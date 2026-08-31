import { Router } from "express";
import mongoose from "mongoose";
import Level from "../../models/Level.js";
import Participant from "../../models/Participant.js";
import Attempt from "../../models/Attempt.js";
import Response from "../../models/Response.js";
import { STATUS } from "../../../../shared/constants.js";
import { sendError } from "../../lib/httpError.js";
import { summarizeLevelAttempts, remediationRoundFor, outcomeFor } from "../../services/scoring.js";

const router = Router();

// Full question-by-question trail for one participant on one level: every
// attempt (any status — an in_progress one is still worth seeing) in
// attemptNo order, and every response within it in the order it was
// answered, with all four SPEC 8 timestamps. This is what "see exactly
// where a participant struggled" means in practice. The admin console
// itself (auth, roles, bank, builder) is a later phase (see CLAUDE.md's
// build order) — this route exists so the underlying data is reachable in
// the meantime, gated by the same kind of temporary dev stand-in already
// used for participant auth.
router.get("/trail", async (request, response) => {
  const { participantId, levelKey } = request.query;
  if (!mongoose.isValidObjectId(participantId)) return sendError(response, 400, "INVALID_PARTICIPANT_ID", "participantId is required");
  if (typeof levelKey !== "string") return sendError(response, 400, "INVALID_LEVEL_KEY", "levelKey is required");

  const [participant, level] = await Promise.all([
    Participant.findOne({ _id: participantId, deletedAt: null }),
    Level.findOne({ key: levelKey, deletedAt: null })
  ]);
  if (!participant) return sendError(response, 404, "PARTICIPANT_NOT_FOUND", "No such participant");
  if (!level) return sendError(response, 404, "LEVEL_NOT_FOUND", "No such level");

  const attempts = await Attempt.find({ participantId, levelId: level._id, isPractice: false }).sort({ attemptNo: 1 });
  const submittedAttempts = attempts.filter(a => a.status === STATUS.SUBMITTED);
  const summary = summarizeLevelAttempts(submittedAttempts);

  const responsesByAttemptId = new Map();
  if (attempts.length > 0) {
    const responses = await Response.find({ attemptId: { $in: attempts.map(a => a._id) } })
      .sort({ answeredAt: 1 })
      .populate("questionId", "title objective sequence");
    for (const r of responses) {
      const key = String(r.attemptId);
      if (!responsesByAttemptId.has(key)) responsesByAttemptId.set(key, []);
      responsesByAttemptId.get(key).push(r);
    }
  }

  response.json({
    participant: { participantId: String(participant._id), code: participant.code, arm: participant.arm, excluded: participant.excluded },
    level: { key: level.key, title: level.title, passMark: level.passMark },
    headline: summary.headline,
    restartCount: summary.restartCount,
    remediationCount: summary.remediationCount,
    masteredAt: summary.masteryAttempt?.submittedAt ?? null,
    attempts: attempts.map(attempt => ({
      attemptId: String(attempt._id),
      attemptNo: attempt.attemptNo,
      kind: attempt.kind,
      remediationRound: remediationRoundFor(attempt, attempts),
      status: attempt.status,
      outcome: attempt.status === STATUS.SUBMITTED ? outcomeFor(attempt.accuracy, level.passMark, attempt.kind) : null,
      score: attempt.score,
      accuracy: attempt.accuracy,
      passed: attempt.passed,
      activeMs: attempt.activeMs,
      hiddenMs: attempt.hiddenMs,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      responses: (responsesByAttemptId.get(String(attempt._id)) || []).map(r => ({
        responseId: String(r._id),
        questionId: String(r.questionId?._id ?? r.questionId),
        questionTitle: r.questionId?.title ?? null,
        objective: r.questionId?.objective ?? null,
        sequence: r.questionId?.sequence ?? null,
        questionVersion: r.questionVersion,
        given: r.given,
        isCorrect: r.isCorrect,
        partialScore: r.partialScore,
        isRetry: r.isRetry,
        shownAt: r.shownAt,
        firstInteractionAt: r.firstInteractionAt,
        answeredAt: r.answeredAt,
        hiddenMs: r.hiddenMs,
        mediaReplays: r.mediaReplays,
        serverReceivedAt: r.serverReceivedAt
      }))
    }))
  });
});

export default router;
