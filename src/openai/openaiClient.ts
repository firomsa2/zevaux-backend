// // // openai/openaiClient.ts
// // import WebSocket from "ws";
// // import { env } from "../config/env.js";
// // import { log } from "../utils/logger.js";

// // export function createOpenAIRealtimeWS(
// //   model = "gpt-4o-realtime-preview",
// //   temperature = 0.7
// // ): WebSocket {
// //   const url = `wss://api.openai.com/v1/realtime?model=${model}`;

// //   log.info("Connecting to OpenAI Realtime API", {
// //     model,
// //     url: url.replace(env.OPENAI_API_KEY?.substring(0, 20) || "", "[REDACTED]"),
// //   });

// //   const ws = new WebSocket(url, {
// //     headers: {
// //       Authorization: `Bearer ${env.OPENAI_API_KEY}`,
// //       "OpenAI-Beta": "realtime=v1",
// //     },
// //     handshakeTimeout: 10000,
// //   });

// //   let connectionStartTime: number;

// //   ws.on("open", () => {
// //     connectionStartTime = Date.now();
// //     log.info("OpenAI WebSocket connection established", {
// //       model,
// //       connectionTime: Date.now() - connectionStartTime,
// //     });
// //   });

// //   ws.on("error", (error) => {
// //     log.error("OpenAI WebSocket connection error", {
// //       error: error.message,
// //       model,
// //       connectionDuration: connectionStartTime
// //         ? Date.now() - connectionStartTime
// //         : undefined,
// //     });
// //   });

// //   ws.on("close", (code, reason) => {
// //     log.info("OpenAI WebSocket connection closed", {
// //       code,
// //       reason: reason.toString(),
// //       model,
// //       connectionDuration: connectionStartTime
// //         ? Date.now() - connectionStartTime
// //         : undefined,
// //     });
// //   });

// //   // Add ping/pong to keep connection alive
// //   const keepAliveInterval = setInterval(() => {
// //     if (ws.readyState === WebSocket.OPEN) {
// //       ws.ping();
// //     }
// //   }, 30000); // Every 30 seconds

// //   ws.on("close", () => {
// //     clearInterval(keepAliveInterval);
// //   });

// //   return ws;
// // }

// // // Helper function to send messages with retry logic
// // export async function sendWithRetry(
// //   ws: WebSocket,
// //   message: any,
// //   maxRetries = 3
// // ): Promise<boolean> {
// //   const messageStr =
// //     typeof message === "string" ? message : JSON.stringify(message);

// //   for (let attempt = 1; attempt <= maxRetries; attempt++) {
// //     try {
// //       if (ws.readyState !== WebSocket.OPEN) {
// //         throw new Error("WebSocket not open");
// //       }

// //       ws.send(messageStr);
// //       log.debug("Message sent to OpenAI", {
// //         attempt,
// //         type: typeof message === "string" ? "raw" : message.type,
// //         length: messageStr.length,
// //       });

// //       return true;
// //     } catch (error: any) {
// //       log.warn("Failed to send message to OpenAI", {
// //         attempt,
// //         error: error.message,
// //         type: typeof message === "string" ? "raw" : message?.type,
// //       });

// //       if (attempt === maxRetries) {
// //         log.error("Max retries exceeded for sending message", {
// //           type: typeof message === "string" ? "raw" : message?.type,
// //         });
// //         return false;
// //       }

// //       // Wait before retrying (exponential backoff)
// //       await new Promise((resolve) =>
// //         setTimeout(resolve, Math.pow(2, attempt) * 100)
// //       );
// //     }
// //   }

// //   return false;
// // }

// // // Function to create a complete session configuration
// // export function createSessionConfig(
// //   systemPrompt: string,
// //   voice: string = "alloy",
// //   tools: any[] = [],
// //   language: string = "en-US"
// // ) {
// //   return {
// //     type: "session.update",
// //     session: {
// //       instructions: systemPrompt,
// //       turn_detection: {
// //         type: "server_vad",
// //         threshold: 0.5,
// //         prefix_padding_ms: 300,
// //         silence_duration_ms: 800,
// //       },
// //       input_audio_format: "pcm16",
// //       output_audio_format: "pcm16",
// //       voice: voice,
// //       modalities: ["text", "audio"],
// //       temperature: 0.7,
// //       input_audio_transcription: {
// //         model: "whisper-1",
// //         language: language,
// //       },
// //       tools: tools,
// //       tool_choice: "auto",
// //     },
// //   };
// // }

// import WebSocket from "ws";
// import { env } from "../config/env.js";
// import { log } from "../utils/logger.js";

// export function createOpenAIRealtimeWS(
//   model = "gpt-4o-realtime-preview",
//   temperature = 0.8
// ): WebSocket {
//   const url = `wss://api.openai.com/v1/realtime?model=${model}`;

//   log.info("Connecting to OpenAI Realtime API", {
//     model,
//     url: url.replace(env.OPENAI_API_KEY?.substring(0, 20) || "", "[REDACTED]"),
//   });

//   const ws = new WebSocket(url, {
//     headers: {
//       Authorization: `Bearer ${env.OPENAI_API_KEY}`,
//       "OpenAI-Beta": "realtime=v1",
//       "User-Agent": "Zevaux-AI-Calling/1.0",
//     },
//   });

//   ws.on("open", () => {
//     log.info("OpenAI WebSocket connection established", {
//       model,
//       timestamp: new Date().toISOString(),
//     });
//   });

//   ws.on("error", (error) => {
//     log.error("OpenAI WebSocket connection error", {
//       error: error.message,
//       model,
//     });
//   });

//   ws.on("close", (code, reason) => {
//     log.info("OpenAI WebSocket connection closed", {
//       code,
//       reason: reason.toString(),
//       model,
//     });
//   });

//   // Keep connection alive with pings
//   const keepAlive = setInterval(() => {
//     if (ws.readyState === WebSocket.OPEN) {
//       ws.ping();
//     }
//   }, 25000);

//   ws.on("close", () => {
//     clearInterval(keepAlive);
//   });

//   ws.on("ping", (data) => {
//     log.debug("Received ping from OpenAI");
//   });

//   ws.on("pong", (data) => {
//     log.debug("Received pong from OpenAI");
//   });

//   return ws;
// }

// // Helper function to send messages with retry logic
// export async function sendWithRetry(
//   ws: WebSocket,
//   message: any,
//   maxRetries = 3
// ): Promise<boolean> {
//   const messageStr =
//     typeof message === "string" ? message : JSON.stringify(message);

//   for (let attempt = 1; attempt <= maxRetries; attempt++) {
//     try {
//       if (ws.readyState !== WebSocket.OPEN) {
//         throw new Error("WebSocket not open");
//       }

//       ws.send(messageStr);
//       log.debug("Message sent to OpenAI", {
//         attempt,
//         type: typeof message === "string" ? "raw" : message.type,
//         length: messageStr.length,
//       });

//       return true;
//     } catch (error: any) {
//       log.warn("Failed to send message to OpenAI", {
//         attempt,
//         error: error.message,
//         type: typeof message === "string" ? "raw" : message?.type,
//       });

//       if (attempt === maxRetries) {
//         log.error("Max retries exceeded for sending message", {
//           type: typeof message === "string" ? "raw" : message?.type,
//         });
//         return false;
//       }

//       // Wait before retrying (exponential backoff)
//       await new Promise((resolve) =>
//         setTimeout(resolve, Math.pow(2, attempt) * 100)
//       );
//     }
//   }

//   return false;
// }

// // Function to create a complete session configuration
// export function createSessionConfig(
//   systemPrompt: string,
//   voice: string = "alloy",
//   tools: any[] = [],
//   language: string = "en-US"
// ) {
//   return {
//     type: "session.update",
//     session: {
//       instructions: systemPrompt,
//       turn_detection: {
//         type: "server_vad",
//         threshold: 0.5,
//         prefix_padding_ms: 300,
//         silence_duration_ms: 500, // Optimal for conversation
//       },
//       input_audio_format: "g711_ulaw", // Twilio format
//       output_audio_format: "g711_ulaw", // Twilio format
//       voice: voice,
//       modalities: ["text", "audio"],
//       temperature: 0.8,
//       input_audio_transcription: {
//         model: "whisper-1",
//         language: language,
//       },
//       tools: tools,
//       tool_choice: "auto",
//     },
//   };
// }

// // Utility function to handle audio format conversion if needed
// export function ensureUlawAudio(audioData: string): string {
//   // If audio data is already base64 encoded ulaw, return as-is
//   // This is a placeholder - in production you might need actual conversion
//   return audioData;
// }

// // Function to validate session configuration
// export function validateSessionConfig(config: any): boolean {
//   const requiredFields = [
//     "instructions",
//     "input_audio_format",
//     "output_audio_format",
//     "voice",
//     "modalities",
//   ];

//   for (const field of requiredFields) {
//     if (!config.session?.[field]) {
//       log.error(`Missing required field in session config: ${field}`);
//       return false;
//     }
//   }

//   // Validate audio format
//   const validFormats = ["g711_ulaw", "pcm16", "mulaw"];
//   if (!validFormats.includes(config.session.input_audio_format)) {
//     log.error(
//       `Invalid input audio format: ${config.session.input_audio_format}`
//     );
//     return false;
//   }

//   if (!validFormats.includes(config.session.output_audio_format)) {
//     log.error(
//       `Invalid output audio format: ${config.session.output_audio_format}`
//     );
//     return false;
//   }

//   return true;
// }

import WebSocket from "ws";
import { env } from "../config/env.js";
import { log } from "../utils/logger.js";

export function createOpenAIRealtimeWS(): WebSocket {
  // Use the most stable model
  const model = "gpt-4o-realtime-preview-2024-12-17";
  const url = `wss://api.openai.com/v1/realtime?model=${model}`;

  log.info("🔌 Connecting to OpenAI Realtime API", { model });

  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  let connectionTimeout: NodeJS.Timeout;
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
  });

  ws.on("error", (error) => {
    clearTimeout(connectionTimeout);
    log.error("❌ OpenAI connection error", { error: error.message });
  });

  ws.on("close", (code, reason) => {
    log.info("🔒 OpenAI connection closed", {
      code,
      reason: reason.toString(),
    });
  });

  return ws;
}
