// services/vectorSearchService.ts
import { supabase } from "../utils/supabase.js";
import { log } from "../utils/logger.js";
import OpenAI from "openai";
import { env } from "../config/env.js";

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

function normalize(vec: number[]) {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map((v) => v / norm);
}

export class VectorSearchService {
  // Cache for embeddings to reduce API calls
  private static embeddingCache = new Map<string, number[]>();
  private static cacheTTL = 5 * 60 * 1000; // 5 minutes

  // Generate embedding for a query
  static async generateEmbedding(text: string): Promise<number[]> {
    const cacheKey = text.toLowerCase().trim();

    // Check cache first
    const cached = this.embeddingCache.get(cacheKey);
    if (cached && Date.now() - (cached as any).timestamp < this.cacheTTL) {
      return (cached as any).embedding;
    }

    try {
      const response = await openai.embeddings.create({
        model: "text-embedding-3-small", // or "text-embedding-ada-002"
        input: text,
        encoding_format: "float",
      });

      const embedding = response.data[0].embedding;

      // Cache the result
      this.embeddingCache.set(cacheKey, {
        embedding,
        timestamp: Date.now(),
      });

      // Clean cache periodically (remove old entries)
      this.cleanCache();

      return embedding;
    } catch (error: any) {
      log.error("Failed to generate embedding", {
        error: error.message,
        text: text.substring(0, 100),
      });
      throw error;
    }
  }

  // Search knowledge base with vector similarity
  static async vectorSearch(
    businessId: string,
    query: string,
    options: {
      topK?: number;
      similarityThreshold?: number;
      minSimilarity?: number;
    } = {}
  ): Promise<
    Array<{
      content: string;
      similarity: number;
      source?: string;
      metadata?: any;
    }>
  > {
    try {
      // Generate embedding for the query
      const queryEmbedding = normalize(await this.generateEmbedding(query));

      // Convert to PostgreSQL vector format
      const embeddingStr = `[${queryEmbedding.join(",")}]`;

      const { data: results, error } = await supabase.rpc(
        "search_knowledge_base",
        {
          business_id_param: businessId,
          query_embedding: embeddingStr,
          //   query_embedding: queryEmbedding,
          similarity_threshold: options.similarityThreshold || 0.5,
          match_count: options.topK || 5,
        }
      );

      if (error) {
        log.error("Vector search error", error);
        throw error;
      }

      // Filter by minimum similarity if specified
      const filteredResults = options.minSimilarity
        ? results.filter((r: any) => r.similarity >= options.minSimilarity)
        : results;

      return filteredResults.map((r: any) => ({
        content: r.content,
        similarity: r.similarity,
        metadata: r.metadata,
        source: r.metadata?.source || r.metadata?.file_name || "Unknown",
      }));
    } catch (error: any) {
      log.error("Vector search failed", {
        businessId,
        query,
        error: error.message,
      });

      // Fallback to text search
      return await this.textSearch(businessId, query, options);
    }
  }

  // Fallback text search (for when vector search fails)
  static async textSearch(
    businessId: string,
    query: string,
    options: { topK?: number } = {}
  ): Promise<
    Array<{
      content: string;
      similarity: number;
      source?: string;
    }>
  > {
    try {
      const { data: results, error } = await supabase.rpc(
        "search_knowledge_by_text",
        {
          business_id_param: businessId,
          search_query: query,
          match_count: options.topK || 3,
        }
      );

      if (error) {
        log.error("Text search error", error);
        return [];
      }

      return (results || []).map((r: any) => ({
        content: r.content,
        similarity: 0.5, // Default similarity for text search
        source: r.metadata?.file_name || r.metadata?.source || "Unknown",
      }));
    } catch (error: any) {
      log.error("Text search failed", {
        businessId,
        query,
        error: error.message,
      });
      return [];
    }
  }

  // Hybrid search: Try vector first, fall back to text
  static async hybridSearch(
    businessId: string,
    query: string,
    options: {
      vectorTopK?: number;
      textTopK?: number;
      minSimilarity?: number;
    } = {}
  ): Promise<
    Array<{
      content: string;
      similarity: number;
      source?: string;
      metadata?: any;
      searchType: "vector" | "text";
    }>
  > {
    const vectorResults = await this.vectorSearch(businessId, query, {
      topK: options.vectorTopK || 3,
      minSimilarity: options.minSimilarity,
    });

    // If we got good vector results, use them
    if (vectorResults.length > 0 && vectorResults[0].similarity >= 0.7) {
      return vectorResults.map((r) => ({
        ...r,
        searchType: "vector" as const,
      }));
    }

    // Otherwise, try text search
    const textResults = await this.textSearch(businessId, query, {
      topK: options.textTopK || 3,
    });

    return [
      ...vectorResults.map((r) => ({ ...r, searchType: "vector" as const })),
      ...textResults.map((r) => ({ ...r, searchType: "text" as const })),
    ]
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, options.vectorTopK || 3);
  }

  // Get conversation context (multiple recent messages)
  static async searchWithContext(
    businessId: string,
    conversationContext: Array<{ role: string; content: string }>,
    options: {
      includeHistory?: boolean;
      topK?: number;
    } = {}
  ): Promise<
    Array<{
      content: string;
      similarity: number;
      source?: string;
      metadata?: any;
    }>
  > {
    // Combine last 3-5 user messages for context
    const recentUserMessages = conversationContext
      .filter((msg) => msg.role === "user")
      .slice(-3)
      .map((msg) => msg.content)
      .join(" ");

    const currentQuery =
      conversationContext.filter((msg) => msg.role === "user").pop()?.content ||
      "";

    // Search with combined context
    const searchQuery = options.includeHistory
      ? `${recentUserMessages} ${currentQuery}`
      : currentQuery;

    if (!searchQuery.trim()) {
      return [];
    }

    return await this.hybridSearch(businessId, searchQuery, {
      vectorTopK: options.topK || 5,
    });
  }

  // Clean up cache
  private static cleanCache() {
    const now = Date.now();
    for (const [key, value] of this.embeddingCache.entries()) {
      if (now - (value as any).timestamp > this.cacheTTL) {
        this.embeddingCache.delete(key);
      }
    }
  }

  // Get statistics about knowledge base
  static async getKnowledgeStats(businessId: string): Promise<{
    totalChunks: number;
    totalDocuments: number;
    languages: string[];
    lastUpdated: string | null;
  }> {
    log.info("Fetching knowledge stats", { businessId });
    const { data: chunks, error: chunksError } = await supabase
      .from("knowledge_base_chunks")
      .select("id, created_at")
      .eq("business_id", businessId);

    log.info("Chunks fetched", { count: chunks?.length || 0 });

    const { data: documents, error: docsError } = await supabase
      .from("knowledge_base_documents")
      .select("id, language, updated_at")
      .eq("business_id", businessId);

    log.info("Documents fetched", { count: documents?.length || 0 });

    if (chunksError || docsError) {
      log.error("Failed to get knowledge stats", { chunksError, docsError });
      return {
        totalChunks: 0,
        totalDocuments: 0,
        languages: [],
        lastUpdated: null,
      };
    }

    const languages = Array.from(
      new Set(documents?.map((d) => d.language).filter(Boolean) || [])
    );

    const lastUpdated = documents?.length
      ? documents.reduce((latest, doc) => {
          const docDate = new Date(doc.updated_at || doc.created_at).getTime();
          const latestDate = new Date(latest || 0).getTime();
          return docDate > latestDate ? doc.updated_at : latest;
        }, null as string | null)
      : null;

    return {
      totalChunks: chunks?.length || 0,
      totalDocuments: documents?.length || 0,
      languages,
      lastUpdated,
    };
  }
}
