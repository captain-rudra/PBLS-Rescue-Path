import { Router } from "express";
import mongoose from "mongoose";
import Level from "../../models/Level.js";
import Question from "../../models/Question.js";
import { STATUS } from "../../../../shared/constants.js";
import { sendError } from "../../lib/httpError.js";
import { requireSuperAdmin } from "../../middleware/requireSuperAdmin.js";
import { writeAuditLog } from "../../services/audit.js";

const router = Router();

// For the bank/builder's level pickers — read-only here; level creation
// and editing (order, passMark, objectives) is content management beyond
// this build's scope (bank + builder for questions).
router.get("/", async (request, response) => {
  const levels = await Level.find({ deletedAt: null }).sort({ order: 1 });
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
      status: level.status
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

export default router;
