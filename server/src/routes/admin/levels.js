import { Router } from "express";
import mongoose from "mongoose";
import Level from "../../models/Level.js";
import Question from "../../models/Question.js";
import Attempt from "../../models/Attempt.js";
import { STATUS } from "../../../../shared/constants.js";
import { sendError } from "../../lib/httpError.js";
import { requireSuperAdmin } from "../../middleware/requireSuperAdmin.js";
import { writeAuditLog } from "../../services/audit.js";

const router = Router();

// For the bank/builder's level pickers — read-only here; level creation
// and editing (order, passMark, objectives) is content management beyond
// this build's scope (bank + builder for questions).
// includeDeleted surfaces soft-deleted levels too — needed so a
// super_admin can actually find one again to permanently delete it (the
// /permanent route requires deletedAt to already be set, but the row is
// otherwise invisible once deleted).
router.get("/", async (request, response) => {
  const filter = request.query.includeDeleted === "true" ? {} : { deletedAt: null };
  const levels = await Level.find(filter).sort({ order: 1 });
  response.json({
    levels: levels.map(level => ({
      levelId: String(level._id),
      key: level.key,
      order: level.order,
      title: level.title,
      scene: level.scene,
      role: level.role,
      objectives: level.objectives,
      passMark: level.passMark,
      badge: level.badge,
      status: level.status,
      deletedAt: level.deletedAt ?? null
    }))
  });
});

// SPEC 4.3: "Only super_admin moves a level to locked. Locking sweeps
// every question in scope." A draft question was never served and needs
// no fork protection, so the sweep only touches published questions —
// each becomes `locked`, meaning its next edit forks rather than
// overwrites (SPEC 4.8). One audit row for the level action; the sweep
// count is the "after" detail, not one row per swept question.
router.post("/:id/lock", requireSuperAdmin, async (request, response) => {
  const { id } = request.params;
  if (!mongoose.isValidObjectId(id)) return sendError(response, 400, "INVALID_ID", "Not a valid level id");
  const level = await Level.findOne({ _id: id, deletedAt: null });
  if (!level) return sendError(response, 404, "LEVEL_NOT_FOUND", "No such level");
  if (level.status === STATUS.LOCKED) return sendError(response, 409, "ALREADY_LOCKED", "This level is already locked");

  const before = { status: level.status };
  level.status = STATUS.LOCKED;
  await level.save();
  const swept = await Question.updateMany({ levelId: level._id, status: STATUS.PUBLISHED, supersededBy: null }, { $set: { status: STATUS.LOCKED } });

  await writeAuditLog({
    actorId: request.admin._id,
    actorRole: request.admin.role,
    action: "level_locked",
    target: { kind: "level", id: level._id },
    before,
    after: { status: level.status, sweptQuestionCount: swept.modifiedCount },
    reason: request.body?.reason ?? null
  });

  response.json({ level: { levelId: String(level._id), key: level.key, status: level.status }, sweptQuestionCount: swept.modifiedCount });
});

// Symmetric inverse: only meaningful on a currently-locked level, moves it
// (and every question the lock swept) back to published. A question that
// was forked WHILE locked came out of that fork already `locked` too
// (questions.js's PATCH handler), so this sweep reaches those exactly the
// same way.
router.post("/:id/unlock", requireSuperAdmin, async (request, response) => {
  const { id } = request.params;
  if (!mongoose.isValidObjectId(id)) return sendError(response, 400, "INVALID_ID", "Not a valid level id");
  const level = await Level.findOne({ _id: id, deletedAt: null });
  if (!level) return sendError(response, 404, "LEVEL_NOT_FOUND", "No such level");
  if (level.status !== STATUS.LOCKED) return sendError(response, 409, "NOT_LOCKED", "This level is not locked");

  const before = { status: level.status };
  level.status = STATUS.PUBLISHED;
  await level.save();
  const swept = await Question.updateMany({ levelId: level._id, status: STATUS.LOCKED, supersededBy: null }, { $set: { status: STATUS.PUBLISHED } });

  await writeAuditLog({
    actorId: request.admin._id,
    actorRole: request.admin.role,
    action: "level_unlocked",
    target: { kind: "level", id: level._id },
    before,
    after: { status: level.status, sweptQuestionCount: swept.modifiedCount },
    reason: request.body?.reason ?? null
  });

  response.json({ level: { levelId: String(level._id), key: level.key, status: level.status }, sweptQuestionCount: swept.modifiedCount });
});

// Soft delete (CLAUDE.md rule 5) — sets deletedAt, never removes the
// document. `deletedAt: null` is already baked into every level query on
// both the admin and play side, so a deleted level disappears from the
// bank/builder pickers and can no longer be served — but any Attempt or
// Question that already references it is untouched. super_admin-only,
// like every other lifecycle action in this file. There is deliberately no
// route to create or otherwise edit a level (see the GET handler's
// comment) — this is content retirement, not content management.
router.delete("/:id", requireSuperAdmin, async (request, response) => {
  const { id } = request.params;
  if (!mongoose.isValidObjectId(id)) return sendError(response, 400, "INVALID_ID", "Not a valid level id");
  const level = await Level.findOne({ _id: id, deletedAt: null });
  if (!level) return sendError(response, 404, "LEVEL_NOT_FOUND", "No such level");

  const reason = (request.body?.reason || "").trim();
  if (!reason) return sendError(response, 400, "REASON_REQUIRED", "a reason is required to delete a level");

  const before = { status: level.status, deletedAt: level.deletedAt };
  level.deletedAt = new Date();
  await level.save();

  await writeAuditLog({
    actorId: request.admin._id,
    actorRole: request.admin.role,
    action: "level_deleted",
    target: { kind: "level", id: level._id },
    before,
    after: { status: level.status, deletedAt: level.deletedAt },
    reason
  });

  response.json({ deleted: true, levelId: String(level._id) });
});

// Permanently delete (hard delete) — irreversible, and deliberately
// narrow: reserved for a level that is ALREADY soft-deleted AND was never
// actually played. Refuses if any Attempt ever references it — a level
// with real play data is exactly the referential integrity CLAUDE.md's
// data-integrity principle exists to protect, so it can never be
// hard-deleted through this route. Attempt/Response rows are never
// touched here.
router.delete("/:id/permanent", requireSuperAdmin, async (request, response) => {
  const { id } = request.params;
  if (!mongoose.isValidObjectId(id)) return sendError(response, 400, "INVALID_ID", "Not a valid level id");
  const level = await Level.findById(id);
  if (!level) return sendError(response, 404, "LEVEL_NOT_FOUND", "No such level");
  if (!level.deletedAt) return sendError(response, 409, "NOT_SOFT_DELETED", "Soft-delete this level first");

  const reason = (request.body?.reason || "").trim();
  if (!reason) return sendError(response, 400, "REASON_REQUIRED", "a reason is required to permanently delete a level");

  const hasAttempts = await Attempt.exists({ levelId: level._id });
  if (hasAttempts) return sendError(response, 409, "HAS_ATTEMPTS", "This level has real play data and cannot be permanently deleted");

  const before = { levelId: String(level._id), key: level.key, title: level.title, status: level.status };
  await level.deleteOne();

  await writeAuditLog({
    actorId: request.admin._id,
    actorRole: request.admin.role,
    action: "level_hard_deleted",
    target: { kind: "level", id: level._id },
    before,
    after: null,
    reason
  });

  response.json({ deleted: true, permanent: true, levelId: before.levelId });
});

export default router;
