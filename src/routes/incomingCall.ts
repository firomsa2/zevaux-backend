import { FastifyInstance } from "fastify";
import { CallSession } from "../models/CallSession.js";
import { SessionManager } from "../core/sessionManager.js";
import { signCallToken } from "../utils/hmac.js";
import { log } from "../utils/logger.js";
import twilio from "twilio";
import { validateTwilioSignature } from "../utils/twilioSignature.js";

// Initialize Twilio client for validation
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export default async function incomingCallRoute(fastify: FastifyInstance) {
  fastify.post("/incoming-call", async (request, reply) => {
    console.log("Validating Twilio signature for incoming call");
    const isValid = await validateTwilioSignature(request);
    console.log("Twilio signature valid:", isValid);

    if (!isValid) {
      return reply.status(401).type("text/xml").send(`
        <?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Reject reason="busy"/>
        </Response>
      `);
    }
    try {
      // log.info("Incoming call request received", {
      //   headers: request.headers,
      //   body: request.body,
      // });
      console.log("Incoming call request received", {
        headers: request.headers,
        body: request.body,
      });

      // try {
      // log.info("Incoming call request received", {
      //   headers: request.headers,
      //   body: request.body,
      // });
      // console.log("Incoming call request received", {
      //   headers: request.headers,
      //   body: request.body,
      // });

      // Validate Twilio signature
      // const isValid = await validateTwilioSignature(request);
      // if (!isValid) {
      //   log.warn("Invalid Twilio signature");
      //   return reply
      //     .status(401)
      //     .type("text/xml")
      //     .send(
      //       `<?xml version="1.0" encoding="UTF-8"?>
      //     <Response>
      //       <Reject reason="busy"/>
      //     </Response>`
      //     );
      // }

      const params = (request.body as Record<string, any>) || {};
      const from = params.From || params.from || "unknown";
      const to = params.To || params.to || "unknown";
      const callSid = params.CallSid || params.callSid || `cs_${Date.now()}`;
      const direction = params.Direction || "inbound";

      // log.info("Processing incoming call", {
      //   callSid,
      //   from: from.replace(/\d(?=\d{4})/g, "*"), // Mask phone number in logs
      //   to: to.replace(/\d(?=\d{4})/g, "*"),
      //   direction,
      // });

      // Create and initialize session
      const session = new CallSession({ callSid, from, to, direction });

      try {
        await session.loadBusinessAndConfig();
        await session.createCallRow(params);
      } catch (err: any) {
        // log.error("Failed to initialize call session", {
        //   error: err.message,
        //   callSid,
        //   to,
        // });

        // Return error TwiML
        const errorTwiML = `<?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Say voice="alice" language="en-US">
              We're sorry, we're unable to connect your call right now. 
              Please try again later or contact us directly.
            </Say>
            <Pause length="2"/>
            <Hangup/>
          </Response>`;

        return reply.type("text/xml").send(errorTwiML);
      }

      // Store session in manager
      SessionManager.set(callSid, session);

      // Sign token for WebSocket authentication
      const token = signCallToken(callSid);

      // Get WebSocket URL
      const host = request.headers.host || "localhost:5050";
      const useWss =
        process.env.NODE_ENV === "production" || host.includes("https");
      //   const protocol = useWss ? "wss" : "ws";
      const protocol = useWss ? "wss" : "wss";
      //   const wsUrl = `${protocol}://${host}/media-stream`;

      // Get the host from request headers

      // Use wss:// protocol and add parameters in the Stream element
      const wsUrl = `wss://${host}/media-stream`;

      // Generate TwiML response
      const twiml = generateTwiML(wsUrl, callSid, token, from, to, session);

      // log.info("Returning TwiML response", {
      //   wsUrl,
      //   callSid,
      //   businessId: session.businessId,
      //   businessName: session.business?.name,
      // });

      return reply.type("text/xml").send(twiml);
    } catch (error: any) {
      // log.error("Unexpected error in incoming call route", {
      //   error: error.message,
      //   stack: error.stack,
      // });

      // Fallback TwiML
      const fallbackTwiML = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say voice="alice" language="en-US">
            Thank you for your call. We're currently experiencing technical difficulties.
            Please try again in a few minutes or leave a message after the tone.
          </Say>
          <Pause length="3"/>
          <Record maxLength="120" action="/api/voice/voicemail"/>
          <Say voice="alice" language="en-US">
            We didn't receive your message. Please call back later.
          </Say>
          <Hangup/>
        </Response>`;

      return reply.type("text/xml").send(fallbackTwiML);
    }
  });

  // Voicemail endpoint
  fastify.post("/voicemail", async (request, reply) => {
    const params = request.body as Record<string, any>;

    // log.info("Voicemail received", {
    //   callSid: params.CallSid,
    //   recordingUrl: params.RecordingUrl,
    //   duration: params.RecordingDuration,
    // });

    // TODO: Process voicemail - save to storage, notify business, etc.

    return reply.type("text/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say voice="alice" language="en-US">
          Thank you for your message. We'll get back to you as soon as possible.
        </Say>
        <Hangup/>
      </Response>`
    );
  });
}

// async function validateTwilioSignature(request: any): Promise<boolean> {
//   // Skip validation in development
//   if (process.env.NODE_ENV !== "production") {
//     return true;
//   }

//   const signature = request.headers["x-twilio-signature"];
//   const url = `${request.protocol}://${request.hostname}${request.url}`;
//   const params = request.body;

//   if (!signature || !process.env.TWILIO_AUTH_TOKEN) {
//     return false;
//   }

//   try {
//     return twilio.validateRequest(
//       process.env.TWILIO_AUTH_TOKEN,
//       signature,
//       url,
//       params
//     );
//   } catch (error) {
//     // log.error("Twilio signature validation error", error);
//     return false;
//   }
// }

// function generateTwiML(
//   wsUrl: string,
//   callSid: string,
//   token: string,
//   from: string,
//   to: string,
//   session: CallSession
// ): string {
//   console.log("Generating TwiML for call", {
//     callSid,
//     businessId: session.businessId,
//     businessName: session.business?.name,
//   });
//   // log.info("Generating TwiML for call", {
//   //   callSid,
//   //   businessId: session.businessId,
//   //   businessName: session.business?.name,
//   // });
//   // Check if we should play a greeting first
//   const greeting =
//     session.businessConfig?.introScript ||
//     `Thank you for calling ${
//       session.business?.name || "us"
//     }. Connecting you now.`;

//   console.log("Using greeting", { greeting });
//   // log.info("Using greeting", { greeting });
//   // Get voice profile
//   const voiceProfile = session.businessConfig?.voiceProfile || {
//     voice: "alice",
//     language: "en-US",
//   };
//   console.log("Using voice profile", voiceProfile);
//   // log.info("Using voice profile", { voiceProfile });

//   console.log("Generated TwiML", { wsUrl, callSid, from, to });
//   // log.info("Generated TwiML", { wsUrl, callSid, from, to });

//   console.log(
//     "TwiML Response:",
//     `<?xml version="1.0" encoding="UTF-8"?>
//     <Response>
//       ${
//         greeting
//           ? `
//       <Say voice="${voiceProfile.voice}" language="${
//               voiceProfile.language || "en-US"
//             }">
//         ${greeting}
//       </Say>
//       <Pause length="1"/>
//       `
//           : ""
//       }
//       <Connect>
//         <Stream url="${wsUrl}" name="zevaux_stream">
//           <Parameter name="callSid" value="${callSid}" />
//           <Parameter name="token" value="${token}" />
//           <Parameter name="from" value="${from}" />
//           <Parameter name="to" value="${to}" />
//           <Parameter name="businessId" value="${session.businessId}" />
//           <Parameter name="businessName" value="${
//             session.business?.name || ""
//           }" />
//           <Parameter name="timestamp" value="${Date.now()}" />
//         </Stream>
//       </Connect>
//     </Response>`
//   );

//   //   return `<?xml version="1.0" encoding="UTF-8"?>
//   //     <Response>
//   //       ${
//   //         greeting
//   //           ? `
//   //       <Say voice="${voiceProfile.voice}" language="${
//   //               voiceProfile.language || "en-US"
//   //             }">
//   //         ${greeting}
//   //       </Say>
//   //       <Pause length="1"/>
//   //       `
//   //           : ""
//   //       }
//   //       <Connect>
//   //         <Stream url="${wsUrl}" name="zevaux_stream">
//   //           <Parameter name="callSid" value="${callSid}" />
//   //           <Parameter name="token" value="${token}" />
//   //           <Parameter name="from" value="${from}" />
//   //           <Parameter name="to" value="${to}" />
//   //           <Parameter name="businessId" value="${session.businessId}" />
//   //           <Parameter name="businessName" value="${
//   //             session.business?.name || ""
//   //           }" />
//   //           <Parameter name="timestamp" value="${Date.now()}" />
//   //         </Stream>
//   //       </Connect>
//   //     </Response>`;

//   return `<?xml version="1.0" encoding="UTF-8"?>
//        <Response>
//          <Say voice="Google.en-US-Chirp3-HD-Aoede">Please wait while we connect your call to the A. I.</Say>
//          <!--<Pause length="1"/>-->
//          <!--<Say voice="Google.en-US-Chirp3-HD-Aoede">O.K. you can start talking!</Say>-->
//          <Connect>
//            <Stream url="${wsUrl}"  name="zevaux_stream">
//              <!-- Add parameters here - Twilio will send these in the WebSocket start event -->
//              <Parameter name="callSid" value="${callSid}" />
//              <Parameter name="token" value="${token}" />
//              <Parameter name="from" value="${from}" />
//              <Parameter name="to" value="${to}" />
//              <Parameter name="businessId" value="${session.businessId}" />
//                 <Parameter name="businessName" value="${
//                   session.business?.name || ""
//                 }" />
//              <Parameter name="timestamp" value="${Date.now()}" />
//            </Stream>
//          </Connect>
//        </Response>`;
// }

function generateTwiML(
  wsUrl: string,
  callSid: string,
  token: string,
  from: string,
  to: string,
  session: CallSession
): string {
  // AI speaks first: keep TwiML minimal (no <Say>) to avoid double-greeting.
  // The assistant greeting is generated via the realtime stream.
  return `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Connect>
        <Stream url="${wsUrl}" name="zevaux_stream">
          <Parameter name="callSid" value="${callSid}" />
          <Parameter name="token" value="${token}" />
          <Parameter name="from" value="${from}" />
          <Parameter name="to" value="${to}" />
          <Parameter name="businessId" value="${session.businessId}" />
          <Parameter name="businessName" value="${
            session.business?.name || ""
          }" />
          <Parameter name="timestamp" value="${Date.now()}" />
          <Parameter name="aiSpeaksFirst" value="1" />
        </Stream>
      </Connect>
    </Response>`;
}
