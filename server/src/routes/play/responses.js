import { Router } from "express";
import mongoose from "mongoose";
import Attempt from "../../models/Attempt.js";
import Question from "../../models/Question.js";
import Response from "../../models/Response.js";
import { STATUS } from "../../../../shared/constants.js";
import { sendError } from "../../lib/httpError.js";
import { validateGiven, scoreResponse } from "../../services/scoring.js";

const router = Router();

const correctAnswerFor = question => {
  if (question.type === "drag_drop") {
    return { correctPlacements: Object.fromEntries((question.items || []).map(item => [item.id, item.bucket])) };
  }
  if (question.type === "sequence") {
    return { correctOrder: question.correctOrder };
  }
  return { correct: question.correct };
};

router.post("/", async (request, response) => {
  const { attemptId, questionId, given, shownAt, firstInteractionAt = null, answeredAt, hiddenMs = 0, mediaReplays = 0 } = request.body || {};

  if (!mongoose.isValidObjectId(attemptId)) return sendError(response, 400, "INVALID_ATTEMPT_ID", "Not a valid attempt id");
  if (!mongoose.isValidObjectId(questionId)) return sendError(response, 400, "INVALID_QUESTION_ID", "Not a valid question id");

  const attempt = await Attempt.findOne({ _id: attemptId, participantId: request.participant._id });
  if (!attempt) return sendError(response, 404, "ATTEMPT_NOT_FOUND", "No such attempt for this participant");
  if (attempt.status !== STATUS.IN_PROGRESS) return sendError(response, 409, "ATTEMPT_NOT_ACTIVE", `Attempt is already ${attempt.status}`);

  const isAssigned = attempt.questionIds.some(id => String(id) === String(questionId));
  if (!isAssigned) return sendError(response, 400, "QUESTION_NOT_IN_ATTEMPT", "That question is not part of this attempt");

  const question = await Question.findOne({ _id: questionId, deletedAt: null });
  if (!question) return sendError(response, 404, "QUESTION_NOT_FOUND", "Question no longer exists");

  if (!validateGiven(question, given)) return sendError(response, 400, "INVALID_GIVEN", "given does not match this question's expected shape");

  const shownAtDate = new Date(shownAt);
  const answeredAtDate = new Date(answeredAt);
  if (Number.isNaN(shownAtDate.getTime()) || Number.isNaN(answeredAtDate.getTime())) {
    return sendError(response, 400, "INVALID_TIMESTAMPS", "shownAt and answeredAt must be valid timestamps");
  }
  if (answeredAtDate < shownAtDate) return sendError(response, 400, "INVALID_TIMESTAMPS", "answeredAt cannot be before shownAt");

  let firstInteractionAtDate = null;
  if (firstInteractionAt !== null) {
    firstInteractionAtDate = new Date(firstInteractionAt);
    if (Number.isNaN(firstInteractionAtDate.getTime()) || firstInteractionAtDate < shownAtDate || firstInteractionAtDate > answeredAtDate) {
      return sendError(response, 400, "INVALID_TIMESTAMPS", "firstInteractionAt must fall between shownAt and answeredAt");
    }
  }

  if (typeof hiddenMs !== "number" || hiddenMs < 0) return sendError(response, 400, "INVALID_HIDDEN_MS", "hiddenMs must be a non-negative number");
  if (typeof mediaReplays !== "number" || mediaReplays < 0) return sendError(response, 400, "INVALID_MEDIA_REPLAYS", "mediaReplays must be a non-negative number");

  const alreadyCounted = await Response.exists({ attemptId, questionId, isRetry: false });
  const isRetry = Boolean(alreadyCounted);

  const { isCorrect, partialScore } = scoreResponse(question, given);

  const created = await Response.create({
    attemptId,
    participantId: request.participant._id,
    sessionId: attempt.sessionId,
    questionId,
    questionVersion: question.version,
    levelId: attempt.levelId,
    given,
    isCorrect,
    partialScore,
    shownAt: shownAtDate,
    firstInteractionAt: firstInteractionAtDate,
    answeredAt: answeredAtDate,
    hiddenMs,
    mediaReplays,
    isRetry,
    serverReceivedAt: new Date()
  });

  response.status(201).json({
    responseId: String(created._id),
    isCorrect: created.isCorrect,
    partialScore: created.partialScore,
    isRetry: created.isRetry,
    feedback: { text: question.feedback.text, videoUrl: question.feedback.videoUrl || null, ...correctAnswerFor(question) }
  });
});

export default router;
