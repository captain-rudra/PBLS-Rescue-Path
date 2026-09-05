import mongoose from "mongoose";
import Admin from "../models/Admin.js";
import { sendError } from "../lib/httpError.js";
import { verifyToken, extractBearerToken } from "../services/auth.js";
import { TOKEN_AUDIENCE } from "../../../shared/constants.js";

// DEV_ADMIN_ID stand-in, same shape and same two-gate safety
// (NODE_ENV !== "production" AND an explicit opt-in flag) as
// requireParticipant.js's bypass. Only ever applies when no token was
// presented at all — a real token is always verified for real.
const tryDevBypass = async (request, response, next) => {
  const bypassAllowed = process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_AUTH_BYPASS === "true";
  if (!bypassAllowed) return sendError(response, 401, "NO_TOKEN", "No admin token presented");

  const adminId = process.env.DEV_ADMIN_ID;
  if (!adminId || !mongoose.isValidObjectId(adminId)) {
    return sendError(response, 500, "CONFIG_ERROR", "No token presented and DEV_ADMIN_ID is not set to a valid admin id");
  }
  console.warn("[auth] requireAdmin: no token presented — falling back to DEV_ADMIN_ID. This must never be enabled in production.");
  const admin = await Admin.findOne({ _id: adminId, deletedAt: null, active: true });
  if (!admin) return sendError(response, 401, "ADMIN_NOT_FOUND", "No admin matches DEV_ADMIN_ID");
  request.admin = admin;
  return next();
};

export const requireAdmin = async (request, response, next) => {
  const token = extractBearerToken(request);
  if (!token) return tryDevBypass(request, response, next);

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return sendError(response, 401, "INVALID_TOKEN", "Admin token is invalid or expired");
  }

  // Audience checked FIRST, before role or anything else — non-negotiable
  // (CLAUDE.md). A participant token must never satisfy this.
  if (payload.aud !== TOKEN_AUDIENCE.ADMIN) return sendError(response, 401, "WRONG_AUDIENCE", "Token is not an admin token");
  if (!mongoose.isValidObjectId(payload.sub)) return sendError(response, 401, "INVALID_TOKEN", "Admin token is invalid or expired");

  const admin = await Admin.findOne({ _id: payload.sub, deletedAt: null, active: true });
  if (!admin) return sendError(response, 401, "ADMIN_NOT_FOUND", "No such active admin");

  request.admin = admin;
  next();
};
