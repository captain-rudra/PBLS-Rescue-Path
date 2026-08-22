import { Router } from "express";
import Attempt from "../../models/Attempt.js";
import Level from "../../models/Level.js";
import { STATUS } from "../../../../shared/constants.js";

const router = Router();

router.get("/records", async (request, response) => {
  const attempts = await Attempt.find({ participantId: request.participant._id, isPractice: false, status: STATUS.SUBMITTED }).sort({ createdAt: 1 });
  const levels = await Level.find({ _id: { $in: attempts.map(a => a.levelId) } });
  const levelById = new Map(levels.map(l => [String(l._id), l]));

  response.json({
    records: attempts.map(attempt => {
      const level = levelById.get(String(attempt.levelId));
      return {
        attemptId: String(attempt._id),
        levelKey: level?.key ?? null,
        levelTitle: level?.title ?? null,
        kind: attempt.kind,
        attemptNo: attempt.attemptNo,
        score: attempt.score,
        accuracy: attempt.accuracy,
        passed: attempt.passed,
        starsAwarded: attempt.starsAwarded,
        activeMs: attempt.activeMs,
        hiddenMs: attempt.hiddenMs,
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt
      };
    })
  });
});

export default router;
