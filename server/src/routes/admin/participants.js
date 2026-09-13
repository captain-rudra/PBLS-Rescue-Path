import { Router } from "express";
import mongoose from "mongoose";
import Participant from "../../models/Participant.js";
import Session from "../../models/Session.js";
import { sendError } from "../../lib/httpError.js";
import { writeAuditLog } from "../../services/audit.js";
import { requireSuperAdmin } from "../../middleware/requireSuperAdmin.js";

const router = Router();

const MAX_BATCH = 500;
const DEFAULT_PREFIX = "PBLS";
const PREFIX_RE = /^[A-Z0-9]{2,12}$/;

const codePattern = (prefix, arm) => new RegExp(`^${prefix}-${arm}-(\\d+)$`);

// Continues the numbering for this (prefix, arm) rather than starting
// over, so two separate generation runs never collide and a facilitator's
// printed slips stay in one unbroken sequence.
const nextCodes = async (prefix, arm, count) => {
  const existing = await Participant.find({ code: { $regex: codePattern(prefix, arm) } }, { code: 1 });
  let max = 0;
  for (const p of existing) {
    const match = p.code.match(codePattern(prefix, arm));
    if (match) max = Math.max(max, Number(match[1]));
  }
  const width = Math.max(3, String(max + count).length);
  return Array.from({ length: count }, (_, i) => `${prefix}-${arm}-${String(max + i + 1).padStart(width, "0")}`);
};

const stateOf = p => {
  if (p.excluded) return "excluded";
  if (p.lockedUntil && new Date(p.lockedUntil) > new Date()) return "locked";
  if (!p.pinHash) return "no pin yet";
  if (p.activeJti) return "signed in";
  return "pin set";
};

// The management-screen row. Deliberately does NOT carry the roster label
// — that lives on the session document (SPEC 6.2) and is looked up
// separately so it can never leak into anything derived from a
// participant document.
const rowOf = (p, label = null) => ({
  participantId: String(p._id),
  code: p.code,
  arm: p.arm,
  pinSet: Boolean(p.pinHash),
  state: stateOf(p),
  excluded: Boolean(p.excluded),
  excludeReason: p.excludeReason ?? null,
  adminNote: p.adminNote ?? null,
  lockedUntil: p.lockedUntil ?? null,
  deviceChangedAt: p.deviceChangedAt ?? null,
  sessionId: p.sessionId ? String(p.sessionId) : null,
  sessionLabel: label
});

// Builds sessionId -> (participantId -> label) from the sessions the given
// participants belong to. One query, not one per row.
const labelLookup = async participants => {
  const sessionIds = [...new Set(participants.map(p => p.sessionId).filter(Boolean).map(String))];
  if (sessionIds.length === 0) return () => null;
  const sessions = await Session.find({ _id: { $in: sessionIds } }, { roster: 1 }).lean();
  const map = new Map();
  for (const s of sessions) {
    for (const entry of s.roster || []) {
      if (entry.label) map.set(`${String(s._id)}:${String(entry.participantId)}`, entry.label);
    }
  }
  return p => (p.sessionId ? map.get(`${String(p.sessionId)}:${String(p._id)}`) ?? null : null);
};

// --- List (SPEC 6) — filterable by session and arm ---------------------
router.get("/", async (request, response) => {
  const { sessionId, arm } = request.query;
  const filter = { deletedAt: null };
  if (sessionId) {
    if (!mongoose.isValidObjectId(sessionId)) return sendError(response, 400, "INVALID_SESSION_ID", "sessionId is not a valid id");
    filter.sessionId = new mongoose.Types.ObjectId(sessionId);
  }
  if (arm) {
    if (arm !== "E" && arm !== "C") return sendError(response, 400, "INVALID_ARM", "arm must be 'E' or 'C'");
    filter.arm = arm;
  }

  const participants = await Participant.find(filter).sort({ arm: 1, code: 1 }).lean();
  const labelFor = await labelLookup(participants);
  response.json({ participants: participants.map(p => rowOf(p, labelFor(p))) });
});

// --- Printable slips (SPEC 6.4) --------------------------------------
// Only the code and the arm — no admin note, no roster label, nothing
// that identifies a person. The client renders these one-per-slip on A4
// with a cut line; the mapping from code to person lives solely on the
// facilitator's signed attendance sheet.
const PIN_INSTRUCTIONS = [
  "Open the app and enter this code.",
  "You'll be asked to choose a 4-digit PIN — pick one you'll remember.",
  "That PIN is how you sign back in on this or any device."
];

router.get("/slips", async (request, response) => {
  const { sessionId, arm, ids } = request.query;
  const filter = { deletedAt: null };
  if (sessionId) {
    if (!mongoose.isValidObjectId(sessionId)) return sendError(response, 400, "INVALID_SESSION_ID", "sessionId is not a valid id");
    filter.sessionId = new mongoose.Types.ObjectId(sessionId);
  }
  if (arm) {
    if (arm !== "E" && arm !== "C") return sendError(response, 400, "INVALID_ARM", "arm must be 'E' or 'C'");
    filter.arm = arm;
  }
  if (ids) {
    const list = String(ids).split(",").filter(id => mongoose.isValidObjectId(id));
    filter._id = { $in: list };
  }

  const participants = await Participant.find(filter, { code: 1, arm: 1 }).sort({ arm: 1, code: 1 }).lean();
  response.json({
    slips: participants.map(p => ({ code: p.code, arm: p.arm })),
    pinInstructions: PIN_INSTRUCTIONS
  });
});

// --- Bulk code generation (SPEC 6.1) -------------------------------
// `prefix` (default "PBLS") + arm + running number => e.g. PBLS-E-047.
// `sessionId` attaches the fresh codes to an existing session's roster;
// a roster label (SPEC 6.2) is written onto the roster entry ONLY, never
// the participant document, and (per SPEC 6.2) never reaches an export.
// This route does not create, configure or start a session.
router.post("/generate", async (request, response) => {
  const { arm, count, sessionId, labels } = request.body || {};
  const prefix = (request.body?.prefix ?? DEFAULT_PREFIX).toUpperCase();
  if (arm !== "E" && arm !== "C") return sendError(response, 400, "INVALID_ARM", "arm must be 'E' or 'C'");
  if (!PREFIX_RE.test(prefix)) return sendError(response, 400, "INVALID_PREFIX", "prefix must be 2–12 uppercase letters or digits, no hyphen");
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH) {
    return sendError(response, 400, "INVALID_COUNT", `count must be an integer between 1 and ${MAX_BATCH}`);
  }
  if (labels !== undefined && (!Array.isArray(labels) || labels.length !== count || labels.some(l => typeof l !== "string"))) {
    return sendError(response, 400, "INVALID_LABELS", "labels, if given, must be a string array with exactly `count` entries");
  }

  let session = null;
  if (sessionId !== undefined && sessionId !== null && sessionId !== "") {
    if (!mongoose.isValidObjectId(sessionId)) return sendError(response, 400, "INVALID_SESSION_ID", "sessionId is not a valid id");
    session = await Session.findOne({ _id: sessionId, deletedAt: null });
    if (!session) return sendError(response, 404, "SESSION_NOT_FOUND", "No such session");
  }
  if (labels !== undefined && !session) {
    return sendError(response, 400, "LABELS_NEED_SESSION", "roster labels can only be attached when a sessionId is given — they live on the session roster, not the participant");
  }

  const codes = await nextCodes(prefix, arm, count);
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
      session.roster.push({ participantId: participant._id, label: labels?.[index] || undefined, state: "invited" });
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
        after: { code: participant.code, arm: participant.arm, prefix, sessionId: participant.sessionId, label: labels?.[index] ?? null },
        reason: "Bulk code generation"
      })
    )
  );

  response.status(201).json({
    prefix,
    participants: created.map((participant, index) => ({
      participantId: String(participant._id),
      code: participant.code,
      arm: participant.arm,
      label: labels?.[index] ?? null // echoed for the immediate print — NOT stored on the participant
    }))
  });
});

const loadParticipantOr404 = async (response, id) => {
  if (!mongoose.isValidObjectId(id)) {
    sendError(response, 400, "INVALID_ID", "Not a valid participant id");
    return null;
  }
  const participant = await Participant.findOne({ _id: id, deletedAt: null });
  if (!participant) {
    sendError(response, 404, "PARTICIPANT_NOT_FOUND", "No such participant");
    return null;
  }
  return participant;
};

// --- Reset PIN (SPEC 6, SPEC 9) --------------------------------------
// Clears the hash so the participant sets a new one on next sign-in, and
// severs any live session (activeJti) and any failed-PIN lockout so the
// reset is total.
router.post("/:id/reset-pin", async (request, response) => {
  const participant = await loadParticipantOr404(response, request.params.id);
  if (!participant) return;

  const before = rowOf(participant.toObject());
  participant.pinHash = null;
  participant.failedPinCount = 0;
  participant.lockedUntil = null;
  participant.activeJti = null;
  await participant.save();

  await writeAuditLog({
    actorId: request.admin._id,
    actorRole: request.admin.role,
    action: "participant_pin_reset",
    target: { kind: "participant", id: participant._id },
    before,
    after: rowOf(participant.toObject()),
    reason: request.body?.reason ?? null
  });

  response.json({ participant: rowOf(participant.toObject()) });
});

// --- Admin note and exclude flag (SPEC 9) --------------------------
router.patch("/:id", async (request, response) => {
  const participant = await loadParticipantOr404(response, request.params.id);
  if (!participant) return;
  const body = request.body || {};

  if (body.excluded !== undefined && typeof body.excluded !== "boolean") return sendError(response, 400, "INVALID_EXCLUDED", "excluded must be a boolean");
  if (body.adminNote !== undefined && typeof body.adminNote !== "string" && body.adminNote !== null) return sendError(response, 400, "INVALID_NOTE", "adminNote must be a string or null");
  if (body.excludeReason !== undefined && typeof body.excludeReason !== "string" && body.excludeReason !== null) {
    return sendError(response, 400, "INVALID_REASON", "excludeReason must be a string or null");
  }
  if (body.excluded === true && !((body.excludeReason ?? participant.excludeReason) || "").trim()) {
    return sendError(response, 400, "REASON_REQUIRED", "a reason is required when excluding a participant");
  }

  const before = rowOf(participant.toObject());

  if (body.excluded !== undefined) {
    participant.excluded = body.excluded;
    if (body.excluded) {
      participant.excludeReason = (body.excludeReason ?? participant.excludeReason ?? "").trim() || participant.excludeReason;
      participant.activeJti = null; // withdrawing a participant also signs them out (CLAUDE.md: kicked/withdrawn get excluded, never removed)
    } else {
      participant.excludeReason = undefined; // history is preserved in the audit row
    }
  } else if (body.excludeReason !== undefined && participant.excluded) {
    participant.excludeReason = body.excludeReason || undefined;
  }

  if (body.adminNote !== undefined) participant.adminNote = body.adminNote ? body.adminNote.trim() : undefined;

  await participant.save();

  await writeAuditLog({
    actorId: request.admin._id,
    actorRole: request.admin.role,
    action: "participant_updated",
    target: { kind: "participant", id: participant._id },
    before,
    after: rowOf(participant.toObject()),
    reason: body.reason ?? null
  });

  response.json({ participant: rowOf(participant.toObject()) });
});

// --- Delete (SPEC 6, CLAUDE.md rule 5) --------------------------------
// A SOFT delete, like every other delete in this codebase: sets
// `deletedAt`, never removes the document. `deletedAt: null` is already
// baked into the participant filter on every list/records/export/sign-in
// query, so a deleted code disappears from the console and can no longer
// authenticate — but its attempts and responses, if any exist, are left
// exactly where they are, still traceable back to this document. This is
// for retiring a code that was generated wrong or is a test artifact, not
// for withdrawing a real participant from the study — that's what
// `excluded` is for, since it keeps the row visible with a reason instead
// of hiding it. super_admin-only, like every other irreversible-sounding
// action in this file (archiving a question, locking a level).
router.delete("/:id", requireSuperAdmin, async (request, response) => {
  const participant = await loadParticipantOr404(response, request.params.id);
  if (!participant) return;
  const reason = (request.body?.reason || "").trim();
  if (!reason) return sendError(response, 400, "REASON_REQUIRED", "a reason is required to delete a participant");

  const before = rowOf(participant.toObject());
  participant.deletedAt = new Date();
  participant.activeJti = null; // the code can no longer authenticate once deleted, but this makes any live device drop immediately too
  await participant.save();

  await writeAuditLog({
    actorId: request.admin._id,
    actorRole: request.admin.role,
    action: "participant_deleted",
    target: { kind: "participant", id: participant._id },
    before,
    after: rowOf(participant.toObject()),
    reason
  });

  response.json({ deleted: true, participantId: String(participant._id) });
});

export default router;
