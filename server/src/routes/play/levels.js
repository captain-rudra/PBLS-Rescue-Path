import { Router } from "express";
import Level from "../../models/Level.js";
import Question from "../../models/Question.js";
import Attempt from "../../models/Attempt.js";
import { STATUS } from "../../../../shared/constants.js";
import { remediationRoundFor } from "../../services/scoring.js";
import { loadFullProgress } from "../../services/progress.js";
import { sendError } from "../../lib/httpError.js";

const router = Router();

router.get("/", async (request, response) => {
  const { levels, progress } = await loadFullProgress(request.participant);

  const questionCounts = await Question.aggregate([
    // supersededBy: null — only the current, active version of each slot
    // (SPEC 4.8); a forked-away historical row must not double-count.
    { $match: { levelKey: { $in: levels.map(l => l.key) }, status: { $in: [STATUS.PUBLISHED, STATUS.LOCKED] }, deletedAt: null, supersededBy: null } },
    { $group: { _id: "$levelKey", count: { $sum: 1 }, types: { $addToSet: "$type" } } }
  ]);

  const questionCountByKey = new Map(questionCounts.map(c => [c._id, c.count]));
  const formatsByKey = new Map(questionCounts.map(c => [c._id, c.types.sort()]));

  response.json({
    levels: progress.map(({ level, state, starsAwarded, headline, restartCount, remediationCount }) => ({
      levelId: String(level._id),
      key: level.key,
      order: level.order,
      title: level.title,
      scene: level.scene,
      role: level.role,
      badge: level.badge,
      passMark: level.passMark,
      objectives: level.objectives,
      questionCount: questionCountByKey.get(level.key) || 0,
      formats: formatsByKey.get(level.key) || [],
      state,
      starsAwarded,
      headline,
      restartCount,
      remediationCount
    }))
  });
});

// Lightweight attempt list for the level review's attempt selector (SPEC
// 2.6): every submitted, non-practice attempt this participant has made on
// the level, oldest first, with just enough to label each one (kind,
// remediation round, accuracy) without pulling the full review payload for
// attempts the participant hasn't chosen to open yet.
router.get("/:levelKey/attempts", async (request, response) => {
  const level = await Level.findOne({ key: request.params.levelKey, deletedAt: null, status: { $in: [STATUS.PUBLISHED, STATUS.LOCKED] } });
  if (!level) return sendError(response, 404, "LEVEL_NOT_FOUND", "No such level");

  const attempts = await Attempt.find({
    participantId: request.participant._id,
    levelId: level._id,
    isPractice: false,
    status: STATUS.SUBMITTED
  }).sort({ attemptNo: 1 });

  response.json({
    attempts: attempts.map(attempt => ({
      attemptId: String(attempt._id),
      attemptNo: attempt.attemptNo,
      kind: attempt.kind,
      remediationRound: remediationRoundFor(attempt, attempts),
      accuracy: attempt.accuracy,
      passed: attempt.passed,
      starsAwarded: attempt.starsAwarded,
      submittedAt: attempt.submittedAt
    }))
  });
});

// A participant may reset their ENTIRE game — every level relocks and can
// be played fresh — but only once every level currently shows `complete`
// (mastered). This never touches an existing Attempt/Response: it appends
// one levelResets entry per level (see Participant model), which is the
// boundary loadFullProgress uses to decide what counts as "current" from
// here on. Every attempt made before the reset stays in the database,
// unchanged, and keeps showing up in GET /:levelKey/attempts and every
// export — this is a fresh start for the player, not an erasure of the
// record. No writeAuditLog call: that helper is shaped for an admin actor
// (actorRole admin/super_admin); the levelResets entry itself, timestamped
// and permanent on the participant document, is this action's durable
// record.
router.post("/reset-progress", async (request, response) => {
  const { levels, progress } = await loadFullProgress(request.participant);
  if (!progress.every(p => p.state === "complete")) {
    return sendError(response, 403, "LEVELS_INCOMPLETE", "Every level must be mastered before you can reset your progress");
  }

  const resetAt = new Date();
  await request.participant.updateOne({
    $push: {
      levelResets: { $each: levels.map(level => ({ levelId: level._id, resetAt, resetBy: "participant" })) }
    }
  });

  response.json({ reset: true, resetAt });
});

export default router;
