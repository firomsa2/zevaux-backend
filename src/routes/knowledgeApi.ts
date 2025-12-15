// routes/knowledgeApi.ts
import { FastifyInstance } from "fastify";
import { supabase } from "../utils/supabase.js";
import { log } from "../utils/logger.js";
import OpenAI from "openai";
import { VectorSearchService } from "../services/vectorSearchService.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function knowledgeRoutes(fastify: FastifyInstance) {
  log.info("Registering knowledge API routes");
  // Get knowledge base stats
  fastify.get(
    "/api/business/:businessId/knowledge/stats",
    async (request, reply) => {
      const { businessId } = request.params as { businessId: string };

      try {
        const stats = await VectorSearchService.getKnowledgeStats(businessId);
        log.info("Knowledge stats retrieved", { businessId, stats });
        return reply.send({ success: true, data: stats });
      } catch (error: any) {
        log.error("Failed to get knowledge stats", error);
        return reply
          .status(500)
          .send({ error: "Failed to get knowledge stats" });
      }
    }
  );

  // Search knowledge base (for testing/debugging)
  fastify.post(
    "/api/business/:businessId/knowledge/search",
    async (request, reply) => {
      const { businessId } = request.params as { businessId: string };
      const { query, topK = 3 } = request.body as any;

      try {
        const results = await VectorSearchService.hybridSearch(
          businessId,
          query,
          {
            vectorTopK: topK,
          }
        );

        return reply.send({
          success: true,
          query,
          results: results.map((r) => ({
            content: r.content.substring(0, 500),
            similarity: r.similarity,
            source: r.source,
            searchType: r.searchType,
          })),
        });
      } catch (error: any) {
        log.error("Knowledge search failed", error);
        return reply.status(500).send({ error: "Search failed" });
      }
    }
  );

  // Test embedding generation
  fastify.post("/api/embeddings/test", async (request, reply) => {
    const { text } = request.body as { text: string };
    log.info("Embedding test requested", { textLength: text.length });

    try {
      const embedding = await VectorSearchService.generateEmbedding(text);
      log.info("Embedding generated", { embeddingLength: embedding.length });

      return reply.send({
        success: true,
        text,
        embeddingLength: embedding.length,
        embeddingFirst5: embedding.slice(0, 5),
      });
    } catch (error: any) {
      log.error("Embedding test failed", error);
      return reply.status(500).send({ error: "Embedding generation failed" });
    }
  });

  // Add document to knowledge base (via n8n webhook)
  fastify.post(
    "/api/webhook/n8n/knowledge-processed",
    async (request, reply) => {
      const payload = request.body as any;

      log.info("Knowledge processed webhook", {
        businessId: payload.businessId,
        documentId: payload.documentId,
        chunkCount: payload.chunks?.length,
      });

      // You can store processing results, update status, etc.
      // This is called by n8n after chunking and embedding

      return reply.send({ success: true, received: true });
    }
  );

  // Clear cache (admin only)
  fastify.post("/api/admin/cache/clear", async (request, reply) => {
    // Clear embedding cache
    (VectorSearchService as any).embeddingCache.clear();

    log.info("Embedding cache cleared");
    return reply.send({ success: true, message: "Cache cleared" });
  });
}
