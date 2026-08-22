// Step 2a end-to-end check for the gameplay API. Exercises the real HTTP
// routes (never calls scoring.js directly) against a throwaway participant
// and session, using seeded prelevel/l1 content. Requires `npm run seed`
// to have been run against MONGODB_URI first.
//
// Usage: node scripts/e2e-play.js   (or: npm run test:play --workspace server)

import assert from "node:assert/strict";
import { connectDB, disconnectDB } from "../server/src/db.js";
import { createApp } from "../server/src/app.js";
import Level from "../server/src/models/Level.js";
import Question from "../server/src/models/Question.js";
import Session from "../server/src/models/Session.js";
import Participant from "../server/src/models/Participant.js";
import Attempt from "../server/src/models/Attempt.js";
import Response from "../server/src/models/Response.js";

const log = (...args) => console.log("[e2e-play]", ...args);

const correctGivenFor = question => {
  if (question.type === "drag_drop") {
    return { placements: Object.fromEntries(question.items.map(item => [item.id, item.bucket])) };
  }
  if (question.type === "sequence") {
    return { order: [...question.correctOrder] };
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
    return { order: [...order.slice(1), order[0]] }; // cyclic shift: fixed-point-free for distinct ids
  }
  const wrongKey = question.options.map(o => o.key).find(k => k !== question.correct);
  return { selected: wrongKey };
};

let server;
let baseUrl;
let participant;
let session;
const createdAttemptIds = [];

const request = async (method, path, body) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
};

const answerAllQuestions = async (attemptId, questions, correctCount) => {
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

const setup = async () => {
  await connectDB();

  const prelevel = await Level.findOne({ key: "prelevel", deletedAt: null });
  const l1 = await Level.findOne({ key: "l1", deletedAt: null });
  assert.ok(prelevel && l1, "seed data missing: run `npm run seed` first");

  session = await Session.create({
    mode: "open",
    capacity: 1,
    levelKeys: ["prelevel", "l1", "l2"],
    showTimer: true
  });

  participant = await Participant.create({
    code: `E2E-${Date.now()}`,
    arm: "E",
    sessionId: session._id
  });

  process.env.DEV_PARTICIPANT_ID = String(participant._id);

  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  log(`server up on ${baseUrl}, participant ${participant.code}`);
};

const teardown = async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (participant) {
    await Response.deleteMany({ participantId: participant._id });
    await Attempt.deleteMany({ participantId: participant._id });
    await Participant.deleteOne({ _id: participant._id });
  }
  if (session) await Session.deleteOne({ _id: session._id });
  await disconnectDB();
};

const testLevelsInitialState = async () => {
  const { status, body } = await request("GET", "/play/levels");
  assert.equal(status, 200);
  const prelevel = body.levels.find(l => l.key === "prelevel");
  const l1 = body.levels.find(l => l.key === "l1");
  assert.equal(prelevel.state, "active", "prelevel must be active with no attempts yet");
  assert.equal(l1.state, "locked", "l1 must be locked until prelevel is passed");
  log("GET /play/levels initial state OK");
};

const testPassPrelevel = async () => {
  const created = await request("POST", "/play/attempts", { levelKey: "prelevel", kind: "first" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const { attempt, questions } = created.body;
  createdAttemptIds.push(attempt.attemptId);
  assert.equal(questions.length, 10);
  for (const q of questions) assert.equal(q.correct, undefined, "player payload must never include the answer key");

  await answerAllQuestions(attempt.attemptId, questions, questions.length);

  const submitted = await request("POST", `/play/attempts/${attempt.attemptId}/submit`);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.attempt.passed, true);
  assert.equal(submitted.body.attempt.accuracy, 100);
  assert.equal(submitted.body.attempt.starsAwarded, 3);
  assert.equal(submitted.body.remediation.required, false);
  assert.equal(submitted.body.unlockedNextLevelKey, "l1");
  log(`prelevel passed: score=${submitted.body.attempt.score} stars=${submitted.body.attempt.starsAwarded}`);

  const doubleSubmit = await request("POST", `/play/attempts/${attempt.attemptId}/submit`);
  assert.equal(doubleSubmit.status, 409, "resubmitting a submitted attempt must be refused");

  const { body: levels } = await request("GET", "/play/levels");
  assert.equal(levels.levels.find(l => l.key === "prelevel").state, "complete");
  assert.equal(levels.levels.find(l => l.key === "l1").state, "active");
  log("GET /play/levels after pass: l1 unlocked OK");
};

const testFailAndRemediateL1 = async () => {
  const created = await request("POST", "/play/attempts", { levelKey: "l1", kind: "first" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const { attempt, questions } = created.body;
  createdAttemptIds.push(attempt.attemptId);
  assert.equal(questions.length, 9, "l1 Q9 is a draft stub and must not be served");

  // Only the first item correct -> well under the 80% pass mark.
  await answerAllQuestions(attempt.attemptId, questions, 1);

  const submitted = await request("POST", `/play/attempts/${attempt.attemptId}/submit`);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.attempt.passed, false);
  assert.equal(submitted.body.attempt.starsAwarded, 0);
  assert.equal(submitted.body.remediation.required, true);
  assert.equal(submitted.body.remediation.questionIds.length, questions.length - 1);
  assert.equal(submitted.body.unlockedNextLevelKey, null);
  log(`l1 failed as expected: accuracy=${submitted.body.attempt.accuracy}% remediation items=${submitted.body.remediation.questionIds.length}`);

  const { body: levelsAfterFail } = await request("GET", "/play/levels");
  assert.equal(levelsAfterFail.levels.find(l => l.key === "l1").state, "failed");

  const remediationCreated = await request("POST", "/play/attempts", { levelKey: "l1", kind: "remediation" });
  assert.equal(remediationCreated.status, 201, JSON.stringify(remediationCreated.body));
  const remediationAttempt = remediationCreated.body.attempt;
  const remediationQuestions = remediationCreated.body.questions;
  createdAttemptIds.push(remediationAttempt.attemptId);
  assert.equal(remediationQuestions.length, submitted.body.remediation.questionIds.length, "remediation must serve exactly the missed items");
  const remediationIds = new Set(remediationQuestions.map(q => q.questionId));
  for (const id of submitted.body.remediation.questionIds) assert.ok(remediationIds.has(id));

  await answerAllQuestions(remediationAttempt.attemptId, remediationQuestions, remediationQuestions.length);
  const remediationSubmitted = await request("POST", `/play/attempts/${remediationAttempt.attemptId}/submit`);
  assert.equal(remediationSubmitted.status, 200, JSON.stringify(remediationSubmitted.body));
  assert.equal(remediationSubmitted.body.attempt.passed, true);
  assert.equal(remediationSubmitted.body.attempt.starsAwarded, 1, "remediation pass always awards exactly one star");
  assert.equal(remediationSubmitted.body.unlockedNextLevelKey, "l2");
  log(`l1 remediation passed: stars=${remediationSubmitted.body.attempt.starsAwarded}`);

  const { body: levelsAfterRemediation } = await request("GET", "/play/levels");
  const l1Final = levelsAfterRemediation.levels.find(l => l.key === "l1");
  assert.equal(l1Final.state, "complete");
  assert.equal(l1Final.starsAwarded, 1);
  assert.equal(levelsAfterRemediation.levels.find(l => l.key === "l2").state, "active");
  log("GET /play/levels after remediation: l1 complete, l2 unlocked OK");
};

const testIntegrityGuards = async () => {
  const noRemediation = await request("POST", "/play/attempts", { levelKey: "l1", kind: "remediation" });
  assert.equal(noRemediation.status, 400, "remediation must be refused once nothing is missed");

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

  log("integrity guards OK (no remediation when nothing missed, incomplete submit blocked, bad shape blocked, records scoped per participant)");
};

const printResultingDocuments = async () => {
  const attempts = await Attempt.find({ _id: { $in: createdAttemptIds } }).lean();
  const responses = await Response.find({ attemptId: { $in: createdAttemptIds } }).lean();
  console.log("\n=== Attempt documents ===");
  console.log(JSON.stringify(attempts, null, 2));
  console.log("\n=== Response documents ===");
  console.log(JSON.stringify(responses, null, 2));
};

const testMeRecords = async () => {
  const { status, body } = await request("GET", "/play/me/records");
  assert.equal(status, 200);
  assert.ok(body.records.length >= 3, "should have prelevel, l1(failed), l1(remediation) at least");
  assert.ok(body.records.every(r => typeof r.score === "number"));
  log(`GET /play/me/records: ${body.records.length} record(s) OK`);
};

const run = async () => {
  await setup();
  try {
    await testLevelsInitialState();
    await testPassPrelevel();
    await testFailAndRemediateL1();
    await testIntegrityGuards();
    await testMeRecords();
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
