import Fastify from "fastify";
import fastifyWs from "@fastify/websocket";
import fastifyFormbody from "@fastify/formbody";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import dotenv from "dotenv";
dotenv.config();

import incomingCallRoute from "./routes/incomingCall.js";
import messagingRoutes from "./routes/messaging.js";
import { handleMediaStream } from "./ws/mediaStream.js";
import { log } from "./utils/logger.js";
import { env } from "./config/env.js";
import knowledgeRoutes from "./routes/knowledgeApi.js";

const fastify = Fastify({
  logger: false, // We use our own logger
  connectionTimeout: 60000,
  keepAliveTimeout: 60000,
  bodyLimit: 1048576, // 1MB
});

// Register security plugins
fastify.register(fastifyHelmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
    },
  },
});

fastify.register(fastifyCors, {
  origin:
    env.NODE_ENV === "production"
      ? ["https://app.zevaux.com", "https://zevaux.com"]
      : ["http://localhost:3000", "http://localhost:3001"],
  credentials: true,
});

fastify.register(fastifyRateLimit, {
  max: 100,
  timeWindow: "1 minute",
});

// Register core plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWs, {
  options: {
    maxPayload: 1048576, // 1MB
    clientTracking: true,
  },
});

// Health check endpoint
fastify.get("/health", async (request, reply) => {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
    version: "1.0.0",
    services: {
      database: "connected", // You could add actual DB check
      openai: "configured",
      twilio: env.TWILIO_ACCOUNT_SID ? "configured" : "missing",
    },
  };
});

// Register routes
fastify.register(async (fastify) => {
  await incomingCallRoute(fastify);

  fastify.register(knowledgeRoutes);
  // Messaging endpoints
  fastify.register(messagingRoutes);

  // WebSocket endpoint for media streaming
  fastify.get("/media-stream", { websocket: true }, (connection, req) => {
    // log.info("🎯 WebSocket connection received at /media-stream", {
    //   ip: req.ip,
    //   userAgent: req.headers["user-agent"],
    // });

    handleMediaStream(connection, req);
  });
});

// Error handling
fastify.setErrorHandler((error, request, reply) => {
  // log.error("Unhandled error", {
  //   error: error.message,
  //   stack: error.stack,
  //   url: request.url,
  //   method: request.method,
  //   ip: request.ip,
  // });

  reply.status(500).send({
    error: "Internal server error",
    message: env.NODE_ENV === "production" ? "Something went wrong" : "",
    requestId: request.id,
  });
});

// Graceful shutdown
async function gracefulShutdown() {
  log.info("Starting graceful shutdown...");

  // Close WebSocket connections
  fastify.websocketServer?.clients.forEach((client) => {
    if (client.readyState === 1) {
      // OPEN
      client.close(1001, "Server shutting down");
    }
  });

  // Close Fastify
  await fastify.close();

  log.info("Server shut down gracefully");
  process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

// Start server
const start = async () => {
  try {
    const port = env.PORT;
    const address = await fastify.listen({ port, host: "0.0.0.0" });

    log.info(`🚀 Voice server listening on ${address}`);
    log.info(`🌍 Environment: ${env.NODE_ENV}`);
    log.info(`🔗 Health check: ${address}/health`);
    log.info(
      `🎯 WebSocket endpoint: ${address.replace("http", "ws")}/media-stream`
    );
    log.info(`📞 Incoming call endpoint: ${address}/api/voice/incoming-call`);
  } catch (err) {
    log.error("Failed to start server");
    process.exit(1);
  }
};

start();
