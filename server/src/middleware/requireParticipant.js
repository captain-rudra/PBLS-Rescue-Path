import mongoose from "mongoose";
import Participant from "../models/Participant.js";
import { sendError } from "../lib/httpError.js";

/**
 * Temporary stand-in for participant auth (Step 2a).
 * Resolves the participant from DEV_PARTICIPANT_ID instead of a play JWT.
 * Replace with real token verification when auth lands; every route below
 * only ever reads `req.participant`, so the swap is contained to this file.
 */
export const requireParticipant = async (request, response, next) => {
  const participantId = process.env.DEV_PARTICIPANT_ID;
  if (!participantId || !mongoose.isValidObjectId(participantId)) {
    return sendError(response, 500, "CONFIG_ERROR", "DEV_PARTICIPANT_ID is not set to a valid participant id");
  }
  const participant = await Participant.findOne({ _id: participantId, deletedAt: null });
  if (!participant) return sendError(response, 401, "PARTICIPANT_NOT_FOUND", "No participant matches DEV_PARTICIPANT_ID");
  if (participant.excluded) return sendError(response, 403, "PARTICIPANT_EXCLUDED", "This participant is excluded from play");
  if (participant.lockedUntil && participant.lockedUntil > new Date()) {
    return sendError(response, 403, "PARTICIPANT_LOCKED", "This participant is temporarily locked");
  }
  request.participant = participant;
  next();
};
