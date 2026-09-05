import { Router } from "express";
import Level from "../../models/Level.js";
import Question from "../../models/Question.js";
import Attempt from "../../models/Attempt.js";
import { STATUS } from "../../../../shared/constants.js";
import { computeLevelProgress, remediationRoundFor } from "../../services/scoring.js";
import { sendError } from "../../lib/httpError.js";

const router = Router();

router.get("/", async (request, response) => {
  const levels = await Level.find({ deletedAt: null, status: { $in: [STATUS.PUBLISHED, STATUS.LOCKED] } }).sort({ order: 1 });

  const [attempts, questionCounts] = await Promise.all([
    Attempt.find({
      participantId: request.participant._id,
      isPractice: false,
      status: STATUS.SUBMITTED,
      levelId: { $in: levels.map(l => l._id) }
    }),
    Question.aggregate([
      { $match: { levelKey: { $in: levels.map(l => l.key) }, status: { $in: [STATUS.PUBLISHED, STATUS.LOCKED] }, deletedAt: null } },
      { $group: { _id: "$levelKey", count: { $sum: 1 }, types: { $addToSet: "$type" } } }
    ])
  ]);

  const questionCountByKey = new Map(questionCounts.map(c => [c._id, c.count]));
  const formatsByKey = new Map(questionCounts.map(c => [c._id, c.types.sort()]));
  const attemptsByLevelId = new Map();
  for (const attempt of attempts) {
    const key = String(attempt.levelId);
    if (!attemptsByLevelId.has(key)) attemptsByLevelId.set(key, []);
    attemptsByLevelId.get(key).push(attempt);
  }

  const progress = computeLevelProgress(levels, attemptsByLevelId);

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

export default router;
