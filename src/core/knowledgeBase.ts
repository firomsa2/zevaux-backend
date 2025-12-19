// core/knowledgeBase.ts
import { supabase } from "../utils/supabase.js";
import { log } from "../utils/logger.js";

export async function searchKnowledgeBase(
  businessId: string,
  query: string,
  topK: number = 3
): Promise<string[]> {
  try {
    // Simple text search - you can upgrade to vector search later
    const { data: chunks, error } = await supabase
      .from("knowledge_base_chunks")
      .select("content")
      .eq("business_id", businessId)
      .ilike("content", `%${query}%`)
      .limit(topK);

    if (error) {
      // log.error("Knowledge base search error", error);
      return [];
    }

    return chunks?.map((c) => c.content) || [];
  } catch (error) {
    // log.error("Error searching knowledge base", error);
    return [];
  }
}
