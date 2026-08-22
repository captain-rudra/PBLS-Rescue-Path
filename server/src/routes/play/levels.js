import { Router } from "express";
import Level from "../../models/Level.js";
import Question from "../../models/Question.js";
import Attempt from "../../models/Attempt.js";
import { STATUS } from "../../../../shared/constants.js";
import { computeLevelProgress } from "../../services/scoring.js";

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
      { $group: { _id: "$levelKey", count: { $sum: 1 } } }
    ])
  ]);

  const questionCountByKey = new Map(questionCounts.map(c => [c._id, c.count]));
  const attemptsByLevelId = new Map();
  for (const attempt of attempts) {
    const key = String(attempt.levelId);
    if (!attemptsByLevelId.has(key)) attemptsByLevelId.set(key, []);
    attemptsByLevelId.get(key).push(attempt);
  }

  const progress = computeLevelProgress(levels, attemptsByLevelId);

  response.json({
    levels: progress.map(({ level, state, starsAwarded }) => ({
      levelId: String(level._id),
      key: level.key,
      order: level.order,
      title: level.title,
      scene: level.scene,
      role: level.role,
      badge: level.badge,
      passMark: level.passMark,
      questionCount: questionCountByKey.get(level.key) || 0,
      state,
      starsAwarded
    }))
  });
});

export default router;
