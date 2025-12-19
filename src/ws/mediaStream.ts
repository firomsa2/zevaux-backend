// import { FastifyRequest } from "fastify";
// import WebSocket from "ws";
// import { SessionManager } from "../core/SessionManager.js";
// import { createOpenAIRealtimeWS } from "../openai/openaiClient.js";
// import { verifyCallToken } from "../utils/hmac.js";
// import { ToolRouter } from "../core/functionRouter.js";
// import { log } from "../utils/logger.js";
// import { env } from "../config/env.js";

// type TwilioMessage = any;

// export async function handleMediaStream(conn: WebSocket, req: FastifyRequest) {
//   let openaiWs = null;
//   let callSid = "";
//   let streamSid = "";
//   let session = null;

//   log.info("New WebSocket connection to /media-stream");

//   // Handle messages from Twilio
//   conn.on("message", async (raw) => {
//     try {
//       const data: TwilioMessage = JSON.parse(raw.toString());

//       // 1. Handle START event
//       if (data.event === "start") {
//         log.info("Twilio stream start", data.start);

//         streamSid = data.start.streamSid;
//         callSid = data.start.callSid;

//         const customParameters = data.start.customParameters || {};
//         const token = customParameters.token;
//         const paramCallSid = customParameters.callSid || callSid;

//         // Validate token
//         if (!token || !verifyCallToken(token) || !paramCallSid) {
//           log.warn("Invalid token or missing callSid");
//           conn.send(JSON.stringify({ event: "error", message: "auth_failed" }));
//           conn.close();
//           return;
//         }

//         // Get session
//         session = SessionManager.get(paramCallSid);
//         if (!session) {
//           log.warn("Session not found for callSid", paramCallSid);
//           conn.send(
//             JSON.stringify({ event: "error", message: "session_missing" })
//           );
//           conn.close();
//           return;
//         }

//         callSid = paramCallSid;

//         // Send acknowledgment to Twilio
//         conn.send(
//           JSON.stringify({
//             event: "connected",
//             streamSid: streamSid,
//           })
//         );

//         // Connect to OpenAI
//         openaiWs = createOpenAIRealtimeWS();
//         openaiWs.on("open", async () => {
//           log.info("OpenAI WS open for", callSid);

//           // Get system prompt from session
//           const systemPrompt =
//             session.businessPrompt || session.buildFallbackPrompt();

//           // Get voice profile from config
//           const voiceProfile = session.businessConfig?.voiceProfile || {
//             voice: "alloy",
//             language: session.business?.default_language || "en-US",
//           };

//           const msg = {
//             type: "session.update",
//             session: {
//               instructions: systemPrompt,
//               turn_detection: {
//                 type: "server_vad",
//                 threshold: 0.5,
//                 prefix_padding_ms: 300,
//                 silence_duration_ms: 500,
//               },
//               input_audio_format: "g711_ulaw",
//               output_audio_format: "g711_ulaw",
//               voice: voiceProfile.voice || "alloy",
//               modalities: ["text", "audio"],
//               temperature: 0.7,
//               input_audio_transcription: {
//                 model: "whisper-1",
//               },
//               tools: ToolRouter.getToolSpec(),
//               tool_choice: "auto",
//             },
//           };
//           openaiWs.send(JSON.stringify(msg));

//           log.info("Sent session.update to OpenAI");

//           // Trigger the AI to start speaking
//           setTimeout(() => {
//             openaiWs.send(
//               JSON.stringify({
//                 type: "response.create",
//                 response: {
//                   modalities: ["text", "audio"],
//                 },
//               })
//             );
//             log.info("Triggered AI to start conversation");
//           }, 1000);
//         });

//         // Setup OpenAI message handling
//         setupOpenAiMessageHandling(openaiWs, conn, session, streamSid);

//         openaiWs.on("error", (err) => {
//           log.error("OpenAI WebSocket error:", err);
//           conn.send(
//             JSON.stringify({
//               event: "error",
//               message: "OpenAI connection error",
//             })
//           );
//         });

//         openaiWs.on("close", () => {
//           log.info("OpenAI WebSocket closed for", callSid);
//         });
//       }
//       // 2. Handle MEDIA events
//       else if (data.event === "media") {
//         if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
//           const audioAppend = {
//             type: "input_audio_buffer.append",
//             audio: data.media.payload,
//           };
//           openaiWs.send(JSON.stringify(audioAppend));
//         }
//       }
//       // 3. Handle STOP event
//       else if (data.event === "stop") {
//         log.info("Received stop event");
//         if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
//           openaiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
//           openaiWs.send(JSON.stringify({ type: "response.create" }));
//         }
//       }
//     } catch (e) {
//       log.error("Error parsing Twilio message", e);
//     }
//   });

//   // Handle WebSocket close
//   conn.on("close", async () => {
//     log.info("Twilio WS closed for", callSid);
//     try {
//       if (session) {
//         const finalText = session.getTranscript();
//         await session.persistTranscriptAndSummary(finalText);
//         await session.finalizeCall();
//       }
//     } catch (err) {
//       log.error("Error finalizing call", err);
//     } finally {
//       if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
//         openaiWs.close();
//       }
//       if (callSid) {
//         SessionManager.delete(callSid);
//       }
//     }
//   });

//   conn.on("error", (err) => log.error("TwilioWS err", err));
// }

// function setupOpenAiMessageHandling(openaiWs, conn, session, streamSid) {
//   openaiWs.on("message", async (raw) => {
//     try {
//       const msg = JSON.parse(raw.toString());

//       // 1. Handle audio output
//       if (msg.type === "response.audio.delta" && msg.delta) {
//         conn.send(
//           JSON.stringify({
//             event: "media",
//             streamSid: streamSid,
//             media: {
//               payload: msg.delta,
//               track: "inbound",
//             },
//           })
//         );
//       }

//       if (msg.type === "response.output_audio.delta" && msg.delta) {
//         conn.send(
//           JSON.stringify({
//             event: "media",
//             streamSid: streamSid,
//             media: {
//               payload: msg.delta,
//               track: "inbound",
//             },
//           })
//         );
//       }

//       // 2. Handle text output
//       if (msg.type === "response.text.delta" && msg.delta) {
//         session.pushTranscriptSegment(msg.delta);
//       }

//       if (msg.type === "response.output_text.delta" && msg.delta) {
//         session.pushTranscriptSegment(msg.delta);
//       }

//       // 3. Handle user transcription - ADD RAG HERE
//       if (
//         msg.type === "conversation.item.input_audio_transcription.completed" &&
//         msg.transcript
//       ) {
//         const userText = msg.transcript;
//         session.pushTranscriptSegment(`User: ${userText}`);
//         log.info("User said:", userText);

//         // Perform RAG search
//         const knowledgeSnippets = await session.searchKnowledge(userText, 3);

//         // If we have knowledge snippets, send as context
//         if (knowledgeSnippets.length > 0) {
//           const contextMsg = {
//             type: "conversation.item.create",
//             item: {
//               type: "message",
//               role: "system",
//               content: `Business Knowledge Snippets:\n${knowledgeSnippets
//                 .map((s, i) => `${i + 1}) ${s}`)
//                 .join("\n")}`,
//             },
//           };
//           openaiWs.send(JSON.stringify(contextMsg));
//         }
//       }

//       // 4. Handle tool calls - FORWARD TO N8N
//       if (msg.type === "tool.call") {
//         const toolName = msg.tool?.name;
//         const args = msg.tool?.arguments ? JSON.parse(msg.tool.arguments) : {};

//         log.info("Tool call received:", toolName, args);

//         try {
//           // Forward to n8n webhook
//           const result = await forwardToN8n(toolName, args, session);

//           const functionOutputEvent = {
//             type: "conversation.item.create",
//             item: {
//               type: "function_call_output",
//               role: "system",
//               output: JSON.stringify(result),
//             },
//           };

//           openaiWs.send(JSON.stringify(functionOutputEvent));
//           openaiWs.send(
//             JSON.stringify({
//               type: "response.create",
//               response: {
//                 modalities: ["text", "audio"],
//               },
//             })
//           );
//         } catch (error) {
//           log.error("Error executing tool:", error);

//           // Send error back to OpenAI
//           const errorEvent = {
//             type: "conversation.item.create",
//             item: {
//               type: "function_call_output",
//               role: "system",
//               output: JSON.stringify({ error: "Tool execution failed" }),
//             },
//           };
//           openaiWs.send(JSON.stringify(errorEvent));
//         }
//       }

//       // 5. Handle response completion
//       if (msg.type === "response.done") {
//         log.info("OpenAI response completed for", session.callSid);
//       }

//       // 6. Handle errors
//       if (msg.type === "error") {
//         log.error("OpenAI error:", msg);
//       }
//     } catch (err) {
//       log.error("Error handling OpenAI message", err);
//     }
//   });
// }

// async function forwardToN8n(toolName: string, args: any, session: any) {
//   const webhookUrl = env.N8N_TOOL_WEBHOOK;

//   if (!webhookUrl) {
//     throw new Error("N8N_TOOL_WEBHOOK not configured");
//   }

//   const payload = {
//     tool: toolName,
//     args: args,
//     businessId: session.businessId,
//     callId: session.callId,
//     callerPhone: session.from,
//     timestamp: new Date().toISOString(),
//   };

//   const response = await fetch(webhookUrl, {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//     },
//     body: JSON.stringify(payload),
//   });

//   if (!response.ok) {
//     throw new Error(`N8N webhook failed: ${response.statusText}`);
//   }

//   return await response.json();
// }

// ws/mediaStream.ts
// import { FastifyRequest } from "fastify";
// import WebSocket from "ws";
// import { SessionManager } from "../core/sessionManager.js";
// import { createOpenAIRealtimeWS } from "../openai/openaiClient.js";
// import { verifyCallToken } from "../utils/hmac.js";
// import { ToolRouter } from "../core/functionRouter.js";
// import { log } from "../utils/logger.js";
// import { env } from "../config/env.js";
// import OpenAI from "openai";

// const openaiApi = new OpenAI({
//   apiKey: env.OPENAI_API_KEY,
// });

// type TwilioMessage = {
//   event: string;
//   start?: {
//     streamSid: string;
//     callSid: string;
//     customParameters?: Record<string, string>;
//   };
//   media?: {
//     payload: string;
//     track: "inbound" | "outbound";
//   };
//   mark?: {
//     name: string;
//   };
//   stop?: any;
// };

// type OpenAIMessage = {
//   type: string;
//   event_id?: string;
//   response?: any;
//   session?: any;
//   delta?: string;
//   transcript?: string;
//   tool?: {
//     name: string;
//     arguments: string;
//   };
//   error?: any;
// };

// export async function handleMediaStream(conn: WebSocket, req: FastifyRequest) {
//   let openaiWs: WebSocket | null = null;
//   let callSid = "";
//   let streamSid = "";
//   let session: any = null;
//   let isSessionInitialized = false;
//   let lastUserUtterance = "";
//   let conversationId: string | null = null;
//   console.log("🎯 New WebSocket connection to /media-stream");

//   log.info("New WebSocket connection to /media-stream", {
//     ip: req.ip,
//     headers: req.headers,
//   });

//   // Handle messages from Twilio
//   conn.on("message", async (raw) => {
//     try {
//       const data: TwilioMessage = JSON.parse(raw.toString());

//       console.log("🔄 Processing Twilio event", { event: data.event });
//       // 1. Handle START event
//       if (data.event === "start") {
//         console.log("🚀 Twilio stream start received", {
//           streamSid: data.start?.streamSid,
//           callSid: data.start?.callSid,
//           customParameters: data.start?.customParameters,
//         });
//         log.info("Twilio stream start received", {
//           streamSid: data.start?.streamSid,
//           callSid: data.start?.callSid,
//         });

//         streamSid = data.start?.streamSid || "";
//         callSid = data.start?.callSid || "";

//         const customParameters = data.start?.customParameters || {};
//         const token = customParameters.token;
//         const paramCallSid = customParameters.callSid || callSid;

//         console.log("🔐 Validating token and callSid", {
//           tokenPresent: !!token,
//           callSidPresent: !!paramCallSid,
//         });

//         // Validate token
//         if (!token || !verifyCallToken(token) || !paramCallSid) {
//           log.warn("Invalid token or missing callSid", {
//             tokenPresent: !!token,
//             callSidPresent: !!paramCallSid,
//           });
//           conn.send(JSON.stringify({ event: "error", message: "auth_failed" }));
//           conn.close();
//           return;
//         }

//         console.log("🔍 Retrieving session for callSid", { paramCallSid });
//         // Get session
//         session = SessionManager.get(paramCallSid);

//         console.log("📂 Session retrieval result", {
//           sessionExists: !!session,
//         });
//         if (!session) {
//           log.warn("Session not found for callSid", paramCallSid);
//           conn.send(
//             JSON.stringify({ event: "error", message: "session_missing" })
//           );
//           conn.close();
//           return;
//         }

//         console.log("✅ Session found", { callSid: paramCallSid });
//         callSid = paramCallSid;
//         console.log("✉️ Sending acknowledgment to Twilio", { streamSid });

//         // Send acknowledgment to Twilio
//         conn.send(
//           JSON.stringify({
//             event: "connected",
//             streamSid: streamSid,
//           })
//         );
//         console.log("🌐 Initializing OpenAI Realtime connection for callSid", {
//           callSid,
//         });

//         // Initialize OpenAI Realtime connection
//         await initializeOpenAIConnection();
//         console.log("✅ OpenAI Realtime connection initialized");
//       }
//       // 2. Handle MEDIA events (audio from caller)
//       else if (data.event === "media" && data.media) {
//         if (
//           openaiWs &&
//           openaiWs.readyState === WebSocket.OPEN &&
//           isSessionInitialized
//         ) {
//           // Forward audio to OpenAI
//           const audioMessage = {
//             type: "input_audio_buffer.append",
//             audio: data.media.payload,
//           };
//           openaiWs.send(JSON.stringify(audioMessage));

//           log.debug("Forwarded audio to OpenAI", {
//             length: data.media.payload.length,
//             track: data.media.track,
//           });
//         }
//       }
//       // 3. Handle MARK event (end of speech segment)
//       else if (data.event === "mark") {
//         log.info("Mark event received", { mark: data.mark?.name });

//         if (
//           openaiWs &&
//           openaiWs.readyState === WebSocket.OPEN &&
//           isSessionInitialized
//         ) {
//           // Commit the audio buffer and trigger response
//           openaiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" }));

//           // Create response after a short delay
//           setTimeout(() => {
//             openaiWs?.send(
//               JSON.stringify({
//                 type: "response.create",
//                 response: {
//                   modalities: ["text", "audio"],
//                 },
//               })
//             );
//           }, 200);
//         }
//       }
//       // 4. Handle STOP event (call ended)
//       else if (data.event === "stop") {
//         log.info("Stop event received, ending call");

//         if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
//           openaiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
//           openaiWs.close();
//         }

//         conn.close();
//       }
//     } catch (e: any) {
//       log.error("Error handling Twilio message", {
//         error: e.message,
//         stack: e.stack,
//         rawMessage: raw?.toString().substring(0, 200),
//       });
//     }
//   });

//   // Initialize OpenAI Realtime connection
//   async function initializeOpenAIConnection() {
//     try {
//       openaiWs = createOpenAIRealtimeWS();

//       openaiWs.on("open", async () => {
//         log.info("OpenAI WebSocket connection established", { callSid });

//         // Get enhanced system prompt
//         const systemPrompt = session.buildEnhancedSystemPrompt();

//         // Get voice profile from config
//         const voiceProfile = session.businessConfig?.voiceProfile || {
//           voice: "alloy",
//           language: session.business?.default_language || "en-US",
//           provider: "openai",
//           speed: 1.0,
//           pitch: 1.0,
//         };

//         // Configure the session
//         const sessionConfig = {
//           type: "session.update",
//           session: {
//             instructions: systemPrompt,
//             turn_detection: {
//               type: "server_vad",
//               threshold: 0.5,
//               prefix_padding_ms: 300,
//               silence_duration_ms: 1000,
//             },
//             input_audio_format: "g711_ulaw",
//             output_audio_format: "g711_ulaw",
//             voice: voiceProfile.voice,
//             modalities: ["text", "audio"],
//             temperature: 0.7,
//             input_audio_transcription: {
//               model: "whisper-1",
//             },
//             tools: ToolRouter.getToolSpec(),
//             tool_choice: "auto",
//             voice_settings: {
//               speed: voiceProfile.speed || 1.0,
//               pitch: voiceProfile.pitch || 1.0,
//             },
//           },
//         };

//         openaiWs?.send(JSON.stringify(sessionConfig));
//         log.info("Sent session configuration to OpenAI", {
//           voice: voiceProfile.voice,
//           toolsCount: ToolRouter.getToolSpec().length,
//         });

//         // Set up message handling
//         setupOpenAIMessageHandling();

//         // Mark as initialized
//         isSessionInitialized = true;

//         // Trigger the AI to start speaking after a short delay
//         setTimeout(() => {
//           if (openaiWs?.readyState === WebSocket.OPEN) {
//             openaiWs.send(
//               JSON.stringify({
//                 type: "response.create",
//                 response: {
//                   modalities: ["text", "audio"],
//                 },
//               })
//             );
//             log.info("Triggered AI to start conversation");
//           }
//         }, 1500);
//       });

//       openaiWs.on("error", (error) => {
//         log.error("OpenAI WebSocket error", {
//           error: error.message,
//           callSid,
//         });

//         // Send error to Twilio
//         conn.send(
//           JSON.stringify({
//             event: "error",
//             message: "AI service unavailable",
//           })
//         );
//       });

//       openaiWs.on("close", (code, reason) => {
//         log.info("OpenAI WebSocket closed", {
//           code,
//           reason: reason.toString(),
//           callSid,
//         });
//       });
//     } catch (error: any) {
//       log.error("Failed to initialize OpenAI connection", {
//         error: error.message,
//         callSid,
//       });
//     }
//   }

//   function setupOpenAIMessageHandling() {
//     if (!openaiWs) return;

//     openaiWs.on("message", async (raw) => {
//       try {
//         const msg: OpenAIMessage = JSON.parse(raw.toString());

//         // Log message type for debugging
//         log.debug("OpenAI message received", { type: msg.type });

//         // 1. Handle session updates
//         if (msg.type === "session.updated") {
//           session.openaiSessionId = msg.session?.id;
//           log.info("OpenAI session updated", {
//             sessionId: session.openaiSessionId,
//           });
//         }

//         // 2. Handle audio output
//         if (
//           (msg.type === "response.audio.delta" ||
//             msg.type === "response.output_audio.delta") &&
//           msg.delta
//         ) {
//           // Send audio to Twilio
//           conn.send(
//             JSON.stringify({
//               event: "media",
//               streamSid: streamSid,
//               media: {
//                 payload: msg.delta,
//                 track: "inbound",
//               },
//             })
//           );
//         }

//         // 3. Handle text output
//         if (
//           (msg.type === "response.text.delta" ||
//             msg.type === "response.output_text.delta") &&
//           msg.delta
//         ) {
//           session.pushTranscriptSegment(msg.delta, "ai");
//         }

//         // 4. Handle user transcription
//         if (
//           msg.type ===
//             "conversation.item.input_audio_transcription.completed" &&
//           msg.transcript
//         ) {
//           const userText = msg.transcript;
//           lastUserUtterance = userText;
//           session.pushTranscriptSegment(userText, "user");

//           log.info("User transcription", { text: userText });

//           // Perform RAG search with the user's question
//           const knowledgeSnippets = await session.searchKnowledge(userText, 3);

//           if (knowledgeSnippets.length > 0) {
//             // Send knowledge as context to OpenAI
//             const contextMessage = {
//               type: "conversation.item.create",
//               item: {
//                 type: "message",
//                 role: "system",
//                 content: `RELEVANT BUSINESS INFORMATION:\n${knowledgeSnippets
//                   .map((s, i) => `${i + 1}. ${s}`)
//                   .join(
//                     "\n"
//                   )}\n\nUse this information to answer the caller's question accurately.`,
//               },
//             };

//             openaiWs?.send(JSON.stringify(contextMessage));
//             log.info("Added knowledge context to conversation", {
//               snippetCount: knowledgeSnippets.length,
//             });
//           }
//         }

//         // 5. Handle tool calls
//         if (msg.type === "tool.call" && msg.tool) {
//           await handleToolCall(msg.tool);
//         }

//         // 6. Handle response completion
//         if (msg.type === "response.done" && msg.response) {
//           session.currentResponseId = msg.response.id;
//           log.info("AI response completed", {
//             responseId: msg.response.id,
//             callSid,
//           });
//         }

//         // 7. Handle errors
//         if (msg.type === "error") {
//           log.error("OpenAI API error", msg.error);

//           // Try to recover or end gracefully
//           if (msg.error?.code === "rate_limit_exceeded") {
//             conn.send(
//               JSON.stringify({
//                 event: "media",
//                 streamSid: streamSid,
//                 media: {
//                   payload: "", // Empty audio
//                   track: "inbound",
//                 },
//               })
//             );

//             // Play error message
//             const errorTwiML = `<?xml version="1.0" encoding="UTF-8"?>
//               <Response>
//                 <Say>We're experiencing high demand. Please call back in a few minutes or leave a message.</Say>
//                 <Pause length="2"/>
//               </Response>`;

//             // This would need to be sent differently - for now, log it
//             log.warn("Rate limit exceeded, should play error message");
//           }
//         }
//       } catch (error: any) {
//         log.error("Error handling OpenAI message", {
//           error: error.message,
//           rawMessage: raw?.toString().substring(0, 200),
//         });
//       }
//     });
//   }

//   async function handleToolCall(tool: any) {
//     try {
//       const toolName = tool.name;
//       const args = tool.arguments ? JSON.parse(tool.arguments) : {};

//       log.info("Tool call received", { toolName, args });

//       // Forward to n8n webhook
//       const result = await forwardToN8n(toolName, args, session);

//       // Send result back to OpenAI
//       const functionOutput = {
//         type: "conversation.item.create",
//         item: {
//           type: "function_call_output",
//           role: "system",
//           output: JSON.stringify(result),
//         },
//       };

//       openaiWs?.send(JSON.stringify(functionOutput));

//       // Trigger next response
//       setTimeout(() => {
//         openaiWs?.send(
//           JSON.stringify({
//             type: "response.create",
//             response: {
//               modalities: ["text", "audio"],
//             },
//           })
//         );
//       }, 500);
//     } catch (error: any) {
//       log.error("Error handling tool call", error);

//       // Send error back to OpenAI
//       const errorOutput = {
//         type: "conversation.item.create",
//         item: {
//           type: "function_call_output",
//           role: "system",
//           output: JSON.stringify({
//             error: "Tool execution failed",
//             message: error.message,
//           }),
//         },
//       };

//       openaiWs?.send(JSON.stringify(errorOutput));
//     }
//   }

//   // Handle WebSocket close
//   conn.on("close", async (code, reason) => {
//     log.info("Twilio WebSocket closed", {
//       callSid,
//       code,
//       reason: reason.toString(),
//     });

//     try {
//       if (session) {
//         await session.persistTranscriptAndSummary();
//         await session.finalizeCall();
//       }
//     } catch (err: any) {
//       log.error("Error finalizing call", err);
//     } finally {
//       if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
//         openaiWs.close();
//       }
//       if (callSid) {
//         SessionManager.delete(callSid);
//       }
//     }
//   });

//   // Handle WebSocket errors
//   conn.on("error", (error) => {
//     log.error("Twilio WebSocket error", {
//       error: error.message,
//       callSid,
//     });
//   });
// }

// async function forwardToN8n(toolName: string, args: any, session: any) {
//   const webhookUrl = env.N8N_TOOL_WEBHOOK;

//   if (!webhookUrl) {
//     throw new Error("N8N_TOOL_WEBHOOK not configured");
//   }

//   const payload = {
//     tool: toolName,
//     args: args,
//     session: {
//       businessId: session.businessId,
//       businessName: session.business?.name,
//       callId: session.callId,
//       callSid: session.callSid,
//       callerPhone: session.from,
//       callerNumber: session.from,
//       toNumber: session.to,
//     },
//     metadata: {
//       timestamp: new Date().toISOString(),
//       source: "openai_realtime",
//       conversationId: session.openaiSessionId,
//     },
//   };

//   log.info("Forwarding tool call to n8n", {
//     tool: toolName,
//     webhookUrl,
//     businessId: session.businessId,
//   });

//   try {
//     const response = await fetch(webhookUrl, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         "X-Zevaux-Signature": await generateSignature(JSON.stringify(payload)),
//       },
//       body: JSON.stringify(payload),
//       timeout: 10000, // 10 second timeout
//     });

//     if (!response.ok) {
//       throw new Error(
//         `N8N webhook failed: ${response.status} ${response.statusText}`
//       );
//     }

//     const result = await response.json();
//     log.info("N8n webhook response", {
//       tool: toolName,
//       success: result.success,
//       businessId: session.businessId,
//     });

//     return result;
//   } catch (error: any) {
//     log.error("Failed to forward to n8n", {
//       error: error.message,
//       tool: toolName,
//       webhookUrl,
//     });

//     // Return a fallback response
//     return {
//       success: false,
//       error: "Service temporarily unavailable",
//       message: "Your request has been recorded and will be processed shortly.",
//     };
//   }
// }

// async function generateSignature(payload: string): Promise<string> {
//   // Simple HMAC signature for webhook verification
//   const encoder = new TextEncoder();
//   const key = await crypto.subtle.importKey(
//     "raw",
//     encoder.encode(env.HMAC_TOKEN_SECRET || "default-secret"),
//     { name: "HMAC", hash: "SHA-256" },
//     false,
//     ["sign"]
//   );

//   const signature = await crypto.subtle.sign(
//     "HMAC",
//     key,
//     encoder.encode(payload)
//   );

//   return Buffer.from(signature).toString("hex");
// }

// import { FastifyRequest } from "fastify";
// import WebSocket from "ws";
// import { SessionManager } from "../core/sessionManager.js";
// import { createOpenAIRealtimeWS } from "../openai/openaiClient.js";
// import { verifyCallToken } from "../utils/hmac.js";
// import { ToolRouter } from "../core/functionRouter.js";
// import { log } from "../utils/logger.js";
// import { env } from "../config/env.js";

// type TwilioMessage = {
//   event: string;
//   start?: {
//     streamSid: string;
//     callSid: string;
//     customParameters?: Record<string, string>;
//   };
//   media?: {
//     payload: string;
//     track: "inbound" | "outbound";
//   };
//   mark?: {
//     name: string;
//   };
//   stop?: any;
// };

// type OpenAIMessage = {
//   type: string;
//   event_id?: string;
//   response?: any;
//   session?: any;
//   delta?: string;
//   transcript?: string;
//   tool?: {
//     name: string;
//     arguments: string;
//   };
//   error?: any;
// };

// export async function handleMediaStream(conn: WebSocket, req: FastifyRequest) {
//   let openaiWs: WebSocket | null = null;
//   let callSid = "";
//   let streamSid = "";
//   let session: any = null;
//   let isSessionInitialized = false;
//   let lastUserUtterance = "";
//   let conversationId: string | null = null;
//   let audioBuffer: string[] = [];

//   console.log("🎯 New WebSocket connection to /media-stream");

//   log.info("New WebSocket connection to /media-stream", {
//     ip: req.ip,
//     headers: req.headers,
//   });

//   // Handle messages from Twilio
//   conn.on("message", async (raw) => {
//     try {
//       const data: TwilioMessage = JSON.parse(raw.toString());

//       console.log("🔄 Processing Twilio event", { event: data.event });

//       // 1. Handle START event
//       if (data.event === "start") {
//         console.log("🚀 Twilio stream start received", {
//           streamSid: data.start?.streamSid,
//           callSid: data.start?.callSid,
//           customParameters: data.start?.customParameters,
//         });
//         log.info("Twilio stream start received", {
//           streamSid: data.start?.streamSid,
//           callSid: data.start?.callSid,
//         });

//         streamSid = data.start?.streamSid || "";
//         callSid = data.start?.callSid || "";

//         const customParameters = data.start?.customParameters || {};
//         const token = customParameters.token;
//         const paramCallSid = customParameters.callSid || callSid;

//         console.log("🔐 Validating token and callSid", {
//           tokenPresent: !!token,
//           callSidPresent: !!paramCallSid,
//         });

//         // Validate token
//         if (!token || !verifyCallToken(token) || !paramCallSid) {
//           log.warn("Invalid token or missing callSid", {
//             tokenPresent: !!token,
//             callSidPresent: !!paramCallSid,
//           });
//           conn.send(JSON.stringify({ event: "error", message: "auth_failed" }));
//           conn.close();
//           return;
//         }

//         console.log("🔍 Retrieving session for callSid", { paramCallSid });
//         // Get session
//         session = SessionManager.get(paramCallSid);

//         console.log("📂 Session retrieval result", {
//           sessionExists: !!session,
//         });
//         if (!session) {
//           log.warn("Session not found for callSid", paramCallSid);
//           conn.send(
//             JSON.stringify({ event: "error", message: "session_missing" })
//           );
//           conn.close();
//           return;
//         }

//         console.log("✅ Session found", { callSid: paramCallSid });
//         callSid = paramCallSid;
//         console.log("✉️ Sending acknowledgment to Twilio", { streamSid });

//         // Send acknowledgment to Twilio
//         conn.send(
//           JSON.stringify({
//             event: "connected",
//             streamSid: streamSid,
//           })
//         );
//         console.log("🌐 Initializing OpenAI Realtime connection for callSid", {
//           callSid,
//         });

//         // Initialize OpenAI Realtime connection
//         await initializeOpenAIConnection();
//         console.log("✅ OpenAI Realtime connection initialized");
//       }
//       // 2. Handle MEDIA events (audio from caller)
//       else if (data.event === "media" && data.media) {
//         log.debug("Received audio chunk", {
//           length: data.media.payload.length,
//           track: data.media.track,
//         });

//         if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
//           // Buffer the audio if session not initialized yet
//           if (!isSessionInitialized) {
//             audioBuffer.push(data.media.payload);
//             log.debug("Buffering audio, waiting for initialization", {
//               bufferedChunks: audioBuffer.length,
//             });
//           } else {
//             // Send immediately
//             const audioMessage = {
//               type: "input_audio_buffer.append",
//               audio: data.media.payload,
//             };
//             openaiWs.send(JSON.stringify(audioMessage));
//           }
//         } else {
//           log.warn("OpenAI WS not ready, ignoring audio chunk");
//         }
//       }
//       // 3. Handle MARK event (end of speech segment)
//       else if (data.event === "mark") {
//         log.info("Mark event received", { mark: data.mark?.name });

//         if (
//           openaiWs &&
//           openaiWs.readyState === WebSocket.OPEN &&
//           isSessionInitialized
//         ) {
//           // Commit the audio buffer and trigger response
//           openaiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" }));

//           // Create response after a short delay
//           setTimeout(() => {
//             if (openaiWs?.readyState === WebSocket.OPEN) {
//               openaiWs.send(
//                 JSON.stringify({
//                   type: "response.create",
//                   response: {
//                     modalities: ["text", "audio"],
//                   },
//                 })
//               );
//               log.debug("Triggered response creation after mark");
//             }
//           }, 200);
//         }
//       }
//       // 4. Handle STOP event (call ended)
//       else if (data.event === "stop") {
//         log.info("Stop event received, ending call");

//         if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
//           openaiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
//           setTimeout(() => {
//             openaiWs?.close();
//           }, 1000);
//         }

//         conn.close();
//       }
//     } catch (e: any) {
//       log.error("Error handling Twilio message", {
//         error: e.message,
//         stack: e.stack,
//         rawMessage: raw?.toString().substring(0, 200),
//       });
//     }
//   });

//   // Initialize OpenAI Realtime connection
//   async function initializeOpenAIConnection() {
//     try {
//       openaiWs = createOpenAIRealtimeWS();

//       openaiWs.on("open", async () => {
//         log.info("OpenAI WebSocket connection established", { callSid });

//         // Get enhanced system prompt
//         const systemPrompt = session.buildEnhancedSystemPrompt
//           ? session.buildEnhancedSystemPrompt()
//           : "You are a helpful AI assistant. Speak clearly and professionally.";

//         // Get voice profile from config
//         const voiceProfile = session.businessConfig?.voiceProfile || {
//           voice: "alloy",
//           language: session.business?.default_language || "en-US",
//           provider: "openai",
//           speed: 1.0,
//           pitch: 1.0,
//         };

//         // Configure the session - CRITICAL FIX: Use g711_ulaw for Twilio
//         const sessionConfig = {
//           type: "session.update",
//           session: {
//             instructions: systemPrompt,
//             turn_detection: {
//               type: "server_vad",
//               threshold: 0.5,
//               prefix_padding_ms: 300,
//               silence_duration_ms: 500, // Reduced for faster responses
//             },
//             // MUST use g711_ulaw for Twilio compatibility
//             input_audio_format: "g711_ulaw",
//             output_audio_format: "g711_ulaw",
//             voice: voiceProfile.voice,
//             modalities: ["text", "audio"],
//             temperature: 0.8, // Increased for more natural speech
//             input_audio_transcription: {
//               model: "whisper-1",
//             },
//             tools: ToolRouter.getToolSpec(),
//             tool_choice: "auto",
//             // Optional voice settings (remove if causing issues)
//             // voice_settings: {
//             //   speed: voiceProfile.speed || 1.0,
//             // },
//           },
//         };

//         openaiWs?.send(JSON.stringify(sessionConfig));
//         log.info("Sent session configuration to OpenAI", {
//           voice: voiceProfile.voice,
//           audioFormat: "g711_ulaw",
//           toolsCount: ToolRouter.getToolSpec().length,
//         });

//         // Initialize audio buffer
//         setTimeout(() => {
//           if (openaiWs?.readyState === WebSocket.OPEN) {
//             openaiWs.send(
//               JSON.stringify({
//                 type: "input_audio_buffer.init",
//                 audio_buffer: {
//                   mode: "voice_activity",
//                 },
//               })
//             );
//             log.info("Initialized audio buffer");
//           }
//         }, 100);

//         // Set up message handling
//         setupOpenAIMessageHandling();

//         // Mark as initialized
//         isSessionInitialized = true;

//         // Process any buffered audio chunks
//         if (audioBuffer.length > 0) {
//           log.info("Processing buffered audio chunks", {
//             count: audioBuffer.length,
//           });
//           for (const chunk of audioBuffer) {
//             if (openaiWs?.readyState === WebSocket.OPEN) {
//               openaiWs.send(
//                 JSON.stringify({
//                   type: "input_audio_buffer.append",
//                   audio: chunk,
//                 })
//               );
//             }
//           }
//           audioBuffer = [];
//         }

//         // Trigger the AI to start speaking after a short delay
//         setTimeout(() => {
//           if (openaiWs?.readyState === WebSocket.OPEN) {
//             openaiWs.send(
//               JSON.stringify({
//                 type: "response.create",
//                 response: {
//                   modalities: ["text", "audio"],
//                 },
//               })
//             );
//             log.info("Triggered AI to start conversation");
//           }
//         }, 1500);
//       });

//       openaiWs.on("error", (error) => {
//         log.error("OpenAI WebSocket error", {
//           error: error.message,
//           callSid,
//         });

//         // Send error to Twilio
//         conn.send(
//           JSON.stringify({
//             event: "error",
//             message: "AI service unavailable",
//           })
//         );
//       });

//       openaiWs.on("close", (code, reason) => {
//         log.info("OpenAI WebSocket closed", {
//           code,
//           reason: reason.toString(),
//           callSid,
//         });
//       });
//     } catch (error: any) {
//       log.error("Failed to initialize OpenAI connection", {
//         error: error.message,
//         callSid,
//       });
//     }
//   }

//   function setupOpenAIMessageHandling() {
//     if (!openaiWs) return;

//     openaiWs.on("message", async (raw) => {
//       try {
//         const msg: OpenAIMessage = JSON.parse(raw.toString());

//         // Log message type for debugging
//         log.debug("OpenAI message type received", { type: msg.type });

//         // 1. Handle session updates
//         if (msg.type === "session.updated") {
//           session.openaiSessionId = msg.session?.id;
//           log.info("OpenAI session updated", {
//             sessionId: session.openaiSessionId,
//           });
//         }

//         // 2. Handle audio output - CRITICAL FIX: Proper audio handling
//         if (msg.type === "response.audio.delta" && msg.delta) {
//           log.debug("Sending audio to Twilio", {
//             length: msg.delta.length,
//             sample: msg.delta.substring(0, 30),
//           });

//           // Send audio to Twilio
//           conn.send(
//             JSON.stringify({
//               event: "media",
//               streamSid: streamSid,
//               media: {
//                 payload: msg.delta,
//                 track: "inbound",
//               },
//             })
//           );
//         }

//         // Also handle output_audio.delta format
//         if (msg.type === "response.output_audio.delta" && msg.delta) {
//           log.debug("Sending output_audio to Twilio", {
//             length: msg.delta.length,
//           });

//           conn.send(
//             JSON.stringify({
//               event: "media",
//               streamSid: streamSid,
//               media: {
//                 payload: msg.delta,
//                 track: "inbound",
//               },
//             })
//           );
//         }

//         // 3. Handle text output
//         if (
//           (msg.type === "response.text.delta" ||
//             msg.type === "response.output_text.delta") &&
//           msg.delta
//         ) {
//           session.pushTranscriptSegment(msg.delta, "ai");
//         }

//         // 4. Handle user transcription - RAG INTEGRATION
//         if (
//           msg.type ===
//             "conversation.item.input_audio_transcription.completed" &&
//           msg.transcript
//         ) {
//           const userText = msg.transcript;
//           lastUserUtterance = userText;
//           session.pushTranscriptSegment(userText, "user");

//           log.info("User transcription", { text: userText });

//           // Perform RAG search with the user's question
//           if (session.searchKnowledge) {
//             try {
//               const knowledgeSnippets = await session.searchKnowledge(userText, 3);

//               if (knowledgeSnippets.length > 0) {
//                 // Send knowledge as context to OpenAI
//                 const contextMessage = {
//                   type: "conversation.item.create",
//                   item: {
//                     type: "message",
//                     role: "system",
//                     content: `RELEVANT BUSINESS INFORMATION:\n${knowledgeSnippets
//                       .map((s: string, i: number) => `${i + 1}. ${s}`)
//                       .join(
//                         "\n"
//                       )}\n\nUse this information to answer the caller's question accurately.`,
//                   },
//                 };

//                 openaiWs?.send(JSON.stringify(contextMessage));
//                 log.info("Added knowledge context to conversation", {
//                   snippetCount: knowledgeSnippets.length,
//                 });
//               }
//             } catch (ragError: any) {
//               log.error("RAG search failed", { error: ragError.message });
//             }
//           }
//         }

//         // 5. Handle tool calls
//         if (msg.type === "tool.call" && msg.tool) {
//           await handleToolCall(msg.tool);
//         }

//         // 6. Handle response completion
//         if (msg.type === "response.done" && msg.response) {
//           session.currentResponseId = msg.response.id;
//           log.info("AI response completed", {
//             responseId: msg.response.id,
//             callSid,
//           });
//         }

//         // 7. Handle errors
//         if (msg.type === "error") {
//           log.error("OpenAI API error", msg.error);

//           // Try to recover or end gracefully
//           if (msg.error?.code === "rate_limit_exceeded") {
//             // Send empty audio to clear buffer
//             conn.send(
//               JSON.stringify({
//                 event: "media",
//                 streamSid: streamSid,
//                 media: {
//                   payload: "", // Empty audio
//                   track: "inbound",
//                 },
//               })
//             );
//           }
//         }

//         // 8. Handle input audio buffer status
//         if (msg.type === "input_audio_buffer.speech_started") {
//           log.info("OpenAI detected speech started");
//         }

//         if (msg.type === "input_audio_buffer.speech_stopped") {
//           log.info("OpenAI detected speech stopped");
//         }

//         // 9. Handle conversation updates
//         if (msg.type === "conversation.item.created") {
//           log.debug("Conversation item created", { itemType: msg.item?.type });
//         }

//       } catch (error: any) {
//         log.error("Error handling OpenAI message", {
//           error: error.message,
//           rawMessage: raw?.toString().substring(0, 200),
//         });
//       }
//     });
//   }

//   async function handleToolCall(tool: any) {
//     try {
//       const toolName = tool.name;
//       const args = tool.arguments ? JSON.parse(tool.arguments) : {};

//       log.info("Tool call received", { toolName, args });

//       // Forward to n8n webhook
//       const result = await forwardToN8n(toolName, args, session);

//       // Send result back to OpenAI
//       const functionOutput = {
//         type: "conversation.item.create",
//         item: {
//           type: "function_call_output",
//           role: "system",
//           output: JSON.stringify(result),
//         },
//       };

//       openaiWs?.send(JSON.stringify(functionOutput));

//       // Trigger next response
//       setTimeout(() => {
//         if (openaiWs?.readyState === WebSocket.OPEN) {
//           openaiWs.send(
//             JSON.stringify({
//               type: "response.create",
//               response: {
//                 modalities: ["text", "audio"],
//               },
//             })
//           );
//           log.debug("Triggered response after tool call");
//         }
//       }, 500);
//     } catch (error: any) {
//       log.error("Error handling tool call", error);

//       // Send error back to OpenAI
//       const errorOutput = {
//         type: "conversation.item.create",
//         item: {
//           type: "function_call_output",
//           role: "system",
//           output: JSON.stringify({
//             error: "Tool execution failed",
//             message: error.message,
//           }),
//         },
//       };

//       openaiWs?.send(JSON.stringify(errorOutput));
//     }
//   }

//   // Handle WebSocket close
//   conn.on("close", async (code, reason) => {
//     log.info("Twilio WebSocket closed", {
//       callSid,
//       code,
//       reason: reason.toString(),
//     });

//     try {
//       if (session) {
//         if (session.persistTranscriptAndSummary) {
//           await session.persistTranscriptAndSummary();
//         }
//         if (session.finalizeCall) {
//           await session.finalizeCall();
//         }
//       }
//     } catch (err: any) {
//       log.error("Error finalizing call", err);
//     } finally {
//       if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
//         openaiWs.close();
//       }
//       if (callSid) {
//         SessionManager.delete(callSid);
//       }
//     }
//   });

//   // Handle WebSocket errors
//   conn.on("error", (error) => {
//     log.error("Twilio WebSocket error", {
//       error: error.message,
//       callSid,
//     });
//   });
// }

// async function forwardToN8n(toolName: string, args: any, session: any) {
//   const webhookUrl = env.N8N_TOOL_WEBHOOK;

//   if (!webhookUrl) {
//     log.warn("N8N_TOOL_WEBHOOK not configured, using mock response");
//     return {
//       success: false,
//       message: "Webhook not configured",
//       mock: true,
//       tool: toolName,
//     };
//   }

//   const payload = {
//     tool: toolName,
//     args: args,
//     session: {
//       businessId: session.businessId,
//       businessName: session.business?.name,
//       callId: session.callId,
//       callSid: session.callSid,
//       callerPhone: session.from,
//       callerNumber: session.from,
//       toNumber: session.to,
//     },
//     metadata: {
//       timestamp: new Date().toISOString(),
//       source: "openai_realtime",
//       conversationId: session.openaiSessionId,
//     },
//   };

//   log.info("Forwarding tool call to n8n", {
//     tool: toolName,
//     businessId: session.businessId,
//   });

//   try {
//     const response = await fetch(webhookUrl, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         "X-Zevaux-Signature": await generateSignature(JSON.stringify(payload)),
//       },
//       body: JSON.stringify(payload),
//       signal: AbortSignal.timeout(10000),
//     });

//     if (!response.ok) {
//       throw new Error(
//         `N8N webhook failed: ${response.status} ${response.statusText}`
//       );
//     }

//     const result = await response.json();
//     log.info("N8n webhook response", {
//       tool: toolName,
//       success: result.success,
//       businessId: session.businessId,
//     });

//     return result;
//   } catch (error: any) {
//     log.error("Failed to forward to n8n", {
//       error: error.message,
//       tool: toolName,
//     });

//     // Return a fallback response
//     return {
//       success: false,
//       error: "Service temporarily unavailable",
//       message: "Your request has been recorded and will be processed shortly.",
//       fallback: true,
//     };
//   }
// }

// async function generateSignature(payload: string): Promise<string> {
//   if (!env.HMAC_TOKEN_SECRET) {
//     return "no-signature-configured";
//   }

//   try {
//     const encoder = new TextEncoder();
//     const key = await crypto.subtle.importKey(
//       "raw",
//       encoder.encode(env.HMAC_TOKEN_SECRET),
//       { name: "HMAC", hash: "SHA-256" },
//       false,
//       ["sign"]
//     );

//     const signature = await crypto.subtle.sign(
//       "HMAC",
//       key,
//       encoder.encode(payload)
//     );

//     return Buffer.from(signature).toString("hex");
//   } catch (error: any) {
//     log.error("Failed to generate signature", { error: error.message });
//     return "signature-error";
//   }
// }

import { FastifyRequest } from "fastify";
import WebSocket from "ws";
import { SessionManager } from "../core/sessionManager.js";
import { createOpenAIRealtimeWS } from "../openai/openaiClient.js";
import { verifyCallToken } from "../utils/hmac.js";
import { ToolRouter } from "../core/functionRouter.js";
import { log } from "../utils/logger.js";
import { env } from "../config/env.js";

// Track active connections to prevent duplicates
const activeConnections = new Map<
  string,
  {
    conn: WebSocket;
    openaiWs: WebSocket | null;
    session: any;
    streamSid: string;
    isInitialized: boolean;
  }
>();

type TwilioMessage = {
  event: string;
  start?: {
    streamSid: string;
    callSid: string;
    customParameters?: Record<string, string>;
  };
  media?: {
    payload: string;
    track: "inbound" | "outbound";
  };
  mark?: {
    name: string;
  };
  stop?: any;
};

type OpenAIMessage = {
  type: string;
  event_id?: string;
  response?: any;
  session?: any;
  item?: any;
  delta?: string;
  transcript?: string;
  tool?: {
    name: string;
    arguments: string;
  };
  error?: any;
};

export async function handleMediaStream(conn: WebSocket, req: FastifyRequest) {
  let openaiWs: WebSocket | null = null;
  let callSid = "";
  let streamSid = "";
  let session: any = null;
  let isSessionInitialized = false;
  let audioBuffer: string[] = [];
  let lastUserUtterance = "";

  // Connection/turn state (per websocket)
  let hasReceivedStop = false;
  let isUserSpeaking = false;
  let isAssistantSpeaking = false;
  let lastAssistantItemId: string | null = null;
  let pendingTranscript: { eventId?: string; text: string } | null = null;
  let pendingTranscriptTimer: NodeJS.Timeout | null = null;

  // Add this at the top of your setupOpenAIMessageHandling function
  let responseCount = 0;
  let lastResponseTime = 0;

  console.log("🎯 New WebSocket connection to /media-stream");

  // log.info("New WebSocket connection to /media-stream", {
  //   ip: req.ip,
  //   url: req.url,
  // });

  function safeSendToTwilio(payload: any) {
    if (conn.readyState !== WebSocket.OPEN) return;
    try {
      conn.send(JSON.stringify(payload));
    } catch {
      // ignore send failures
    }
  }

  function safeSendToOpenAI(payload: any) {
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;
    try {
      openaiWs.send(JSON.stringify(payload));
    } catch {
      // ignore send failures
    }
  }

  function clearTwilioPlayback() {
    if (!streamSid) return;
    // Stops any queued outbound audio to the caller
    safeSendToTwilio({ event: "clear", streamSid });
  }

  function cancelAssistantResponse() {
    // Cancels current response generation (barge-in)
    safeSendToOpenAI({ type: "response.cancel" });

    // Best-effort truncate of the last assistant item so it doesn't “resume” later
    if (lastAssistantItemId) {
      safeSendToOpenAI({
        type: "conversation.item.truncate",
        item_id: lastAssistantItemId,
        content_index: 0,
        audio_end_ms: 0,
      });
    }
  }

  async function enrichContextAndRespond(userText: string) {
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;

    // Don’t block the realtime loop too long on RAG
    const ragTimeoutMs = 1500;
    let ragResult: any | null = null;

    if (session?.searchKnowledgeWithRAG) {
      try {
        ragResult = await Promise.race([
          session.searchKnowledgeWithRAG(userText, {
            includeConversationContext: true,
            topK: 3,
            minSimilarity: 0.6,
          }),
          new Promise((resolve) =>
            setTimeout(() => resolve(null), ragTimeoutMs)
          ),
        ]);
      } catch {
        ragResult = null;
      }
    }

    if (ragResult?.snippets?.length && ragResult?.formattedContext) {
      safeSendToOpenAI({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: ragResult.formattedContext,
        },
      });

      // Best-effort logging; never block the call
      if (session?.logRAGUsage) {
        void session
          .logRAGUsage(userText, ragResult.snippets, true)
          .catch(() => undefined);
      }
    } else if (session?.logRAGUsage) {
      void session
        .logRAGUsage(userText, ragResult?.snippets || [], false)
        .catch(() => undefined);
    }

    // Trigger assistant response
    safeSendToOpenAI({
      type: "response.create",
      response: {
        modalities: ["text", "audio"],
      },
    });
  }

  // Handle messages from Twilio
  conn.on("message", async (raw) => {
    try {
      const data: TwilioMessage = JSON.parse(raw.toString());

      console.log("🔄 Processing Twilio event", { event: data.event });

      // 1. Handle START event
      if (data.event === "start") {
        console.log("🚀 Twilio stream start received");

        streamSid = data.start?.streamSid || "";
        callSid = data.start?.callSid || "";

        const customParameters = data.start?.customParameters || {};
        const token = customParameters.token;
        const paramCallSid = customParameters.callSid || callSid;

        // Validate token
        if (!token || !verifyCallToken(token) || !paramCallSid) {
          log.warn("Invalid token or missing callSid");
          conn.send(JSON.stringify({ event: "error", message: "auth_failed" }));
          conn.close();
          return;
        }

        // Check for duplicate connection
        if (activeConnections.has(paramCallSid)) {
          console.log("⚠️ Duplicate connection detected, closing previous");
          const existingConn = activeConnections.get(paramCallSid);
          if (existingConn) {
            if (existingConn.openaiWs?.readyState === WebSocket.OPEN) {
              existingConn.openaiWs.close();
            }
            if (existingConn.conn.readyState === WebSocket.OPEN) {
              existingConn.conn.close();
            }
            activeConnections.delete(paramCallSid);
          }
        }

        // Get session
        session = SessionManager.get(paramCallSid);
        if (!session) {
          // log.warn("Session not found for callSid", paramCallSid);
          conn.send(
            JSON.stringify({ event: "error", message: "session_missing" })
          );
          conn.close();
          return;
        }

        callSid = paramCallSid;

        // Store connection
        activeConnections.set(callSid, {
          conn,
          openaiWs: null,
          session,
          streamSid,
          isInitialized: false,
        });

        // Send acknowledgment to Twilio IMMEDIATELY
        safeSendToTwilio({
          event: "connected",
          streamSid: streamSid,
        });
        console.log("✉️ Sent connected acknowledgment to Twilio");

        // Initialize OpenAI Realtime connection
        await initializeOpenAIConnection();
      }
      // 2. Handle MEDIA events (audio from caller)
      else if (data.event === "media" && data.media) {
        if (!callSid) {
          return;
        }

        if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
          // Send immediately if initialized
          if (isSessionInitialized) {
            const audioMessage = {
              type: "input_audio_buffer.append",
              audio: data.media.payload,
            };
            safeSendToOpenAI(audioMessage);
          } else {
            // Buffer the audio
            audioBuffer.push(data.media.payload);
          }
        }
      }
      // 3. Handle MARK event (end of speech segment)
      else if (data.event === "mark") {
        // Twilio MARK events are optional and not required when using server VAD.
        // Keeping this as a no-op avoids duplicate / out-of-turn responses.
      }
      // 4. Handle STOP event (call ended)
      else if (data.event === "stop") {
        log.info("Stop event received, ending call");
        hasReceivedStop = true;

        if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
          // openaiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
          openaiWs.close();
        }

        conn.close();
      }
    } catch (e: any) {
      // log.error("Error handling Twilio message", {
      //   error: e.message,
      // });
    }
  });

  // Initialize OpenAI Realtime connection - OPTIMIZED for speed
  async function initializeOpenAIConnection() {
    try {
      openaiWs = createOpenAIRealtimeWS();

      // Update active connections
      if (activeConnections.has(callSid)) {
        const connData = activeConnections.get(callSid);
        if (connData) {
          connData.openaiWs = openaiWs;
          activeConnections.set(callSid, connData);
        }
      }

      openaiWs.on("open", async () => {
        // log.info("✅ OpenAI WebSocket connection established", { callSid });

        // Get system prompt QUICKLY
        const systemPrompt = session.buildEnhancedSystemPrompt
          ? session.buildEnhancedSystemPrompt()
          : `You are an AI receptionist. Greet the caller warmly and ask how you can help them.`;

        // Get voice profile
        const voiceProfile = session.businessConfig?.voiceProfile || {
          voice: "alloy",
        };

        // Configure the session - MINIMAL configuration for speed
        const sessionConfig = {
          type: "session.update",
          session: {
            instructions: systemPrompt,
            turn_detection: {
              type: "server_vad",
              threshold: 0.3,
              prefix_padding_ms: 100,
              silence_duration_ms: 400,
            },
            input_audio_format: "g711_ulaw",
            output_audio_format: "g711_ulaw",
            voice: voiceProfile.voice,
            modalities: ["text", "audio"],
            temperature: 0.8,
            input_audio_transcription: {
              model: "whisper-1",
            },
            tools: ToolRouter.getToolSpec(),
            tool_choice: "auto",
          },
        };
        console.log(
          "🔧 Tools being sent to OpenAI:",
          JSON.stringify(ToolRouter.getToolSpec()).substring(0, 500)
        );

        // Send session config IMMEDIATELY
        safeSendToOpenAI(sessionConfig);
        log.info("📤 Sent session configuration to OpenAI");

        // Set up message handling IMMEDIATELY
        setupOpenAIMessageHandling();

        // Mark as initialized and flush any buffered audio
        isSessionInitialized = true;

        if (activeConnections.has(callSid)) {
          const connData = activeConnections.get(callSid);
          if (connData) {
            connData.isInitialized = true;
            activeConnections.set(callSid, connData);
          }
        }

        if (audioBuffer.length > 0) {
          for (const chunk of audioBuffer) {
            safeSendToOpenAI({
              type: "input_audio_buffer.append",
              audio: chunk,
            });
          }
          audioBuffer = [];
        }

        // IMPORTANT: Don’t auto-trigger a response on connect.
        // TwiML already plays an intro greeting; letting the caller speak first prevents
        // overlapping audio and “fresh start” repeats on reconnect.
      });

      openaiWs.on("error", (error) => {
        // log.error("❌ OpenAI WebSocket error", {
        //   error: error.message,
        //   callSid,
        // });
      });

      openaiWs.on("close", (code, reason) => {
        // log.info("🔒 OpenAI WebSocket closed", { callSid });

        // Clean up active connections
        if (callSid && activeConnections.has(callSid)) {
          activeConnections.delete(callSid);
        }
      });
    } catch (error: any) {
      // log.error("Failed to initialize OpenAI connection", {
      //   error: error.message,
      //   callSid,
      // });
    }
  }

  function setupOpenAIMessageHandling() {
    if (!openaiWs) return;

    openaiWs.on("message", async (raw) => {
      try {
        const msg: OpenAIMessage = JSON.parse(raw.toString());
        console.log("🔍 Message type:", msg.type);

        // Specifically look for tool calls
        if (msg.type === "tool.call") {
          console.log("🎯 TOOL CALL DETECTED!");
          console.log("Tool name:", msg.tool?.name);
          console.log("Tool arguments:", msg.tool?.arguments);
        }

        // Log important message types only
        const importantTypes = [
          "session.updated",
          "response.audio.delta",
          "response.output_audio.delta",
          "response.done",
          "error",
        ];

        if (importantTypes.includes(msg.type)) {
          // log.debug("📨 OpenAI message", { type: msg.type });
        }

        // 1. Handle session updates
        if (msg.type === "session.updated") {
          session.openaiSessionId = msg.session?.id;
          log.info("🔄 OpenAI session updated");
        }

        // Track assistant item IDs for best-effort truncation during barge-in
        if (
          (msg.type === "response.output_item.added" ||
            msg.type === "conversation.item.created") &&
          msg.item?.role === "assistant" &&
          msg.item?.id
        ) {
          lastAssistantItemId = msg.item.id;
        }

        // Replace both handlers with this single handler:
        if (
          (msg.type === "response.audio.delta" ||
            msg.type === "response.output_audio.delta") &&
          msg.delta
        ) {
          console.log(
            `🔊 Audio delta type: ${msg.type}, length: ${msg.delta.length}`
          );

          // If caller is speaking, drop outbound audio (barge-in)
          if (isUserSpeaking) {
            return;
          }

          isAssistantSpeaking = true;

          // Only send if we haven't sent this already
          if (msg.type === "response.audio.delta") {
            // response.audio.delta is the main one to use
            try {
              safeSendToTwilio({
                event: "media",
                streamSid: streamSid,
                media: {
                  payload: msg.delta,
                  track: "outbound",
                },
              });
            } catch (sendError: any) {
              log.error("Failed to send audio to Twilio", sendError);
            }
          }
          // Ignore response.output_audio.delta if it's duplicate
        }

        // 2. Handle audio output - MOST IMPORTANT
        // if (msg.type === "response.audio.delta" && msg.delta) {
        //   // Send audio to Twilio IMMEDIATELY
        //   try {
        //     conn.send(
        //       JSON.stringify({
        //         event: "media",
        //         streamSid: streamSid,
        //         media: {
        //           payload: msg.delta,
        //           track: "inbound",
        //         },
        //       })
        //     );
        //   } catch (sendError: any) {
        //     log.error("Failed to send audio to Twilio", sendError);
        //   }
        // }

        // Also handle output_audio.delta format
        // if (msg.type === "response.output_audio.delta" && msg.delta) {
        //   try {
        //     conn.send(
        //       JSON.stringify({
        //         event: "media",
        //         streamSid: streamSid,
        //         media: {
        //           payload: msg.delta,
        //           track: "inbound",
        //         },
        //       })
        //     );
        //   } catch (sendError: any) {
        //     log.error("Failed to send output_audio to Twilio", sendError);
        //   }
        // }
        // Then in your message handlers, add:
        if (msg.type === "response.create" || msg.type === "response.created") {
          console.log(
            `🔄 [${Date.now()}] Response triggered #${++responseCount}`
          );
        }

        if (
          msg.type === "response.audio.delta" ||
          msg.type === "response.output_audio.delta"
        ) {
          const now = Date.now();
          console.log(
            `🎵 [${now}] Audio delta received, last was ${
              now - lastResponseTime
            }ms ago`
          );
          lastResponseTime = now;
        }

        // 3. Handle text output
        if (
          (msg.type === "response.text.delta" ||
            msg.type === "response.output_text.delta") &&
          msg.delta
        ) {
          if (session.pushTranscriptSegment) {
            session.pushTranscriptSegment(msg.delta, "ai");
          }
        }

        // 4. Handle user transcription - RAG INTEGRATION
        // if (
        //   msg.type ===
        //     "conversation.item.input_audio_transcription.completed" &&
        //   msg.transcript
        // ) {
        //   const userText = msg.transcript;
        //   if (session.pushTranscriptSegment) {
        //     session.pushTranscriptSegment(userText, "user");
        //   }

        //   log.info("👤 User said:", { text: userText });

        //   // Perform RAG search ASYNCHRONOUSLY (don't block audio)
        //   if (session.searchKnowledge) {
        //     setTimeout(async () => {
        //       try {
        //         const knowledgeSnippets = await session.searchKnowledge(
        //           userText,
        //           3
        //         );

        //         if (knowledgeSnippets.length > 0) {
        //           const contextMessage = {
        //             type: "conversation.item.create",
        //             item: {
        //               type: "message",
        //               role: "system",
        //               content: `RELEVANT INFO:\n${knowledgeSnippets
        //                 .map((s: string, i: number) => `${i + 1}. ${s}`)
        //                 .join("\n")}`,
        //             },
        //           };

        //           openaiWs?.send(JSON.stringify(contextMessage));
        //         }
        //       } catch (ragError: any) {
        //         log.error("RAG search failed", ragError);
        //       }
        //     }, 100); // Small delay to not interrupt conversation flow
        //   }
        // }
        // 4. Handle user transcription - ENHANCED WITH RAG
        if (
          msg.type ===
            "conversation.item.input_audio_transcription.completed" &&
          msg.transcript
        ) {
          const userText = msg.transcript;
          lastUserUtterance = userText;
          session.pushTranscriptSegment(userText, "user");

          // log.info("👤 User transcription", { text: userText });

          // Debounce transcripts and respond using a short async path (keeps realtime loop snappy)
          pendingTranscript = { eventId: msg.event_id, text: userText };
          if (pendingTranscriptTimer) {
            clearTimeout(pendingTranscriptTimer);
          }
          pendingTranscriptTimer = setTimeout(() => {
            const t = pendingTranscript;
            pendingTranscript = null;
            pendingTranscriptTimer = null;
            if (t) {
              void enrichContextAndRespond(t.text);
            }
          }, 50);
        }

        // 5. Handle tool calls
        if (msg.type === "tool.call" && msg.tool) {
          await handleToolCall(msg.tool);
        }

        // 6. Handle response completion
        if (msg.type === "response.done") {
          log.info("✅ AI response completed");
          isAssistantSpeaking = false;
        }

        // 7. Handle errors
        if (msg.type === "error") {
          log.error("❌ OpenAI error:", msg.error);
        }

        // 8. Handle speech detection (debug only)
        if (msg.type === "input_audio_buffer.speech_started") {
          isUserSpeaking = true;
          // If assistant is speaking, barge-in: stop playback immediately
          if (isAssistantSpeaking) {
            clearTwilioPlayback();
            cancelAssistantResponse();
            isAssistantSpeaking = false;
          }
        }

        if (msg.type === "input_audio_buffer.speech_stopped") {
          isUserSpeaking = false;
          // Best-effort commit for manual turn control (safe even if ignored)
          safeSendToOpenAI({ type: "input_audio_buffer.commit" });
        }
      } catch (error: any) {
        log.error("Error handling OpenAI message", error);
      }
    });
  }

  async function handleToolCall(tool: any) {
    try {
      const toolName = tool.name;
      const args = tool.arguments ? JSON.parse(tool.arguments) : {};

      // log.info("🔧 Tool call:", { toolName });

      // Forward to n8n webhook
      const result = await forwardToN8n(toolName, args, session);

      // ADD ROBUST LOGGING HERE
      // log.info("Result from n8n webhook:", {
      //   toolName,
      //   result,
      // });

      // Send result back to OpenAI
      const functionOutput = {
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          role: "system",
          output: JSON.stringify(result),
        },
      };

      openaiWs?.send(JSON.stringify(functionOutput));

      // Trigger next response immediately
      setTimeout(() => {
        if (openaiWs?.readyState === WebSocket.OPEN) {
          openaiWs.send(
            JSON.stringify({
              type: "response.create",
              response: {
                modalities: ["text", "audio"],
              },
            })
          );
        }
      }, 100); // Minimal delay
    } catch (error: any) {
      log.error("Error handling tool call", error);
    }
  }

  // Handle WebSocket close
  conn.on("close", async (code, reason) => {
    // log.info("🔚 Twilio WebSocket closed", { callSid });

    try {
      // Clean up
      if (callSid && activeConnections.has(callSid)) {
        activeConnections.delete(callSid);
      }

      // Only finalize and delete the session when the call actually ends (Twilio STOP).
      // Media stream websocket can transiently reconnect mid-call.
      if (hasReceivedStop && session) {
        if (session.persistTranscriptAndSummary) {
          await session.persistTranscriptAndSummary();
        }
        if (session.finalizeCall) {
          await session.finalizeCall();
        }
      }
    } catch (err: any) {
      log.error("Error finalizing call", err);
    } finally {
      if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.close();
      }
      if (callSid && hasReceivedStop) {
        SessionManager.delete(callSid);
      }
    }
  });

  // Handle WebSocket errors
  conn.on("error", (error) => {
    // log.error("❌ Twilio WebSocket error", { error: error.message });
  });
}

async function forwardToN8n(toolName: string, args: any, session: any) {
  // Determine which webhook to use based on tool type
  let webhookUrl: string | undefined = env.N8N_TOOL_WEBHOOK; // Default for general tools

  // Route calendar-related tools to the calendar webhook
  const calendarTools = [
    "book_appointment",
    "reschedule_appointment",
    "cancel_appointment",
    "check_availability",
  ];

  if (calendarTools.includes(toolName)) {
    webhookUrl = env.N8N_CALENDAR_WEBHOOK;
    // log.info("📅 Routing to calendar webhook", { toolName, webhookUrl });
  }

  if (!webhookUrl) {
    return {
      success: false,
      message: "Webhook not configured",
    };
  }

  const payload = {
    tool: toolName,
    args: args,
    session: {
      businessId: session.businessId,
      businessName: session.business?.name,
      callId: session.callId,
      callSid: session.callSid,
      callerPhone: session.from,
      timestamp: new Date().toISOString(),
    },
  };

  try {
    // log.info("📤 Forwarding tool call to n8n", { toolName, webhookUrl });

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000), // 10 second timeout for calendar operations
    });

    if (!response.ok) {
      throw new Error(`N8N webhook failed: ${response.status}`);
    }

    const result = await response.json();
    // log.info("✅ Received response from n8n", {
    //   toolName,
    //   success: result.success,
    // });

    return result;
  } catch (error: any) {
    // log.error("Failed to forward to n8n", {
    //   error: error.message,
    //   toolName,
    //   webhookUrl,
    // });

    // Return a fallback response that the AI can use
    return {
      success: false,
      error: "Service temporarily unavailable",
      message:
        "I couldn't process your calendar request right now. Please try again in a moment or call back later.",
    };
  }
}

// async function forwardToN8n(toolName: string, args: any, session: any) {
//   const webhookUrl = env.N8N_TOOL_WEBHOOK;

//   if (!webhookUrl) {
//     return {
//       success: false,
//       message: "Webhook not configured",
//     };
//   }

//   const payload = {
//     tool: toolName,
//     args: args,
//     session: {
//       businessId: session.businessId,
//       businessName: session.business?.name,
//       callId: session.callId,
//       callSid: session.callSid,
//       callerPhone: session.from,
//     },
//   };

//   try {
//     const response = await fetch(webhookUrl, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify(payload),
//       signal: AbortSignal.timeout(5000),
//     });

//     if (!response.ok) {
//       throw new Error(`N8N webhook failed: ${response.status}`);
//     }

//     return await response.json();
//   } catch (error: any) {
//     log.error("Failed to forward to n8n", error);
//     return {
//       success: false,
//       error: "Service temporarily unavailable",
//     };
//   }
// }
