import { supabase } from "../utils/supabase.js";
import { log } from "../utils/logger.js";
import OpenAI from "openai";
import { VectorSearchService } from "../services/vectorSearchService.js";
import { randomUUID } from "crypto";
import twilio from "twilio";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface CreateCallProps {
  callSid: string;
  from: string;
  to: string;
  direction?: "inbound" | "outbound";
}

export class CallSession {
  callSid: string;
  from: string;
  to: string;
  direction: string;
  callId: string | null = null;
  businessId: string | null = null;
  business: any = null;
  businessConfig: any = null;
  businessPrompt: string | null = null;
  transcriptBuffers: string[] = [];
  transcriptEntries: Array<{ speaker: "user" | "assistant"; text: string }> = [];
  conversationContext: any[] = [];
  startedAt: string = new Date().toISOString();
  openaiSessionId: string | null = null;
  currentResponseId: string | null = null;
  recordingUrl: string | null = null;

  constructor(props: CreateCallProps) {
    this.callSid = props.callSid;
    this.from = props.from;
    this.to = props.to;
    this.direction = props.direction || "inbound";
    console.log("CallSession created", {
      callSid: this.callSid,
      from: this.from,
      to: this.to,
      direction: this.direction,
    });
  }

  async loadBusinessAndConfig() {
    try {
      // Look up business by phone number
      const { data: phoneEndpoint, error: phoneError } = await supabase
        .from("phone_endpoints")
        .select("business_id")
        .eq("phone_number", this.to)
        .eq("channel_type", "voice")
        .eq("status", "active")
        .limit(1)
        .single();

      if (phoneError || !phoneEndpoint) {
        // log.error("Phone endpoint not found", { to: this.to, phoneError });
        throw new Error("Phone number not configured for any business");
      }

      this.businessId = phoneEndpoint.business_id;

      // Load business
      const { data: business, error: businessError } = await supabase
        .from("businesses")
        .select("*")
        .eq("id", this.businessId)
        .limit(1)
        .single();

      // log.info("Loaded business and config", { businessId: this.businessId });

      if (businessError || !business) {
        // log.error("Business not found", {
        //   businessId: this.businessId,
        //   businessError,
        // });
        throw new Error("Business configuration not found");
      }

      this.business = business;

      // Load business config
      const { data: config, error: configError } = await supabase
        .from("business_configs")
        .select("config")
        .eq("business_id", this.businessId)
        .limit(1)
        .maybeSingle();

      // log.info("Business config loaded", { businessId: this.businessId });

      this.businessConfig = config?.config || {};

      // Load business prompt
      const { data: prompt, error: promptError } = await supabase
        .from("business_prompts")
        .select("system_prompt")
        .eq("business_id", this.businessId)
        .limit(1)
        .maybeSingle();

      // log.info("Business prompt loaded", { businessId: this.businessId });

      this.businessPrompt = prompt?.system_prompt || this.buildFallbackPrompt();

      // log.info("Business loaded successfully", {
      //   businessId: this.businessId,
      //   businessName: this.business.name,
      //   hasConfig: !!this.businessConfig,
      //   hasPrompt: !!this.businessPrompt,
      // });

      return true;
    } catch (error: any) {
      log.error("Failed to load business and config", error);
      throw error;
    }
  }

  buildFallbackPrompt(): string {
    const businessName = this.business?.name || "Our business";
    const defaultLanguage = this.business?.default_language || "en";
    const tone = this.business?.tone || "friendly, professional";
    const industry = this.business?.industry || "business";

    return `You are ${businessName}'s AI receptionist for ${industry}.

CRITICAL RULES:
1. NEVER say you are ChatGPT, OpenAI, or an AI. You are ${businessName}'s virtual assistant.
2. ALWAYS be ${tone}.
3. Speak in ${defaultLanguage}.
4. If you don't know something, say: "I don't have that information, but I'll make sure the team gets your question."
5. Never give medical, legal, or financial advice.
6. Keep responses concise and helpful.

Start every call with: "Thanks for calling ${businessName}, how can I help you today?"

End calls politely with: "Thanks for calling ${businessName}, have a great day!"`;
  }

  /**
   * Create call log entry in call_logs table (primary table for call tracking)
   * Returns the call_logs id which is stored in this.callId
   */
  async createCallRow(twilioMeta: Record<string, any> = {}) {
    try {
      // Create call_log entry (primary table for call tracking)
      const { data, error } = await supabase
        .from("call_logs")
        .insert({
          business_id: this.businessId,
          channel: "voice",
          twilio_sid: this.callSid,
          caller: this.from,
          status: "in_progress",
          start_time: this.startedAt,
          metadata: {
            business_name: this.business?.name,
            business_id: this.businessId,
            to: this.to,
            from: this.from,
            direction: this.direction,
            ...twilioMeta,
            call_sid: this.callSid,
          },
        })
        .select()
        .single();

      if (error) {
        log.error(
          {
            error,
            callSid: this.callSid,
            businessId: this.businessId,
          },
          "Failed to create call_log entry"
        );
        throw error;
      }

      // Store the call_logs id as callId (used for transcript references)
      this.callId = data.id;

      log.info(
        {
          callId: this.callId,
          callSid: this.callSid,
          businessId: this.businessId,
        },
        "Call log entry created"
      );

      return this.callId;
    } catch (error: any) {
      log.error(
        {
          error: error?.message || error,
          stack: error?.stack,
          callSid: this.callSid,
        },
        "Failed to create call row"
      );
      throw error;
    }
  }

  async searchKnowledgeWithRAG(
    query: string,
    options: {
      includeConversationContext?: boolean;
      topK?: number;
      minSimilarity?: number;
    } = {}
  ): Promise<{
    snippets: Array<{
      content: string;
      similarity: number;
      source?: string;
    }>;
    formattedContext: string;
    searchMethod: string;
  }> {
    // log.info("Starting RAG knowledge search", {
    //   businessId: this.businessId,
    //   query,
    // });
    try {
      let searchResults: Array<{
        content: string;
        similarity: number;
        source?: string;
        metadata?: any;
        searchType?: string;
      }> = [];

      if (
        options.includeConversationContext &&
        this.conversationContext.length > 0
      ) {
        // log.info("Searching with conversation context", {
        //   businessId: this.businessId,
        //   contextLength: this.conversationContext.length,
        // });
        // Search with conversation context
        searchResults = await VectorSearchService.searchWithContext(
          this.businessId!,
          this.conversationContext,
          {
            includeHistory: true,
            topK: options.topK || 5,
          }
        );
        // log.info("Contextual search results", {
        //   resultCount: searchResults.length,
        // });
      } else {
        // Search just the current query
        searchResults = await VectorSearchService.hybridSearch(
          this.businessId!,
          query,
          {
            vectorTopK: options.topK || 5,
            minSimilarity: options.minSimilarity,
          }
        );
        // log.info("Query-only search results", {
        //   resultCount: searchResults.length,
        // });
      }
      // Filter out low similarity results
      const filteredResults = searchResults.filter(
        (r) => r.similarity >= (options.minSimilarity || 0.5)
      );

      // Format for OpenAI context
      const formattedContext = this.formatKnowledgeSnippets(filteredResults);

      return {
        snippets: filteredResults,
        formattedContext,
        searchMethod: searchResults[0]?.searchType || "hybrid",
      };
    } catch (error: any) {
      // log.error("RAG search failed", {
      //   businessId: this.businessId,
      //   query,
      //   error: error.message,
      // });

      return {
        snippets: [],
        formattedContext: "",
        searchMethod: "none",
      };
    }
  }

  private formatKnowledgeSnippets(
    snippets: Array<{
      content: string;
      similarity: number;
      source?: string;
    }>
  ): string {
    if (!snippets.length) {
      log.info("No knowledge snippets to format");
      return "No relevant business information found.";
    }
    // log.info("Formatting knowledge snippets", {
    //   snippetCount: snippets.length,
    // });

    const formattedSnippets = snippets.map((snippet, index) => {
      const confidence = Math.round(snippet.similarity * 100);
      const source = snippet.source ? ` (Source: ${snippet.source})` : "";
      return `[${index + 1}, Confidence: ${confidence}%] ${
        snippet.content
      }${source}`;
    });
    // log.info("Formatted knowledge snippets", {
    //   snippetCount: formattedSnippets.length,
    // });

    return `BUSINESS KNOWLEDGE BASE (Relevant Information):
${formattedSnippets.join("\n\n")}

IMPORTANT: Use this information to answer accurately. If the information above doesn't fully answer the question, say what you know from above and ask for clarification if needed.`;
  }

  // Enhanced RAG with conversation history
  async getContextualKnowledge(query: string): Promise<{
    knowledgeContext: string;
    hasRelevantInfo: boolean;
    confidence: number;
  }> {
    // Get business hours and services from config (static info)
    const staticInfo = await this.getStaticBusinessInfo();

    // Get dynamic knowledge from RAG
    const ragResult = await this.searchKnowledgeWithRAG(query, {
      includeConversationContext: true,
      topK: 3,
      minSimilarity: 0.5, // Require at least 60% similarity
    });

    // Combine static and dynamic information
    const combinedContext = `${staticInfo}\n\n${ragResult.formattedContext}`;

    // Calculate overall confidence
    const avgSimilarity =
      ragResult.snippets.length > 0
        ? ragResult.snippets.reduce((sum, s) => sum + s.similarity, 0) /
          ragResult.snippets.length
        : 0;

    return {
      knowledgeContext: combinedContext,
      hasRelevantInfo: ragResult.snippets.length > 0,
      confidence: avgSimilarity,
    };
  }

  async getStaticBusinessInfo(): Promise<string> {
    const hours = await this.getBusinessHoursText();
    const services = await this.getServicesText();

    return `BUSINESS INFORMATION:
- Hours: ${hours}
- Services: 
${services}

RULES:
1. Always refer to the business hours and services above when answering related questions.
2. If the caller asks about something not in the services list, say it's not offered and suggest alternatives.`;
  }

  // Method to log RAG usage for analytics
  async logRAGUsage(
    query: string,
    results: any[],
    usedInResponse: boolean
  ): Promise<void> {
    try {
      await supabase.from("rag_usage_logs").insert({
        business_id: this.businessId,
        call_id: this.callId,
        query: query.substring(0, 500), // Limit length
        result_count: results.length,
        top_similarity: results[0]?.similarity || 0,
        used_in_response: usedInResponse,
        metadata: {
          business_name: this.business?.name,
          call_sid: this.callSid,
          query_length: query.length,
        },
      });
    } catch (error: any) {
      log.error("Failed to log RAG usage", error);
    }
  }

  async searchKnowledge(query: string, topK = 3): Promise<string[]> {
    // log.info("Searching knowledge base", {
    //   businessId: this.businessId,
    //   query,
    // });
    if (!this.businessId || !query?.trim()) return [];
    // log.info("Performing knowledge base search", {
    //   businessId: this.businessId,
    //   query,
    //   topK,
    // });

    try {
      // First try exact matches
      const { data: exactMatches } = await supabase
        .from("knowledge_base_chunks")
        .select("content")
        .eq("business_id", this.businessId)
        .textSearch("content", query.split(" ").join(" & "))
        .limit(topK);

      // log.info("Exact match search results", {
      //   businessId: this.businessId,
      //   query,
      //   exactMatchCount: exactMatches?.length || 0,
      // });
      if (exactMatches && exactMatches.length > 0) {
        return exactMatches.map((c) => c.content);
      }
      // log.info("No exact matches found, trying partial matches", {
      //   businessId: this.businessId,
      //   query,
      // });

      // Fallback to partial matches
      const { data: partialMatches } = await supabase
        .from("knowledge_base_chunks")
        .select("content")
        .eq("business_id", this.businessId)
        .or(`content.ilike.%${query}%,content.ilike.%${query.split(" ")[0]}%`)
        .limit(topK);

      // log.info("Partial match search results", {
      //   businessId: this.businessId,
      //   query,
      //   partialMatchCount: partialMatches?.length || 0,
      // });

      return partialMatches?.map((c) => c.content) || [];
    } catch (error) {
      // log.error("Knowledge base search error", error);
      return [];
    }
  }

  async getBusinessHoursText(): Promise<string> {
    if (!this.businessConfig?.hours) return "Not specified";

    const hours = this.businessConfig.hours;
    const days = {
      monday: "Monday",
      tuesday: "Tuesday",
      wednesday: "Wednesday",
      thursday: "Thursday",
      friday: "Friday",
      saturday: "Saturday",
      sunday: "Sunday",
    };

    const hourEntries = Object.entries(hours)
      .filter(([_, value]) => value && Array.isArray(value) && value.length > 0)
      .map(([day, periods]: [string, any]) => {
        const dayName = days[day as keyof typeof days] || day;
        const periodsText = periods
          .map((p: any) => `${p.open} to ${p.close}`)
          .join(" and ");
        return `${dayName}: ${periodsText}`;
      });

    return hourEntries.length > 0 ? hourEntries.join(", ") : "Not specified";
  }

  async getServicesText(): Promise<string> {
    if (
      !this.businessConfig?.services ||
      !Array.isArray(this.businessConfig.services)
    ) {
      return "No specific services listed";
    }

    return this.businessConfig.services
      .map((s: any) => `- ${s.name} (${s.durationMinutes || 30} minutes)`)
      .join("\n");
  }

  buildEnhancedSystemPrompt(): string {
    const basePrompt = this.businessPrompt || this.buildFallbackPrompt();
    
    const enhancedPrompt = `${basePrompt}

KNOWLEDGE BASE USAGE:
You have access to a knowledge base search tool (${`search_knowledge_base`}) that contains detailed business information.

INFORMATION RETRIEVAL STRATEGY:
1. First, check if the information is already provided in the context above (base prompt, previous conversation, or system messages).
2. If the information is NOT available in the current context, use the ${`search_knowledge_base`} tool to search for it.
3. Only use the knowledge base when you genuinely don't have the information needed to answer the caller's question.
4. When using the knowledge base, search with clear, specific queries related to what the caller is asking.

EXAMPLES:
- Caller asks about pricing → If not in context, search knowledge base with query like "pricing" or "cost"
- Caller asks about services → If not in context, search knowledge base with query like "services offered" or "what services do you provide"
- Caller asks about hours → If not in context, search knowledge base with query like "business hours" or "opening hours"
- Caller asks about policies → If not in context, search knowledge base with query related to the specific policy

IMPORTANT:
- Always try to answer from context first before searching
- Use natural, conversational search queries
- If the knowledge base doesn't have the information, politely inform the caller and offer alternatives (e.g., "I don't have that specific information, but I can connect you with someone who does" or "Let me take your contact information and have someone get back to you")
- For appointment bookings, use the appropriate booking tool with all required information`;

    return enhancedPrompt;
  }

  pushTranscriptSegment(seg: string, speaker: "user" | "ai" = "ai") {
    if (!seg?.trim()) return;

    const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
    const prefix = speaker === "user" ? "Caller" : "Assistant";
    this.transcriptBuffers.push(`[${timestamp}] ${prefix}: ${seg.trim()}`);

    // Keep conversation context for RAG
    this.conversationContext.push({
      role: speaker === "user" ? "user" : "assistant",
      content: seg.trim(),
      timestamp: new Date().toISOString(),
    });

    // Keep last 20 messages in context
    if (this.conversationContext.length > 20) {
      this.conversationContext = this.conversationContext.slice(-20);
    }
  }

  /**
   * Add transcript entry in Vapi-compatible format (User/AI format)
   * Includes deduplication to prevent duplicate entries
   */
  addTranscriptEntry(speaker: "user" | "assistant", text: string) {
    if (!text?.trim()) return;

    const trimmedText = text.trim();

    // Deduplication: Check if the same text was recently added (within last 3 entries)
    // This prevents duplicate transcript entries from OpenAI events
    const recentEntries = this.transcriptEntries.slice(-3);
    const isDuplicate = recentEntries.some(
      (entry) =>
        entry.speaker === speaker &&
        entry.text.toLowerCase() === trimmedText.toLowerCase()
    );

    if (isDuplicate) {
      log.info(
        {
          speaker,
          textLength: trimmedText.length,
        },
        "Skipping duplicate transcript entry"
      );
      return;
    }

    // Filter out very short or meaningless entries (less than 2 characters)
    if (trimmedText.length < 2) {
      return;
    }

    // Store in the new format for Vapi compatibility
    this.transcriptEntries.push({
      speaker: speaker,
      text: trimmedText,
    });

    // Also keep the old format for backward compatibility
    const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
    const prefix = speaker === "user" ? "Caller" : "Assistant";
    this.transcriptBuffers.push(`[${timestamp}] ${prefix}: ${trimmedText}`);

    // Keep conversation context for RAG
    this.conversationContext.push({
      role: speaker,
      content: trimmedText,
      timestamp: new Date().toISOString(),
    });

    // Keep last 20 messages in context
    if (this.conversationContext.length > 20) {
      this.conversationContext = this.conversationContext.slice(-20);
    }
  }

  /**
   * Get transcript in Vapi format: "User: ...\nAI: ...\nUser: ..."
   */
  getTranscript(): string {
    // Use the new format if available, otherwise fall back to old format
    if (this.transcriptEntries.length > 0) {
      return this.transcriptEntries
        .map((entry) => {
          const prefix = entry.speaker === "user" ? "User" : "AI";
          return `${prefix}: ${entry.text}`;
        })
        .join("\n");
    }
    return this.transcriptBuffers.join("\n");
  }

  /**
   * Get transcript in the old format (with timestamps)
   */
  getTranscriptWithTimestamps(): string {
    return this.transcriptBuffers.join("\n");
  }

  async generateSummaryWithAI(): Promise<string> {
    const transcript = this.getTranscript();
    if (!transcript || transcript.length < 50) {
      return "Short call with no significant content.";
    }

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Summarize this phone call transcript in 1-2 sentences. Include key topics discussed and outcome if any.",
          },
          {
            role: "user",
            content: `Transcript:\n${transcript}\n\nSummary:`,
          },
        ],
        max_tokens: 150,
        temperature: 0.3,
      });

      return completion.choices[0]?.message?.content || "Call completed.";
    } catch (error) {
      // log.error("Failed to generate AI summary", error);
      return this.generateSimpleSummary();
    }
  }

  generateSimpleSummary(): string {
    const transcript = this.getTranscript();
    const lines = transcript.split("\n");
    const lastLines = lines.slice(-3).join(" ");

    // Look for keywords
    if (
      transcript.toLowerCase().includes("book") ||
      transcript.toLowerCase().includes("appointment")
    ) {
      return "Appointment booking discussion";
    } else if (
      transcript.toLowerCase().includes("price") ||
      transcript.toLowerCase().includes("cost")
    ) {
      return "Pricing inquiry";
    } else if (
      transcript.toLowerCase().includes("hour") ||
      transcript.toLowerCase().includes("open")
    ) {
      return "Business hours inquiry";
    } else if (lines.length > 5) {
      return "Detailed conversation about services";
    } else {
      return "Brief inquiry call";
    }
  }

  determineOutcome(): string {
    const transcript = this.getTranscript().toLowerCase();

    if (
      transcript.includes("book") &&
      (transcript.includes("confirm") || transcript.includes("thank"))
    ) {
      return "booking_confirmed";
    } else if (
      transcript.includes("book") ||
      transcript.includes("appointment")
    ) {
      return "booking_inquiry";
    } else if (
      transcript.includes("price") ||
      transcript.includes("cost") ||
      transcript.includes("how much")
    ) {
      return "pricing_inquiry";
    } else if (
      transcript.includes("hour") ||
      transcript.includes("open") ||
      transcript.includes("close")
    ) {
      return "hours_inquiry";
    } else if (
      transcript.includes("angry") ||
      transcript.includes("upset") ||
      transcript.includes("complaint")
    ) {
      return "escalated_call";
    } else if (transcript.includes("thank") && transcript.includes("bye")) {
      return "successful_call";
    } else {
      return "general_inquiry";
    }
  }

  /**
   * Fetch recording URL from Twilio for this call
   */
  async fetchRecordingUrl(): Promise<string | null> {
    try {
      // If we already have a recording URL, return it
      if (this.recordingUrl) {
        return this.recordingUrl;
      }

      // Try to fetch from Twilio
      if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
        log.warn("Twilio credentials not configured, skipping recording URL fetch");
        return null;
      }

      const twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );

      // Fetch recordings for this call
      const recordings = await twilioClient.recordings.list({
        callSid: this.callSid,
        limit: 1,
      });

      if (recordings && recordings.length > 0) {
        const recording = recordings[0];
        // Get the recording URL (WAV format)
        const recordingUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${recording.sid}.wav`;
        this.recordingUrl = recordingUrl;
        return recordingUrl;
      }

      return null;
    } catch (error: any) {
      log.error("Failed to fetch recording URL from Twilio", error);
      return null;
    }
  }

  async persistTranscriptAndSummary() {
    try {
      const transcript = this.getTranscript();
      const summary = await this.generateSummaryWithAI();
      const outcome = this.determineOutcome();

      // Try to fetch recording URL if not already set
      if (!this.recordingUrl) {
        await this.fetchRecordingUrl();
      }

      // Generate a unique ID for this transcript entry (similar to Vapi format)
      const transcriptId = randomUUID();
      const createdAt = new Date().toISOString();

      // Save transcript in Vapi-compatible format
      // The format matches: {idx, id, call_id, content, summary, Vapi_call_id, created_at, recording_URL, business_id}
      const transcriptData: any = {
        id: transcriptId,
        call_id: this.callId,
        business_id: this.businessId,
        content: transcript,
        summary: summary,
        created_at: createdAt,
        // Store Twilio call SID as equivalent to Vapi_call_id
        Vapi_call_id: this.callSid,
        // Store metadata as JSONB (transcripts table has metadata column)
        metadata: {
          outcome: outcome,
          conversation_length: this.conversationContext.length,
          business_id: this.businessId,
          call_sid: this.callSid,
          twilio_call_id: this.callSid,
        },
      };

      // Add recording URL if available
      if (this.recordingUrl) {
        transcriptData.recording_URL = this.recordingUrl;
        transcriptData.metadata.recording_url = this.recordingUrl;
      }

      // Save transcript
      const { data: insertedTranscript, error: transcriptError } = await supabase
        .from("transcripts")
        .insert(transcriptData)
        .select()
        .single();

      if (transcriptError) {
        // Check if it's a foreign key constraint error
        if (
          transcriptError.code === "23503" &&
          transcriptError.message?.includes("calls")
        ) {
          log.error(
            {
              error: transcriptError,
              callId: this.callId,
              callSid: this.callSid,
              hint: "The transcripts table foreign key still references 'calls' table. Run the migration SQL to update it to reference 'call_logs'.",
            },
            "persistTranscript error: Foreign key constraint violation"
          );
        } else {
          log.error(
            {
              error: transcriptError,
              callId: this.callId,
              callSid: this.callSid,
            },
            "persistTranscript error"
          );
        }
      } else {
        log.info(
          {
            transcriptId: insertedTranscript?.id,
            callId: this.callId,
          },
          "Transcript saved successfully"
        );
      }

      // Calculate call duration in minutes
      const endTime = new Date().toISOString();
      const startTime = new Date(this.startedAt);
      const endTimeDate = new Date(endTime);
      const durationMs = endTimeDate.getTime() - startTime.getTime();
      const minutes = Math.ceil(durationMs / 60000); // Round up to nearest minute
      const durationSeconds = Math.ceil(durationMs / 1000);

      // Update call_logs with outcome, summary, end_time, and minutes
      // Note: minutes column should be added to call_logs table. If it doesn't exist,
      // the error will be logged but minutes will still be stored in metadata
      const updateData: any = {
        status: "completed",
        outcome: outcome,
        summary: summary,
        end_time: endTime,
        minutes: minutes, // Add minutes column (add this column to call_logs table if it doesn't exist)
        metadata: {
          ...this.businessConfig,
          transcript_length: transcript.length,
          summary_generated: true,
          transcript_id: transcriptId,
          duration_ms: durationMs,
          duration_seconds: durationSeconds,
          minutes: minutes, // Also store in metadata as backup
        },
      };

      const { error: callLogUpdateError } = await supabase
        .from("call_logs")
        .update(updateData)
        .eq("twilio_sid", this.callSid);

      if (callLogUpdateError) {
        log.error(
          {
            error: callLogUpdateError,
            callId: this.callId,
            callSid: this.callSid,
          },
          "Failed to update call_logs"
        );
      } else {
        log.info(
          {
            callId: this.callId,
            callSid: this.callSid,
            minutes,
            durationSeconds: Math.ceil(durationMs / 1000),
          },
          "Call log updated with completion data"
        );
      }

      // log.info("Transcript and summary persisted", {
      //   callId: this.callId,
      //   outcome,
      //   summaryLength: summary.length,
      // });
    } catch (error: any) {
      log.error("Failed to persist transcript and summary", error);
    }
  }

  /**
   * Set the recording URL for this call (from Twilio)
   */
  setRecordingUrl(url: string) {
    this.recordingUrl = url;
  }

  /**
   * Finalize the call in call_logs table
   * This is called when the call ends to ensure end_time is set
   * Minutes calculation is handled in persistTranscriptAndSummary
   */
  async finalizeCall() {
    try {
      const endedAt = new Date().toISOString();
      const startTime = new Date(this.startedAt);
      const endTimeDate = new Date(endedAt);
      const durationMs = endTimeDate.getTime() - startTime.getTime();
      const minutes = Math.ceil(durationMs / 60000);

      // Update call_logs with end_time and minutes (if not already updated by persistTranscriptAndSummary)
      // Note: minutes column should be added to call_logs table. If it doesn't exist,
      // the error will be logged but minutes will still be stored in metadata
      const updateData: any = {
        end_time: endedAt,
        minutes: minutes, // Add minutes column (add this column to call_logs table if it doesn't exist)
        status: "completed", // Ensure status is set to completed
        metadata: {
          duration_ms: durationMs,
          duration_seconds: Math.ceil(durationMs / 1000),
          minutes: minutes, // Also store in metadata as backup
        },
      };

      const { error } = await supabase
        .from("call_logs")
        .update(updateData)
        .eq("twilio_sid", this.callSid);

      if (error) {
        log.error(
          {
            error,
            callId: this.callId,
            callSid: this.callSid,
          },
          "Failed to finalize call in call_logs"
        );
      } else {
        log.info(
          {
            callId: this.callId,
            callSid: this.callSid,
            minutes,
          },
          "Call finalized in call_logs"
        );
      }
    } catch (error: any) {
      log.error(
        {
          error: error?.message || error,
          stack: error?.stack,
          callId: this.callId,
          callSid: this.callSid,
        },
        "finalizeCall error"
      );
    }
  }

  async markCallAsFailed(reason: string) {
    try {
      await supabase
        .from("call_logs")
        .update({
          status: "failed",
          outcome: "system_error",
          summary: `Call failed: ${reason}`,
          end_time: new Date().toISOString(),
        })
        .eq("twilio_sid", this.callSid);

      // log.error("Call marked as failed", { callSid: this.callSid, reason });
    } catch (error: any) {
      log.error("Failed to mark call as failed", error);
    }
  }
}

// IMPORTANT REMINDERS:
// 1. NEVER reveal you're an AI or mention OpenAI/ChatGPT.
// 2. If unsure about anything, ask the caller to hold while you check or offer to take a message.
// 3. Always confirm important details like appointments or contact information.
// 4. Be patient and repeat information if needed.
// 5. If the caller is upset, remain calm and offer to transfer to a human.
// 6. USE THE ${`search_knowledge_base`} TOOL for any questions about services do you offer, policies, pricing, specific services, or business details not provided in the initial context.
// For questions about:
// - Hours: Check the business hours information
// - Services: Refer to the services list
// - Pricing: Use ${`search_knowledge_base`}, to find pricing. If not found, say "I don't have pricing details, but I can connect you with someone who does"
// - Appointments: Use the booking tool with all required information`;

// BUSINESS DETAILS:
// - Name: ${businessName}
// - Industry: ${industry}
// - Primary Language: ${defaultLanguage}
// - Tone: ${tone}