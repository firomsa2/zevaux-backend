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
      oldestSession:
        sessions.size > 0
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
