import { Router } from "express";
import mongoose from "mongoose";
import Level from "../../models/Level.js";
import Question from "../../models/Question.js";
import { STATUS, QUESTION_TYPES } from "../../../../shared/constants.js";
import { sendError } from "../../lib/httpError.js";
import { requireSuperAdmin } from "../../middleware/requireSuperAdmin.js";
import { writeAuditLog } from "../../services/audit.js";
import { sanitizeQuestionForType, validateForPublish, mediaStatusFor, MEDIA_FIELDS_BY_TYPE } from "../../services/questionValidation.js";

const router = Router();

// "Live" statuses participate in the level's running order; archived
// items are retained history, not a position anyone is still filling.
const ORDERABLE_STATUSES = [STATUS.DRAFT, STATUS.PUBLISHED, STATUS.LOCKED];

const rowPayload = question => ({
  questionId: String(question._id),
  levelKey: question.levelKey,
  sequence: question.sequence,
  type: question.type,
  title: question.title,
  objective: question.objective,
  scenario: question.scenario ?? null,
  prompt: question.prompt,
  points: question.points,
  status: question.status,
  version: question.version,
  supersedes: question.supersedes ? String(question.supersedes) : null,
  supersededBy: question.supersededBy ? String(question.supersededBy) : null,
  authoringNote: question.authoringNote ?? null,
  media: question.media ?? null,
  fallbackText: question.fallbackText ?? null,
  options: question.options ?? [],
  buckets: question.buckets ?? [],
  items: question.items ?? [],
  correctOrder: question.correctOrder ?? [],
  hotspots: question.hotspots ?? [],
  sides: question.sides ?? [],
  correct: question.correct ?? null,
  feedback: question.feedback,
  mediaStatus: mediaStatusFor(question),
  createdAt: question.createdAt,
  updatedAt: question.updatedAt
});

// SPEC 4.2: filterable by level, type and status, with counts. Only the
// current active version of each slot (supersededBy: null) — a fork's
// retired predecessor is history, not a bank row someone would edit.
router.get("/", async (request, response) => {
  const { levelKey, type, status } = request.query;
  const baseFilter = { supersededBy: null };
  if (levelKey) baseFilter.levelKey = levelKey;
  if (type) {
    if (!QUESTION_TYPES.includes(type)) return sendError(response, 400, "INVALID_TYPE", `type must be one of ${QUESTION_TYPES.join(", ")}`);
    baseFilter.type = type;
  }
  if (status) {
    if (!Object.values(STATUS).includes(status)) return sendError(response, 400, "INVALID_STATUS", "Not a recognised status");
    baseFilter.status = status;
  }

  const [questions, forCounts] = await Promise.all([
    Question.find(baseFilter).sort({ levelKey: 1, sequence: 1 }),
    // Counts reflect the level/type filters (if any) but never the status
    // filter, so the status tally itself stays meaningful as "how many of
    // each status exist within this scope" rather than collapsing to one
    // bucket the moment a status filter is applied.
    Question.find({ supersededBy: null, ...(levelKey ? { levelKey } : {}), ...(type ? { type } : {}) }, { levelKey: 1, type: 1, status: 1 })
  ]);

  const counts = { total: forCounts.length, byLevel: {}, byType: {}, byStatus: {} };
  for (const q of forCounts) {
    counts.byLevel[q.levelKey] = (counts.byLevel[q.levelKey] || 0) + 1;
    counts.byType[q.type] = (counts.byType[q.type] || 0) + 1;
    counts.byStatus[q.status] = (counts.byStatus[q.status] || 0) + 1;
  }

  response.json({ questions: questions.map(rowPayload), counts, mediaFieldsByType: MEDIA_FIELDS_BY_TYPE });
});

router.get("/:id", async (request, response) => {
  const { id } = request.params;
  if (!mongoose.isValidObjectId(id)) return sendError(response, 400, "INVALID_ID", "Not a valid question id");
  const question = await Question.findById(id);
  if (!question) return sendError(response, 404, "QUESTION_NOT_FOUND", "No such question");
  response.json({ question: rowPayload(question) });
});

const loadLevelOr404 = async (response, levelKey) => {
  const level = await Level.findOne({ key: levelKey, deletedAt: null });
  if (!level) sendError(response, 404, "LEVEL_NOT_FOUND", "No such level");
  return level;
};

const nextSequenceFor = async levelKey => {
  const last = await Question.findOne({ levelKey, supersededBy: null }).sort({ sequence: -1 });
  return (last?.sequence ?? 0) + 1;
};

router.post("/", async (request, response) => {
  const body = request.body || {};
  if (!QUESTION_TYPES.includes(body.type)) return sendError(response, 400, "INVALID_TYPE", `type must be one of ${QUESTION_TYPES.join(", ")}`);
  const desiredStatus = body.status === STATUS.PUBLISHED ? STATUS.PUBLISHED : STATUS.DRAFT;

  const level = await loadLevelOr404(response, body.levelKey);
  if (!level) return;

  let sanitized;
  try {
    sanitized = sanitizeQuestionForType(body);
  } catch (error) {
    if (error.status) return sendError(response, error.status, error.code, error.message);
    throw error;
  }

  if (desiredStatus === STATUS.PUBLISHED) {
    const failures = validateForPublish(sanitized, level);
    if (failures.length > 0) return sendError(response, 422, "VALIDATION_FAILED", JSON.stringify(failures));
  }

  const sequence = Number.isInteger(body.sequence) && body.sequence > 0 ? body.sequence : await nextSequenceFor(level.key);

  let question;
  try {
    question = await Question.create({
      ...sanitized,
      levelId: level._id,
      sequence,
      status: desiredStatus,
      version: 1,
      supersedes: null,
      supersededBy: null,
      createdBy: request.admin._id,
      updatedBy: request.admin._id
    });
  } catch (error) {
    if (error?.code === 11000) return sendError(response, 409, "SEQUENCE_TAKEN", `Sequence ${sequence} is already used in ${level.key}`);
    throw error;
  }

  await writeAuditLog({
    actorId: request.admin._id,
    actorRole: request.admin.role,
    action: "question_created",
    target: { kind: "question", id: question._id },
    after: rowPayload(question),
    reason: body.reason ?? null
  });

  response.status(201).json({ question: rowPayload(question) });
});

router.patch("/:id", async (request, response) => {
  const { id } = request.params;
  if (!mongoose.isValidObjectId(id)) return sendError(response, 400, "INVALID_ID", "Not a valid question id");
  const body = request.body || {};

  const existing = await Question.findById(id);
  if (!existing) return sendError(response, 404, "QUESTION_NOT_FOUND", "No such question");
  if (existing.status === STATUS.ARCHIVED) return sendError(response, 409, "QUESTION_ARCHIVED", "An archived question cannot be edited");

  const type = body.type || existing.type;
  if (!QUESTION_TYPES.includes(type)) return sendError(response, 400, "INVALID_TYPE", `type must be one of ${QUESTION_TYPES.join(", ")}`);

  const level = await loadLevelOr404(response, existing.levelKey);
  if (!level) return;

  let sanitized;
  try {
    sanitized = sanitizeQuestionForType({ ...body, type, levelKey: existing.levelKey });
  } catch (error) {
    if (error.status) return sendError(response, error.status, error.code, error.message);
    throw error;
  }

  const isLocked = existing.status === STATUS.LOCKED;
  // A locked question's edit always forks into another locked version —
  // the level, not this one edit, is what decides when questions stop
  // needing to fork (SPEC 4.3/4.8). A draft/published question's own
  // requested status otherwise applies normally.
  const desiredStatus = isLocked ? STATUS.LOCKED : body.status === STATUS.PUBLISHED ? STATUS.PUBLISHED : STATUS.DRAFT;

  if (desiredStatus === STATUS.PUBLISHED || desiredStatus === STATUS.LOCKED) {
    const failures = validateForPublish(sanitized, level);
    if (failures.length > 0) return sendError(response, 422, "VALIDATION_FAILED", JSON.stringify(failures));
  }

  if (isLocked) {
    // SPEC 4.8: do not overwrite. A new document, version bumped,
    // `supersedes` pointing back — the old row is left completely intact,
    // and the partial unique index is exactly what allows both to share
    // (levelKey, sequence) at once. Order matters here: the new document's
    // _id is generated up front and the OLD row is retired (supersededBy
    // set) FIRST, freeing its claim on the partial-unique (levelKey,
    // sequence) slot, before the new row is inserted to take it. Creating
    // the new row first would briefly leave both rows active on the same
    // slot and trip the unique index that is supposed to prevent exactly
    // that.
    const before = rowPayload(existing);
    const forkedId = new mongoose.Types.ObjectId();
    existing.supersededBy = forkedId;
    await existing.save();
    let forked;
    try {
      forked = await Question.create({
        _id: forkedId,
        ...sanitized,
        levelId: level._id,
        sequence: existing.sequence,
        status: STATUS.LOCKED,
        version: existing.version + 1,
        supersedes: existing._id,
        supersededBy: null,
        createdBy: existing.createdBy,
        updatedBy: request.admin._id
      });
    } catch (error) {
      // The old row was already retired to free the slot (above) — if the
      // new row never lands, that retirement must be undone, or the slot
      // is left with no active document at all: the old content becomes
      // unservable and unreachable from the bank, without ever having
      // actually been replaced.
      existing.supersededBy = null;
      await existing.save();
      throw error;
    }

    await writeAuditLog({
      actorId: request.admin._id,
      actorRole: request.admin.role,
      action: "question_forked",
      target: { kind: "question", id: existing._id },
      before,
      after: rowPayload(forked),
      reason: body.reason ?? null
    });

    return response.json({ question: rowPayload(forked), forked: true, previousQuestionId: String(existing._id) });
  }

  // In place: draft stays draft-cheap to iterate on; a PUBLISHED question's
  // edit bumps its own version right there rather than forking (SPEC 4.3 —
  // forking is reserved for `locked`).
  const before = rowPayload(existing);
  Object.assign(existing, sanitized);
  existing.status = desiredStatus;
  existing.updatedBy = request.admin._id;
  if (existing.status === STATUS.PUBLISHED && before.status === STATUS.PUBLISHED) existing.version += 1;
  await existing.save();

  await writeAuditLog({
    actorId: request.admin._id,
    actorRole: request.admin.role,
    action: "question_updated",
    target: { kind: "question", id: existing._id },
    before,
    after: rowPayload(existing),
    reason: body.reason ?? null
  });

  response.json({ question: rowPayload(existing) });
});

// Soft delete only, super_admin only (mounted with requireSuperAdmin in
// admin/index.js) — sets status: "archived" and nothing else. deletedAt
// stays null: an archived row is still retained and still listable in the
// bank (SPEC 4.3's "retained for responses that reference it"), just no
// longer servable to a player (already excluded by every serving query's
// status whitelist) or reorderable.
router.delete("/:id", requireSuperAdmin, async (request, response) => {
  const { id } = request.params;
  if (!mongoose.isValidObjectId(id)) return sendError(response, 400, "INVALID_ID", "Not a valid question id");
  const question = await Question.findById(id);
  if (!question) return sendError(response, 404, "QUESTION_NOT_FOUND", "No such question");
  if (question.status === STATUS.ARCHIVED) return sendError(response, 409, "ALREADY_ARCHIVED", "This question is already archived");

  const before = rowPayload(question);
  question.status = STATUS.ARCHIVED;
  question.updatedBy = request.admin._id;
  await question.save();

  await writeAuditLog({
    actorId: request.admin._id,
    actorRole: request.admin.role,
    action: "question_archived",
    target: { kind: "question", id: question._id },
    before,
    after: rowPayload(question),
    reason: request.body?.reason ?? null
  });

  response.json({ question: rowPayload(question) });
});

// SPEC 4.2: "reordering rewrites sequence for the whole level in one
// transaction so two items can never share a position." The local MongoDB
// this runs against is a standalone instance, not a replica set — it does
// not support multi-document ACID transactions at all. A two-phase
// bulkWrite gets the property that actually matters — no lasting duplicate
// position, and no window where two DIFFERENT final positions collide —
// without one: phase 1 moves every affected row to a temporary sequence
// far outside any real range, phase 2 sets every row to its real final
// sequence. Because the temporary values in phase 1 can never collide with
// each other or with the real ones, and the final values in phase 2 are a
// permutation (already validated below), neither phase can ever hit the
// partial unique index.
//
// This is a documented dev-environment compromise, NOT a claim that a
// transaction was impossible. Production is MongoDB Atlas (a replica set);
// SPEC 4.2 spells out the transactional version to swap in there — it
// keeps this same two-phase structure but wraps it in `withTransaction`.
const REORDER_OFFSET = 1_000_000;

router.post("/reorder", async (request, response) => {
  const { levelKey, orderedQuestionIds } = request.body || {};
  if (typeof levelKey !== "string") return sendError(response, 400, "INVALID_LEVEL_KEY", "levelKey is required");
  if (!Array.isArray(orderedQuestionIds) || orderedQuestionIds.some(id => !mongoose.isValidObjectId(id))) {
    return sendError(response, 400, "INVALID_ORDER", "orderedQuestionIds must be an array of valid ids");
  }

  const level = await loadLevelOr404(response, levelKey);
  if (!level) return;

  const current = await Question.find({ levelKey, supersededBy: null, status: { $in: ORDERABLE_STATUSES } }).sort({ sequence: 1 });
  const currentIds = current.map(q => String(q._id));
  const providedIds = orderedQuestionIds.map(String);
  const sameSet = currentIds.length === providedIds.length && new Set(providedIds).size === providedIds.length && currentIds.every(id => providedIds.includes(id));
  if (!sameSet) {
    return sendError(response, 400, "INCOMPLETE_ORDER", "orderedQuestionIds must include every orderable question in this level exactly once, with none added or missing");
  }

  const before = Object.fromEntries(current.map(q => [String(q._id), q.sequence]));

  await Question.bulkWrite(providedIds.map((id, index) => ({ updateOne: { filter: { _id: id }, update: { $set: { sequence: REORDER_OFFSET + index } } } })));
  await Question.bulkWrite(providedIds.map((id, index) => ({ updateOne: { filter: { _id: id }, update: { $set: { sequence: index + 1 } } } })));

  const after = Object.fromEntries(providedIds.map((id, index) => [id, index + 1]));

  await writeAuditLog({
    actorId: request.admin._id,
    actorRole: request.admin.role,
    action: "questions_reordered",
    target: { kind: "level", id: level._id },
    before: { sequenceByQuestionId: before },
    after: { sequenceByQuestionId: after },
    reason: request.body?.reason ?? null
  });

  const reordered = await Question.find({ levelKey, supersededBy: null }).sort({ sequence: 1 });
  response.json({ questions: reordered.map(rowPayload) });
});

export default router;
