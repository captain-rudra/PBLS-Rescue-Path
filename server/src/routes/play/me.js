import { Router } from "express";
import Attempt from "../../models/Attempt.js";
import Level from "../../models/Level.js";
import { STATUS } from "../../../../shared/constants.js";
import { summarizeLevelAttempts, remediationRoundFor, outcomeFor } from "../../services/scoring.js";

const router = Router();

// A participant's own attempt trail — restricted to `request.participant`
// from the token, never a query parameter, so this can never be pointed at
// someone else's rows (SPEC 11: "the restriction is applied server side
// from the participant id on the token, not a client-side filter").
router.get("/records", async (request, response) => {
  const attempts = await Attempt.find({ participantId: request.participant._id, isPractice: false, status: STATUS.SUBMITTED }).sort({ createdAt: 1 });
  const levels = await Level.find({ _id: { $in: attempts.map(a => a.levelId) } });
  const levelById = new Map(levels.map(l => [String(l._id), l]));

  const attemptsByLevelId = new Map();
  for (const attempt of attempts) {
    const key = String(attempt.levelId);
    if (!attemptsByLevelId.has(key)) attemptsByLevelId.set(key, []);
    attemptsByLevelId.get(key).push(attempt);
  }
  const summaryByLevelId = new Map([...attemptsByLevelId].map(([key, levelAttempts]) => [key, summarizeLevelAttempts(levelAttempts)]));

  response.json({
    records: attempts.map(attempt => {
      const level = levelById.get(String(attempt.levelId));
      const levelAttempts = attemptsByLevelId.get(String(attempt.levelId)) || [];
      const summary = summaryByLevelId.get(String(attempt.levelId));
      return {
        attemptId: String(attempt._id),
        levelKey: level?.key ?? null,
        levelTitle: level?.title ?? null,
        kind: attempt.kind,
        attemptNo: attempt.attemptNo,
        remediationRound: remediationRoundFor(attempt, levelAttempts),
        outcome: level ? outcomeFor(attempt.accuracy, level.passMark, attempt.kind) : null,
        score: attempt.score,
        accuracy: attempt.accuracy,
        passed: attempt.passed,
        starsAwarded: attempt.starsAwarded,
        activeMs: attempt.activeMs,
        hiddenMs: attempt.hiddenMs,
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
        // Level-level figures, the same on every row for this level: the
        // frozen first-attempt headline plus restart/remediation tallies.
        levelHeadline: summary.headline,
        levelRestartCount: summary.restartCount,
        levelRemediationCount: summary.remediationCount
      };
    })
  });
});

export default router;
