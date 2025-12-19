import { FastifyRequest, FastifyReply } from "fastify";
import { supabase } from "../utils/supabase.js";
import { log } from "../utils/logger.js";
// import { verifyApiKey } from '../utils/hmac.js';

interface AuthenticatedRequest extends FastifyRequest {
  user?: {
    id: string;
    org_id: string;
    email: string;
    role: string;
  };
}

export async function requireAuth(
  request: AuthenticatedRequest,
  reply: FastifyReply
) {
  try {
    // Check for API key in headers
    const apiKey = request.headers["x-api-key"] as string;

    if (apiKey) {
      // Verify API key
      // const isValid = verifyApiKey(apiKey);
      // if (!isValid) {
      //   return reply.status(401).send({ error: 'Invalid API key' });
      // }

      // Extract orgId from API key
      const decoded = Buffer.from(apiKey, "base64").toString("utf8");
      const [orgId] = decoded.split(":");

      request.user = {
        id: `api-${orgId}`,
        org_id: orgId,
        email: `api@${orgId}.zevaux.com`,
        role: "api",
      };

      return;
    }

    // Check for JWT token
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply
        .status(401)
        .send({ error: "Missing or invalid authorization header" });
    }

    const token = authHeader.substring(7);

    // Verify JWT with Supabase
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      // log.warn('Invalid JWT token', { error: error?.message });
      return reply.status(401).send({ error: "Invalid token" });
    }

    // Get user details from database
    const { data: userRecord, error: dbError } = await supabase
      .from("users")
      .select("id, org_id, email, role")
      .eq("id", user.id)
      .single();

    if (dbError || !userRecord) {
      // log.error('User not found in database', { userId: user.id, error: dbError?.message });
      return reply.status(401).send({ error: "User not found" });
    }

    request.user = userRecord;

    // log.debug('User authenticated', {
    //   userId: userRecord.id,
    //   orgId: userRecord.org_id,
    //   role: userRecord.role
    // });
  } catch (error: any) {
    // log.error('Authentication error', { error: error.message });
    return reply.status(500).send({ error: "Authentication failed" });
  }
}

export async function requireAdmin(
  request: AuthenticatedRequest,
  reply: FastifyReply
) {
  await requireAuth(request, reply);

  if (request.user?.role !== "admin") {
    return reply.status(403).send({ error: "Admin access required" });
  }
}

export function getCurrentUser(request: AuthenticatedRequest) {
  return request.user;
}

export function getCurrentOrgId(request: AuthenticatedRequest): string | null {
  return request.user?.org_id || null;
}

// Rate limiting by organization
export const orgRateLimit = {
  max: 100,
  timeWindow: "1 minute",
  keyGenerator: (request: AuthenticatedRequest) => {
    return request.user?.org_id || request.ip;
  },
};
