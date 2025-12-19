// import { env } from "../config/env.js";
// import { log } from "../utils/logger.js";

// export async function testCalendarWebhook() {
//   const webhookUrl = env.N8N_CALENDAR_WEBHOOK;

//   if (!webhookUrl || webhookUrl.includes("your-n8n-instance.com")) {
//     console.error("❌ Calendar webhook URL not configured properly");
//     console.log("Current URL:", webhookUrl);
//     return { success: false, message: "Webhook URL not configured" };
//   }

//   const testPayload = {
//     tool: "test_connection",
//     args: {
//       test: true,
//       timestamp: new Date().toISOString(),
//     },
//     session: {
//       test: true,
//       businessId: "test_business",
//       callId: "test_call_123",
//     },
//   };

//   try {
//     console.log("🔍 Testing calendar webhook:", webhookUrl);

//     const response = await fetch(webhookUrl, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify(testPayload),
//       timeout: 5000,
//     });

//     console.log("✅ Webhook response status:", response.status);

//     if (response.ok) {
//       const data = await response.json();
//       console.log("📦 Response data:", JSON.stringify(data, null, 2));
//       return { success: true, status: response.status, data };
//     } else {
//       console.error("❌ Webhook returned error:", response.statusText);
//       return {
//         success: false,
//         status: response.status,
//         error: response.statusText,
//       };
//     }
//   } catch (error) {
//     console.error("❌ Webhook test failed:", error.message);
//     return { success: false, error: error.message };
//   }
// }

// // Run the test
// testCalendarWebhook().then((result) => {
//   console.log("Test result:", result);
// });
