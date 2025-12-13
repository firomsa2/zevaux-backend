// routes/messaging.ts
import { FastifyInstance } from "fastify";
import { supabase } from "../utils/supabase.js";
import { log } from "../utils/logger.js";
import OpenAI from "openai";

export default async function messagingRoutes(fastify: FastifyInstance) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Handle incoming SMS
  fastify.post("/api/messaging/inbound", async (request, reply) => {
    const params = request.body as Record<string, any>;
    const from = params.From || params.from;
    const to = params.To || params.to;
    const body = params.Body || params.body || "";

    log.info("Incoming SMS", { from, to, body });

    try {
      // Find business by phone number
      const { data: phoneEndpoint } = await supabase
        .from("phone_endpoints")
        .select("business_id")
        .eq("phone_number", to)
        .eq("channel_type", "sms")
        .eq("status", "active")
        .single();

      if (!phoneEndpoint) {
        return reply.status(404).send({ error: "Business not found" });
      }

      // Load business prompt
      const { data: prompt } = await supabase
        .from("business_prompts")
        .select("system_prompt")
        .eq("business_id", phoneEndpoint.business_id)
        .single();

      // Search knowledge base
      const { data: knowledgeChunks } = await supabase
        .from("knowledge_base_chunks")
        .select("content")
        .eq("business_id", phoneEndpoint.business_id)
        .ilike("content", `%${body}%`)
        .limit(3);

      const knowledgeText = knowledgeChunks?.length
        ? `Business Knowledge:\n${knowledgeChunks
            .map((k) => k.content)
            .join("\n")}`
        : "";

      // Generate response using OpenAI Chat Completion
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: prompt?.system_prompt || "You are a helpful AI assistant.",
          },
          {
            role: "user",
            content: `${knowledgeText}\n\nCustomer message: ${body}`,
          },
        ],
        max_tokens: 500,
      });

      const responseText =
        completion.choices[0]?.message?.content ||
        "Thank you for your message. We'll get back to you soon.";

      // TODO: Send response via Twilio SMS API
      // TODO: Log the interaction

      return reply.send({ success: true, response: responseText });
    } catch (error) {
      log.error("Error processing SMS", error);
      return reply.status(500).send({ error: "Failed to process message" });
    }
  });
}
