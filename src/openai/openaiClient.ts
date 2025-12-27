import WebSocket from "ws";
import { env } from "../config/env.js";
import { log } from "../utils/logger.js";

export function createOpenAIRealtimeWS(): WebSocket {
  // the most stable model
  const model = "gpt-4o-realtime-preview-2024-12-17";
  // const model = "gpt-realtime";
  const url = `wss://api.openai.com/v1/realtime?model=${model}`;

  // log.info("🔌 Connecting to OpenAI Realtime API", { model });

  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  let connectionTimeout: NodeJS.Timeout;
  let pingInterval: NodeJS.Timeout;
  let isConnected = false;

  // Set connection timeout
  connectionTimeout = setTimeout(() => {
    if (!isConnected) {
      log.error("⏰ OpenAI connection timeout");
      ws.close();
    }
  }, 10000); // 10 second timeout

  ws.on("open", () => {
    clearTimeout(connectionTimeout);
    isConnected = true;
    log.info("✅ OpenAI connection established");

    // Keep-alive: Send a ping every 30 seconds
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);
  });

  ws.on("error", (error) => {
    clearTimeout(connectionTimeout);
    clearInterval(pingInterval);
    // log.error("❌ OpenAI connection error", { error: error.message });
  });

  ws.on("close", (code, reason) => {
    clearInterval(pingInterval);
    // log.info("🔒 OpenAI connection closed", {
    //   code,
    //   reason: reason.toString(),
    // });
  });

  return ws;
}
