import { FastifyRequest } from "fastify";
import WebSocket from "ws";
import { SessionManager } from "../core/sessionManager.js";
import { createOpenAIRealtimeWS } from "../openai/openaiClient.js";
import { verifyCallToken } from "../utils/hmac.js";
import { ToolRouter } from "../core/functionRouter.js";
import { log } from "../utils/logger.js";
import { env } from "../config/env.js";
import Twilio from "twilio";

const twilioClient = Twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
// const twilioClient = new Twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

type TwilioMessage = any;

// Constants for audio pacing
const AUDIO_FRAME_SIZE_MS = 20; // 20ms per frame
const SAMPLE_RATE = 8000; // 8kHz for G.711 ulaw
// G.711 ulaw is 1 byte per sample, so 8000 bytes/sec
// 20ms = 0.02s * 8000 = 160 bytes
const CHUNK_SIZE = 160;

export async function handleMediaStream(conn: WebSocket, req: FastifyRequest) {
  let openaiWs: WebSocket | null = null;
  let callSid = "";
  let streamSid = "";
  let session: any = null;

  // State for audio buffering and pacing
  let audioQueue: string[] = []; // Queue of base64 strings
  let isPlaying = false;
  let audioInterval: NodeJS.Timeout | null = null;

  // Metrics state
  let callStartTimestamp = Date.now();
  let lastEventTimestamp = 0;

  log.info("New WebSocket connection to /media-stream");

  // Helper to flush audio
  const flushAudio = () => {
    audioQueue = [];
    if (streamSid && conn.readyState === WebSocket.OPEN) {
      // Tell Twilio to clear its buffer
      conn.send(
        JSON.stringify({
          event: "clear",
          streamSid,
        })
      );
    }
  };

  // Audio Pacing Loop
  const startAudioPacing = () => {
    if (audioInterval) clearInterval(audioInterval);

    audioInterval = setInterval(() => {
      if (audioQueue.length > 0 && conn.readyState === WebSocket.OPEN) {
        const audioData = audioQueue.shift();
        if (audioData) {
          conn.send(
            JSON.stringify({
              event: "media",
              streamSid: streamSid,
              media: {
                payload: audioData,
                track: "inbound",
              },
            })
          );
        }
      }
    }, AUDIO_FRAME_SIZE_MS);
  };

  // Handle messages from Twilio
  conn.on("message", async (raw) => {
    try {
      const data: TwilioMessage = JSON.parse(raw.toString());

      // 1. Handle START event
      if (data.event === "start") {
        log.info("Twilio stream start", data.start);

        streamSid = data.start.streamSid;
        callSid = data.start.callSid;

        const customParameters = data.start.customParameters || {};
        const token = customParameters.token;
        const paramCallSid = customParameters.callSid || callSid;

        // Validate token
        if (!token || !verifyCallToken(token) || !paramCallSid) {
          log.warn("Invalid token or missing callSid");
          conn.send(JSON.stringify({ event: "error", message: "auth_failed" }));
          conn.close();
          return;
        }

        // Get session
        session = SessionManager.get(paramCallSid);
        if (!session) {
          log.warn("Session not found for callSid", paramCallSid);
          conn.send(
            JSON.stringify({ event: "error", message: "session_missing" })
          );
          conn.close();
          return;
        }

        callSid = paramCallSid;

        // Send acknowledgment to Twilio
        conn.send(
          JSON.stringify({
            event: "connected",
            streamSid: streamSid,
          })
        );

        // Start the audio pacer
        startAudioPacing();

        // Connect to OpenAI
        openaiWs = createOpenAIRealtimeWS();

        openaiWs.on("open", async () => {
          // log.info("OpenAI WS open for", callSid);

          // Get system prompt from session
          const systemPrompt =
            session.businessPrompt || session.buildFallbackPrompt();

          // Get voice profile from config
          const voiceProfile = session.businessConfig?.voiceProfile || {
            voice: "alloy",
            language: session.business?.default_language || "en-US",
          };

          const msg = {
            type: "session.update",
            session: {
              instructions: systemPrompt,
              turn_detection: {
                type: "server_vad",
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 400, // Tuned for snappier response
                // threshold: 0.75, // ignore quieter sounds
                // silence_duration_ms: 700, // wait longer before deciding
                // prefix_padding_ms: 200,
              },
              input_audio_format: "g711_ulaw",
              output_audio_format: "g711_ulaw",
              voice: voiceProfile.voice || "alloy",
              modalities: ["text", "audio"],
              temperature: 0.7,
              input_audio_transcription: {
                model: "whisper-1",
              },
              tools: ToolRouter.getToolSpec(),
              tool_choice: "auto",
            },
          };
          openaiWs?.send(JSON.stringify(msg));

          log.info("Sent session.update to OpenAI");

          // Trigger the AI to start speaking
          setTimeout(() => {
            if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
              openaiWs.send(
                JSON.stringify({
                  type: "response.create",
                  response: {
                    modalities: ["text", "audio"],
                  },
                })
              );
              log.info("Triggered AI to start conversation");
            }
          }, 1000);
        });

        // Setup OpenAI message handling
        if (openaiWs) {
          setupOpenAiMessageHandling(
            openaiWs,
            conn,
            session,
            streamSid,
            (chunk) => {
              // Add to buffer instead of sending directly
              audioQueue.push(chunk);
            },
            flushAudio
          );
        }

        openaiWs.on("error", (err) => {
          // log.error("OpenAI WebSocket error:", err);
          conn.send(
            JSON.stringify({
              event: "error",
              message: "OpenAI connection error",
            })
          );
        });

        openaiWs.on("close", () => {
          // log.info("OpenAI WebSocket closed for", callSid);
        });
      }
      // 2. Handle MEDIA events
      else if (data.event === "media") {
        if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
          const audioAppend = {
            type: "input_audio_buffer.append",
            audio: data.media.payload,
          };
          openaiWs.send(JSON.stringify(audioAppend));
        }
      }
      // 3. Handle STOP event
      else if (data.event === "stop") {
        log.info("Received stop event");
        if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        }
      }
      // 4. Handle CLEAR event (if Twilio sends it)
      else if (data.event === "clear") {
        audioQueue = [];
      }
    } catch (e) {
      // log.error("Error parsing Twilio message", e);
    }
  });

  // Handle WebSocket close
  conn.on("close", async () => {
    // log.info("Twilio WS closed for", callSid);
    if (audioInterval) clearInterval(audioInterval);

    try {
      if (session) {
        const finalText = session.getTranscript();
        await session.persistTranscriptAndSummary(finalText);
        await session.finalizeCall();
      }
    } catch (err) {
      // log.error("Error finalizing call", err);
    } finally {
      if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.close();
      }
      if (callSid) {
        SessionManager.delete(callSid);
      }
    }
  });

  conn.on("error", (err) => log.error("TwilioWS err"));
  // conn.on("error", (err) => log.error("TwilioWS err", err));
}

function setupOpenAiMessageHandling(
  openaiWs: WebSocket,
  conn: WebSocket,
  session: any,
  streamSid: string,
  onAudioDelta: (chunk: string) => void,
  onBargeIn: () => void
) {
  openaiWs.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // 1. Handle audio output
      if (msg.type === "response.audio.delta" && msg.delta) {
        onAudioDelta(msg.delta);
      }

      // 2. Handle User Interruption (Barge-In)
      if (msg.type === "input_audio_buffer.speech_started") {
        log.info("Speech started (Barge-in detected)");
        onBargeIn();

        // Cancel OpenAI response
        openaiWs.send(
          JSON.stringify({
            type: "response.cancel",
          })
        );
      }

      // 3. Handle function calls (tools)
      if (msg.type === "response.function_call_arguments.done") {
        const functionName = msg.name;
        const args = JSON.parse(msg.arguments);
        const callId = msg.call_id;

        log.info(`Function call: ${functionName}`, args);
        console.log(`Function call: ${functionName}`, args);

        // Handle Handover to Human
        if (functionName === "handover_to_human") {
          log.info("Initiating handover to human");
          const targetPhone =
            session.businessConfig?.forwarding_phone ||
            session.business?.phone_number;

          console.log("Handover to human, target phone:", targetPhone);

          // log.info("Handover details", {
          //   currentBotNumber: session.to,
          //   targetPhone: targetPhone,
          //   caller: session.from,
          // });
          console.log("Handover details", {
            currentBotNumber: session.to,
            targetPhone: targetPhone,
            caller: session.from,
          });

          if (targetPhone) {
            // Prevent self-dialing loop
            if (targetPhone === session.to) {
              console.log(
                "Target phone is same as bot number. Aborting transfer to avoid loop."
              );
              log.warn(
                "Target phone is same as bot number. Aborting transfer to avoid loop."
              );
              // Optionally tell the user we can't transfer
              return;
            }

            try {
              log.info("Transferring call to:", targetPhone);
              console.log("Transferring call to:", targetPhone);
              await twilioClient.calls(session.callSid).update({
                twiml: `<Response>
                                    <Say>Please hold while I connect you to a specialist.</Say>
                                    <Dial>${targetPhone}</Dial>
                                 </Response>`,
              });
              console.log("Call transfer initiated to", targetPhone);
              // log.info("Call transfer initiated", { targetPhone });
              return;
            } catch (err) {
              // log.error("Failed to transfer call", err);
            }
          } else {
            log.warn("No forwarding phone number configured for handover");
          }
        }

        // Handle Knowledge Base Search
        if (functionName === "search_knowledge_base") {
          log.info("Executing search_knowledge_base tool", args);
          try {
            const query = args.query;
            const searchResult = await session.searchKnowledgeWithRAG(query, {
              topK: 3,
              minSimilarity: 0.5,
            });

            const result = {
              success: true,
              results: searchResult.formattedContext,
              metadata: {
                count: searchResult.snippets.length,
                method: searchResult.searchMethod,
              },
            };

            // log.info("Search result found", {
            //   count: searchResult.snippets.length,
            // });

            // Send result back to OpenAI
            const toolOutputMsg = {
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: callId,
                output: JSON.stringify(result),
              },
            };
            openaiWs.send(JSON.stringify(toolOutputMsg));

            // Trigger response after tool output
            openaiWs.send(
              JSON.stringify({
                type: "response.create",
                response: {
                  modalities: ["text", "audio"],
                },
              })
            );
            return;
          } catch (err) {
            // log.error("Error executing search_knowledge_base", err);
            // Fall through to error handling
          }
        }

        try {
          // Forward to n8n webhook
          const result = await forwardToN8n(functionName, args, session);

          // Send result back to OpenAI
          const toolOutputMsg = {
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify(result),
            },
          };
          openaiWs.send(JSON.stringify(toolOutputMsg));

          // Trigger response after tool output
          openaiWs.send(
            JSON.stringify({
              type: "response.create",
              response: {
                modalities: ["text", "audio"],
              },
            })
          );
        } catch (error) {
          // log.error("Error executing tool:", error);

          // Send error back to OpenAI
          const errorEvent = {
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify({ error: "Tool execution failed" }),
            },
          };
          openaiWs.send(JSON.stringify(errorEvent));
        }
      }

      // 4. Handle Transcript (User)
      if (
        msg.type === "conversation.item.input_audio_transcription.completed"
      ) {
        const text = msg.transcript;
        if (text) {
          session.addTranscriptEntry("user", text);

          // log.info("User transcript received", { text });

          // Perform RAG search
          try {
            const knowledgeContext = await session.getContextualKnowledge(text);

            if (knowledgeContext.hasRelevantInfo) {
              // log.info("Found relevant knowledge for query", {
              //   query: text,
              //   confidence: knowledgeContext.confidence,
              // });

              // Inject knowledge as a system message
              const contextMsg = {
                type: "conversation.item.create",
                item: {
                  type: "message",
                  role: "system",
                  content: knowledgeContext.knowledgeContext,
                },
              };
              openaiWs.send(JSON.stringify(contextMsg));
            } else {
              // log.info("No relevant knowledge found for query", {
              //   query: text,
              // });
            }
          } catch (err) {
            // log.error("Error performing RAG search", err);
          }
        }
      }

      // 5. Handle Transcript (Assistant)
      if (msg.type === "response.audio_transcript.done") {
        const text = msg.transcript;
        if (text) {
          session.addTranscriptEntry("assistant", text);
        }
      }
    } catch (e) {
      // log.error("Error parsing OpenAI message", e);
    }
  });
}

async function forwardToN8n(toolName: string, args: any, session: any) {
  let webhookUrl = env.N8N_TOOL_WEBHOOK;

  // Route calendar tools to specific webhook
  if (
    [
      "book_appointment",
      "check_availability",
      "reschedule_appointment",
      "cancel_appointment",
    ].includes(toolName)
  ) {
    if (env.N8N_CALENDAR_WEBHOOK) {
      webhookUrl = env.N8N_CALENDAR_WEBHOOK;
      log.info(`Routing tool ${toolName} to Calendar Webhook`);
    } else {
      log.warn(
        "N8N_CALENDAR_WEBHOOK not set, falling back to N8N_TOOL_WEBHOOK"
      );
    }
  }

  if (!webhookUrl) {
    // If no webhook configured, just log and return success (mock mode)
    log.warn("N8N_TOOL_WEBHOOK not configured, skipping forwarding");
    return { success: true, message: "Tool executed (mock)" };
  }

  const payload = {
    tool: toolName,
    args: args,
    businessId: session.businessId,
    callId: session.callId,
    callerPhone: session.from,
    timestamp: new Date().toISOString(),
    // Add a human-readable message for n8n workflows that expect it
    message: `Tool call: ${toolName} with args: ${JSON.stringify(args)}`,
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`N8N webhook failed: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    // log.error("Failed to forward to n8n", error);
    throw error;
  }
}
