// import { CallSession } from "../models/CallSession.js";
// import { log } from "../utils/logger.js";

// export class SessionManager {
//   private static sessions = new Map<string, CallSession>();
//   private static cleanupInterval: NodeJS.Timeout | null = null;
//   private static readonly MAX_SESSION_AGE_MS = 30 * 60 * 1000; // 30 minutes

//   static init() {
//     // Start cleanup interval if not already running
//     if (!this.cleanupInterval) {
//       this.cleanupInterval = setInterval(() => {
//         this.cleanupOldSessions();
//       }, 5 * 60 * 1000); // Every 5 minutes

//       log.info("SessionManager initialized with cleanup interval");
//     }
//   }

//   static set(id: string, session: CallSession) {
//     this.sessions.set(id, session);
//     log.debug("Session added to manager", {
//       callSid: id,
//       totalSessions: this.sessions.size,
//     });
//   }

//   static get(id: string): CallSession | undefined {
//     return this.sessions.get(id);
//   }

//   static getAll(): Map<string, CallSession> {
//     return new Map(this.sessions);
//   }

//   static delete(id: string): boolean {
//     const deleted = this.sessions.delete(id);
//     if (deleted) {
//       log.debug("Session removed from manager", {
//         callSid: id,
//         totalSessions: this.sessions.size,
//       });
//     }
//     return deleted;
//   }

//   static async cleanupOldSessions(): Promise<void> {
//     const now = Date.now();
//     const cutoff = now - this.MAX_SESSION_AGE_MS;
//     const oldSessions: string[] = [];

//     for (const [callSid, session] of this.sessions.entries()) {
//       const sessionAge = now - new Date(session.startedAt).getTime();

//       if (sessionAge > this.MAX_SESSION_AGE_MS) {
//         oldSessions.push(callSid);

//         try {
//           // Finalize the call with timeout status
//           await session.finalizeCall("timeout");
//           log.warn("Cleaned up old session due to timeout", {
//             callSid,
//             sessionAgeMinutes: Math.round(sessionAge / (60 * 1000)),
//             maxAgeMinutes: this.MAX_SESSION_AGE_MS / (60 * 1000),
//           });
//         } catch (error: any) {
//           log.error("Failed to finalize old session", {
//             callSid,
//             error: error.message,
//           });
//         }
//       }
//     }

//     // Remove old sessions from map
//     oldSessions.forEach((callSid) => this.sessions.delete(callSid));

//     if (oldSessions.length > 0) {
//       log.info(`Cleaned up ${oldSessions.length} old sessions`, {
//         remainingSessions: this.sessions.size,
//       });
//     }
//   }

//   static getSessionStats() {
//     const now = Date.now();
//     const stats = {
//       total: this.sessions.size,
//       byDuration: {
//         lessThan1Min: 0,
//         oneTo5Min: 0,
//         fiveTo15Min: 0,
//         moreThan15Min: 0,
//       },
//       averageAgeMs: 0,
//       oldestSessionMs: 0,
//     };

//     let totalAge = 0;
//     let maxAge = 0;

//     for (const [, session] of this.sessions.entries()) {
//       const age = now - new Date(session.startedAt).getTime();
//       totalAge += age;
//       maxAge = Math.max(maxAge, age);

//       if (age < 60000) stats.byDuration.lessThan1Min++;
//       else if (age < 300000) stats.byDuration.oneTo5Min++;
//       else if (age < 900000) stats.byDuration.fiveTo15Min++;
//       else stats.byDuration.moreThan15Min++;
//     }

//     if (this.sessions.size > 0) {
//       stats.averageAgeMs = Math.round(totalAge / this.sessions.size);
//       stats.oldestSessionMs = maxAge;
//     }

//     return stats;
//   }

//   static async shutdown(): Promise<void> {
//     if (this.cleanupInterval) {
//       clearInterval(this.cleanupInterval);
//       this.cleanupInterval = null;
//     }

//     // Finalize all active sessions
//     const sessionCount = this.sessions.size;
//     if (sessionCount > 0) {
//       log.warn(`Finalizing ${sessionCount} active sessions during shutdown`);

//       const promises = Array.from(this.sessions.values()).map(
//         async (session) => {
//           try {
//             await session.finalizeCall("system_shutdown");
//           } catch (error: any) {
//             log.error("Failed to finalize session during shutdown", {
//               callSid: session.callSid,
//               error: error.message,
//             });
//           }
//         }
//       );

//       await Promise.allSettled(promises);
//       this.sessions.clear();
//     }

//     log.info("SessionManager shutdown complete");
//   }

//   static findSessionByOrgId(orgId: string): CallSession | undefined {
//     for (const [, session] of this.sessions.entries()) {
//       if (session.orgId === orgId) {
//         return session;
//       }
//     }
//     return undefined;
//   }

//   static findSessionsByPhoneNumber(phoneNumber: string): CallSession[] {
//     const matchingSessions: CallSession[] = [];

//     for (const [, session] of this.sessions.entries()) {
//       if (session.from === phoneNumber || session.to === phoneNumber) {
//         matchingSessions.push(session);
//       }
//     }

//     return matchingSessions;
//   }
// }

// // Initialize on module load
// SessionManager.init();

// // Handle graceful shutdown
// process.on("beforeExit", async () => {
//   await SessionManager.shutdown();
// });


// core/sessionManager.ts
import { CallSession } from "../models/CallSession.js";
import { log } from "../utils/logger.js";

const sessions = new Map<string, CallSession>();
const sessionTimestamps = new Map<string, number>();
const MAX_SESSION_AGE = 30 * 60 * 1000; // 30 minutes

// Clean up old sessions periodically
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [callSid, timestamp] of sessionTimestamps.entries()) {
    if (now - timestamp > MAX_SESSION_AGE) {
      sessions.delete(callSid);
      sessionTimestamps.delete(callSid);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    log.info("Cleaned up old sessions", { count: cleaned });
  }
}, 5 * 60 * 1000); // Every 5 minutes

export const SessionManager = {
  set(id: string, session: CallSession) {
    sessions.set(id, session);
    sessionTimestamps.set(id, Date.now());
    
    log.info("Session stored", { 
      callSid: id,
      totalSessions: sessions.size,
      businessId: session.businessId,
    });
  },
  
  get(id: string): CallSession | undefined {
    const session = sessions.get(id);
    if (session) {
      sessionTimestamps.set(id, Date.now());
    }
    return session;
  },
  
  delete(id: string) {
    const session = sessions.get(id);
    sessions.delete(id);
    sessionTimestamps.delete(id);
    
    if (session) {
      log.info("Session removed", { 
        callSid: id,
        totalSessions: sessions.size,
        businessId: session.businessId,
      });
    }
  },
  
  getByBusinessId(businessId: string): CallSession[] {
    const businessSessions: CallSession[] = [];
    
    for (const session of sessions.values()) {
      if (session.businessId === businessId) {
        businessSessions.push(session);
      }
    }
    
    return businessSessions;
  },
  
  getAll(): Map<string, CallSession> {
    return new Map(sessions);
  },
  
  getStats() {
    const now = Date.now();
    const activeSessions = Array.from(sessionTimestamps.entries())
      .filter(([_, timestamp]) => now - timestamp < 5 * 60 * 1000) // Last 5 minutes
      .map(([callSid]) => sessions.get(callSid))
      .filter(Boolean);
    
    const byBusiness = activeSessions.reduce((acc, session) => {
      if (session?.businessId) {
        acc[session.businessId] = (acc[session.businessId] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);
    
    return {
      totalSessions: sessions.size,
      activeSessions: activeSessions.length,
      sessionsByBusiness: byBusiness,
      oldestSession: sessions.size > 0 
        ? Math.min(...Array.from(sessionTimestamps.values())) 
        : null,
    };
  },
  
  clearAll() {
    const count = sessions.size;
    sessions.clear();
    sessionTimestamps.clear();
    log.info("All sessions cleared", { count });
  },
};