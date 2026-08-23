import { Router } from "express";
import mongoose from "mongoose";
import Level from "../../models/Level.js";
import Question from "../../models/Question.js";
import Attempt from "../../models/Attempt.js";
import Response from "../../models/Response.js";
import { STATUS, ATTEMPT_KINDS } from "../../../../shared/constants.js";
import { sendError } from "../../lib/httpError.js";
import { toPlayerQuestion, aggregateAttempt, computeLevelProgress } from "../../services/scoring.js";

const router = Router();

// Reloads a pinned question set in its original order — $in does not
// preserve array order, and the response payload must match the sequence
// the attempt was created with.
const loadPinnedQuestions = async questionIds => {
  const found = await Question.find({ _id: { $in: questionIds } });
  const byId = new Map(found.map(q => [String(q._id), q]));
  return questionIds.map(id => byId.get(String(id))).filter(Boolean);
};

const attemptPayload = (attemptDoc, level, questions) => ({
  attempt: {
    attemptId: String(attemptDoc._id),
    levelKey: level.key,
    kind: attemptDoc.kind,
    attemptNo: attemptDoc.attemptNo,
    startedAt: attemptDoc.startedAt,
    status: attemptDoc.status
  },
  level: { key: level.key, title: level.title, passMark: level.passMark, badge: level.badge },
  questions: questions.map(toPlayerQuestion)
});

const loadProgressFor = async (participantId, levelKey) => {
  const levels = await Level.find({ deletedAt: null, status: { $in: [STATUS.PUBLISHED, STATUS.LOCKED] } }).sort({ order: 1 });
  const level = levels.find(l => l.key === levelKey);
  if (!level) return { level: null };

  const attempts = await Attempt.find({
    participantId,
    isPractice: false,
    status: STATUS.SUBMITTED,
    levelId: { $in: levels.map(l => l._id) }
  });
  const attemptsByLevelId = new Map();
  for (const attempt of attempts) {
    const key = String(attempt.levelId);
    if (!attemptsByLevelId.has(key)) attemptsByLevelId.set(key, []);
    attemptsByLevelId.get(key).push(attempt);
  }
  const progress = computeLevelProgress(levels, attemptsByLevelId);
  const target = progress.find(p => p.level.key === levelKey);
  return { level, target };
};

router.post("/", async (request, response) => {
  const { levelKey, kind = "first" } = request.body || {};
  if (typeof levelKey !== "string") return sendError(response, 400, "INVALID_LEVEL_KEY", "levelKey is required");
  if (!ATTEMPT_KINDS.includes(kind)) return sendError(response, 400, "INVALID_KIND", `kind must be one of ${ATTEMPT_KINDS.join(", ")}`);
  if (!request.participant.sessionId) return sendError(response, 400, "NO_SESSION", "Participant is not attached to a session");

  const { level, target } = await loadProgressFor(request.participant._id, levelKey);
  if (!level) return sendError(response, 404, "LEVEL_NOT_FOUND", "No servable level matches that key");
  if (!target.unlocked) return sendError(response, 403, "LEVEL_LOCKED", "This level is not yet unlocked for this participant");

  // POST /play/attempts must be idempotent: a participant can only
  // meaningfully have one in_progress attempt per level. Returning the
  // existing one (whatever kind it was started as) instead of creating a
  // second covers double-click, a retried request on flaky wifi, and two
  // tabs open on the same level — not just React StrictMode's double
  // effect invocation, which is what first surfaced this. A restart must
  // explicitly abandon the old attempt (POST /:id/abandon) before this
  // will ever create a fresh one.
  const existingInProgress = await Attempt.findOne({
    participantId: request.participant._id,
    levelId: level._id,
    isPractice: false,
    status: STATUS.IN_PROGRESS
  }).sort({ createdAt: -1 });

  if (existingInProgress) {
    const pinnedQuestions = await loadPinnedQuestions(existingInProgress.questionIds);
    return response.status(200).json(attemptPayload(existingInProgress, level, pinnedQuestions));
  }

  let missedQuestionIds = null;

  if (kind === "replay") {
    if (target.state !== "complete") return sendError(response, 400, "REPLAY_NOT_ELIGIBLE", "Replay requires a previously passed attempt");
  }

  if (kind === "remediation") {
    const latestAttempt = [...target.attempts].sort((a, b) => b.attemptNo - a.attemptNo)[0];
    if (!latestAttempt || latestAttempt.passed !== false) {
      return sendError(response, 400, "NO_REMEDIATION_DUE", "No failed attempt is awaiting remediation for this level");
    }
    const missed = await Response.find({ attemptId: latestAttempt._id, isRetry: false, isCorrect: false });
    missedQuestionIds = missed.map(r => String(r.questionId));
    if (missedQuestionIds.length === 0) return sendError(response, 400, "NO_REMEDIATION_DUE", "The most recent attempt has no missed items");
  }

  let questions = await Question.find({ levelKey: level.key, status: { $in: [STATUS.PUBLISHED, STATUS.LOCKED] }, deletedAt: null }).sort({ sequence: 1 });
  if (missedQuestionIds) {
    const missedSet = new Set(missedQuestionIds);
    questions = questions.filter(q => missedSet.has(String(q._id)));
  }
  if (questions.length === 0) return sendError(response, 409, "NO_QUESTIONS_AVAILABLE", "This level has no servable questions");

  const attemptNo = (await Attempt.countDocuments({ participantId: request.participant._id, levelId: level._id })) + 1;

  let attempt;
  try {
    attempt = await Attempt.create({
      participantId: request.participant._id,
      sessionId: request.participant.sessionId,
      levelId: level._id,
      attemptNo,
      kind,
      isPractice: false,
      startedAt: new Date(),
      status: STATUS.IN_PROGRESS,
      questionIds: questions.map(q => q._id)
    });
  } catch (error) {
    // Backstop for the TOCTOU gap between the idempotency check above and
    // this insert: another concurrent request for this participant+level
    // won the race to this attemptNo. Whoever won is the correct attempt
    // to hand back — same idempotent outcome, just resolved after the fact
    // instead of before.
    if (error?.code === 11000) {
      const winner = await Attempt.findOne({ participantId: request.participant._id, levelId: level._id, status: STATUS.IN_PROGRESS }).sort({ createdAt: -1 });
      if (winner) {
        const pinnedQuestions = await loadPinnedQuestions(winner.questionIds);
        return response.status(200).json(attemptPayload(winner, level, pinnedQuestions));
      }
    }
    throw error;
  }

  response.status(201).json(attemptPayload(attempt, level, questions));
});

router.post("/:id/abandon", async (request, response) => {
  const { id } = request.params;
  if (!mongoose.isValidObjectId(id)) return sendError(response, 400, "INVALID_ATTEMPT_ID", "Not a valid attempt id");

  const attempt = await Attempt.findOne({ _id: id, participantId: request.participant._id });
  if (!attempt) return sendError(response, 404, "ATTEMPT_NOT_FOUND", "No such attempt for this participant");
  if (attempt.status !== STATUS.IN_PROGRESS) return sendError(response, 409, "ATTEMPT_NOT_ACTIVE", `Attempt is already ${attempt.status}`);

  attempt.status = STATUS.ABANDONED;
  await attempt.save();

  response.json({ attempt: { attemptId: String(attempt._id), status: attempt.status } });
});

router.post("/:id/submit", async (request, response) => {
  const { id } = request.params;
  if (!mongoose.isValidObjectId(id)) return sendError(response, 400, "INVALID_ATTEMPT_ID", "Not a valid attempt id");

  const attempt = await Attempt.findOne({ _id: id, participantId: request.participant._id });
  if (!attempt) return sendError(response, 404, "ATTEMPT_NOT_FOUND", "No such attempt for this participant");
  if (attempt.status !== STATUS.IN_PROGRESS) return sendError(response, 409, "ATTEMPT_NOT_ACTIVE", `Attempt is already ${attempt.status}`);

  const level = await Level.findById(attempt.levelId);
  if (!level) return sendError(response, 404, "LEVEL_NOT_FOUND", "Attempt references a level that no longer exists");

  const questions = await Question.find({ _id: { $in: attempt.questionIds } });
  const responses = await Response.find({ attemptId: attempt._id, isRetry: false });

  const answeredIds = new Set(responses.map(r => String(r.questionId)));
  const missingIds = attempt.questionIds.map(String).filter(qid => !answeredIds.has(qid));
  if (missingIds.length > 0) {
    return sendError(response, 400, "INCOMPLETE_ATTEMPT", `${missingIds.length} question(s) in this attempt have no response yet`);
  }

  const result = aggregateAttempt({ level, attempt, questions, responses });

  attempt.submittedAt = new Date();
  attempt.status = STATUS.SUBMITTED;
  attempt.score = result.score;
  attempt.accuracy = result.accuracy;
  attempt.passed = result.passed;
  attempt.starsAwarded = result.starsAwarded;
  attempt.vitalsEnd = result.vitalsEnd;
  attempt.activeMs = result.activeMs;
  attempt.hiddenMs = result.hiddenMs;
  await attempt.save();

  let unlockedNextLevelKey = null;
  if (result.passed) {
    const nextLevel = await Level.findOne({ order: level.order + 1, deletedAt: null, status: { $in: [STATUS.PUBLISHED, STATUS.LOCKED] } });
    if (nextLevel) unlockedNextLevelKey = nextLevel.key;
  }

  response.json({
    attempt: {
      attemptId: String(attempt._id),
      levelKey: level.key,
      kind: attempt.kind,
      attemptNo: attempt.attemptNo,
      score: attempt.score,
      accuracy: attempt.accuracy,
      passed: attempt.passed,
      starsAwarded: attempt.starsAwarded,
      vitalsEnd: attempt.vitalsEnd,
      activeMs: attempt.activeMs,
      hiddenMs: attempt.hiddenMs,
      status: attempt.status,
      submittedAt: attempt.submittedAt
    },
    remediation: { required: !result.passed, questionIds: result.passed ? [] : result.missedQuestionIds },
    unlockedNextLevelKey
  });
});

export default router;
