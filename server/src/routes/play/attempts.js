import { Router } from "express";
import mongoose from "mongoose";
import Level from "../../models/Level.js";
import Question from "../../models/Question.js";
import Attempt from "../../models/Attempt.js";
import Response from "../../models/Response.js";
import { STATUS, ATTEMPT_KINDS, ATTEMPT_OUTCOMES } from "../../../../shared/constants.js";
import { sendError } from "../../lib/httpError.js";
import {
  toPlayerQuestion,
  aggregateAttempt,
  summarizeObjectives,
  computeLevelProgress,
  summarizeLevelAttempts,
  remediationRoundFor,
  outcomeFor
} from "../../services/scoring.js";

const router = Router();

// Reloads a pinned question set in its original order — $in does not
// preserve array order, and the response payload must match the sequence
// the attempt was created with.
const loadPinnedQuestions = async questionIds => {
  const found = await Question.find({ _id: { $in: questionIds } });
  const byId = new Map(found.map(q => [String(q._id), q]));
  return questionIds.map(id => byId.get(String(id))).filter(Boolean);
};

const attemptPayload = (attemptDoc, level, questions, allAttemptsForLevel) => ({
  attempt: {
    attemptId: String(attemptDoc._id),
    levelKey: level.key,
    kind: attemptDoc.kind,
    attemptNo: attemptDoc.attemptNo,
    remediationRound: remediationRoundFor(attemptDoc, allAttemptsForLevel),
    startedAt: attemptDoc.startedAt,
    status: attemptDoc.status
  },
  level: { key: level.key, title: level.title, passMark: level.passMark, badge: level.badge },
  questions: questions.map(toPlayerQuestion)
});

// Pure given (level, questions, responses) -> objectives + missed-items
// detail. Reused for both "how did this submit's round go" and "how did
// the frozen first attempt go" — same shape, different source attempt.
const buildPerformanceSummary = (level, questions, responses) => {
  const objectives = summarizeObjectives({ level, questions, responses });
  const questionById = new Map(questions.map(q => [String(q._id), q]));
  const missedItems = responses
    .filter(r => !r.isCorrect)
    .map(r => {
      const q = questionById.get(String(r.questionId));
      return { questionId: String(r.questionId), title: q?.title ?? null, objective: q?.objective ?? null, prompt: q?.prompt ?? null };
    });
  return { objectives, missedItems };
};

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

// POST /play/attempts must be idempotent AND safe under real concurrency —
// a double-click, a retried request on flaky wifi, two tabs on the same
// level, or a React double-effect-invoke can all fire two of these close
// together. `attemptNo` is assigned by counting existing attempts, which
// is inherently a check-then-insert race: two concurrent requests can both
// count 2 and both try to insert attemptNo 3, and the unique index on
// (participantId, levelId, attemptNo) — correctly, per CLAUDE.md/SPEC 7 —
// rejects the second with E11000.
//
// The old recovery here caught that E11000 once and looked for an
// in_progress attempt to hand back, assuming the winner of the race was
// still in_progress. That assumption isn't guaranteed — if the winner gets
// submitted in the gap between the loser's failed insert and its recovery
// query, the "winner" lookup comes back empty and the raw E11000 escaped
// as an unhandled 500. This loop instead reruns the ENTIRE idempotency
// check + create from scratch on a collision, up to a few times: every
// retry re-reads the current true state, so it converges correctly
// whether the winning attempt is still in_progress (idempotent 200) or has
// already moved on (a fresh, correctly-numbered attempt is created).
const MAX_CREATE_ATTEMPTS = 5;

router.post("/", async (request, response) => {
  const { levelKey, kind = "first" } = request.body || {};
  if (typeof levelKey !== "string") return sendError(response, 400, "INVALID_LEVEL_KEY", "levelKey is required");
  if (!ATTEMPT_KINDS.includes(kind)) return sendError(response, 400, "INVALID_KIND", `kind must be one of ${ATTEMPT_KINDS.join(", ")}`);
  if (!request.participant.sessionId) return sendError(response, 400, "NO_SESSION", "Participant is not attached to a session");

  for (let createAttempt = 1; createAttempt <= MAX_CREATE_ATTEMPTS; createAttempt++) {
    const { level, target } = await loadProgressFor(request.participant._id, levelKey);
    if (!level) return sendError(response, 404, "LEVEL_NOT_FOUND", "No servable level matches that key");
    if (!target.unlocked) return sendError(response, 403, "LEVEL_LOCKED", "This level is not yet unlocked for this participant");

    // A participant can only meaningfully have one in_progress attempt per
    // level. Returning the existing one (whatever kind it was started as)
    // instead of creating a second is what makes this endpoint idempotent.
    // The level always runs to completion (no mid-level restart), so the
    // only way an in_progress attempt gets superseded is by submitting it.
    const existingInProgress = await Attempt.findOne({
      participantId: request.participant._id,
      levelId: level._id,
      isPractice: false,
      status: STATUS.IN_PROGRESS
    }).sort({ createdAt: -1 });

    if (existingInProgress) {
      const pinnedQuestions = await loadPinnedQuestions(existingInProgress.questionIds);
      return response.status(200).json(attemptPayload(existingInProgress, level, pinnedQuestions, [...target.attempts, existingInProgress]));
    }

    let missedQuestionIds = null;

    if (kind === "remediation") {
      // Due only when the most recent SUBMITTED attempt cleared the pass
      // mark but hasn't yet reached 100% — a below-pass-mark attempt (even
      // a failed remediation round) is a whole-level restart instead
      // (SPEC 2.3), requested as kind "first".
      const latestAttempt = [...target.attempts].sort((a, b) => b.attemptNo - a.attemptNo)[0];
      if (!latestAttempt || !latestAttempt.passed || latestAttempt.accuracy === 100) {
        return sendError(response, 400, "NO_REMEDIATION_DUE", "No attempt awaiting remediation for this level");
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

    try {
      const attempt = await Attempt.create({
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
      return response.status(201).json(attemptPayload(attempt, level, questions, [...target.attempts, attempt]));
    } catch (error) {
      // Another concurrent request for this participant+level won the race
      // to this attemptNo between the check above and this insert. Loop
      // back to the top: a fresh read of the world resolves it correctly
      // either way (idempotent 200 if the winner is still in_progress, or
      // a fresh attempt at the next free number if it has already moved
      // on) — never a delete, never touching the index, never a duplicate.
      if (error?.code === 11000) continue;
      throw error;
    }
  }

  return sendError(response, 409, "ATTEMPT_CREATION_CONFLICT", "Could not start an attempt after several concurrent tries — please retry");
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

  const result = aggregateAttempt({ level, questions, responses });
  const outcome = outcomeFor(result.accuracy, level.passMark, attempt.kind);
  const { objectives, missedItems } = buildPerformanceSummary(level, questions, responses);

  attempt.submittedAt = new Date();
  attempt.status = STATUS.SUBMITTED;
  attempt.score = result.score;
  attempt.accuracy = result.accuracy;
  // "Cleared the floor" (avoided a full restart) — kind-aware, same as
  // outcome: a remediation-kind attempt is never a restart trigger,
  // regardless of its own accuracy.
  attempt.passed = outcome !== ATTEMPT_OUTCOMES.FAIL;
  attempt.starsAwarded = result.starsAwarded;
  attempt.vitalsEnd = result.vitalsEnd;
  attempt.activeMs = result.activeMs;
  attempt.hiddenMs = result.hiddenMs;
  await attempt.save();

  let unlockedNextLevelKey = null;
  if (outcome === ATTEMPT_OUTCOMES.MASTERED) {
    const nextLevel = await Level.findOne({ order: level.order + 1, deletedAt: null, status: { $in: [STATUS.PUBLISHED, STATUS.LOCKED] } });
    if (nextLevel) unlockedNextLevelKey = nextLevel.key;
  }

  // This attempt is terminal now, so the fully up-to-date submitted set
  // both freezes the headline (if this was attemptNo 1) and gives this
  // attempt's own remediation-round number.
  const allSubmittedAttempts = await Attempt.find({ participantId: request.participant._id, levelId: level._id, isPractice: false, status: STATUS.SUBMITTED });
  const summary = summarizeLevelAttempts(allSubmittedAttempts);

  // The result card only ever appears on a MASTERED submit, and by then
  // `objectives`/`missedItems` above describe THIS round — which, being
  // mastered, is trivially all-correct. The permanent record it should
  // show is the frozen first attempt's own performance, not that. Reuse
  // the current attempt's already-loaded data when this submit IS
  // attemptNo 1; otherwise the first attempt is a different document and
  // its questions/responses need their own fetch.
  let headline = summary.headline;
  if (summary.firstAttempt) {
    const isCurrentAttemptTheFirst = String(summary.firstAttempt._id) === String(attempt._id);
    const firstAttemptQuestions = isCurrentAttemptTheFirst ? questions : await Question.find({ _id: { $in: summary.firstAttempt.questionIds } });
    const firstAttemptResponses = isCurrentAttemptTheFirst ? responses : await Response.find({ attemptId: summary.firstAttempt._id, isRetry: false });
    const firstPerformance = buildPerformanceSummary(level, firstAttemptQuestions, firstAttemptResponses);
    headline = { ...summary.headline, ...firstPerformance };
  }

  response.json({
    attempt: {
      attemptId: String(attempt._id),
      levelKey: level.key,
      kind: attempt.kind,
      attemptNo: attempt.attemptNo,
      remediationRound: remediationRoundFor(attempt, allSubmittedAttempts),
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
    outcome,
    headline,
    restartCount: summary.restartCount,
    remediationCount: summary.remediationCount,
    objectives,
    missedItems,
    unlockedNextLevelKey
  });
});

export default router;
