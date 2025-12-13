// // models/CallSession.ts - UPDATED VERSION
// import { supabase } from "../utils/supabase.js";
// import { log } from "../utils/logger.js";
// // import { ToolRouter } from "../core/functionRouter.js";
// import { searchKnowledgeBase } from "../core/knowledgeBase.js";

// export interface CreateCallProps {
//   callSid: string;
//   from: string;
//   to: string;
// }

// export class CallSession {
//   callSid: string;
//   from: string;
//   to: string;
//   callId: string | null = null;
//   businessId: string | null = null;
//   business: any = null;
//   businessConfig: any = null;
//   businessPrompt: string | null = null;
//   transcriptBuffers: string[] = [];
//   startedAt: string = new Date().toISOString();

//   constructor(props: CreateCallProps) {
//     this.callSid = props.callSid;
//     this.from = props.from;
//     this.to = props.to;
//   }

//   async loadBusinessAndConfig() {
//     // Look up business by phone number
//     const { data: phoneEndpoint } = await supabase
//       .from("phone_endpoints")
//       .select("business_id")
//       .eq("phone_number", this.to)
//       .eq("channel_type", "voice")
//       .eq("status", "active")
//       .limit(1)
//       .single();

//     if (!phoneEndpoint) throw new Error("Phone number not found");

//     this.businessId = phoneEndpoint.business_id;

//     // Load business
//     const { data: business } = await supabase
//       .from("business")
//       .select("*")
//       .eq("id", this.businessId)
//       .limit(1)
//       .single();

//     if (!business) throw new Error("Business not found");
//     this.business = business;

//     // Load business config
//     const { data: config } = await supabase
//       .from("business_configs")
//       .select("config")
//       .eq("business_id", this.businessId)
//       .limit(1)
//       .single();

//     this.businessConfig = config?.config || {};

//     // Load business prompt
//     const { data: prompt } = await supabase
//       .from("business_prompts")
//       .select("system_prompt")
//       .eq("business_id", this.businessId)
//       .limit(1)
//       .single();

//     this.businessPrompt = prompt?.system_prompt || this.buildFallbackPrompt();

//     log.info("Loaded business config", { businessId: this.businessId });
//   }

//   buildFallbackPrompt(): string {
//     const businessName = this.business?.name || "Our business";
//     const defaultLanguage = this.business?.default_language || "en";

//     return `You are an AI receptionist for ${businessName}.
//     Speak in ${defaultLanguage}. Be friendly, professional, and helpful.
//     If you don't know something, say so politely and offer to help in another way.`;
//   }

//   async createCallRow(twilioMeta: Record<string, any> = {}) {
//     const { data, error } = await supabase
//       .from("calls")
//       .insert({
//         business_id: this.businessId,
//         caller_phone: this.from,
//         started_at: this.startedAt,
//         metadata: twilioMeta,
//       })
//       .select()
//       .single();

//     if (error) {
//       log.error("createCallRow error", error);
//       throw error;
//     }

//     this.callId = data.id;

//     // Also create call_log entry
//     await supabase
//       .from("call_logs")
//       .insert({
//         business_id: this.businessId,
//         channel: "voice",
//         twilio_sid: this.callSid,
//         caller: this.from,
//         status: "in_progress",
//         start_time: this.startedAt,
//       });

//     return this.callId;
//   }

//   async searchKnowledge(query: string, topK = 3) {
//     if (!this.businessId) return [];

//     return await searchKnowledgeBase(this.businessId, query, topK);
//   }

//   pushTranscriptSegment(seg: string) {
//     if (!seg) return;
//     this.transcriptBuffers.push(seg);
//   }

//   getTranscript() {
//     return this.transcriptBuffers.join("\n");
//   }

//   async persistTranscriptAndSummary(summary?: string) {
//     const content = this.getTranscript();

//     // Save transcript
//     const { error: transcriptError } = await supabase
//       .from("transcripts")
//       .insert({
//         call_id: this.callId,
//         content,
//         summary: summary || this.generateSummary(content),
//       });

//     if (transcriptError) log.error("persistTranscript error", transcriptError);

//     // Update call_log with outcome
//     const outcome = this.determineOutcome(content);
//     await supabase
//       .from("call_logs")
//       .update({
//         status: "completed",
//         outcome: outcome,
//         summary: summary || this.generateSummary(content),
//         end_time: new Date().toISOString(),
//       })
//       .eq("twilio_sid", this.callSid);
//   }

//   generateSummary(content: string): string {
//     // Simple summary - you can improve this with AI later
//     const lines = content.split('\n');
//     const lastLines = lines.slice(-5).join(' ');
//     return `Call about: ${lastLines.substring(0, 100)}...`;
//   }

//   determineOutcome(content: string): string {
//     // Simple outcome detection
//     if (content.toLowerCase().includes("book") || content.toLowerCase().includes("appointment")) {
//       return "booking_created";
//     } else if (content.toLowerCase().includes("thank you") || content.toLowerCase().includes("bye")) {
//       return "info_only";
//     } else {
//       return "unknown";
//     }
//   }

//   async finalizeCall() {
//     const endedAt = new Date().toISOString();

//     const { error } = await supabase
//       .from("calls")
//       .update({
//         ended_at: endedAt,
//       })
//       .eq("id", this.callId);

//     if (error) log.error("finalizeCall error", error);
//   }
// }

// models/CallSession.ts
import { supabase } from "../utils/supabase.js";
import { log } from "../utils/logger.js";
import OpenAI from "openai";

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
  conversationContext: any[] = [];
  startedAt: string = new Date().toISOString();
  openaiSessionId: string | null = null;
  currentResponseId: string | null = null;

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
        log.error("Phone endpoint not found", { to: this.to, phoneError });
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

      log.info("Loaded business and config", { businessId: this.businessId });

      if (businessError || !business) {
        log.error("Business not found", {
          businessId: this.businessId,
          businessError,
        });
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

      log.info("Business config loaded", { businessId: this.businessId });

      this.businessConfig = config?.config || {};

      // Load business prompt
      const { data: prompt, error: promptError } = await supabase
        .from("business_prompts")
        .select("system_prompt")
        .eq("business_id", this.businessId)
        .limit(1)
        .maybeSingle();

      log.info("Business prompt loaded", { businessId: this.businessId });

      this.businessPrompt = prompt?.system_prompt || this.buildFallbackPrompt();

      log.info("Business loaded successfully", {
        businessId: this.businessId,
        businessName: this.business.name,
        hasConfig: !!this.businessConfig,
        hasPrompt: !!this.businessPrompt,
      });

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

  async createCallRow(twilioMeta: Record<string, any> = {}) {
    try {
      const { data, error } = await supabase
        .from("calls")
        .insert({
          business_id: this.businessId,
          caller_phone: this.from,
          //   direction: this.direction,
          started_at: this.startedAt,
          metadata: {
            ...twilioMeta,
            call_sid: this.callSid,
            to: this.to,
            business_id: this.businessId,
          },
        })
        .select()
        .single();

      if (error) {
        log.error("createCallRow error", error);
        throw error;
      }

      this.callId = data.id;

      // Create call_log entry
      await supabase.from("call_logs").insert({
        business_id: this.businessId,
        channel: "voice",
        twilio_sid: this.callSid,
        caller: this.from,
        status: "in_progress",
        start_time: this.startedAt,
        metadata: {
          business_name: this.business?.name,
          business_id: this.businessId,
          call_id: this.callId,
        },
      });

      log.info("Call row created", { callId: this.callId });
      return this.callId;
    } catch (error: any) {
      log.error("Failed to create call row", error);
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
        // Search with conversation context
        searchResults = await VectorSearchService.searchWithContext(
          this.businessId!,
          this.conversationContext,
          {
            includeHistory: true,
            topK: options.topK || 5,
          }
        );
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
      log.error("RAG search failed", {
        businessId: this.businessId,
        query,
        error: error.message,
      });

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
      return "No relevant business information found.";
    }

    const formattedSnippets = snippets.map((snippet, index) => {
      const confidence = Math.round(snippet.similarity * 100);
      const source = snippet.source ? ` (Source: ${snippet.source})` : "";
      return `[${index + 1}, Confidence: ${confidence}%] ${
        snippet.content
      }${source}`;
    });

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
      minSimilarity: 0.6, // Require at least 60% similarity
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
    if (!this.businessId || !query?.trim()) return [];

    try {
      // First try exact matches
      const { data: exactMatches } = await supabase
        .from("knowledge_base_chunks")
        .select("content")
        .eq("business_id", this.businessId)
        .textSearch("content", query.split(" ").join(" & "))
        .limit(topK);

      if (exactMatches && exactMatches.length > 0) {
        return exactMatches.map((c) => c.content);
      }

      // Fallback to partial matches
      const { data: partialMatches } = await supabase
        .from("knowledge_base_chunks")
        .select("content")
        .eq("business_id", this.businessId)
        .or(`content.ilike.%${query}%,content.ilike.%${query.split(" ")[0]}%`)
        .limit(topK);

      return partialMatches?.map((c) => c.content) || [];
    } catch (error) {
      log.error("Knowledge base search error", error);
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

    // Add dynamic business info
    const businessName = this.business?.name || "Our business";
    const industry = this.business?.industry || "business";
    const defaultLanguage = "en";
    // const defaultLanguage = this.business?.default_language || "en";
    // const supportedLanguages = this.business?.supported_languages || ["en"];
    const tone = this.business?.tone || "friendly, professional";

    // Get dynamic info (these could be cached)
    const hoursTextPromise = this.getBusinessHoursText();
    const servicesTextPromise = this.getServicesText();

    // For now, we'll add placeholders and update them in real-time if needed
    const enhancedPrompt = `${basePrompt}

BUSINESS DETAILS:
- Name: ${businessName}
- Industry: ${industry}
- Primary Language: ${defaultLanguage}
- Tone: ${tone}
- Always Talk in English

CRITICAL RULES FOR APPOINTMENT BOOKING:
1. **NEVER** say an appointment is booked unless you have ACTUALLY used the 'book_appointment' tool
2. **ALWAYS** gather ALL required information BEFORE using any booking tool:
3. **DO NOT** make up confirmation numbers or times - wait for the actual tool response
4. **VERIFY** information with the caller before using any tool

IMPORTANT REMINDERS:
1. NEVER reveal you're an AI or mention OpenAI/ChatGPT.
2. If unsure about anything, ask the caller to hold while you check or offer to take a message.
3. Always confirm important details like appointments or contact information.
4. Be patient and repeat information if needed.
5. If the caller is upset, remain calm and offer to transfer to a human.

CRITICAL: You MUST use tools for booking appointments. Follow these exact steps:

1. When caller mentions booking: "I can book that for you. I need a few details first."
2. Collect ALL required information:
   - Name
   - Phone number
   - Service type
   - Preferred date (YYYY-MM-DD)
   - Preferred time (HH:MM 24-hour)

3. After collecting ALL information, USE THE 'book_appointment' TOOL.
   DO NOT say "booked" or "confirmed" before using the tool.
   Wait for the tool response, then read it verbatim.

EXAMPLE DIALOGUE:
Caller: "I want a haircut tomorrow at 2pm"
You: "I can help with that! First, what's your full name?"
[collect name]
You: "And your phone number for confirmation?"
[collect phone]
You: "Let me book that for you..."
[USE 'book_appointment' TOOL WITH COLLECTED INFO]
[READ TOOL RESPONSE]
You: "The booking system confirms: [read tool response]"

NEVER invent confirmations. ALWAYS wait for tool response.
If tool fails, say: "I'm having system issues. Can I take your details and have someone call back?"

For questions about:
- Hours: Check the business hours information
- Services: Refer to the services list
- Pricing: If not in knowledge base, say "I don't have pricing details, but I can connect you with someone who does"
- Appointments: Use the booking tool with all required information`;

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

  getTranscript(): string {
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
      log.error("Failed to generate AI summary", error);
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

  async persistTranscriptAndSummary() {
    try {
      const transcript = this.getTranscript();
      const summary = await this.generateSummaryWithAI();
      const outcome = this.determineOutcome();

      // Save transcript
      const { error: transcriptError } = await supabase
        .from("transcripts")
        .insert({
          call_id: this.callId,
          business_id: this.businessId,
          content: transcript,
          summary: summary,
          metadata: {
            outcome: outcome,
            conversation_length: this.conversationContext.length,
            business_id: this.businessId,
          },
        });

      if (transcriptError) {
        log.error("persistTranscript error", transcriptError);
      }

      // Update call_log with outcome
      await supabase
        .from("call_logs")
        .update({
          status: "completed",
          outcome: outcome,
          summary: summary,
          end_time: new Date().toISOString(),
          metadata: {
            ...this.businessConfig,
            transcript_length: transcript.length,
            summary_generated: true,
          },
        })
        .eq("twilio_sid", this.callSid);

      // Update calls table
      await supabase
        .from("calls")
        .update({
          ended_at: new Date().toISOString(),
          minutes: Math.ceil(
            (Date.now() - new Date(this.startedAt).getTime()) / 60000
          ),
          metadata: {
            ...(this.businessConfig || {}),
            outcome: outcome,
            summary: summary.substring(0, 200),
          },
        })
        .eq("id", this.callId);

      log.info("Transcript and summary persisted", {
        callId: this.callId,
        outcome,
        summaryLength: summary.length,
      });
    } catch (error: any) {
      log.error("Failed to persist transcript and summary", error);
    }
  }

  async finalizeCall() {
    try {
      const endedAt = new Date().toISOString();

      await supabase
        .from("calls")
        .update({
          ended_at: endedAt,
        })
        .eq("id", this.callId);

      log.info("Call finalized", { callId: this.callId });
    } catch (error: any) {
      log.error("finalizeCall error", error);
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

      log.error("Call marked as failed", { callSid: this.callSid, reason });
    } catch (error: any) {
      log.error("Failed to mark call as failed", error);
    }
  }
}
