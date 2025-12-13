// utils/hmac.ts
import { createHmac, timingSafeEqual } from "crypto";
import { log } from "./logger.js";

const HMAC_SECRET = process.env.HMAC_TOKEN_SECRET || "change-me-in-production";
const TOKEN_TTL = parseInt(process.env.CALL_TOKEN_TTL || "300"); // 5 minutes

export function signCallToken(callSid: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const data = `${callSid}:${timestamp}`;

  const hmac = createHmac("sha256", HMAC_SECRET);
  hmac.update(data);
  const signature = hmac.digest("hex");

  return `${data}:${signature}`;
}

export function verifyCallToken(token: string): boolean {
  try {
    const parts = token.split(":");
    if (parts.length !== 3) return false;

    const [callSid, timestampStr, signature] = parts;
    const timestamp = parseInt(timestampStr);

    // Check if token is expired
    const now = Math.floor(Date.now() / 1000);
    if (now - timestamp > TOKEN_TTL) {
      log.warn("Token expired", { callSid, timestamp, now });
      return false;
    }

    // Verify signature
    const data = `${callSid}:${timestamp}`;
    const hmac = createHmac("sha256", HMAC_SECRET);
    hmac.update(data);
    const expectedSignature = hmac.digest("hex");

    // Use timingSafeEqual to prevent timing attacks
    const signatureBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    const isValid = timingSafeEqual(signatureBuffer, expectedBuffer);

    if (!isValid) {
      log.warn("Invalid token signature", { callSid });
    }

    return isValid;
  } catch (error) {
    log.error("Error verifying token", error);
    return false;
  }
}

export function generateWebhookSignature(payload: string): string {
  const hmac = createHmac("sha256", HMAC_SECRET);
  hmac.update(payload);
  return hmac.digest("hex");
}

export function verifyWebhookSignature(
  payload: string,
  signature: string
): boolean {
  try {
    const expectedSignature = generateWebhookSignature(payload);
    return timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex")
    );
  } catch (error) {
    log.error("Error verifying webhook signature", error);
    return false;
  }
}
