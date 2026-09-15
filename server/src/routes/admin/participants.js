import { Router } from "express";
import mongoose from "mongoose";
import Participant from "../../models/Participant.js";
import Session from "../../models/Session.js";
import Level from "../../models/Level.js";
import Attempt from "../../models/Attempt.js";
import { STATUS } from "../../../../shared/constants.js";
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
  if (p.deletedAt) return "deleted";
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
  sessionLabel: label,
  deletedAt: p.deletedAt ?? null
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
// includeDeleted surfaces soft-deleted codes too (rowOf's `deletedAt`
// distinguishes them) — needed so a super_admin can actually FIND a
// soft-deleted, never-played test code again to permanently delete it
// (the /permanent route below requires deletedAt to already be set, but
// the row is otherwise invisible once deleted).
router.get("/", async (request, response) => {
  const { sessionId, arm, includeDeleted } = request.query;
  const filter = includeDeleted === "true" ? {} : { deletedAt: null };
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

// A code generated with no explicit sessionId would otherwise sit at
// sessionId: null forever — there is no session-control UI yet (Phase 2,
// SPEC 6.1 "no session control yet") to attach one after the fact, and
// POST /play/attempts hard-requires a sessionId before any attempt can be
// created. Rather than leave every open-mode code unplayable until Phase 2
// ships, fall back to one standing "open" session covering every published
// level — created once and reused after that. This is exactly the case
// CLAUDE.md already carves out: "the study can be run entirely in open
// mode; the control room is an improvement, not a prerequisite."
const findOrCreateDefaultOpenSession = async () => {
  const existing = await Session.findOne({ isSystemDefault: true, deletedAt: null, status: { $ne: "ended" } }).sort({ createdAt: -1 });
  if (existing) return existing;
  const levels = await Level.find({ deletedAt: null }, { key: 1 }).lean();
  return Session.create({
    mode: "open",
    capacity: 40, // Session's own schema caps capacity at 40 — MAX_BATCH (500) would fail validation
    levelKeys: levels.length ? levels.map(l => l.key) : ["prelevel"],
    status: "running",
    startedAt: new Date(),
    isSystemDefault: true
  });
};

// --- Bulk code generation (SPEC 6.1) -------------------------------
// `prefix` (default "PBLS") + arm + running number => e.g. PBLS-E-047.
// `sessionId` attaches the fresh codes to an existing session's roster;
// a roster label (SPEC 6.2) is written onto the roster entry ONLY, never
// the participant document, and (per SPEC 6.2) never reaches an export.
// This route does not create, configure or start a controlled session —
// but when no sessionId is given (and no labels), it falls back to a
// standing default open session so the codes are playable immediately.
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

  // Only an EXPLICITLY chosen session gets a roster entry (and, per SPEC
  // 6.2, ever gets a label) — the default open-mode fallback below is a
  // playability safety net, not an invite, so it stays off the roster.
  const explicitSession = session;
  if (!session) {
    session = await findOrCreateDefaultOpenSession();
  }

  const codes = await nextCodes(prefix, arm, count);
  const docs = codes.map(code => ({ code, arm, sessionId: session._id }));

  let created;
  try {
    created = await Participant.insertMany(docs, { ordered: true });
  } catch (error) {
    if (error?.code === 11000) return sendError(response, 409, "CODE_COLLISION", "Generated codes collided with a concurrent request — please retry");
    throw error;
  }

  if (explicitSession) {
    for (const [index, participant] of created.entries()) {
      explicitSession.roster.push({ participantId: participant._id, label: labels?.[index] || undefined, state: "invited" });
    }
    await explicitSession.save();
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
    sessionId: String(session._id),
    sessionAutoAttached: !explicitSession,
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

// --- Reset level progress (admin-triggered) --------------------------
// Gives a participant a clean slate on one level without touching a
// single existing Attempt/Response — those stay in the database forever
// (CLAUDE.md rule 1). A reset is just a boundary marker
// (Participant.levelResets, see the model): loadFullProgress ignores any
// attempt for this level created before resetAt, so a fresh attempt made
// after this becomes the new frozen headline while every earlier attempt
// still exists, unchanged, for records and export. super_admin-only and
// reason-required, like every other irreversible-sounding action in this
// file — resetting someone's displayed progress is exactly that sounding,
// even though nothing is actually destroyed.
router.post("/:id/reset-level", requireSuperAdmin, async (request, response) => {
  const participant = await loadParticipantOr404(response, request.params.id);
  if (!participant) return;

  const { levelId } = request.body || {};
  if (!mongoose.isValidObjectId(levelId)) return sendError(response, 400, "INVALID_LEVEL_ID", "levelId is not a valid id");
  const level = await Level.findOne({ _id: levelId, deletedAt: null });
  if (!level) return sendError(response, 404, "LEVEL_NOT_FOUND", "No such level");

  const reason = (request.body?.reason || "").trim();
  if (!reason) return sendError(response, 400, "REASON_REQUIRED", "a reason is required to reset a participant's level");

  const before = rowOf(participant.toObject());
  const resetAt = new Date();

  // A dangling in_progress attempt on this level would otherwise block a
  // fresh one (the partial unique index allows only one in_progress
  // attempt per participant+level) — mark it abandoned, a normal lifecycle
  // status this model already has, not a rewrite of a submitted result.
  await Attempt.updateMany(
    { participantId: participant._id, levelId: level._id, status: STATUS.IN_PROGRESS },
    { $set: { status: STATUS.ABANDONED } }
  );

  participant.levelResets.push({ levelId: level._id, resetAt, resetBy: "admin", adminId: request.admin._id });
  await participant.save();

  await writeAuditLog({
    actorId: request.admin._id,
    actorRole: request.admin.role,
    action: "participant_level_reset",
    target: { kind: "participant", id: participant._id },
    before,
    after: rowOf(participant.toObject()),
    reason
  });

  response.json({ reset: true, participantId: String(participant._id), levelId: String(level._id), resetAt });
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

// --- Permanently delete (hard delete) --------------------------------
// Irreversible — the one exception to CLAUDE.md rule 5 in this codebase,
// and deliberately narrow: reserved for a code that is ALREADY
// soft-deleted (this is "empty the trash," not a shortcut past the soft
// delete above) AND was never actually used. If any Attempt was ever
// created against this participant, the request is refused outright —
// hard-deleting a document that produced real Attempt/Response rows would
// corrupt the one record left explaining who those rows belong to
// (CLAUDE.md: "a number must be traceable to how it was produced"). The
// Attempt/Response rows themselves are never touched by anything in this
// route, matching every other rule in this file.
router.delete("/:id/permanent", requireSuperAdmin, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.id)) return sendError(response, 400, "INVALID_ID", "Not a valid participant id");
  const participant = await Participant.findById(request.params.id);
  if (!participant) return sendError(response, 404, "PARTICIPANT_NOT_FOUND", "No such participant");
  if (!participant.deletedAt) return sendError(response, 409, "NOT_SOFT_DELETED", "Soft-delete this participant first");

  const reason = (request.body?.reason || "").trim();
  if (!reason) return sendError(response, 400, "REASON_REQUIRED", "a reason is required to permanently delete a participant");

  const hasAttempts = await Attempt.exists({ participantId: participant._id });
  if (hasAttempts) return sendError(response, 409, "HAS_ATTEMPTS", "This code has real play data and cannot be permanently deleted");

  const before = rowOf(participant.toObject());
  await participant.deleteOne();

  await writeAuditLog({
    actorId: request.admin._id,
    actorRole: request.admin.role,
    action: "participant_hard_deleted",
    target: { kind: "participant", id: participant._id },
    before,
    after: null,
    reason
  });

  response.json({ deleted: true, permanent: true, participantId: before.participantId });
});

export default router;
