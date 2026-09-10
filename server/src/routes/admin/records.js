import { Router } from "express";
import mongoose from "mongoose";
import Level from "../../models/Level.js";
import Participant from "../../models/Participant.js";
import Attempt from "../../models/Attempt.js";
import Response from "../../models/Response.js";
import Question from "../../models/Question.js";
import { STATUS } from "../../../../shared/constants.js";
import { sendError } from "../../lib/httpError.js";
import { requireSuperAdmin } from "../../middleware/requireSuperAdmin.js";
import { summarizeLevelAttempts, remediationRoundFor, outcomeFor } from "../../services/scoring.js";
import { participantsTable, itemAnalysis, responseRows, attemptRows } from "../../services/analytics.js";
import { toCsv, exportFilename } from "../../services/csv.js";

const router = Router();

// Shared filter for every records view: session, arm, and the two
// include toggles. Excluded and practice rows are OUT unless explicitly
// asked for (SPEC §11), and the export carries that choice in its
// filename so two files can never be confused.
const parseScope = query => ({
  includeExcluded: query.includeExcluded === "true",
  includePractice: query.includePractice === "true",
  sessionId: mongoose.isValidObjectId(query.sessionId) ? query.sessionId : null,
  arm: query.arm === "E" || query.arm === "C" ? query.arm : null
});

// One scoped pass over participants -> attempts -> responses -> questions.
// A study is small (dozens of participants, a few thousand responses), so
// this is loaded whole and rolled up in memory rather than aggregated in
// the database. Nothing here is stored — every figure is recomputed
// (CLAUDE.md, SPEC §8/§11).
const loadScopedData = async scope => {
  const participantFilter = { deletedAt: null };
  if (!scope.includeExcluded) participantFilter.excluded = false;
  if (scope.arm) participantFilter.arm = scope.arm;
  const participants = await Participant.find(participantFilter).lean();

  const attemptFilter = { participantId: { $in: participants.map(p => p._id) } };
  if (!scope.includePractice) attemptFilter.isPractice = false;
  if (scope.sessionId) attemptFilter.sessionId = new mongoose.Types.ObjectId(scope.sessionId);
  const attempts = await Attempt.find(attemptFilter).lean();

  const responses = await Response.find({ attemptId: { $in: attempts.map(a => a._id) } }).lean();
  const levels = await Level.find({ deletedAt: null }).lean();

  const referencedQuestionIds = [...new Set(responses.map(r => String(r.questionId)))];
  const questions = await Question.find({ _id: { $in: referencedQuestionIds } }).lean();

  return { participants, attempts, responses, levels, questions };
};

// The question set item analysis REPORTS on: every currently servable
// question (so a not-yet-answered item still shows with n=0), plus any
// superseded/forked version that responses actually reference.
const reportableItemSet = async referencedQuestions => {
  const servable = await Question.find({ status: { $in: [STATUS.PUBLISHED, STATUS.LOCKED] }, supersededBy: null, deletedAt: null }, { levelKey: 1, sequence: 1, type: 1, objective: 1, version: 1 }).lean();
  const seen = new Set(servable.map(q => String(q._id)));
  const extras = referencedQuestions.filter(q => !seen.has(String(q._id)));
  return [...servable, ...extras].map(q => ({
    questionId: String(q._id),
    levelKey: q.levelKey,
    sequence: q.sequence,
    type: q.type,
    objective: q.objective,
    version: q.version
  }));
};

const scopeEcho = scope => ({ includeExcluded: scope.includeExcluded, includePractice: scope.includePractice, sessionId: scope.sessionId, arm: scope.arm });

// SPEC §11 admin participants table — one row per code, expandable to
// per-level attempt rows. View records is admin-permitted (SPEC 4.1).
router.get("/participants", async (request, response) => {
  const scope = parseScope(request.query);
  const data = await loadScopedData(scope);
  response.json({ scope: scopeEcho(scope), participants: participantsTable(data) });
});

// SPEC §11 item analysis — difficulty and discrimination per question,
// with a plain-language reading and a needs-review flag. Formulas are
// written out in SPEC §11.
router.get("/items", async (request, response) => {
  const scope = parseScope(request.query);
  const data = await loadScopedData(scope);
  const items = itemAnalysis({ questions: await reportableItemSet(data.questions), responses: data.responses });
  response.json({ scope: scopeEcho(scope), items });
});

// SPEC §11 exports — the four CSVs. Raw CSV export is super_admin-only
// (SPEC 4.1: "Raw CSV export | no | yes"). No roster labels, no names —
// `code` + `arm` are the study de-identifiers and nothing else is joined.
const EXPORT_FILES = ["participants", "attempts", "responses", "items"];

router.get("/export", requireSuperAdmin, async (request, response) => {
  const file = request.query.file;
  if (!EXPORT_FILES.includes(file)) return sendError(response, 400, "INVALID_FILE", `file must be one of ${EXPORT_FILES.join(", ")}`);

  const scope = parseScope(request.query);
  const data = await loadScopedData(scope);
  const table = participantsTable(data);

  let csv;
  if (file === "participants") {
    csv = toCsv(
      [
        { key: "code" },
        { key: "arm" },
        { key: "state" },
        { key: "attempts", value: r => r.attemptCount },
        { key: "wrongCount" },
        { key: "retryCount" },
        { key: "activeMs" },
        { key: "hiddenMs" },
        { key: "bestScore" },
        { key: "levelsPlayed" },
        { key: "levelsMastered" }
      ],
      table
    );
  } else if (file === "attempts") {
    csv = toCsv(
      [
        { key: "code" },
        { key: "arm" },
        { key: "levelKey" },
        { key: "attemptNo" },
        { key: "kind" },
        { key: "remediationRound" },
        { key: "outcome" },
        { key: "status" },
        { key: "accuracy" },
        { key: "score" },
        { key: "starsAwarded" },
        { key: "activeMs" },
        { key: "hiddenMs" }
      ],
      attemptRows(table)
    );
  } else if (file === "responses") {
    csv = toCsv(
      [
        { key: "code" },
        { key: "arm" },
        { key: "levelKey" },
        { key: "attemptNo" },
        { key: "attemptKind" },
        { key: "questionSequence" },
        { key: "questionId" },
        { key: "questionVersion" },
        { key: "isCorrect" },
        { key: "isRetry" },
        { key: "partialScore" },
        { key: "shownAt" },
        { key: "firstInteractionAt" },
        { key: "answeredAt" },
        { key: "hiddenMs" }
      ],
      responseRows(data)
    );
  } else {
    const items = itemAnalysis({ questions: await reportableItemSet(data.questions), responses: data.responses });
    csv = toCsv(
      [
        { key: "questionId" },
        { key: "levelKey" },
        { key: "sequence" },
        { key: "type" },
        { key: "objective" },
        { key: "n" },
        { key: "correct" },
        { key: "difficulty", value: r => (r.difficulty === null ? "" : r.difficulty.toFixed(4)) },
        { key: "discrimination", value: r => (r.discrimination === null ? "" : r.discrimination.toFixed(4)) },
        { key: "needsReview" },
        { key: "reading" }
      ],
      items
    );
  }

  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", `attachment; filename="${exportFilename(file, scope)}"`);
  response.send(csv);
});

// Full question-by-question trail for one participant on one level: every
// attempt (any status — an in_progress one is still worth seeing) in
// attemptNo order, and every response within it in the order it was
// answered, with all four SPEC §8 timestamps. This is what "see exactly
// where a participant struggled" means in practice. View records is
// admin-permitted (SPEC 4.1); the whole /admin tree is already behind
// requireAdmin in admin/index.js, so there is no shim here — the route is
// on real admin auth like every sibling.
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
