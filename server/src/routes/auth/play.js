import { Router } from "express";
import Participant from "../../models/Participant.js";
import Session from "../../models/Session.js";
import { sendError } from "../../lib/httpError.js";
import { signParticipantToken, newJti, hashSecret, compareSecret, isPinFormat } from "../../services/auth.js";
import { checkRateLimit } from "../../services/rateLimit.js";
import { MAX_FAILED_PIN_ATTEMPTS, PIN_LOCK_MINUTES, SIGNIN_RATE_LIMIT_PER_MINUTE } from "../../../../shared/constants.js";

const router = Router();

// Deliberately identical wording for "no such code" and "wrong PIN" (SPEC
// 6.3's "neutral message") — telling the two apart would let an attacker
// enumerate valid codes one guess at a time.
const INVALID_CREDENTIALS_MESSAGE = "Incorrect code or PIN.";
const CANNOT_SIGN_IN_MESSAGE = "This code cannot sign in. Please speak to your facilitator.";

const normalizeCode = code => (typeof code === "string" ? code.trim().toUpperCase() : "");

/** True if this code is on the blocklist of the session it's currently assigned to. A participant with no session yet cannot be blocklisted. */
const isBlocklisted = async participant => {
  if (!participant.sessionId) return false;
  const session = await Session.findById(participant.sessionId);
  return Boolean(session?.blocklist?.some(id => String(id) === String(participant._id)));
};

const lockedResponse = (response, participant) => {
  const minutesLeft = Math.max(1, Math.ceil((participant.lockedUntil.getTime() - Date.now()) / 60000));
  return sendError(response, 423, "PARTICIPANT_LOCKED", `Too many incorrect PINs. Try again in about ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.`);
};

/** Shared success path for both login and first-time PIN set: fresh jti, activeJti swap (signing out any other device), a token. */
const issueToken = async (response, participant, { setPinHash } = {}) => {
  const hadPriorSession = Boolean(participant.activeJti);
  const jti = newJti();
  participant.failedPinCount = 0;
  participant.lockedUntil = null;
  participant.activeJti = jti;
  if (hadPriorSession) participant.deviceChangedAt = new Date();
  if (setPinHash) participant.pinHash = setPinHash;
  await participant.save();

  const token = signParticipantToken({ participantId: participant._id, sessionId: participant.sessionId, jti });
  response.json({
    token,
    participant: { participantId: String(participant._id), code: participant.code, arm: participant.arm },
    signedOutOtherDevice: hadPriorSession
  });
};

router.post("/login", async (request, response) => {
  const code = normalizeCode(request.body?.code);
  const { pin } = request.body || {};
  if (!code) return sendError(response, 400, "INVALID_CODE", "code is required");

  if (!checkRateLimit(`login:${code}`, { max: SIGNIN_RATE_LIMIT_PER_MINUTE, windowMs: 60_000 })) {
    return sendError(response, 429, "RATE_LIMITED", "Too many sign-in attempts for this code. Please wait a minute and try again.");
  }

  const participant = await Participant.findOne({ code, deletedAt: null });
  if (!participant) return sendError(response, 401, "INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE);
  if (participant.excluded || (await isBlocklisted(participant))) return sendError(response, 403, "CANNOT_SIGN_IN", CANNOT_SIGN_IN_MESSAGE);
  if (participant.lockedUntil && participant.lockedUntil > new Date()) return lockedResponse(response, participant);

  if (!participant.pinHash) {
    // First sign-in: the code alone is the credential at this point
    // (identity was verified in person when the slip was handed out —
    // CLAUDE.md). Not a failure, just a fork in the flow.
    return response.json({ needsPin: true, code: participant.code });
  }

  if (!isPinFormat(pin)) return sendError(response, 400, "INVALID_PIN_FORMAT", "pin must be exactly 4 digits");

  const correct = await compareSecret(pin, participant.pinHash);
  if (!correct) {
    participant.failedPinCount += 1;
    let justLocked = false;
    if (participant.failedPinCount >= MAX_FAILED_PIN_ATTEMPTS) {
      participant.lockedUntil = new Date(Date.now() + PIN_LOCK_MINUTES * 60_000);
      participant.failedPinCount = 0;
      justLocked = true;
    }
    await participant.save();
    if (justLocked) return lockedResponse(response, participant);
    return sendError(response, 401, "INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE);
  }

  return issueToken(response, participant);
});

router.post("/set-pin", async (request, response) => {
  const code = normalizeCode(request.body?.code);
  const { pin } = request.body || {};
  if (!code) return sendError(response, 400, "INVALID_CODE", "code is required");
  if (!isPinFormat(pin)) return sendError(response, 400, "INVALID_PIN_FORMAT", "pin must be exactly 4 digits");

  if (!checkRateLimit(`login:${code}`, { max: SIGNIN_RATE_LIMIT_PER_MINUTE, windowMs: 60_000 })) {
    return sendError(response, 429, "RATE_LIMITED", "Too many sign-in attempts for this code. Please wait a minute and try again.");
  }

  const participant = await Participant.findOne({ code, deletedAt: null });
  if (!participant) return sendError(response, 401, "INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE);
  if (participant.excluded || (await isBlocklisted(participant))) return sendError(response, 403, "CANNOT_SIGN_IN", CANNOT_SIGN_IN_MESSAGE);
  if (participant.lockedUntil && participant.lockedUntil > new Date()) return lockedResponse(response, participant);
  if (participant.pinHash) return sendError(response, 409, "PIN_ALREADY_SET", "A PIN has already been set for this code — sign in instead");

  const pinHash = await hashSecret(pin);
  return issueToken(response, participant, { setPinHash: pinHash });
});

export default router;
