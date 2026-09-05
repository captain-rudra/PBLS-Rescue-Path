import { Router } from "express";
import mongoose from "mongoose";
import Participant from "../../models/Participant.js";
import Session from "../../models/Session.js";
import { sendError } from "../../lib/httpError.js";
import { writeAuditLog } from "../../services/audit.js";

const router = Router();

const MAX_BATCH = 500;

const codePattern = arm => new RegExp(`^PBLS-${arm}-(\\d+)$`);

// Continues the numbering for this arm rather than starting over, so two
// separate generation runs never collide and a facilitator's printed
// slips stay in one unbroken sequence per arm.
const nextCodes = async (arm, count) => {
  const existing = await Participant.find({ code: { $regex: codePattern(arm) } }, { code: 1 });
  let max = 0;
  for (const p of existing) {
    const match = p.code.match(codePattern(arm));
    if (match) max = Math.max(max, Number(match[1]));
  }
  const width = Math.max(3, String(max + count).length);
  return Array.from({ length: count }, (_, i) => `PBLS-${arm}-${String(max + i + 1).padStart(width, "0")}`);
};

// Bulk code generation only (SPEC 6.1) — no session control here, that's
// Phase 2. `sessionId` is accepted purely so freshly generated codes can be
// attached to an already-existing session's roster; this route does not
// create, configure or start a session. A roster label (SPEC 6.2) lives on
// that session's roster entry, never on the participant document — if no
// sessionId is given, a supplied label is only ever echoed back in the
// response for the admin's own bookkeeping, since there is no roster yet
// to attach it to.
router.post("/generate", async (request, response) => {
  const { arm, count, sessionId, labels } = request.body || {};
  if (arm !== "E" && arm !== "C") return sendError(response, 400, "INVALID_ARM", "arm must be 'E' or 'C'");
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH) {
    return sendError(response, 400, "INVALID_COUNT", `count must be an integer between 1 and ${MAX_BATCH}`);
  }
  if (labels !== undefined && (!Array.isArray(labels) || labels.length !== count || labels.some(l => typeof l !== "string"))) {
    return sendError(response, 400, "INVALID_LABELS", "labels, if given, must be a string array with exactly `count` entries");
  }

  let session = null;
  if (sessionId !== undefined) {
    if (!mongoose.isValidObjectId(sessionId)) return sendError(response, 400, "INVALID_SESSION_ID", "sessionId is not a valid id");
    session = await Session.findOne({ _id: sessionId, deletedAt: null });
    if (!session) return sendError(response, 404, "SESSION_NOT_FOUND", "No such session");
  }

  const codes = await nextCodes(arm, count);
  const docs = codes.map(code => ({ code, arm, sessionId: session ? session._id : null }));

  let created;
  try {
    created = await Participant.insertMany(docs, { ordered: true });
  } catch (error) {
    if (error?.code === 11000) return sendError(response, 409, "CODE_COLLISION", "Generated codes collided with a concurrent request — please retry");
    throw error;
  }

  if (session) {
    for (const [index, participant] of created.entries()) {
      session.roster.push({ participantId: participant._id, label: labels?.[index] ?? undefined, state: "invited" });
    }
    await session.save();
  }

  await Promise.all(
    created.map((participant, index) =>
      writeAuditLog({
        actorId: request.admin._id,
        actorRole: request.admin.role,
        action: "participant_generated",
        target: { kind: "participant", id: participant._id },
        after: { code: participant.code, arm: participant.arm, sessionId: participant.sessionId, label: labels?.[index] ?? null },
        reason: "Bulk code generation"
      })
    )
  );

  response.status(201).json({
    participants: created.map((participant, index) => ({
      participantId: String(participant._id),
      code: participant.code,
      arm: participant.arm,
      label: labels?.[index] ?? null
    }))
  });
});

export default router;
