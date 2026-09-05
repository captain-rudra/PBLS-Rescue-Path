// End-to-end check for the gameplay API and its progression mechanic.
// Exercises the real HTTP routes (never calls scoring.js directly) against
// throwaway participant/session/admin documents, using seeded
// prelevel/l1 content. Requires `npm run seed` to have been run against
// MONGODB_URI first.
//
// Covers the three submit outcomes (docs/SPEC.md 2.3/2.7):
//   - mastered  : accuracy 100% on the first try -> next level unlocks,
//                 3 stars, zero restarts/remediation rounds
//   - fail      : accuracy below the pass mark -> the WHOLE level restarts
//                 from question 1 (not just the missed items)
//   - remediate : accuracy at/above the pass mark but short of 100% ->
//                 another round over just what was missed, repeating until
//                 100% is reached
// and the frozen-headline rule: no matter how many restarts or remediation
// rounds follow, the level's displayed score/accuracy/stars stay pinned to
// attemptNo 1 forever.
//
// Usage: node scripts/e2e-play.js   (or: npm run test:play --workspace server)

import assert from "node:assert/strict";
import { connectDB, disconnectDB } from "../server/src/db.js";
import { createApp } from "../server/src/app.js";
import Level from "../server/src/models/Level.js";
import Question from "../server/src/models/Question.js";
import Session from "../server/src/models/Session.js";
import Participant from "../server/src/models/Participant.js";
import Admin from "../server/src/models/Admin.js";
import Attempt from "../server/src/models/Attempt.js";
import Response from "../server/src/models/Response.js";
import { hashSecret } from "../server/src/services/auth.js";

const log = (...args) => console.log("[e2e-play]", ...args);

// The suite's hundreds of existing assertions all drive the API with no
// Authorization header at all, resolving the participant/admin via
// DEV_PARTICIPANT_ID/DEV_ADMIN_ID (see requireParticipant.js/
// requireAdmin.js) — rewriting every one of them to carry a real token
// would be enormous churn for no coverage gain, since that plumbing is
// identical regardless of which participant/admin id it resolves to. This
// flag is what keeps that bypass available in this process; the two real
// auth tests below (testRealSignInPath, testTokenAudienceGuard) are what
// actually exercise real sign-in and real token verification.
process.env.ALLOW_DEV_AUTH_BYPASS = "true";

const TEST_ADMIN_PASSWORD = "e2e-test-password-123";

const correctGivenFor = question => {
  if (question.type === "drag_drop") {
    return { placements: Object.fromEntries(question.items.map(item => [item.id, item.bucket])) };
  }
  if (question.type === "sequence") {
    // shownOrder simulates the client's seeded pre-shuffle (SPEC 3.3) — any
    // permutation works here since this harness isn't testing the shuffle
    // itself, only that the server records and requires it.
    const shownOrder = [...question.correctOrder.slice(1), question.correctOrder[0]];
    return { order: [...question.correctOrder], shownOrder };
  }
  return { selected: question.correct };
};

const wrongGivenFor = question => {
  if (question.type === "drag_drop") {
    const bucketKeys = question.buckets.map(b => b.key);
    return { placements: Object.fromEntries(question.items.map(item => [item.id, bucketKeys.find(k => k !== item.bucket) || bucketKeys[0]])) };
  }
  if (question.type === "sequence") {
    const order = question.correctOrder;
    const shownOrder = [...order.slice(1), order[0]];
    return { order: [...order.slice(1), order[0]], shownOrder }; // cyclic shift: fixed-point-free for distinct ids
  }
  const wrongKey = question.options.map(o => o.key).find(k => k !== question.correct);
  return { selected: wrongKey };
};

let server;
let baseUrl;
let participant;
let admin;
let session;
const createdAttemptIds = [];

// testHotspotVideoScored creates a throwaway published question at this
// (levelKey, sequence) and deletes it again — the suite must never mutate
// a real seeded item. Sequence is far outside anything the seed uses;
// teardown sweeps it in case a hard kill skipped the test's own cleanup.
const SCRATCH_QUESTION_LEVEL_KEY = "l2";
const SCRATCH_QUESTION_SEQUENCE = 9999;

const request = async (method, path, body, { token } = {}) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
};

// `correctCount` of the questions (in serving order) are answered right,
// the rest wrong. No question type needs special-casing for "wrong": every
// wrongGivenFor is deliberately not the correct answer.
const answerQuestions = async (attemptId, questions, correctCount) => {
  for (const [index, question] of questions.entries()) {
    const shownAt = new Date();
    const firstInteractionAt = new Date(shownAt.getTime() + 300);
    const answeredAt = new Date(shownAt.getTime() + 1500);
    const rawQuestion = await Question.findById(question.questionId);
    const given = index < correctCount ? correctGivenFor(rawQuestion) : wrongGivenFor(rawQuestion);

    const res = await request("POST", "/play/responses", {
      attemptId,
      questionId: question.questionId,
      given,
      shownAt: shownAt.toISOString(),
      firstInteractionAt: firstInteractionAt.toISOString(),
      answeredAt: answeredAt.toISOString(),
      hiddenMs: 0,
      mediaReplays: 0
    });
    assert.equal(res.status, 201, `response for ${question.questionId} should be accepted: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.isCorrect, index < correctCount, "isCorrect must match what the server, not the client, computed");
  }
};

// Drives one level to a clean 100% through the real HTTP routes and
// returns the served questions plus the submit body. Assumes the prior
// level is already mastered for the current participant, so this one is
// unlocked. `expectedPublishedCount`, when given, asserts exactly how many
// questions the level serves — draft items must never be among them.
const masterLevel = async (levelKey, expectedPublishedCount) => {
  const created = await request("POST", "/play/attempts", { levelKey, kind: "first" });
  assert.equal(created.status, 201, `POST /play/attempts ${levelKey}: ${JSON.stringify(created.body)}`);
  const { attempt, questions } = created.body;
  if (expectedPublishedCount != null) {
    assert.equal(questions.length, expectedPublishedCount, `${levelKey} must serve ${expectedPublishedCount} published questions, got ${questions.length}`);
  }
  for (const q of questions) assert.equal(q.correct, undefined, "player payload must never include the answer key");
  await answerQuestions(attempt.attemptId, questions, questions.length);
  const submitted = await request("POST", `/play/attempts/${attempt.attemptId}/submit`);
  assert.equal(submitted.status, 200, `submit ${levelKey}: ${JSON.stringify(submitted.body)}`);
  assert.equal(submitted.body.outcome, "mastered", `${levelKey} at 100% must be 'mastered', got '${submitted.body.outcome}'`);
  assert.equal(submitted.body.attempt.accuracy, 100);
  return { attempt, questions, submitted: submitted.body };
};

const setup = async () => {
  await connectDB();

  const prelevel = await Level.findOne({ key: "prelevel", deletedAt: null });
  const l1 = await Level.findOne({ key: "l1", deletedAt: null });
  assert.ok(prelevel && l1, "seed data missing: run `npm run seed` first");

  // Belt-and-braces: drop any scratch question a previously hard-killed
  // run left behind, so the coverage sweep sees the true published counts.
  await Question.deleteMany({ levelKey: SCRATCH_QUESTION_LEVEL_KEY, sequence: SCRATCH_QUESTION_SEQUENCE });

  session = await Session.create({
    mode: "open",
    capacity: 1,
    levelKeys: ["prelevel", "l1", "l2", "l3", "l4"],
    showTimer: true
  });

  participant = await Participant.create({
    code: `E2E-${Date.now()}`,
    arm: "E",
    sessionId: session._id
  });

  admin = await Admin.create({
    email: `e2e-admin-${Date.now()}@example.test`,
    passwordHash: await hashSecret(TEST_ADMIN_PASSWORD),
    name: "E2E Admin",
    role: "super_admin"
  });

  process.env.DEV_PARTICIPANT_ID = String(participant._id);
  process.env.DEV_ADMIN_ID = String(admin._id);

  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  log(`server up on ${baseUrl}, participant ${participant.code}, admin ${admin.email}`);
};

const teardown = async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await Question.deleteMany({ levelKey: SCRATCH_QUESTION_LEVEL_KEY, sequence: SCRATCH_QUESTION_SEQUENCE });
  if (participant) {
    await Response.deleteMany({ participantId: participant._id });
    await Attempt.deleteMany({ participantId: participant._id });
    await Participant.deleteOne({ _id: participant._id });
  }
  if (admin) await Admin.deleteOne({ _id: admin._id });
  if (session) await Session.deleteOne({ _id: session._id });
  await disconnectDB();
};

const testLevelsInitialState = async () => {
  const { status, body } = await request("GET", "/play/levels");
  assert.equal(status, 200);
  const prelevel = body.levels.find(l => l.key === "prelevel");
  const l1 = body.levels.find(l => l.key === "l1");
  assert.equal(prelevel.state, "active", "prelevel must be active with no attempts yet");
  assert.equal(l1.state, "locked", "l1 must be locked until prelevel is mastered");
  assert.equal(prelevel.starsAwarded, 0);
  assert.equal(prelevel.headline, null);
  log("GET /play/levels initial state OK");
};

// Outcome 1: a clean 100% on the very first try.
const testCleanFirstTryMastery = async () => {
  const created = await request("POST", "/play/attempts", { levelKey: "prelevel", kind: "first" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const { attempt, questions } = created.body;
  createdAttemptIds.push(attempt.attemptId);
  assert.equal(questions.length, 10);
  assert.equal(attempt.remediationRound, 0, "a kind:first attempt is never a remediation round");
  for (const q of questions) assert.equal(q.correct, undefined, "player payload must never include the answer key");

  await answerQuestions(attempt.attemptId, questions, questions.length);

  const submitted = await request("POST", `/play/attempts/${attempt.attemptId}/submit`);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.outcome, "mastered");
  assert.equal(submitted.body.attempt.accuracy, 100);
  assert.equal(submitted.body.headline.accuracy, 100);
  assert.equal(submitted.body.headline.starsAwarded, 3, "a clean first-try 100% must earn 3 stars");
  assert.equal(submitted.body.restartCount, 0);
  assert.equal(submitted.body.remediationCount, 0);
  assert.equal(submitted.body.unlockedNextLevelKey, "l1");
  assert.deepEqual(submitted.body.headline.missedItems, []);
  log(`prelevel mastered clean: score=${submitted.body.attempt.score} stars=${submitted.body.headline.starsAwarded}`);

  const doubleSubmit = await request("POST", `/play/attempts/${attempt.attemptId}/submit`);
  assert.equal(doubleSubmit.status, 409, "resubmitting a submitted attempt must be refused");

  const { body: levels } = await request("GET", "/play/levels");
  const prelevelLevel = levels.levels.find(l => l.key === "prelevel");
  assert.equal(prelevelLevel.state, "complete");
  assert.equal(prelevelLevel.starsAwarded, 3);
  assert.equal(levels.levels.find(l => l.key === "l1").state, "active");
  log("GET /play/levels after mastery: l1 unlocked OK");
};

// The vitals-restart mechanic was removed entirely (SPEC 2.3): answering
// many questions wrong in a row must never interrupt an attempt anymore.
// This deliberately exceeds the old 21-damage/3-full-wrong threshold. Uses
// its own throwaway participant so it doesn't consume l1's attemptNo
// sequence relied on by the tests below.
const testNoMidLevelRestart = async () => {
  const scratchParticipant = await Participant.create({ code: `E2E-RESTART-${Date.now()}`, arm: "E", sessionId: session._id });
  const savedDevId = process.env.DEV_PARTICIPANT_ID;
  process.env.DEV_PARTICIPANT_ID = String(scratchParticipant._id);
  try {
    // This participant needs prelevel mastered first, purely so l1 is
    // unlocked for them — unrelated to what this test is actually checking.
    const prelevelAttempt = await request("POST", "/play/attempts", { levelKey: "prelevel", kind: "first" });
    assert.equal(prelevelAttempt.status, 201, JSON.stringify(prelevelAttempt.body));
    await answerQuestions(prelevelAttempt.body.attempt.attemptId, prelevelAttempt.body.questions, prelevelAttempt.body.questions.length);
    const prelevelSubmit = await request("POST", `/play/attempts/${prelevelAttempt.body.attempt.attemptId}/submit`);
    assert.equal(prelevelSubmit.status, 200, JSON.stringify(prelevelSubmit.body));
    assert.equal(prelevelSubmit.body.outcome, "mastered");

    const created = await request("POST", "/play/attempts", { levelKey: "l1", kind: "first" });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const { attempt, questions } = created.body;
    assert.equal(questions.length, 9, "l1 Q9 is a draft stub and must not be served");
    assert.ok(questions.length >= 5, "need at least 5 questions to exceed the old 3-wrong-answer threshold");

    // Answer the first 5 wrong (old code would have force-restarted after
    // the 3rd) and confirm every single response is still accepted normally.
    for (const question of questions.slice(0, 5)) {
      const rawQuestion = await Question.findById(question.questionId);
      const res = await request("POST", "/play/responses", {
        attemptId: attempt.attemptId,
        questionId: question.questionId,
        given: wrongGivenFor(rawQuestion),
        shownAt: new Date().toISOString(),
        answeredAt: new Date(Date.now() + 500).toISOString()
      });
      assert.equal(res.status, 201, `response must be accepted even past the old restart threshold: ${JSON.stringify(res.body)}`);
    }

    const attemptAfter = await Attempt.findById(attempt.attemptId);
    assert.equal(attemptAfter.status, "in_progress", "5 wrong answers must not abandon or restart the attempt");
    log("no mid-level restart after 5 consecutive wrong answers OK (vitals bar is display-only now)");
  } finally {
    process.env.DEV_PARTICIPANT_ID = savedDevId;
    await Response.deleteMany({ participantId: scratchParticipant._id });
    await Attempt.deleteMany({ participantId: scratchParticipant._id });
    await Participant.deleteOne({ _id: scratchParticipant._id });
  }
};

// Shared setup for the two concurrency regression tests below: a fresh
// scratch participant, driven (via the real HTTP routes) to exactly the
// state the bug report described — l1 attemptNo 1 and 2 already
// submitted, attemptNo 3 (a remediation round) about to be created.
// Leaves DEV_PARTICIPANT_ID pointed at the scratch participant; caller is
// responsible for restoring it and deleting the scratch data.
const setupL1AboutToCreateAttemptNo3 = async () => {
  const scratchParticipant = await Participant.create({ code: `E2E-RACE-${Date.now()}`, arm: "E", sessionId: session._id });
  process.env.DEV_PARTICIPANT_ID = String(scratchParticipant._id);

  const prelevelAttempt = await request("POST", "/play/attempts", { levelKey: "prelevel", kind: "first" });
  assert.equal(prelevelAttempt.status, 201, JSON.stringify(prelevelAttempt.body));
  await answerQuestions(prelevelAttempt.body.attempt.attemptId, prelevelAttempt.body.questions, prelevelAttempt.body.questions.length);
  const prelevelSubmit = await request("POST", `/play/attempts/${prelevelAttempt.body.attempt.attemptId}/submit`);
  assert.equal(prelevelSubmit.status, 200, JSON.stringify(prelevelSubmit.body));

  const attempt1 = await request("POST", "/play/attempts", { levelKey: "l1", kind: "first" }); // attemptNo 1
  assert.equal(attempt1.status, 201, JSON.stringify(attempt1.body));
  await answerQuestions(attempt1.body.attempt.attemptId, attempt1.body.questions, 1); // fail
  const submit1 = await request("POST", `/play/attempts/${attempt1.body.attempt.attemptId}/submit`);
  assert.equal(submit1.status, 200, JSON.stringify(submit1.body));
  assert.equal(submit1.body.outcome, "fail");

  const attempt2 = await request("POST", "/play/attempts", { levelKey: "l1", kind: "first" }); // attemptNo 2
  assert.equal(attempt2.status, 201, JSON.stringify(attempt2.body));
  assert.equal(attempt2.body.attempt.attemptNo, 2);
  await answerQuestions(attempt2.body.attempt.attemptId, attempt2.body.questions, 8); // remediate-eligible
  const submit2 = await request("POST", `/play/attempts/${attempt2.body.attempt.attemptId}/submit`);
  assert.equal(submit2.status, 200, JSON.stringify(submit2.body));
  assert.equal(submit2.body.outcome, "remediate");

  return scratchParticipant;
};

const cleanupScratchParticipant = async (scratchParticipant, savedDevId) => {
  process.env.DEV_PARTICIPANT_ID = savedDevId;
  await Response.deleteMany({ participantId: scratchParticipant._id });
  await Attempt.deleteMany({ participantId: scratchParticipant._id });
  await Participant.deleteOne({ _id: scratchParticipant._id });
};

// Regression test for a real runtime bug: MongoDB threw E11000 on the
// (participantId, levelId, attemptNo) unique index while creating
// attemptNo 3 during real manual play. Root cause: attemptNo is assigned
// by counting existing attempts and adding one — a check-then-insert race.
// Fires several genuinely concurrent requests at the exact "about to
// create attemptNo 3" state and asserts every one resolves cleanly to the
// SAME attempt, with no duplicate row — real E11000 collisions do occur
// here (confirmed while developing this fix), and every one must recover.
const testConcurrentAttemptCreationNoDuplicateKey = async () => {
  const savedDevId = process.env.DEV_PARTICIPANT_ID;
  const scratchParticipant = await setupL1AboutToCreateAttemptNo3();
  try {
    const CONCURRENCY = 6;
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => request("POST", "/play/attempts", { levelKey: "l1", kind: "remediation" }))
    );

    for (const r of results) {
      assert.ok(r.status === 200 || r.status === 201, `every concurrent create must resolve cleanly, not 500/E11000: ${r.status} ${JSON.stringify(r.body)}`);
    }
    const attemptIds = new Set(results.map(r => r.body.attempt.attemptId));
    assert.equal(attemptIds.size, 1, `all ${CONCURRENCY} concurrent requests must converge on the SAME attempt, got ${attemptIds.size} distinct ids`);

    const [singleAttemptId] = attemptIds;
    const dbAttempts = await Attempt.find({ participantId: scratchParticipant._id, kind: "remediation" });
    assert.equal(dbAttempts.length, 1, "exactly one remediation attempt document must exist — no duplicate row from the race");
    assert.equal(String(dbAttempts[0]._id), singleAttemptId);
    assert.equal(dbAttempts[0].attemptNo, 3);

    log(`${CONCURRENCY} concurrent POST /play/attempts at attemptNo 3 converged on one attempt, no E11000 escaped, no duplicate row`);
  } finally {
    await cleanupScratchParticipant(scratchParticipant, savedDevId);
  }
};

// Deterministic regression test for the SPECIFIC gap in the old recovery:
// it caught E11000 once and looked for an in_progress attempt to hand
// back, assuming the race's winner was still in_progress. That assumption
// isn't guaranteed — if the winner has already been submitted by the time
// a stale duplicate request's create() collides, the old code's "find an
// in_progress winner" lookup came back empty and the raw E11000 escaped
// as an unhandled 500. A genuine timing race can't be relied on to
// reproduce this deterministically, so this test engineers the exact
// sequence directly: a request that read the attempt count BEFORE
// attemptNo 3 existed only gets around to inserting AFTER attemptNo 3 has
// already been created AND fully submitted. `Attempt.countDocuments` is
// monkey-patched for exactly one call to return that stale, pre-captured
// count — everything else about the request goes through the real route.
const testStaleAttemptCountAfterWinnerAlreadySubmitted = async () => {
  const savedDevId = process.env.DEV_PARTICIPANT_ID;
  const scratchParticipant = await setupL1AboutToCreateAttemptNo3();
  try {
    const l1 = await Level.findOne({ key: "l1", deletedAt: null });
    const staleCount = await Attempt.countDocuments({ participantId: scratchParticipant._id, levelId: l1._id });
    assert.equal(staleCount, 2, "sanity: exactly attemptNo 1 and 2 exist before the winner is created");

    // Real winner: creates attemptNo 3, then answer + submit it fully —
    // it is no longer in_progress by the time the stale request runs.
    const winner = await request("POST", "/play/attempts", { levelKey: "l1", kind: "remediation" });
    assert.equal(winner.status, 201, JSON.stringify(winner.body));
    assert.equal(winner.body.attempt.attemptNo, 3);
    await answerQuestions(winner.body.attempt.attemptId, winner.body.questions, 0); // stays eligible for further remediation
    const winnerSubmit = await request("POST", `/play/attempts/${winner.body.attempt.attemptId}/submit`);
    assert.equal(winnerSubmit.status, 200, JSON.stringify(winnerSubmit.body));
    assert.equal(winnerSubmit.body.attempt.status, "submitted");

    // The stale request: its own attemptNo computation is forced to the
    // pre-captured value (2 -> attemptNo 3), which now collides with the
    // already-submitted attemptNo 3 above. One-shot: restores itself
    // immediately, so nothing else observes the patched behaviour.
    const realCountDocuments = Attempt.countDocuments.bind(Attempt);
    Attempt.countDocuments = async (...args) => {
      Attempt.countDocuments = realCountDocuments;
      return staleCount;
    };

    const staleResult = await request("POST", "/play/attempts", { levelKey: "l1", kind: "remediation" });
    Attempt.countDocuments = realCountDocuments; // belt-and-braces in case the route never called it (e.g. short-circuited)

    assert.ok(
      staleResult.status === 200 || staleResult.status === 201,
      `a stale attemptNo collision against an already-submitted attempt must not surface a raw E11000/500: ${staleResult.status} ${JSON.stringify(staleResult.body)}`
    );
    assert.equal(staleResult.body.attempt.attemptNo, 4, "must recompute a fresh attemptNo (4), not retry the stale, already-taken 3");

    const dbAttempts = await Attempt.find({ participantId: scratchParticipant._id, levelId: l1._id }).sort({ attemptNo: 1 });
    assert.equal(dbAttempts.length, 4);
    assert.deepEqual(dbAttempts.map(a => a.attemptNo), [1, 2, 3, 4], "no duplicate attemptNo, no gap");

    log("stale attemptNo collision against an already-submitted winner correctly recomputed attemptNo 4, no E11000 escaped");
  } finally {
    await cleanupScratchParticipant(scratchParticipant, savedDevId);
  }
};

// Outcome 2 then repeated outcome 3: fail-and-restart, then remediate to
// 100%. Also proves the frozen-headline rule: the level's displayed score
// stays pinned to the original failing attemptNo:1 even after mastery.
const testFailRestartThenRemediateToMastery = async () => {
  // --- First attempt: 1/9 correct, well below the 80% pass mark -> fail.
  const firstTry = await request("POST", "/play/attempts", { levelKey: "l1", kind: "first" });
  assert.equal(firstTry.status, 201, JSON.stringify(firstTry.body));
  createdAttemptIds.push(firstTry.body.attempt.attemptId);
  assert.equal(firstTry.body.attempt.attemptNo, 1);

  await answerQuestions(firstTry.body.attempt.attemptId, firstTry.body.questions, 1);
  const firstSubmit = await request("POST", `/play/attempts/${firstTry.body.attempt.attemptId}/submit`);
  assert.equal(firstSubmit.status, 200, JSON.stringify(firstSubmit.body));
  assert.equal(firstSubmit.body.outcome, "fail");
  assert.equal(firstSubmit.body.attempt.passed, false);
  const originalScore = firstSubmit.body.attempt.score;
  const originalAccuracy = firstSubmit.body.attempt.accuracy;
  assert.ok(originalAccuracy < 80, "sanity: the first attempt must genuinely be below the pass mark");
  log(`l1 attemptNo:1 failed as expected: accuracy=${originalAccuracy}%`);

  const { body: levelsAfterFail } = await request("GET", "/play/levels");
  assert.equal(levelsAfterFail.levels.find(l => l.key === "l1").state, "failed");

  // A below-pass-mark attempt owes a full restart, not remediation.
  const remediationTooSoon = await request("POST", "/play/attempts", { levelKey: "l1", kind: "remediation" });
  assert.equal(remediationTooSoon.status, 400, "remediation must be refused right after a failed attempt");

  // --- Restart (kind: first again) -> the WHOLE level, not just misses.
  const restart = await request("POST", "/play/attempts", { levelKey: "l1", kind: "first" });
  assert.equal(restart.status, 201, JSON.stringify(restart.body));
  createdAttemptIds.push(restart.body.attempt.attemptId);
  assert.equal(restart.body.attempt.attemptNo, 2);
  assert.equal(restart.body.questions.length, 9, "a restart must serve the full question set again, not just what was missed");

  // 8/9 correct: at/above the 80% pass mark but short of 100% -> remediate.
  await answerQuestions(restart.body.attempt.attemptId, restart.body.questions, 8);
  const restartSubmit = await request("POST", `/play/attempts/${restart.body.attempt.attemptId}/submit`);
  assert.equal(restartSubmit.status, 200, JSON.stringify(restartSubmit.body));
  assert.equal(restartSubmit.body.outcome, "remediate");
  assert.equal(restartSubmit.body.attempt.passed, true);
  assert.equal(restartSubmit.body.restartCount, 1, "one restart so far (attemptNo 2 beyond the original)");
  assert.equal(restartSubmit.body.remediationCount, 0);
  // The frozen headline must still be the ORIGINAL failing attempt, not
  // this much-better restart.
  assert.equal(restartSubmit.body.headline.accuracy, originalAccuracy, "headline must stay pinned to attemptNo 1, not the restart");
  assert.equal(restartSubmit.body.headline.score, originalScore);
  assert.equal(restartSubmit.body.headline.starsAwarded, 0, "the frozen first attempt was below 80%, so 0 stars even mid-remediation-chain");
  const missedAfterRestart = restartSubmit.body.missedItems;
  assert.equal(missedAfterRestart.length, 1, "8/9 correct leaves exactly one missed item");
  log(`l1 restart (attemptNo 2) cleared the pass mark at ${restartSubmit.body.attempt.accuracy}%, 1 item still missed`);

  const { body: levelsAfterRestart } = await request("GET", "/play/levels");
  const l1AfterRestart = levelsAfterRestart.levels.find(l => l.key === "l1");
  assert.equal(l1AfterRestart.state, "remediating");
  assert.equal(l1AfterRestart.starsAwarded, 0, "dashboard stars also reflect the frozen (failing) first attempt");

  // --- Remediation round 1: the single missed item, answered WRONG (0%).
  // The pass mark does not apply to a remediation-kind attempt — this must
  // stay "remediate" (another round over the same item), never "fail" /
  // a full restart, no matter how low this round's own accuracy is.
  const remediation1 = await request("POST", "/play/attempts", { levelKey: "l1", kind: "remediation" });
  assert.equal(remediation1.status, 201, JSON.stringify(remediation1.body));
  createdAttemptIds.push(remediation1.body.attempt.attemptId);
  assert.equal(remediation1.body.attempt.attemptNo, 3);
  assert.equal(remediation1.body.attempt.remediationRound, 1, "first remediation attempt for this level");
  assert.equal(remediation1.body.questions.length, 1, "remediation must serve exactly the missed item");
  assert.equal(remediation1.body.questions[0].questionId, missedAfterRestart[0].questionId);

  await answerQuestions(remediation1.body.attempt.attemptId, remediation1.body.questions, 0);
  const remediation1Submit = await request("POST", `/play/attempts/${remediation1.body.attempt.attemptId}/submit`);
  assert.equal(remediation1Submit.status, 200, JSON.stringify(remediation1Submit.body));
  assert.equal(remediation1Submit.body.attempt.accuracy, 0, "sanity: this round really did score 0%");
  assert.equal(remediation1Submit.body.outcome, "remediate", "a remediation round below the pass mark must stay 'remediate', never 'fail'");
  assert.equal(remediation1Submit.body.attempt.passed, true, "a remediation-kind attempt is never a restart trigger");
  assert.equal(remediation1Submit.body.restartCount, 1, "0% on a remediation round must not count as another restart");
  assert.equal(remediation1Submit.body.remediationCount, 1);
  log(`l1 remediation round 1 scored 0% and correctly stayed in remediation (no restart)`);

  const { body: levelsAfterRemediation1 } = await request("GET", "/play/levels");
  assert.equal(levelsAfterRemediation1.levels.find(l => l.key === "l1").state, "remediating", "0% on a remediation round must not flip the dashboard to 'failed'");

  // A below-pass-mark remediation round must still be eligible for ANOTHER
  // remediation round (not blocked, and not requiring kind:"first").
  const remediation2 = await request("POST", "/play/attempts", { levelKey: "l1", kind: "remediation" });
  assert.equal(remediation2.status, 201, JSON.stringify(remediation2.body));
  createdAttemptIds.push(remediation2.body.attempt.attemptId);
  assert.equal(remediation2.body.attempt.attemptNo, 4);
  assert.equal(remediation2.body.attempt.remediationRound, 2, "second remediation attempt for this level");
  assert.equal(remediation2.body.questions.length, 1, "still just the one item, carried forward from the 0% round");
  assert.equal(remediation2.body.questions[0].questionId, missedAfterRestart[0].questionId);

  // --- Remediation round 2: answered correctly this time -> mastered.
  await answerQuestions(remediation2.body.attempt.attemptId, remediation2.body.questions, 1);
  const remediation2Submit = await request("POST", `/play/attempts/${remediation2.body.attempt.attemptId}/submit`);
  assert.equal(remediation2Submit.status, 200, JSON.stringify(remediation2Submit.body));
  assert.equal(remediation2Submit.body.outcome, "mastered");
  assert.equal(remediation2Submit.body.attempt.accuracy, 100, "this round's own accuracy is 100");
  assert.equal(remediation2Submit.body.restartCount, 1);
  assert.equal(remediation2Submit.body.remediationCount, 2, "two remediation rounds happened, including the 0% one");
  // Headline is STILL the original failing attempt, even now that the
  // level is fully mastered — this is the frozen-headline rule.
  assert.equal(remediation2Submit.body.headline.accuracy, originalAccuracy);
  assert.equal(remediation2Submit.body.headline.score, originalScore);
  assert.equal(remediation2Submit.body.headline.starsAwarded, 0);
  assert.equal(remediation2Submit.body.headline.missedItems.length, 8, "headline missed items must be the ORIGINAL attempt's 8 misses, not this round's 0");
  assert.equal(remediation2Submit.body.unlockedNextLevelKey, "l2");
  log(`l1 mastered via remediation round 2; frozen headline stays at attemptNo:1's ${originalAccuracy}% / 0 stars`);

  const { body: levelsAfterMastery } = await request("GET", "/play/levels");
  const l1Final = levelsAfterMastery.levels.find(l => l.key === "l1");
  assert.equal(l1Final.state, "complete");
  assert.equal(l1Final.starsAwarded, 0, "mastering via remediation never retroactively improves the frozen stars");
  assert.equal(l1Final.headline.accuracy, originalAccuracy);
  assert.equal(l1Final.remediationCount, 2);
  assert.equal(levelsAfterMastery.levels.find(l => l.key === "l2").state, "active");
  log("GET /play/levels after mastery-via-remediation: l1 complete (0 stars, frozen), l2 unlocked OK");
};

const testIntegrityGuards = async () => {
  const noRemediation = await request("POST", "/play/attempts", { levelKey: "l1", kind: "remediation" });
  assert.equal(noRemediation.status, 400, "remediation must be refused once the level is fully mastered");

  const restart = await request("POST", "/play/attempts", { levelKey: "prelevel", kind: "first" });
  assert.equal(restart.status, 201);
  createdAttemptIds.push(restart.body.attempt.attemptId);
  const incompleteSubmit = await request("POST", `/play/attempts/${restart.body.attempt.attemptId}/submit`);
  assert.equal(incompleteSubmit.status, 400, "submitting before every question is answered must be refused");

  const firstQuestion = restart.body.questions[0];
  const badShape = await request("POST", "/play/responses", {
    attemptId: restart.body.attempt.attemptId,
    questionId: firstQuestion.questionId,
    given: { selected: 123 },
    shownAt: new Date().toISOString(),
    answeredAt: new Date().toISOString()
  });
  assert.equal(badShape.status, 400, "malformed given must be rejected");

  const otherParticipant = await Participant.create({ code: `E2E-B-${Date.now()}`, arm: "C", sessionId: session._id });
  const savedDevId = process.env.DEV_PARTICIPANT_ID;
  process.env.DEV_PARTICIPANT_ID = String(otherParticipant._id);
  const otherRecords = await request("GET", "/play/me/records");
  process.env.DEV_PARTICIPANT_ID = savedDevId;
  assert.equal(otherRecords.status, 200);
  assert.equal(otherRecords.body.records.length, 0, "a fresh participant must see none of another participant's records");
  await Participant.deleteOne({ _id: otherParticipant._id });

  log("integrity guards OK (no remediation once mastered, incomplete submit blocked, bad shape blocked, records scoped per participant)");
};

const testMeRecords = async () => {
  const { status, body } = await request("GET", "/play/me/records");
  assert.equal(status, 200);
  assert.ok(body.records.length >= 4, "should have prelevel(mastered), l1(fail), l1(restart-remediate), l1(remediation-mastered) at least");
  assert.ok(body.records.every(r => typeof r.score === "number"));
  const l1Rows = body.records.filter(r => r.levelKey === "l1");
  assert.ok(l1Rows.every(r => r.levelHeadline?.accuracy === l1Rows[0].levelHeadline.accuracy), "every row for a level must report the same frozen headline");
  log(`GET /play/me/records: ${body.records.length} record(s) OK, per-level headline consistent`);
};

// "Admin sees the full end-to-end trail, question by question: which items
// were missed on which attempt, in what order, with timings."
const testAdminTrail = async () => {
  const savedAdminId = process.env.DEV_ADMIN_ID;
  delete process.env.DEV_ADMIN_ID;
  const unauthorized = await request("GET", `/admin/records/trail?participantId=${participant._id}&levelKey=l1`);
  assert.equal(unauthorized.status, 500, "the admin trail must not be reachable without an admin resolved");
  process.env.DEV_ADMIN_ID = savedAdminId;

  const { status, body } = await request("GET", `/admin/records/trail?participantId=${participant._id}&levelKey=l1`);
  assert.equal(status, 200);
  assert.equal(body.attempts.length, 4, "l1 trail must show all four attempts: fail, restart-remediate, remediate-at-0%, remediation-mastered");
  assert.deepEqual(body.attempts.map(a => a.attemptNo), [1, 2, 3, 4]);
  assert.deepEqual(body.attempts.map(a => a.outcome), ["fail", "remediate", "remediate", "mastered"]);
  assert.deepEqual(body.attempts.map(a => a.kind), ["first", "first", "remediation", "remediation"]);
  assert.deepEqual(body.attempts.map(a => a.remediationRound), [0, 0, 1, 2]);
  assert.equal(body.attempts[0].responses.length, 9);
  assert.equal(body.attempts[1].responses.length, 9);
  assert.equal(body.attempts[2].responses.length, 1);
  assert.equal(body.attempts[3].responses.length, 1);
  // Every response carries question identity, correctness and all four
  // SPEC 8 timestamps — the "question by question, with timings" trail.
  for (const attempt of body.attempts) {
    for (const r of attempt.responses) {
      assert.ok(r.questionTitle, "trail response must resolve the question title");
      assert.ok(typeof r.isCorrect === "boolean");
      assert.ok(r.shownAt && r.answeredAt, "trail response must carry timing");
    }
  }
  assert.equal(body.headline.accuracy, body.attempts[0].accuracy, "trail headline must match attemptNo 1, same frozen rule as everywhere else");
  assert.equal(body.restartCount, 1);
  assert.equal(body.remediationCount, 2);
  log("GET /admin/records/trail OK: full 4-attempt, question-by-question trail with timings");
};

// Coverage sweep: every level played through to mastery, and every
// question type that has a published seed item exercised end-to-end
// through the real routes with real server-side scoring. The existing
// tests above only ever touch prelevel and l1 (mcq, animation_mcq,
// drag_drop, sequence) — this adds l2/l3/l4 and, with them, video_mcq and
// split_screen, and checks the full unlock chain prelevel -> l4.
const testEveryLevelAndQuestionType = async () => {
  const scratchParticipant = await Participant.create({ code: `E2E-SWEEP-${Date.now()}`, arm: "E", sessionId: session._id });
  const savedDevId = process.env.DEV_PARTICIPANT_ID;
  process.env.DEV_PARTICIPANT_ID = String(scratchParticipant._id);
  try {
    // Published counts per level for the current seed: totals 10/10/21/21/8
    // minus the 3 draft stubs (l1:9 drag_drop, l2:3 sequence, l2:18
    // hotspot_video).
    const plan = [
      { key: "prelevel", published: 10, unlocks: "l1" },
      { key: "l1", published: 9, unlocks: "l2" },
      { key: "l2", published: 19, unlocks: "l3" },
      { key: "l3", published: 21, unlocks: "l4" },
      { key: "l4", published: 8, unlocks: null }
    ];
    const servedTypes = new Set();
    const servedIds = [];
    for (const step of plan) {
      const { questions, submitted } = await masterLevel(step.key, step.published);
      for (const q of questions) {
        servedTypes.add(q.type);
        servedIds.push(q.questionId);
      }
      assert.equal(submitted.unlockedNextLevelKey, step.unlocks, `${step.key} mastery must unlock ${step.unlocks ?? "nothing (last level)"}`);
      if (step.key === "l3") {
        assert.ok(questions.some(q => q.type === "split_screen"), "l3 must serve its split_screen item (l3:21)");
      }

      // Level badge on a mastered submit: null for the prelevel (the
      // corrected source gives it none — the UI must show no empty slot),
      // the level's own seeded badge otherwise.
      const seededLevel = await Level.findOne({ key: step.key });
      assert.equal(submitted.badge, seededLevel.badge ?? null, `${step.key} mastered submit must return its seeded badge`);
      if (step.key === "prelevel") assert.equal(submitted.badge, null, "the prelevel has no badge");

      // Global achievement (SPEC 2.6/7): BLS Expert can only be newly
      // earned on the FIFTH level's first attempt — never before (fewer
      // than five frozen first attempts exist), never after (first-attempt
      // figures are frozen).
      const newKeys = (submitted.newAchievements || []).map(a => a.key);
      assert.deepEqual(
        newKeys,
        step.key === "l4" ? ["bls_expert"] : [],
        step.key === "l4"
          ? "mastering l4 first-try at 100% must newly earn BLS Expert on this submit"
          : `${step.key} submit must not newly earn any achievement yet`
      );

      log(`${step.key} mastered: ${questions.length} questions, types ${[...new Set(questions.map(q => q.type))].sort().join("/")}`);
    }

    // BLS Expert is now earned and readable from the dedicated endpoint,
    // with a 100% pooled first-attempt accuracy across all five levels.
    const { body: ach } = await request("GET", "/play/achievements");
    const blsExpert = ach.achievements.find(a => a.key === "bls_expert");
    assert.ok(blsExpert.earned, "BLS Expert must be earned after five first-try 100% levels");
    assert.ok(blsExpert.earnedAt, "BLS Expert must carry an earnedAt timestamp");
    assert.equal(blsExpert.progress.levelsWithFirstAttempt, 5);
    assert.equal(blsExpert.progress.overallFirstAttemptAccuracy, 100, "pooled first-attempt accuracy across all five levels is 100%");

    for (const type of ["mcq", "video_mcq", "animation_mcq", "drag_drop", "sequence", "split_screen"]) {
      assert.ok(servedTypes.has(type), `question type '${type}' was never served end-to-end (served: ${[...servedTypes].sort().join(", ")})`);
    }
    // The seed's only hotspot_video (l2:18) is a draft stub — it must not
    // leak into normal play. testHotspotVideoScored covers that type on a
    // throwaway question it creates and deletes.
    assert.ok(!servedTypes.has("hotspot_video"), "the draft hotspot_video stub (l2:18) must never be served through normal play");

    const draftQuestions = await Question.find({ status: "draft" });
    assert.equal(draftQuestions.length, 3, "seed must contain exactly 3 draft questions");
    const draftIds = new Set(draftQuestions.map(q => String(q._id)));
    assert.ok(servedIds.every(id => !draftIds.has(id)), "no draft question may ever be served to a play attempt");
    assert.equal(servedIds.length, 10 + 9 + 19 + 21 + 8, "total questions served across all five levels must equal the published count");

    log(`coverage sweep OK: all 5 levels mastered, unlock chain intact, BLS Expert earned, types exercised: ${[...servedTypes].sort().join(", ")}`);
  } finally {
    process.env.DEV_PARTICIPANT_ID = savedDevId;
    await Response.deleteMany({ participantId: scratchParticipant._id });
    await Attempt.deleteMany({ participantId: scratchParticipant._id });
    await Participant.deleteOne({ _id: scratchParticipant._id });
  }
};

// BLS Expert is measured on FIRST contact, not on the eventual 100% every
// level reaches through remediation (SPEC 7). A participant who scrapes a
// level through on a poor first attempt and only later masters it must not
// end up with the achievement — otherwise, since every path ends at 100%,
// everyone would get it. This drives one level's FIRST attempt well below
// the bar, masters everything, and asserts BLS Expert stays locked with a
// sub-95 pooled figure.
const testBlsExpertMeasuresFirstAttemptOnly = async () => {
  const scratchParticipant = await Participant.create({ code: `E2E-BLS-${Date.now()}`, arm: "E", sessionId: session._id });
  const savedDevId = process.env.DEV_PARTICIPANT_ID;
  process.env.DEV_PARTICIPANT_ID = String(scratchParticipant._id);
  try {
    await masterLevel("prelevel", 10); // 10/10 first try

    // l1 first attempt: 3/9 correct — a genuine fail, far below the pass
    // mark, so it restarts rather than remediates.
    const l1First = await request("POST", "/play/attempts", { levelKey: "l1", kind: "first" });
    assert.equal(l1First.status, 201, JSON.stringify(l1First.body));
    assert.equal(l1First.body.attempt.attemptNo, 1);
    await answerQuestions(l1First.body.attempt.attemptId, l1First.body.questions, 3);
    const l1FirstSubmit = await request("POST", `/play/attempts/${l1First.body.attempt.attemptId}/submit`);
    assert.equal(l1FirstSubmit.status, 200, JSON.stringify(l1FirstSubmit.body));
    assert.equal(l1FirstSubmit.body.outcome, "fail");
    assert.deepEqual(l1FirstSubmit.body.newAchievements, [], "a failing l1 first attempt earns nothing");

    // Restart l1 and every remaining level at a clean 100%.
    await masterLevel("l1", 9);
    await masterLevel("l2", 19);
    await masterLevel("l3", 21);
    const l4Submit = (await masterLevel("l4", 8)).submitted;

    assert.deepEqual(l4Submit.newAchievements, [], "l4 mastery must NOT earn BLS Expert when the l1 first attempt was only 3/9");

    const { body: ach } = await request("GET", "/play/achievements");
    const blsExpert = ach.achievements.find(a => a.key === "bls_expert");
    assert.equal(blsExpert.earned, false, "BLS Expert stays locked when first-contact accuracy is below the bar");
    assert.equal(blsExpert.earnedAt, null);
    assert.equal(blsExpert.progress.levelsWithFirstAttempt, 5, "all five levels still have a frozen first attempt");
    // Pooled first-attempt correct / total: (10 + 3 + 19 + 21 + 8) / (10 + 9 + 19 + 21 + 8) = 61/67
    const expected = Math.round((61 / 67) * 1000) / 10;
    assert.equal(blsExpert.progress.overallFirstAttemptAccuracy, expected, `pooled first-attempt accuracy must be ${expected}% (61/67), not the post-remediation 100%`);
    assert.ok(expected < 95 && expected > 90, "sanity: this scenario really is below the 95% bar");

    log(`BLS Expert correctly withheld: pooled first-attempt accuracy ${expected}% (61/67), not the post-remediation 100%`);
  } finally {
    process.env.DEV_PARTICIPANT_ID = savedDevId;
    await Response.deleteMany({ participantId: scratchParticipant._id });
    await Attempt.deleteMany({ participantId: scratchParticipant._id });
    await Participant.deleteOne({ _id: scratchParticipant._id });
  }
};

// Read-only level review (SPEC 2.6/2.7): every question from a submitted
// attempt, in clinical order, with stem + given + correct + feedback.
// Viewing it must write nothing and re-score nothing; time on it lands on
// attempt.reviewMs and NEVER on time-on-task; an in_progress attempt
// cannot be reviewed (no mid-level answer peeking).
const testLevelReview = async () => {
  const scratchParticipant = await Participant.create({ code: `E2E-REVIEW-${Date.now()}`, arm: "E", sessionId: session._id });
  const savedDevId = process.env.DEV_PARTICIPANT_ID;
  process.env.DEV_PARTICIPANT_ID = String(scratchParticipant._id);
  try {
    const created = await request("POST", "/play/attempts", { levelKey: "prelevel", kind: "first" });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const { attempt, questions } = created.body;
    await answerQuestions(attempt.attemptId, questions, questions.length - 2); // last two deliberately wrong
    const submit = await request("POST", `/play/attempts/${attempt.attemptId}/submit`);
    assert.equal(submit.status, 200, JSON.stringify(submit.body));
    assert.equal(submit.body.attempt.accuracy, 80);
    assert.equal(submit.body.outcome, "remediate");

    const before = await Attempt.findById(attempt.attemptId);
    const responsesBefore = await Response.countDocuments({ attemptId: attempt.attemptId });
    assert.equal(before.reviewMs, 0, "reviewMs starts at 0");

    const review = await request("GET", `/play/attempts/${attempt.attemptId}/review`);
    assert.equal(review.status, 200, JSON.stringify(review.body));
    assert.equal(review.body.items.length, 10, "review covers every question in the attempt");
    assert.deepEqual(review.body.items.map(i => i.sequence), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "review items stay in clinical order");
    for (const item of review.body.items) {
      assert.ok(item.prompt?.length > 0, "every review item carries the stem");
      assert.ok(item.feedbackText?.length > 0, "every review item carries the feedback text");
      assert.ok(item.given !== undefined && item.correct !== undefined, "every review item carries given and correct");
    }
    const missed = review.body.items.filter(i => i.isCorrect === false);
    const right = review.body.items.filter(i => i.isCorrect === true);
    assert.equal(missed.length, 2, "the two deliberately-wrong answers show as missed");
    assert.equal(right.length, 8);
    for (const item of missed) assert.notEqual(item.given.selected, item.correct.correct, "a missed item's given answer differs from the correct answer");
    for (const item of right) assert.equal(item.given.selected, item.correct.correct, "a correct item's given answer matches the correct answer");

    // Viewing the review writes nothing and re-scores nothing.
    const afterReview = await Attempt.findById(attempt.attemptId);
    assert.equal(await Response.countDocuments({ attemptId: attempt.attemptId }), responsesBefore, "GET /review writes no responses");
    assert.equal(afterReview.score, before.score, "GET /review does not re-score");
    assert.equal(afterReview.accuracy, before.accuracy);
    assert.equal(afterReview.status, before.status);

    // review-time accumulates onto reviewMs only, never onto time-on-task.
    assert.equal((await request("POST", `/play/attempts/${attempt.attemptId}/review-time`, { ms: 4200 })).body.attempt.reviewMs, 4200);
    assert.equal((await request("POST", `/play/attempts/${attempt.attemptId}/review-time`, { ms: 800 })).body.attempt.reviewMs, 5000, "review-time accumulates across visits");
    const afterReviewTime = await Attempt.findById(attempt.attemptId);
    assert.equal(afterReviewTime.reviewMs, 5000);
    assert.equal(afterReviewTime.activeMs, before.activeMs, "reviewMs must not touch activeMs (time-on-task)");
    assert.equal(afterReviewTime.hiddenMs, before.hiddenMs, "reviewMs must not touch hiddenMs");
    assert.equal(afterReviewTime.score, before.score);
    assert.equal(await Response.countDocuments({ attemptId: attempt.attemptId }), responsesBefore, "review-time writes no responses");
    assert.equal((await request("POST", `/play/attempts/${attempt.attemptId}/review-time`, { ms: -5 })).status, 400, "negative review time is rejected");

    // An in_progress attempt cannot be reviewed — no mid-level answer peeking.
    const remediation = await request("POST", "/play/attempts", { levelKey: "prelevel", kind: "remediation" });
    assert.equal(remediation.status, 201, JSON.stringify(remediation.body));
    const liveReview = await request("GET", `/play/attempts/${remediation.body.attempt.attemptId}/review`);
    assert.equal(liveReview.status, 409, "an in_progress attempt must not be reviewable");

    log("level review OK: full attempt in order, read-only (no writes, no re-score), reviewMs isolated from time-on-task, in_progress refused");
  } finally {
    process.env.DEV_PARTICIPANT_ID = savedDevId;
    await Response.deleteMany({ participantId: scratchParticipant._id });
    await Attempt.deleteMany({ participantId: scratchParticipant._id });
    await Participant.deleteOne({ _id: scratchParticipant._id });
  }
};

// The seventh type. The seed's only hotspot_video (l2:18) is a draft stub
// (SPEC 13: hotspot coordinates can't be authored until the clip exists),
// so it is never served through normal play — and a test must never touch
// a document the study will use, so flipping that stub's status is out.
// Instead this stands up its own throwaway published hotspot_video under
// l2, plays it, and deletes it again. hotspot_video is scored exactly
// like the mcq family — given.selected vs question.correct, via the
// fallback option list (SPEC 3.5) — and this proves that path.
const testHotspotVideoScored = async () => {
  const l2 = await Level.findOne({ key: "l2", deletedAt: null });
  assert.ok(l2, "seed data missing: l2 level not found");

  // Clear any leftover from a previous hard-killed run before inserting.
  await Question.deleteMany({ levelKey: SCRATCH_QUESTION_LEVEL_KEY, sequence: SCRATCH_QUESTION_SEQUENCE });

  const scratchParticipant = await Participant.create({ code: `E2E-HOTSPOT-${Date.now()}`, arm: "E", sessionId: session._id });
  const savedDevId = process.env.DEV_PARTICIPANT_ID;
  process.env.DEV_PARTICIPANT_ID = String(scratchParticipant._id);
  let scratchQuestion;
  try {
    scratchQuestion = await Question.create({
      levelId: l2._id,
      levelKey: SCRATCH_QUESTION_LEVEL_KEY,
      sequence: SCRATCH_QUESTION_SEQUENCE,
      type: "hotspot_video",
      title: "[e2e-scratch] hotspot_video",
      objective: l2.objectives[0],
      prompt: "Which CPR component is incorrect? (e2e scratch item)",
      media: { videoUrl: "https://example.test/e2e-scratch.mp4", gateOnFirstPlay: true },
      fallbackText: "Fallback option list stands in for the clip in this e2e scratch item.",
      hotspots: [{ tStart: 2, tEnd: 5, x: 0.5, y: 0.5, r: 0.1, isError: true, label: "depth" }],
      options: [
        { key: "A", text: "Rate is correct" },
        { key: "B", text: "Depth is too shallow" },
        { key: "C", text: "Recoil is complete" },
        { key: "D", text: "Hand position is correct" }
      ],
      correct: "B",
      feedback: { text: "Scratch feedback for the e2e hotspot_video item." },
      points: 120,
      status: "published",
      version: 1
    });

    await masterLevel("prelevel", 10);
    await masterLevel("l1", 9);

    const created = await request("POST", "/play/attempts", { levelKey: "l2", kind: "first" });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const { attempt, questions } = created.body;
    assert.equal(questions.length, 20, "l2 serves 19 published + the one scratch hotspot_video question");
    const hotspot = questions.find(q => q.type === "hotspot_video");
    assert.ok(hotspot, "the scratch hotspot_video question must be served");
    assert.equal(hotspot.questionId, String(scratchQuestion._id), "the served hotspot must be the scratch question, not the real l2:18 stub");

    await answerQuestions(attempt.attemptId, questions, questions.length);
    const submitted = await request("POST", `/play/attempts/${attempt.attemptId}/submit`);
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.equal(submitted.body.outcome, "mastered");

    const hotspotResponse = await Response.findOne({ attemptId: attempt.attemptId, questionId: hotspot.questionId });
    assert.ok(hotspotResponse, "the hotspot_video answer must have been recorded as a response");
    assert.equal(hotspotResponse.isCorrect, true, "the server must have scored the hotspot_video answer correct");

    // The real seeded stub was never touched.
    const realStub = await Question.findOne({ levelKey: "l2", sequence: 18 });
    assert.equal(realStub.status, "draft", "the real l2:18 hotspot_video stub must still be draft — the test must not have touched it");

    log("hotspot_video scored end-to-end on a throwaway question (created and deleted, real l2:18 stub untouched)");
  } finally {
    if (scratchQuestion) await Question.deleteOne({ _id: scratchQuestion._id });
    await Question.deleteMany({ levelKey: SCRATCH_QUESTION_LEVEL_KEY, sequence: SCRATCH_QUESTION_SEQUENCE });
    process.env.DEV_PARTICIPANT_ID = savedDevId;
    await Response.deleteMany({ participantId: scratchParticipant._id });
    await Attempt.deleteMany({ participantId: scratchParticipant._id });
    await Participant.deleteOne({ _id: scratchParticipant._id });
  }
};

// Real sign-in path (CLAUDE.md Auth model / SPEC 6.3), exercised through
// the actual API rather than the DEV_PARTICIPANT_ID bypass every other
// test in this file uses: first sign-in forks into setting a PIN, a wrong
// PIN is rejected, five wrong PINs locks the code for a cool-down window,
// and a second sign-in replaces the first device's session — the same
// activeJti mechanism an instant kick will later reuse (CLAUDE.md).
const testRealSignInPath = async () => {
  const code = `E2E-AUTH-${Date.now()}`;
  const scratchParticipant = await Participant.create({ code, arm: "E", sessionId: session._id });
  try {
    // First sign-in: no PIN set yet, code alone forks into "set a PIN" —
    // identity was already verified in person when the slip was handed
    // out (CLAUDE.md), so the code is the only credential needed here.
    const firstLogin = await request("POST", "/auth/play/login", { code });
    assert.equal(firstLogin.status, 200, JSON.stringify(firstLogin.body));
    assert.equal(firstLogin.body.needsPin, true);

    const setPinWrongFormat = await request("POST", "/auth/play/set-pin", { code, pin: "12" });
    assert.equal(setPinWrongFormat.status, 400, "a non-4-digit pin must be rejected");

    const setPin = await request("POST", "/auth/play/set-pin", { code, pin: "1234" });
    assert.equal(setPin.status, 200, JSON.stringify(setPin.body));
    assert.ok(setPin.body.token, "set-pin must issue a token, same as a successful login");
    const firstToken = setPin.body.token;

    const cannotSetAgain = await request("POST", "/auth/play/set-pin", { code, pin: "5678" });
    assert.equal(cannotSetAgain.status, 409, "set-pin must refuse once a PIN already exists");

    // The real token actually authenticates a real /play route — not the
    // DEV_PARTICIPANT_ID bypass every other test in this file relies on.
    const levelsWithToken = await request("GET", "/play/levels", undefined, { token: firstToken });
    assert.equal(levelsWithToken.status, 200, JSON.stringify(levelsWithToken.body));
    assert.equal(levelsWithToken.body.levels.find(l => l.key === "prelevel").state, "active");

    const me = await request("GET", "/auth/me", undefined, { token: firstToken });
    assert.equal(me.status, 200);
    assert.equal(me.body.aud, "play");
    assert.equal(me.body.participant.code, code);

    // A second sign-in replaces activeJti — the first token is superseded.
    const secondLogin = await request("POST", "/auth/play/login", { code, pin: "1234" });
    assert.equal(secondLogin.status, 200, JSON.stringify(secondLogin.body));
    assert.equal(secondLogin.body.signedOutOtherDevice, true, "a second sign-in must flag that it replaced a live session");
    const secondToken = secondLogin.body.token;
    assert.notEqual(secondToken, firstToken);

    const firstTokenNowRejected = await request("GET", "/play/levels", undefined, { token: firstToken });
    assert.equal(firstTokenNowRejected.status, 401, "the superseded first token must be rejected once a second device has signed in");
    assert.equal(firstTokenNowRejected.body.error.code, "SESSION_SUPERSEDED");

    const secondTokenWorks = await request("GET", "/play/levels", undefined, { token: secondToken });
    assert.equal(secondTokenWorks.status, 200, "the new token from the second sign-in must work");

    log("real sign-in path OK: set-pin issues a token, a second sign-in supersedes the first device's token");
  } finally {
    await Attempt.deleteMany({ participantId: scratchParticipant._id });
    await Participant.deleteOne({ _id: scratchParticipant._id });
  }

  // --- Separate participant for the lockout guard, so it starts clean.
  const lockCode = `E2E-LOCK-${Date.now()}`;
  const lockParticipant = await Participant.create({ code: lockCode, arm: "E", sessionId: session._id });
  try {
    await request("POST", "/auth/play/set-pin", { code: lockCode, pin: "1111" });

    let lastResult;
    for (let attempt = 1; attempt <= 5; attempt++) {
      lastResult = await request("POST", "/auth/play/login", { code: lockCode, pin: "0000" }); // always wrong
      if (attempt < 5) assert.equal(lastResult.status, 401, `attempt ${attempt}: still just a wrong PIN, not locked yet`);
    }
    assert.equal(lastResult.status, 423, "the 5th consecutive wrong PIN must lock the code");
    assert.equal(lastResult.body.error.code, "PARTICIPANT_LOCKED");

    const lockedEvenWithRightPin = await request("POST", "/auth/play/login", { code: lockCode, pin: "1111" });
    assert.equal(lockedEvenWithRightPin.status, 423, "the code must stay locked even against the correct PIN until the lock window passes");

    const refreshed = await Participant.findById(lockParticipant._id);
    assert.ok(refreshed.lockedUntil > new Date(), "lockedUntil must be set roughly ten minutes out");
    assert.equal(refreshed.failedPinCount, 0, "failedPinCount resets once the lock itself is set");

    log("five wrong PINs correctly locked the code for the cool-down window, even against the right PIN");
  } finally {
    await Participant.deleteOne({ _id: lockParticipant._id });
  }
};

// The non-negotiable rule (CLAUDE.md): a token's audience is checked
// FIRST, before role or anything else — a participant token must never
// satisfy an admin route, and an admin token must never satisfy a play
// route. Both directions, with real tokens from real sign-in, not the
// DEV_*_ID bypass.
const testTokenAudienceGuard = async () => {
  const code = `E2E-AUD-${Date.now()}`;
  const scratchParticipant = await Participant.create({ code, arm: "E", sessionId: session._id });
  try {
    const setPin = await request("POST", "/auth/play/set-pin", { code, pin: "2468" });
    assert.equal(setPin.status, 200, JSON.stringify(setPin.body));
    const participantToken = setPin.body.token;

    const adminLogin = await request("POST", "/auth/admin/login", { email: admin.email, password: TEST_ADMIN_PASSWORD });
    assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.body));
    const adminToken = adminLogin.body.token;

    const participantTokenOnAdminRoute = await request(
      "GET",
      `/admin/records/trail?participantId=${participant._id}&levelKey=l1`,
      undefined,
      { token: participantToken }
    );
    assert.equal(participantTokenOnAdminRoute.status, 401, "a participant token must never satisfy an admin route");
    assert.equal(participantTokenOnAdminRoute.body.error.code, "WRONG_AUDIENCE");

    const adminTokenOnPlayRoute = await request("GET", "/play/levels", undefined, { token: adminToken });
    assert.equal(adminTokenOnPlayRoute.status, 401, "an admin token must never satisfy a play route");
    assert.equal(adminTokenOnPlayRoute.body.error.code, "WRONG_AUDIENCE");

    log("token audience guard OK: participant token rejected on admin route, admin token rejected on play route");
  } finally {
    await Participant.deleteOne({ _id: scratchParticipant._id });
  }
};

const printResultingDocuments = async () => {
  const attempts = await Attempt.find({ _id: { $in: createdAttemptIds } }).lean();
  const responses = await Response.find({ attemptId: { $in: createdAttemptIds } }).lean();
  console.log("\n=== Attempt documents ===");
  console.log(JSON.stringify(attempts, null, 2));
  console.log("\n=== Response documents (count only) ===");
  console.log(responses.length);
};

const run = async () => {
  await setup();
  try {
    await testLevelsInitialState();
    await testCleanFirstTryMastery();
    await testNoMidLevelRestart();
    await testConcurrentAttemptCreationNoDuplicateKey();
    await testStaleAttemptCountAfterWinnerAlreadySubmitted();
    await testFailRestartThenRemediateToMastery();
    await testIntegrityGuards();
    await testMeRecords();
    await testAdminTrail();
    await testEveryLevelAndQuestionType();
    await testBlsExpertMeasuresFirstAttemptOnly();
    await testLevelReview();
    await testHotspotVideoScored();
    await testRealSignInPath();
    await testTokenAudienceGuard();
    await printResultingDocuments();
    log("ALL CHECKS PASSED");
  } finally {
    await teardown();
  }
};

run().catch(async error => {
  console.error("[e2e-play] FAILED:", error);
  process.exitCode = 1;
  try {
    await teardown();
  } catch {
    // best-effort cleanup after a failure
  }
});
