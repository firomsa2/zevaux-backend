// config/env.ts
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  // Server
  PORT: z.string().transform(Number).default(5050),
  // PORT: z.string().transform(Number).default("5050"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  APP_BASE_URL: z.string().url().default("http://localhost:5050"),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),
  SUPABASE_ANON_KEY: z.string(),

  // OpenAI
  OPENAI_API_KEY: z.string(),
  OPENAI_ORGANIZATION_ID: z.string().optional(),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string(),
  TWILIO_AUTH_TOKEN: z.string(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  // Security
  HMAC_TOKEN_SECRET: z
    .string()
    .min(32)
    .default("change-me-to-a-secure-random-string"),
  // CALL_TOKEN_TTL: z.string().transform(Number).default("300"),
  CALL_TOKEN_TTL: z.string().transform(Number).default(300),

  // n8n Integration
  N8N_TOOL_WEBHOOK: z.string().url(),
  N8N_KNOWLEDGE_WEBHOOK: z.string().url().optional(),
  N8N_CALENDAR_WEBHOOK: z.string().url().optional(),
  N8N_PROMPT_WEBHOOK: z.string().url().optional(),

  // Redis (optional for caching)
  REDIS_URL: z.string().url().optional(),
  REDIS_PASSWORD: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  SENTRY_DSN: z.string().optional(),

  // Monitoring
  DATADOG_API_KEY: z.string().optional(),
  DATADOG_SITE: z.string().optional(),
});

export const env = envSchema.parse(process.env);

// Validate required production settings
if (env.NODE_ENV === "production") {
  if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY.includes("sk-test")) {
    throw new Error("Invalid OpenAI API key for production");
  }

  if (
    !env.HMAC_TOKEN_SECRET ||
    env.HMAC_TOKEN_SECRET === "change-me-to-a-secure-random-string"
  ) {
    throw new Error("HMAC_TOKEN_SECRET must be set in production");
  }

  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    throw new Error("Twilio credentials must be set in production");
  }
}

// Log environment info (without secrets)
console.log("Environment loaded:", {
  NODE_ENV: env.NODE_ENV,
  PORT: env.PORT,
  SUPABASE_URL: env.SUPABASE_URL.replace(/\/\/([^:]+):([^@]+)@/, "//***:***@"),
  OPENAI_API_KEY: env.OPENAI_API_KEY
    ? `${env.OPENAI_API_KEY.substring(0, 7)}...`
    : "missing",
  TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID
    ? `${env.TWILIO_ACCOUNT_SID.substring(0, 7)}...`
    : "missing",
  N8N_TOOL_WEBHOOK: env.N8N_TOOL_WEBHOOK ? "configured" : "missing",
});
