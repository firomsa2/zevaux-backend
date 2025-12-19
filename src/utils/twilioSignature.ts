import twilio from "twilio";

export async function validateTwilioSignature(request: any): Promise<boolean> {
  // Skip validation in development
  //   if (process.env.NODE_ENV !== "production") {
  //     return true;
  //   }

  const signature = request.headers["x-twilio-signature"];
  if (!signature || !process.env.TWILIO_AUTH_TOKEN) {
    return false;
  }

  // ✅ Reconstruct EXACT public URL Twilio used
  const proto =
    (request.headers["x-forwarded-proto"] as string) || request.protocol;

  const host =
    (request.headers["x-forwarded-host"] as string) || request.headers.host;

  const url = `${proto}://${host}${request.raw.url}`;

  try {
    return twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      signature,
      url,
      request.body
    );
  } catch {
    return false;
  }
}
