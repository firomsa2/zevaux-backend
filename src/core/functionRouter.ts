import { log } from "../utils/logger.js";

export class ToolRouter {
  static getToolSpec() {
    return [
      {
        type: "function",
        name: "book_appointment",
        description: "Book an appointment or schedule a meeting",
        parameters: {
          type: "object",
          properties: {
            customer_name: {
              type: "string",
              description: "Full name of the customer",
            },
            customer_phone: {
              type: "string",
              description: "Phone number for confirmation SMS",
            },
            customer_email: {
              type: "string",
              description: "Email for confirmation (optional)",
            },
            service: {
              type: "string",
              description: "Type of service or meeting topic",
            },
            date: {
              type: "string",
              description: "Date in YYYY-MM-DD format",
            },
            time: {
              type: "string",
              description: "Time in HH:MM format (24-hour)",
            },
            duration: {
              type: "string",
              description: "Duration in minutes (default: 30)",
            },
            notes: {
              type: "string",
              description: "Additional notes for the appointment",
            },
          },
          required: [
            "customer_name",
            "customer_phone",
            "service",
            "date",
            "time",
          ],
        },
      },
      {
        type: "function",
        name: "check_availability",
        description: "Check available time slots for appointments",
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description:
                "Date to check availability for in YYYY-MM-DD format",
            },
            service: {
              type: "string",
              description: "Type of service (optional)",
            },
          },
          required: ["date"],
        },
      },
      // {
      //   type: "function",
      //   name: "reschedule_appointment",
      //   description: "Reschedule an existing appointment",
      //   parameters: {
      //     type: "object",
      //     properties: {
      //       appointment_id: {
      //         type: "string",
      //         description: "Appointment reference number or ID",
      //       },
      //       customer_phone: {
      //         type: "string",
      //         description: "Customer phone for verification",
      //       },
      //       new_date: {
      //         type: "string",
      //         description: "New date in YYYY-MM-DD format",
      //       },
      //       new_time: {
      //         type: "string",
      //         description: "New time in HH:MM format",
      //       },
      //       reason: {
      //         type: "string",
      //         description: "Reason for rescheduling (optional)",
      //       },
      //     },
      //     required: [
      //       "appointment_id",
      //       "customer_phone",
      //       "new_date",
      //       "new_time",
      //     ],
      //   },
      // },
      // {
      //   type: "function",
      //   name: "cancel_appointment",
      //   description: "Cancel an existing appointment",
      //   parameters: {
      //     type: "object",
      //     properties: {
      //       appointment_id: {
      //         type: "string",
      //         description: "Appointment reference number or ID",
      //       },
      //       customer_phone: {
      //         type: "string",
      //         description: "Customer phone for verification",
      //       },
      //       reason: {
      //         type: "string",
      //         description: "Reason for cancellation (optional)",
      //       },
      //     },
      //     required: ["appointment_id", "customer_phone"],
      //   },
      // },
      // {
      //   type: "function",
      //   name: "send_followup_sms",
      //   description: "Send follow-up SMS to a customer",
      //   parameters: {
      //     type: "object",
      //     properties: {
      //       customer_phone: { type: "string" },
      //       message: { type: "string" },
      //     },
      //     required: ["customer_phone", "message"],
      //   },
      // },
      {
        type: "function",
        name: "handover_to_human",
        description: "Transfer call to a human or leave voicemail",
        parameters: {
          type: "object",
          properties: {
            reason: { type: "string" },
          },
          required: ["reason"],
        },
      },
      {
        type: "function",
        name: "search_knowledge_base",
        description:
          "Search the business knowledge base for information about policies, services, pricing, hours, etc.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "The search query (e.g., 'refund policy', 'pricing for haircut')",
            },
          },
          required: ["query"],
        },
      },
      {
        type: "function",
        name: "log_conversation_event",
        description: "Log important conversation events",
        parameters: {
          type: "object",
          properties: {
            event_type: { type: "string" },
            details: { type: "string" },
          },
          required: ["event_type"],
        },
      },
    ];
  }

  static async execute(toolName: string, args: any, session: any) {
    // This is just a fallback - actual execution happens in n8n
    // We forward all tool calls to n8n via webhook
    log.info(`Tool ${toolName} would be forwarded to n8n with args:`, args);

    return {
      success: true,
      message: `Tool ${toolName} forwarded to automation system`,
      tool: toolName,
      args: args,
    };
  }
}
