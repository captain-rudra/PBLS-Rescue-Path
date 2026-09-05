import mongoose from "mongoose";
import Participant from "../models/Participant.js";
import { sendError } from "../lib/httpError.js";
import { verifyToken, extractBearerToken } from "../services/auth.js";
import { TOKEN_AUDIENCE } from "../../../shared/constants.js";

const finish = (participant, request, response, next) => {
  if (participant.excluded) return sendError(response, 403, "PARTICIPANT_EXCLUDED", "This participant is excluded from play");
  if (participant.lockedUntil && participant.lockedUntil > new Date()) {
    return sendError(response, 403, "PARTICIPANT_LOCKED", "This participant is temporarily locked");
  }
  request.participant = participant;
  next();
};

// DEV_PARTICIPANT_ID stand-in from Step 2a, kept ONLY for the e2e suite
// (which drives the API directly and has no reason to re-run a real
// sign-in for every one of its hundreds of assertions) and for a
// developer poking around locally without wanting to sign in every reload.
// Gated on two independent conditions so it can never fire by accident in
// a real session: NODE_ENV must not be "production", AND the flag must be
// explicitly turned on. It only ever applies when NO token was presented
// at all — a real token always takes precedence and is always verified for
// real, so this can never be used to forge or escalate an actual session.
const tryDevBypass = async (request, response, next) => {
  const bypassAllowed = process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_AUTH_BYPASS === "true";
  if (!bypassAllowed) return sendError(response, 401, "NO_TOKEN", "No participant token presented");

  const participantId = process.env.DEV_PARTICIPANT_ID;
  if (!participantId || !mongoose.isValidObjectId(participantId)) {
    return sendError(response, 500, "CONFIG_ERROR", "No token presented and DEV_PARTICIPANT_ID is not set to a valid participant id");
  }
  console.warn("[auth] requireParticipant: no token presented — falling back to DEV_PARTICIPANT_ID. This must never be enabled in production.");
  const participant = await Participant.findOne({ _id: participantId, deletedAt: null });
  if (!participant) return sendError(response, 401, "PARTICIPANT_NOT_FOUND", "No participant matches DEV_PARTICIPANT_ID");
  return finish(participant, request, response, next);
};

export const requireParticipant = async (request, response, next) => {
  const token = extractBearerToken(request);
  if (!token) return tryDevBypass(request, response, next);

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return sendError(response, 401, "INVALID_TOKEN", "Participant token is invalid or expired");
  }

  // Audience checked FIRST, before role or anything else about the token —
  // non-negotiable (CLAUDE.md). An admin token must never satisfy this.
  if (payload.aud !== TOKEN_AUDIENCE.PLAY) return sendError(response, 401, "WRONG_AUDIENCE", "Token is not a participant token");
  if (!mongoose.isValidObjectId(payload.sub)) return sendError(response, 401, "INVALID_TOKEN", "Participant token is invalid or expired");

  const participant = await Participant.findOne({ _id: payload.sub, deletedAt: null });
  if (!participant) return sendError(response, 401, "PARTICIPANT_NOT_FOUND", "No such participant");

  // The stored activeJti is what makes an instant sign-out possible: a
  // second device's sign-in overwrites it, so a token whose jti no longer
  // matches was issued to a session that has since been superseded.
  if (!participant.activeJti || participant.activeJti !== payload.jti) {
    return sendError(response, 401, "SESSION_SUPERSEDED", "Signed in on another device, or signed out");
  }

  return finish(participant, request, response, next);
};
