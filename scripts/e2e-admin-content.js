// End-to-end check for the admin question bank and builder (docs/SPEC.md
// 4.2-4.6, 4.8). Runs entirely against a SCRATCH level and scratch
// questions/admins created here and deleted in teardown — nothing in this
// file ever reads, writes, or reorders a real seeded question (mirrors
// e2e-play.js's testHotspotVideoScored pattern).
//
// Usage: node scripts/e2e-admin-content.js  (or: npm run test:admin-content --workspace server)

import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../server/src/db.js";
import { createApp } from "../server/src/app.js";
import Level from "../server/src/models/Level.js";
import Question from "../server/src/models/Question.js";
import Admin from "../server/src/models/Admin.js";
import Participant from "../server/src/models/Participant.js";
import Session from "../server/src/models/Session.js";
import Attempt from "../server/src/models/Attempt.js";
import Response from "../server/src/models/Response.js";
import AuditLog from "../server/src/models/AuditLog.js";
import { hashSecret, signParticipantToken, newJti } from "../server/src/services/auth.js";
import { aggregateAttempt } from "../server/src/services/scoring.js";
import { ROLES } from "../shared/constants.js";

const log = (...args) => console.log("[e2e-admin-content]", ...args);

process.env.ALLOW_DEV_AUTH_BYPASS = "true";

const SCRATCH_LEVEL_KEY = `e2e-admin-content-${Date.now()}`;
const OBJECTIVE_A = "Scratch objective A";
const OBJECTIVE_B = "Scratch objective B";

let server;
let baseUrl;
let scratchLevel;
let superAdmin;
let plainAdmin;
let matrixParticipant;
const superAdminPassword = "e2e-super-password-123";
const plainAdminPassword = "e2e-plain-password-123";
const createdQuestionIds = [];

// Records-and-analytics fixture: a scratch session + level + questions +
// participants + hand-built attempts and responses, all tagged and torn
// down here. Everything in /admin/records is scoped by session id in the
// tests, so it never mixes with any other data in the database.
const records = { session: null, level: null, participantIds: [], attemptIds: [], questionIds: [] };

// Participant-management fixture (SPEC 6): a scratch session, ten
// generated codes with roster labels, and a scratch attempt so the "no
// label reaches any export" check has real rows to scan.
const people = { session: null, level: null, participantCodePrefix: "E2EPM", attemptIds: [], questionId: null, labels: [], defaultSessionId: null };

const request = async (method, path, body, { token } = {}) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
};

// The suite's other tests all lean on DEV_ADMIN_ID (no token, bypass) so a
// plain header-less request resolves as super_admin by default; the two
// role-gated tests below need REAL tokens for a real super_admin and a
// real plain admin specifically, so they get their own explicit sign-ins.
const adminToken = async (email, password) => {
  const { status, body } = await request("POST", "/auth/admin/login", { email, password });
  assert.equal(status, 200, `admin login for ${email} must succeed: ${JSON.stringify(body)}`);
  return body.token;
};

const setup = async () => {
  await connectDB();

  scratchLevel = await Level.create({
    key: SCRATCH_LEVEL_KEY,
    order: 999,
    title: "E2E scratch level",
    scene: "Test bench",
    role: "Tester",
    objectives: [OBJECTIVE_A, OBJECTIVE_B],
    passMark: 80,
    badge: null,
    status: "published"
  });

  superAdmin = await Admin.create({
    email: `e2e-admin-content-super-${Date.now()}@example.test`,
    passwordHash: await hashSecret(superAdminPassword),
    name: "E2E Super Admin",
    role: ROLES.SUPER_ADMIN
  });
  plainAdmin = await Admin.create({
    email: `e2e-admin-content-plain-${Date.now()}@example.test`,
    passwordHash: await hashSecret(plainAdminPassword),
    name: "E2E Plain Admin",
    role: ROLES.ADMIN
  });

  process.env.DEV_ADMIN_ID = String(superAdmin._id);

  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  log(`server up on ${baseUrl}, scratch level ${SCRATCH_LEVEL_KEY}`);
};

const teardown = async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (createdQuestionIds.length) await Question.deleteMany({ _id: { $in: createdQuestionIds } });
  await Question.deleteMany({ levelKey: SCRATCH_LEVEL_KEY });
  if (scratchLevel) await Level.deleteOne({ _id: scratchLevel._id });
  if (superAdmin) {
    await AuditLog.deleteMany({ actorId: superAdmin._id });
    await Admin.deleteOne({ _id: superAdmin._id });
  }
  if (plainAdmin) await Admin.deleteOne({ _id: plainAdmin._id });
  if (matrixParticipant) await Participant.deleteOne({ _id: matrixParticipant._id });

  if (records.attemptIds.length) await Response.deleteMany({ attemptId: { $in: records.attemptIds } });
  if (records.attemptIds.length) await Attempt.deleteMany({ _id: { $in: records.attemptIds } });
  if (records.participantIds.length) await Participant.deleteMany({ _id: { $in: records.participantIds } });
  if (records.questionIds.length) await Question.deleteMany({ _id: { $in: records.questionIds } });
  if (records.level) await Level.deleteOne({ _id: records.level._id });
  if (records.session) await Session.deleteOne({ _id: records.session._id });

  if (people.attemptIds.length) await Response.deleteMany({ attemptId: { $in: people.attemptIds } });
  if (people.attemptIds.length) await Attempt.deleteMany({ _id: { $in: people.attemptIds } });
  await Participant.deleteMany({ code: new RegExp(`^${people.participantCodePrefix}-`) });
  if (people.questionId) await Question.deleteOne({ _id: people.questionId });
  if (people.level) await Level.deleteOne({ _id: people.level._id });
  if (people.session) await Session.deleteOne({ _id: people.session._id });
  if (people.defaultSessionId) await Session.deleteOne({ _id: people.defaultSessionId });

  await disconnectDB();
};

// One representative, VALID draft payload per SPEC 3 shape.
const DRAFTS_BY_TYPE = {
  mcq: {
    type: "mcq",
    title: "Scratch mcq",
    objective: OBJECTIVE_A,
    prompt: "Which is correct?",
    points: 100,
    options: [{ key: "A", text: "Right" }, { key: "B", text: "Wrong" }],
    correct: "A",
    feedback: { text: "Because A." }
  },
  video_mcq: {
    type: "video_mcq",
    title: "Scratch video_mcq",
    objective: OBJECTIVE_A,
    prompt: "What happens in the clip?",
    points: 100,
    options: [{ key: "A", text: "Right" }, { key: "B", text: "Wrong" }],
    correct: "A",
    media: { videoUrl: "https://example.test/clip.mp4", gateOnFirstPlay: true },
    fallbackText: "A child collapses.",
    feedback: { text: "Because A." }
  },
  animation_mcq: {
    type: "animation_mcq",
    title: "Scratch animation_mcq",
    objective: OBJECTIVE_A,
    prompt: "What does the animation show?",
    points: 100,
    options: [{ key: "A", text: "Right" }, { key: "B", text: "Wrong" }],
    correct: "A",
    media: { riveSrc: "https://example.test/scene.riv", loop: true },
    fallbackText: "An animation of the heart.",
    feedback: { text: "Because A." }
  },
  drag_drop: {
    type: "drag_drop",
    title: "Scratch drag_drop",
    objective: OBJECTIVE_A,
    prompt: "Sort each item.",
    points: 100,
    items: [{ id: "i1", text: "Item 1", bucket: "b1" }, { id: "i2", text: "Item 2", bucket: "b2" }],
    buckets: [{ key: "b1", label: "Bucket 1" }, { key: "b2", label: "Bucket 2" }],
    feedback: { text: "Sorted." }
  },
  sequence: {
    type: "sequence",
    title: "Scratch sequence",
    objective: OBJECTIVE_A,
    prompt: "Put these in order.",
    points: 100,
    items: [{ id: "s1", text: "Step 1" }, { id: "s2", text: "Step 2" }],
    correctOrder: ["s1", "s2"],
    feedback: { text: "In order." }
  },
  split_screen: {
    type: "split_screen",
    title: "Scratch split_screen",
    objective: OBJECTIVE_A,
    prompt: "Which rescuer is correct?",
    points: 100,
    options: [{ key: "A", text: "Rescuer A" }, { key: "B", text: "Rescuer B" }],
    correct: "B",
    media: { videoUrl: "https://example.test/a.mp4", videoUrlB: "https://example.test/b.mp4" },
    sides: [{ label: "Rescuer A", parameters: ["too slow"] }, { label: "Rescuer B", parameters: ["correct rate"] }],
    fallbackText: "A is too slow, B is correct.",
    feedback: { text: "B is correct." }
  },
  hotspot_video: {
    type: "hotspot_video",
    title: "Scratch hotspot_video",
    objective: OBJECTIVE_A,
    prompt: "Tap the error.",
    points: 100,
    options: [{ key: "A", text: "Depth" }, { key: "B", text: "Rate" }],
    correct: "A",
    media: { videoUrl: "https://example.test/h.mp4", durationSeconds: 10, gateOnFirstPlay: true },
    hotspots: [{ tStart: 2, tEnd: 5, x: 0.5, y: 0.5, r: 0.1, isError: true, label: "depth" }],
    fallbackText: "The compressions are too shallow.",
    feedback: { text: "Depth was the error." }
  },
  interlude: {
    type: "interlude",
    title: "Scratch interlude",
    objective: OBJECTIVE_A,
    prompt: "Watch what happens next.",
    points: 999, // deliberately non-zero — sanitizeQuestionForType must force this to 0 regardless
    media: { videoUrl: "https://example.test/i-a.mp4", videoUrlB: "https://example.test/i-b.mp4" },
    fallbackText: "Two paramedics arrive and take over care.",
    feedback: { text: "" } // deliberately empty — interlude gets a fixed placeholder instead, never blocks publish
  }
};

const createDraft = async (type, overrides = {}) => {
  const payload = { ...DRAFTS_BY_TYPE[type], ...overrides, levelKey: SCRATCH_LEVEL_KEY };
  const { status, body } = await request("POST", "/admin/questions", payload);
  assert.equal(status, 201, `creating a ${type} draft must succeed: ${JSON.stringify(body)}`);
  createdQuestionIds.push(body.question.questionId);
  return body.question;
};

const testCreateAllSevenTypesAsDrafts = async () => {
  for (const type of Object.keys(DRAFTS_BY_TYPE)) {
    const question = await createDraft(type);
    assert.equal(question.status, "draft");
    assert.equal(question.type, type);
    assert.equal(question.version, 1);
  }
  log(`all ${Object.keys(DRAFTS_BY_TYPE).length} question types created as drafts OK`);
};

const testPublishValid = async () => {
  const question = await createDraft("mcq", { title: "Scratch mcq to publish" });
  const { status, body } = await request("PATCH", `/admin/questions/${question.questionId}`, { ...question, status: "published" });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.question.status, "published");

  const auditRow = await AuditLog.findOne({ "target.id": question.questionId }).sort({ at: -1 });
  assert.ok(auditRow, "publishing must write an auditlog row");
  assert.equal(auditRow.action, "question_updated");
  log("publish of a valid mcq draft OK, audit row written");
};

const testPublishInvalidNamesFailures = async () => {
  // Missing a correct answer AND only one option AND no objective.
  const question = await createDraft("mcq", { objective: "not a real objective" });
  const { status, body } = await request("PATCH", `/admin/questions/${question.questionId}`, {
    ...question,
    options: [{ key: "A", text: "Only one" }],
    correct: null,
    objective: "not a real objective",
    status: "published"
  });
  assert.equal(status, 422, JSON.stringify(body));
  const failures = JSON.parse(body.error.message);
  assert.ok(Array.isArray(failures) && failures.length >= 3, `expected several named failures, got ${JSON.stringify(failures)}`);
  assert.ok(failures.some(f => /correct answer/i.test(f)), "must name the missing-correct-answer failure");
  assert.ok(failures.some(f => /at least two options/i.test(f)), "must name the too-few-options failure");
  assert.ok(failures.some(f => /objective/i.test(f)), "must name the invalid-objective failure");

  const stillDraft = await Question.findById(question.questionId);
  assert.equal(stillDraft.status, "draft", "a failed publish must leave the question exactly as it was, still draft");
  log(`invalid publish correctly refused and named ${failures.length} failures: ${failures.join(" | ")}`);
};

const testFallbackTextRequiredWithMedia = async () => {
  const question = await createDraft("video_mcq", { fallbackText: null });
  const { status, body } = await request("PATCH", `/admin/questions/${question.questionId}`, { ...question, fallbackText: null, status: "published" });
  assert.equal(status, 422, JSON.stringify(body));
  const failures = JSON.parse(body.error.message);
  assert.ok(failures.some(f => /fallbackText/i.test(f)), "must name the missing-fallbackText failure when media is attached");
  log("fallbackText-required-with-media check OK");
};

const testInterludeIsUnscored = async () => {
  // Blank feedback.text and an over-large points value — both must be
  // silently corrected by the sanitizer, never block or need fixing by
  // the admin (SPEC 3.8 / 4.4 checks 6 and 9).
  const question = await createDraft("interlude", { title: "Interlude publish" });
  const publish = await request("PATCH", `/admin/questions/${question.questionId}`, { ...question, status: "published" });
  assert.equal(publish.status, 200, JSON.stringify(publish.body));
  assert.equal(publish.body.question.points, 0, "interlude points must be forced to 0 regardless of what was submitted");
  assert.match(publish.body.question.feedback?.text || "", /interlude/i, "a blank feedback.text must get the fixed placeholder, not block publish");

  // Missing one of the two mandatory clips must fail check 9, by name.
  const oneClip = await createDraft("interlude", { title: "Interlude missing a clip", media: { videoUrl: "https://example.test/only-one.mp4" } });
  const rejected = await request("PATCH", `/admin/questions/${oneClip.questionId}`, { ...oneClip, status: "published" });
  assert.equal(rejected.status, 422, JSON.stringify(rejected.body));
  const failures = JSON.parse(rejected.body.error.message);
  assert.ok(failures.some(f => /both video urls/i.test(f)), "must name the missing-second-clip failure for an interlude");

  log("interlude OK: unscored (points forced to 0), no feedback.text required, both clips required to publish");
};

// aggregateAttempt is a pure function — no DB, no HTTP. Fixture: an
// interlude first, then one correct mcq, then one wrong mcq, ordered by
// answeredAt exactly as scored. If the interlude were (wrongly) counted
// as a third, always-correct question, accuracy would read 66.67%
// instead of the true 50% (1 of the 2 REAL questions), and its
// always-true response would seed a streak of 2 by question 2 — an
// undeserved +10 streak bonus neither real answer earned on its own.
const testInterludeExcludedFromScoring = () => {
  const questions = [
    { _id: "q-interlude", type: "interlude", points: 0 },
    { _id: "q1", type: "mcq", points: 100 },
    { _id: "q2", type: "mcq", points: 100 }
  ];
  const base = Date.parse("2026-01-01T00:00:00.000Z");
  const responses = [
    { questionId: "q-interlude", isCorrect: true, partialScore: 0, shownAt: new Date(base), answeredAt: new Date(base + 1000), hiddenMs: 0 },
    { questionId: "q1", isCorrect: true, partialScore: 100, shownAt: new Date(base + 2000), answeredAt: new Date(base + 5000), hiddenMs: 0 },
    { questionId: "q2", isCorrect: false, partialScore: 0, shownAt: new Date(base + 6000), answeredAt: new Date(base + 9000), hiddenMs: 0 }
  ];

  const result = aggregateAttempt({ level: { objectives: [] }, questions, responses });
  assert.equal(result.accuracy, 50, `interlude must not count toward accuracy — expected 50% (1 of 2 real questions), got ${result.accuracy}%`);
  assert.equal(result.streakBonus, 0, "the interlude's always-true response must not seed a streak toward the +10 bonus");
  assert.deepEqual(result.missedQuestionIds, ["q2"], "the interlude must never appear as a missed item, and the real wrong answer still must");
  assert.equal(result.score, 100, "score is the one real correct mcq's 100 points plus a (correctly zero) streak bonus");

  log("interlude excluded from scoring OK: accuracy/streak/missed-items all computed from the 2 real questions only, not 3");
};

const testReorder = async () => {
  const a = await createDraft("mcq", { title: "Reorder A" });
  const b = await createDraft("mcq", { title: "Reorder B" });
  const c = await createDraft("mcq", { title: "Reorder C" });

  const current = await Question.find({ levelKey: SCRATCH_LEVEL_KEY, supersededBy: null }).sort({ sequence: 1 });
  const currentIds = current.map(q => String(q._id));

  // Reverse just the three freshly-created ones, keeping everything else
  // already in the scratch level exactly where it was.
  const newOrderForThree = [c.questionId, b.questionId, a.questionId];
  const fullOrder = currentIds.filter(id => ![a.questionId, b.questionId, c.questionId].includes(id));
  const insertAt = currentIds.indexOf(a.questionId);
  fullOrder.splice(insertAt, 0, ...newOrderForThree);

  const { status, body } = await request("POST", "/admin/questions/reorder", { levelKey: SCRATCH_LEVEL_KEY, orderedQuestionIds: fullOrder });
  assert.equal(status, 200, JSON.stringify(body));

  const reordered = await Question.find({ levelKey: SCRATCH_LEVEL_KEY, supersededBy: null }).sort({ sequence: 1 });
  const sequences = reordered.map(q => q.sequence);
  assert.deepEqual(sequences, [...sequences].sort((x, y) => x - y).filter((v, i, arr) => arr.indexOf(v) === i), "no two questions may share a sequence after reorder");
  assert.equal(new Set(sequences).size, sequences.length, "every sequence in the level must be unique after reorder");

  const cDoc = reordered.find(q => String(q._id) === c.questionId);
  const bDoc = reordered.find(q => String(q._id) === b.questionId);
  const aDoc = reordered.find(q => String(q._id) === a.questionId);
  assert.ok(cDoc.sequence < bDoc.sequence && bDoc.sequence < aDoc.sequence, "the three reversed questions must land in c, b, a order");

  const incomplete = await request("POST", "/admin/questions/reorder", { levelKey: SCRATCH_LEVEL_KEY, orderedQuestionIds: [a.questionId] });
  assert.equal(incomplete.status, 400, "reorder must refuse an order missing questions from the level");

  log("reorder OK: no duplicate/shared sequences, three-item reversal landed correctly, incomplete order refused");
};

const testLockForksOnEdit = async () => {
  const original = await createDraft("mcq", { title: "Lock me" });
  const publish = await request("PATCH", `/admin/questions/${original.questionId}`, { ...original, status: "published" });
  assert.equal(publish.status, 200, JSON.stringify(publish.body));

  const superToken = await adminToken(superAdmin.email, superAdminPassword);
  const lock = await request("POST", `/admin/levels/${scratchLevel._id}/lock`, {}, { token: superToken });
  assert.equal(lock.status, 200, JSON.stringify(lock.body));
  assert.ok(lock.body.sweptQuestionCount >= 1, "locking must sweep at least the questions published in this scratch level");

  const beforeEdit = await Question.findById(original.questionId);
  assert.equal(beforeEdit.status, "locked", "a published question must become locked when its level locks");

  const edited = await request("PATCH", `/admin/questions/${original.questionId}`, {
    ...publish.body.question,
    title: "Lock me — EDITED",
    reason: "e2e: confirm fork on locked edit"
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.forked, true, "editing a locked question must report forked: true");
  const newId = edited.body.question.questionId;
  createdQuestionIds.push(newId);
  assert.notEqual(newId, original.questionId, "forking must produce a NEW document id");

  const oldDoc = await Question.findById(original.questionId);
  const newDoc = await Question.findById(newId);
  assert.equal(oldDoc.title, "Lock me", "the OLD document must be left completely intact, not overwritten");
  assert.equal(oldDoc.status, "locked");
  assert.equal(String(oldDoc.supersededBy), newId, "the old document's supersededBy must point at the new one");
  assert.equal(newDoc.title, "Lock me — EDITED");
  assert.equal(newDoc.status, "locked", "a fork under a still-locked level must itself come out locked");
  assert.equal(String(newDoc.supersedes), original.questionId, "the new document's supersedes must point back at the old one");
  assert.equal(newDoc.version, oldDoc.version + 1);
  assert.equal(newDoc.sequence, oldDoc.sequence, "the fork keeps the same slot (sequence) as what it replaced");

  // The play-serving side must only ever see the ACTIVE (new) version.
  const activeCount = await Question.countDocuments({ levelKey: SCRATCH_LEVEL_KEY, sequence: oldDoc.sequence, supersededBy: null });
  assert.equal(activeCount, 1, "exactly one active document may occupy a given (levelKey, sequence) at a time");

  const forkAuditRow = await AuditLog.findOne({ action: "question_forked", "target.id": original.questionId });
  assert.ok(forkAuditRow, "forking must write an auditlog row");
  assert.equal(forkAuditRow.reason, "e2e: confirm fork on locked edit");

  const unlock = await request("POST", `/admin/levels/${scratchLevel._id}/unlock`, {}, { token: superToken });
  assert.equal(unlock.status, 200, JSON.stringify(unlock.body));
  const afterUnlock = await Question.findById(newId);
  assert.equal(afterUnlock.status, "published", "unlocking must sweep the fork back to published");

  log("locked-question edit correctly forked a new version, left the old one intact, and unlock swept the fork back to published");
};

// The full admin-route auth matrix. Every route under /admin is exercised
// against all three token kinds — not a spot check. The DELETE route that
// shipped without requireSuperAdmin was invisible until the suite caught
// it; this is the shape of test that makes that class of bug loud.
//
// Each request is deliberately crafted to PASS the guards and then fail on
// a domain check (a bogus id -> 404, a bad body -> 400), so nothing here
// mutates real data — the point is only "which tokens does the guard let
// through", never what the handler does afterwards.
//
// `superAdminOnly` reflects the guards actually mounted in the route
// files, which in turn track CLAUDE.md's "Enforced in code" list: only
// deleting a question and locking/unlocking a level are super_admin-only.
// Reordering questions is NOT on that list, so a plain admin may do it —
// if that ever changes, the route's guard and this flag change together,
// and this test fails until they do.
const BOGUS_ID = () => new mongoose.Types.ObjectId().toString();

const adminRouteMatrix = () => [
  { label: "GET    /admin/questions", method: "GET", path: "/admin/questions" },
  { label: "GET    /admin/questions/:id", method: "GET", path: `/admin/questions/${BOGUS_ID()}` },
  { label: "POST   /admin/questions", method: "POST", path: "/admin/questions", body: {} },
  { label: "PATCH  /admin/questions/:id", method: "PATCH", path: `/admin/questions/${BOGUS_ID()}`, body: {} },
  { label: "DELETE /admin/questions/:id", method: "DELETE", path: `/admin/questions/${BOGUS_ID()}`, superAdminOnly: true },
  { label: "POST   /admin/questions/reorder", method: "POST", path: "/admin/questions/reorder", body: { levelKey: "no-such-level-e2e-matrix", orderedQuestionIds: [] } },
  { label: "GET    /admin/levels", method: "GET", path: "/admin/levels" },
  { label: "POST   /admin/levels/:id/lock", method: "POST", path: `/admin/levels/${BOGUS_ID()}/lock`, body: {}, superAdminOnly: true },
  { label: "POST   /admin/levels/:id/unlock", method: "POST", path: `/admin/levels/${BOGUS_ID()}/unlock`, body: {}, superAdminOnly: true },
  { label: "POST   /admin/participants/generate", method: "POST", path: "/admin/participants/generate", body: { arm: "NOT_AN_ARM" } },
  { label: "GET    /admin/participants", method: "GET", path: "/admin/participants" },
  { label: "GET    /admin/participants/slips", method: "GET", path: "/admin/participants/slips" },
  { label: "POST   /admin/participants/:id/reset-pin", method: "POST", path: `/admin/participants/${BOGUS_ID()}/reset-pin`, body: {} },
  { label: "PATCH  /admin/participants/:id", method: "PATCH", path: `/admin/participants/${BOGUS_ID()}`, body: {} },
  // Soft-delete is super_admin-only, like every other delete in this codebase.
  { label: "DELETE /admin/participants/:id", method: "DELETE", path: `/admin/participants/${BOGUS_ID()}`, body: { reason: "matrix probe" }, superAdminOnly: true },
  { label: "GET    /admin/sessions", method: "GET", path: "/admin/sessions" },
  { label: "GET    /admin/records/participants", method: "GET", path: "/admin/records/participants" },
  { label: "GET    /admin/records/items", method: "GET", path: "/admin/records/items" },
  // Raw CSV export is super_admin-only (SPEC 4.1: "Raw CSV export | no | yes").
  { label: "GET    /admin/records/export", method: "GET", path: "/admin/records/export?file=participants", superAdminOnly: true },
  { label: "GET    /admin/records/trail", method: "GET", path: `/admin/records/trail?participantId=${BOGUS_ID()}&levelKey=no-such-level-e2e-matrix` }
];

const testAdminRouteAuthMatrix = async () => {
  matrixParticipant = await Participant.create({ code: `E2E-ADMIN-MATRIX-${Date.now()}`, arm: "E" });
  const jti = newJti();
  matrixParticipant.activeJti = jti;
  await matrixParticipant.save();
  const participantToken = signParticipantToken({ participantId: matrixParticipant._id, sessionId: null, jti });
  const plainToken = await adminToken(plainAdmin.email, plainAdminPassword);
  const superToken = await adminToken(superAdmin.email, superAdminPassword);

  for (const route of adminRouteMatrix()) {
    const { label, method, path, body, superAdminOnly } = route;

    // 1. Participant token — rejected on AUDIENCE, before role or anything.
    const asParticipant = await request(method, path, body, { token: participantToken });
    assert.equal(asParticipant.status, 401, `${label}: a participant token must be rejected (401), got ${asParticipant.status}`);
    assert.equal(asParticipant.body?.error?.code, "WRONG_AUDIENCE", `${label}: the participant rejection must be on audience, got ${asParticipant.body?.error?.code}`);

    // 2. Plain admin token — 403 SUPER_ADMIN_REQUIRED where the route is
    //    super_admin-only, otherwise it must clear every auth check and
    //    only ever fail (if at all) on a domain error.
    const asAdmin = await request(method, path, body, { token: plainToken });
    if (superAdminOnly) {
      assert.equal(asAdmin.status, 403, `${label}: a plain admin must be refused (403), got ${asAdmin.status}`);
      assert.equal(asAdmin.body?.error?.code, "SUPER_ADMIN_REQUIRED", `${label}: the plain-admin refusal must be SUPER_ADMIN_REQUIRED, got ${asAdmin.body?.error?.code}`);
    } else {
      assert.notEqual(asAdmin.status, 401, `${label}: a plain admin must NOT be rejected on auth (401)`);
      assert.notEqual(asAdmin.body?.error?.code, "WRONG_AUDIENCE", `${label}: a plain admin must clear the audience check`);
      assert.notEqual(asAdmin.body?.error?.code, "SUPER_ADMIN_REQUIRED", `${label}: a plain admin must NOT hit a super_admin gate on this route`);
    }

    // 3. Super admin token — clears every auth check on every route.
    const asSuperAdmin = await request(method, path, body, { token: superToken });
    assert.notEqual(asSuperAdmin.status, 401, `${label}: a super_admin must clear the audience check`);
    assert.notEqual(asSuperAdmin.body?.error?.code, "WRONG_AUDIENCE", `${label}: a super_admin must clear the audience check`);
    assert.notEqual(asSuperAdmin.body?.error?.code, "SUPER_ADMIN_REQUIRED", `${label}: a super_admin must clear the role check`);

    log(`  ${label}  —  participant 401 · ${superAdminOnly ? "plain admin 403" : "plain admin passes"} · super_admin passes`);
  }

  log("admin-route auth matrix OK — every route, all three token kinds");
};

// The domain half of the old spot check: a super_admin's delete really
// archives and really audits (the matrix above only proves the guard let
// the request through, on a bogus id).
const testDeleteArchivesAndAudits = async () => {
  const question = await createDraft("mcq", { title: "Delete-domain scratch" });
  const superToken = await adminToken(superAdmin.email, superAdminPassword);

  const deleted = await request("DELETE", `/admin/questions/${question.questionId}`, undefined, { token: superToken });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal(deleted.body.question.status, "archived");

  const auditRow = await AuditLog.findOne({ action: "question_archived", "target.id": question.questionId });
  assert.ok(auditRow, "archiving must write an auditlog row");

  log("super_admin delete archives the question and writes an audit row OK");
};

const testArchivedCannotBeEdited = async () => {
  const question = await createDraft("mcq", { title: "Archive then edit" });
  const superToken = await adminToken(superAdmin.email, superAdminPassword);
  const archived = await request("DELETE", `/admin/questions/${question.questionId}`, undefined, { token: superToken });
  assert.equal(archived.status, 200, JSON.stringify(archived.body));

  const editAttempt = await request("PATCH", `/admin/questions/${question.questionId}`, { ...question, title: "should not apply" });
  assert.equal(editAttempt.status, 409, "an archived question must refuse further edits");

  log("archived question correctly refuses further edits");
};

// --- Records and analytics (SPEC §11) -------------------------------------

// A fully hand-built scratch cohort with numbers small enough to check on
// paper. One level L (pass mark 60) with four mcq questions; correct
// answer is always "A". First-encounter grid:
//
//        Q1  Q2  Q3  Q4     within-level total (T)
//   P1    ✓   ✓   ✓   ✗            3
//   P2    ✓   ✓   ✗   ✗            2
//   P3    ✓   ✗   ✗   ✗            1
//   P4    ✗   ✗   ✗   ✗            0
//
// Plus P5 (excluded) and P6 (one practice attempt) to exercise the two
// include toggles. All attempts carry the scratch session id, and every
// records call in these tests is scoped to it, so nothing else in the
// database is in view.
const RECORDS_GRID = {
  P1: [true, true, true, false],
  P2: [true, true, false, false],
  P3: [true, false, false, false],
  P4: [false, false, false, false]
};
const POINTS = 100;
const BASE_TIME = new Date("2026-01-01T10:00:00.000Z").getTime();

const makeResponse = async ({ attempt, participant, question, correct, index }) => {
  const shownAt = new Date(BASE_TIME + index * 60_000);
  const doc = await Response.create({
    attemptId: attempt._id,
    participantId: participant._id,
    sessionId: records.session._id,
    questionId: question._id,
    questionVersion: 1,
    levelId: records.level._id,
    given: { selected: correct ? "A" : "B" },
    isCorrect: correct,
    partialScore: correct ? POINTS : 0,
    shownAt,
    firstInteractionAt: new Date(shownAt.getTime() + 2_000),
    answeredAt: new Date(shownAt.getTime() + 5_000), // timeOnResponse = 5000 - hiddenMs(1000) = 4000
    hiddenMs: 1_000,
    isRetry: false
  });
  return doc;
};

const makeAttempt = async ({ participant, correctness, isPractice = false }) => {
  const correctCount = correctness.filter(Boolean).length;
  const attempt = await Attempt.create({
    participantId: participant._id,
    sessionId: records.session._id,
    levelId: records.level._id,
    attemptNo: 1,
    kind: "first",
    isPractice,
    questionIds: records.questionIds,
    startedAt: new Date(BASE_TIME - 10_000),
    submittedAt: new Date(BASE_TIME + correctness.length * 60_000),
    activeMs: correctness.length * 4_000,
    hiddenMs: correctness.length * 1_000,
    score: correctCount * POINTS,
    accuracy: Math.round((correctCount / correctness.length) * 100),
    passed: correctCount / correctness.length >= 0.6,
    starsAwarded: 0,
    status: "submitted"
  });
  records.attemptIds.push(attempt._id);
  for (let i = 0; i < correctness.length; i++) {
    await makeResponse({ attempt, participant, question: { _id: records.questionIds[i] }, correct: correctness[i], index: i });
  }
  return attempt;
};

const buildRecordsFixture = async () => {
  records.session = await Session.create({ mode: "open", capacity: 10, levelKeys: ["records-e2e"], status: "ended" });
  records.level = await Level.create({
    key: `records-e2e-${Date.now()}`,
    order: 998,
    title: "Records scratch level",
    scene: "Bench",
    role: "Tester",
    objectives: ["records obj"],
    passMark: 60,
    status: "published"
  });

  for (let i = 1; i <= 4; i++) {
    const q = await Question.create({
      levelId: records.level._id,
      levelKey: records.level.key,
      sequence: i,
      type: "mcq",
      title: `Records Q${i}`,
      objective: "records obj",
      prompt: "Pick A.",
      options: [{ key: "A", text: "Right" }, { key: "B", text: "Wrong" }],
      correct: "A",
      feedback: { text: "A." },
      points: POINTS,
      status: "published",
      version: 1
    });
    records.questionIds.push(q._id);
  }

  const mk = async (codeSuffix, arm, extra = {}) => {
    const p = await Participant.create({ code: `E2E-RECORDS-${codeSuffix}`, arm, sessionId: records.session._id, ...extra });
    records.participantIds.push(p._id);
    return p;
  };

  const p1 = await mk("P1", "E");
  const p2 = await mk("P2", "E");
  const p3 = await mk("P3", "C");
  const p4 = await mk("P4", "C");
  const p5 = await mk("P5", "E", { excluded: true, excludeReason: "e2e" });
  const p6 = await mk("P6", "C");

  await makeAttempt({ participant: p1, correctness: RECORDS_GRID.P1 });
  await makeAttempt({ participant: p2, correctness: RECORDS_GRID.P2 });
  await makeAttempt({ participant: p3, correctness: RECORDS_GRID.P3 });
  await makeAttempt({ participant: p4, correctness: RECORDS_GRID.P4 });
  await makeAttempt({ participant: p5, correctness: [false] }); // excluded — out of scope unless includeExcluded
  await makeAttempt({ participant: p6, correctness: [true], isPractice: true }); // practice — out of scope unless includePractice

  log(`records fixture: session ${records.session._id}, 4 questions, 6 participants`);
};

// Independent reference: the DEFINITIONAL point-biserial
// (M1 - M0) / sd_pop * sqrt(p*q), a different computational path than the
// service's Pearson-covariance form. If the two agree the number is
// trustworthy. `totalByP` is each participant's within-level number
// correct; `rows` is [{ participantId, isCorrect }] for one question.
const referencePointBiserial = (rows, totalByP) => {
  if (rows.length < 2) return null;
  const g1 = rows.filter(r => r.isCorrect);
  const g0 = rows.filter(r => !r.isCorrect);
  if (g1.length === 0 || g0.length === 0) return null;
  const y = r => (totalByP.get(String(r.participantId)) || 0) - (r.isCorrect ? 1 : 0); // corrected
  const mean = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
  const allY = rows.map(y);
  const my = mean(allY);
  const varY = mean(allY.map(v => (v - my) ** 2));
  if (varY === 0) return null;
  const p = g1.length / rows.length;
  return ((mean(g1.map(y)) - mean(g0.map(y))) / Math.sqrt(varY)) * Math.sqrt(p * (1 - p));
};

const assertClose = (actual, expected, message, tol = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${message}: expected ~${expected}, got ${actual}`);

const parseCsv = text => {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift();
  return rows.filter(r => r.length === header.length).map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
};

const testRecordsAndAnalytics = async () => {
  await buildRecordsFixture();
  const sid = String(records.session._id);
  const superToken = await adminToken(superAdmin.email, superAdminPassword);

  // --- Participants table ------------------------------------------------
  const { status, body } = await request("GET", `/admin/records/participants?sessionId=${sid}`, undefined, { token: superToken });
  assert.equal(status, 200, JSON.stringify(body));
  const byCode = new Map(body.participants.map(p => [p.code, p]));

  assert.ok(byCode.has("E2E-RECORDS-P1"), "P1 present in default scope");
  assert.ok(!byCode.has("E2E-RECORDS-P5"), "the excluded participant is hidden by default");

  const p1 = byCode.get("E2E-RECORDS-P1");
  assert.equal(p1.arm, "E");
  assert.equal(p1.state, "active");
  assert.equal(p1.attemptCount, 1);
  assert.equal(p1.wrongCount, 1, "P1 got exactly one wrong (Q4)");
  assert.equal(p1.retryCount, 0);
  assert.equal(p1.activeMs, 4 * 4000, "P1 activeMs = 4 responses * (5000 - 1000 hidden)");
  assert.equal(p1.hiddenMs, 4 * 1000);
  assert.equal(p1.bestScore, 300);
  assert.equal(p1.levelsMastered, 0);
  assert.equal(p1.levels.length, 1);
  assert.equal(p1.levels[0].attempts[0].missedItems.length, 1, "P1's one missed item is Q4");
  assert.equal(p1.levels[0].attempts[0].missedItems[0].title, "Records Q4");
  assert.equal(p1.levels[0].attempts[0].activeMs, 16000, "per-attempt activeMs recomputed from responses, not read off the attempt");

  assert.equal(byCode.get("E2E-RECORDS-P4").wrongCount, 4, "P4 got everything wrong");
  assert.equal(byCode.get("E2E-RECORDS-P6").attemptCount, 0, "P6's only attempt is practice — not counted by default");

  // --- Include toggles -------------------------------------------------
  const withExcluded = await request("GET", `/admin/records/participants?sessionId=${sid}&includeExcluded=true`, undefined, { token: superToken });
  const p5 = new Map(withExcluded.body.participants.map(p => [p.code, p])).get("E2E-RECORDS-P5");
  assert.ok(p5, "the excluded participant appears once includeExcluded=true");
  assert.equal(p5.state, "excluded");

  const withPractice = await request("GET", `/admin/records/participants?sessionId=${sid}&includePractice=true`, undefined, { token: superToken });
  assert.equal(new Map(withPractice.body.participants.map(p => [p.code, p])).get("E2E-RECORDS-P6").attemptCount, 1, "the practice attempt counts once includePractice=true");

  // --- Arm filter ----------------------------------------------------
  const armE = await request("GET", `/admin/records/participants?sessionId=${sid}&arm=E`, undefined, { token: superToken });
  const armECodes = armE.body.participants.map(p => p.code).filter(c => c.startsWith("E2E-RECORDS-"));
  assert.deepEqual(armECodes.sort(), ["E2E-RECORDS-P1", "E2E-RECORDS-P2"], "arm=E returns only the arm-E scratch participants");

  log("participants table OK — totals, state, per-attempt recompute, both include toggles, arm filter");

  // --- Item analysis --------------------------------------------------
  const items = await request("GET", `/admin/records/items?sessionId=${sid}`, undefined, { token: superToken });
  assert.equal(items.status, 200, JSON.stringify(items.body));
  const q = new Map(items.body.items.map(it => [it.sequence, it])); // scratch questions are sequence 1..4

  assert.equal(q.get(1).difficulty, 0.75, "Q1: 3 of 4 right on first encounter");
  assert.equal(q.get(2).difficulty, 0.5, "Q2: 2 of 4");
  assert.equal(q.get(3).difficulty, 0.25, "Q3: 1 of 4");
  assert.equal(q.get(4).difficulty, 0, "Q4: 0 of 4");
  assert.equal(q.get(1).n, 4);

  // Cross-check discrimination against the independent definitional
  // formula, on the exact same corrected within-level totals.
  const totalByP = new Map([
    [String(records.participantIds[0]), 3],
    [String(records.participantIds[1]), 2],
    [String(records.participantIds[2]), 1],
    [String(records.participantIds[3]), 0]
  ]);
  const rowsFor = grid => [0, 1, 2, 3].map((_, pi) => ({ participantId: records.participantIds[pi], isCorrect: grid[pi] }));
  const grids = [
    [true, true, true, false], // Q1
    [true, true, false, false], // Q2
    [true, false, false, false], // Q3
    [false, false, false, false] // Q4
  ];
  for (let seq = 1; seq <= 4; seq++) {
    const expected = referencePointBiserial(rowsFor(grids[seq - 1]), totalByP);
    if (expected === null) {
      assert.equal(q.get(seq).discrimination, null, `Q${seq} discrimination should be null (degenerate)`);
    } else {
      assertClose(q.get(seq).discrimination, expected, `Q${seq} discrimination vs definitional point-biserial`);
    }
  }
  // Literal spot value, checkable by hand: Q2 = 1/sqrt(2).
  assertClose(q.get(2).discrimination, 1 / Math.sqrt(2), "Q2 discrimination is exactly 1/sqrt(2)", 1e-12);

  assert.equal(q.get(3).needsReview, false, "Q3 is hard but discriminates well — not flagged");
  assert.equal(q.get(4).discrimination, null, "Q4: everyone wrong -> discrimination cannot be computed");
  assert.equal(q.get(4).needsReview, true, "Q4 is hard AND non-discriminating -> flagged for review");
  assert.match(q.get(4).reading, /everyone answered it the same way/i);
  assert.match(q.get(1).reading, /Easy|Moderate/);

  log("item analysis OK — difficulty exact, discrimination matches an independent point-biserial, review flag correct");
};

const CSV_HEADERS = {
  participants: ["code", "arm", "state", "attempts", "wrongCount", "retryCount", "activeMs", "hiddenMs", "bestScore", "levelsPlayed", "levelsMastered"],
  attempts: ["code", "arm", "levelKey", "attemptNo", "kind", "remediationRound", "outcome", "status", "accuracy", "score", "starsAwarded", "activeMs", "hiddenMs"],
  responses: ["code", "arm", "levelKey", "attemptNo", "attemptKind", "questionSequence", "questionId", "questionVersion", "isCorrect", "isRetry", "partialScore", "shownAt", "firstInteractionAt", "answeredAt", "hiddenMs"],
  items: ["questionId", "levelKey", "sequence", "type", "objective", "n", "correct", "difficulty", "discrimination", "needsReview", "reading"]
};
const FORBIDDEN_COLUMNS = /name|label|email|phone|pin|jti/i;

const exportCsv = async (file, query, token) => {
  const res = await fetch(`${baseUrl}/admin/records/export?file=${file}${query}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  const disposition = res.headers.get("content-disposition") || "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? null;
  return { status: res.status, contentType: res.headers.get("content-type"), filename, text, rows: res.status === 200 ? parseCsv(text) : [] };
};

const testExportsAndHandCheck = async () => {
  const sid = String(records.session._id);
  const superToken = await adminToken(superAdmin.email, superAdminPassword);

  // Header + no-PII check on all four.
  for (const file of Object.keys(CSV_HEADERS)) {
    const csv = await exportCsv(file, `&sessionId=${sid}`, superToken);
    assert.equal(csv.status, 200, `${file}.csv must export`);
    assert.match(csv.contentType || "", /text\/csv/, `${file}.csv content type`);
    const header = Object.keys(csv.rows[0] || {});
    assert.deepEqual(header, CSV_HEADERS[file], `${file}.csv columns must be exactly the documented set`);
    assert.ok(!header.some(h => FORBIDDEN_COLUMNS.test(h)), `${file}.csv must carry no name/label/PII column`);
  }

  // Filename encodes the include choices (SPEC §11).
  const outOut = await exportCsv("participants", `&sessionId=${sid}`, superToken);
  assert.match(outOut.filename, /participants__excluded-out__practice-out__/, "default filename says excluded-out, practice-out");
  const inIn = await exportCsv("participants", `&sessionId=${sid}&includeExcluded=true&includePractice=true`, superToken);
  assert.match(inIn.filename, /participants__excluded-in__practice-in__/, "toggled filename says excluded-in, practice-in");
  assert.match(inIn.filename, /__session-/, "session-scoped export names the session");
  assert.notEqual(outOut.filename, inIn.filename, "the two exports can never share a filename");

  // Default participants.csv: every non-excluded scratch code (P6 is a row
  // with 0 attempts — it is a participant, just with only a practice
  // attempt), and P5 absent because it's excluded.
  const partCodes = outOut.rows.map(r => r.code).filter(c => c.startsWith("E2E-RECORDS-")).sort();
  assert.deepEqual(partCodes, ["E2E-RECORDS-P1", "E2E-RECORDS-P2", "E2E-RECORDS-P3", "E2E-RECORDS-P4", "E2E-RECORDS-P6"], "default participants.csv: all non-excluded scratch codes, P5 absent");

  const itemsCsv = await exportCsv("items", `&sessionId=${sid}`, superToken);
  const itemsBySeq = new Map(itemsCsv.rows.filter(r => r.levelKey === records.level.key).map(r => [r.sequence, r]));
  assert.equal(itemsBySeq.get("1").difficulty, "0.7500", "items.csv difficulty is the fixed-4dp value");
  assert.equal(itemsBySeq.get("4").discrimination, "", "items.csv leaves discrimination blank when it can't be computed");
  assert.equal(itemsBySeq.get("4").needsReview, "true");

  // --- Hand-check responses.csv against the raw Response documents -----
  const respCsv = await exportCsv("responses", `&sessionId=${sid}`, superToken);
  const p1 = await Participant.findOne({ code: "E2E-RECORDS-P1" });
  const p1Attempt = await Attempt.findOne({ participantId: p1._id, sessionId: records.session._id });
  const p1Docs = await Response.find({ attemptId: p1Attempt._id }).sort({ answeredAt: 1 }).lean();
  const p1CsvRows = respCsv.rows.filter(r => r.code === "E2E-RECORDS-P1").sort((a, b) => new Date(a.answeredAt) - new Date(b.answeredAt));

  assert.equal(p1CsvRows.length, p1Docs.length, "one responses.csv row per P1 Response document");
  for (let i = 0; i < p1Docs.length; i++) {
    const doc = p1Docs[i];
    const row = p1CsvRows[i];
    assert.equal(row.questionId, String(doc.questionId), `row ${i}: questionId`);
    assert.equal(Number(row.questionVersion), doc.questionVersion, `row ${i}: questionVersion`);
    assert.equal(row.isCorrect, String(doc.isCorrect), `row ${i}: isCorrect`);
    assert.equal(row.isRetry, String(doc.isRetry), `row ${i}: isRetry`);
    assert.equal(Number(row.partialScore), doc.partialScore, `row ${i}: partialScore`);
    assert.equal(new Date(row.shownAt).toISOString(), doc.shownAt.toISOString(), `row ${i}: shownAt`);
    assert.equal(new Date(row.firstInteractionAt).toISOString(), doc.firstInteractionAt.toISOString(), `row ${i}: firstInteractionAt`);
    assert.equal(new Date(row.answeredAt).toISOString(), doc.answeredAt.toISOString(), `row ${i}: answeredAt`);
    assert.equal(Number(row.hiddenMs), doc.hiddenMs, `row ${i}: hiddenMs`);
  }

  log(`exports OK — four CSVs, exact documented headers, no PII columns, filename encodes the toggles; responses.csv hand-checked field-for-field against ${p1Docs.length} P1 Response documents`);
};

// --- Participant management (SPEC 6) -----------------------------------

const playToken = async (code, pin) => {
  const set = await request("POST", "/auth/play/set-pin", { code, pin });
  if (set.status === 200) return set.body.token;
  const login = await request("POST", "/auth/play/login", { code, pin });
  assert.equal(login.status, 200, `play login for ${code}: ${JSON.stringify(login.body)}`);
  return login.body.token;
};

const testParticipantManagement = async () => {
  const superToken = await adminToken(superAdmin.email, superAdminPassword);
  people.session = await Session.create({ mode: "open", capacity: 20, levelKeys: ["e2e-pm"], status: "draft" });
  people.level = await Level.create({ key: `e2e-pm-${Date.now()}`, order: 997, title: "PM scratch", scene: "Bench", role: "Tester", objectives: ["pm obj"], passMark: 50, status: "published" });
  people.questionId = (
    await Question.create({
      levelId: people.level._id,
      levelKey: people.level.key,
      sequence: 1,
      type: "mcq",
      title: "PM Q1",
      objective: "pm obj",
      prompt: "Pick A.",
      options: [{ key: "A", text: "Right" }, { key: "B", text: "Wrong" }],
      correct: "A",
      feedback: { text: "A." },
      points: 100,
      status: "published",
      version: 1
    })
  )._id;

  people.labels = Array.from({ length: 10 }, (_, i) => `Roll ${21 + i}`);

  // --- Bulk generation with a custom prefix + roster labels ----------
  const gen = await request(
    "POST",
    "/admin/participants/generate",
    { prefix: "e2epm", arm: "E", count: 10, sessionId: String(people.session._id), labels: people.labels },
    { token: superToken }
  );
  assert.equal(gen.status, 201, JSON.stringify(gen.body));
  assert.equal(gen.body.prefix, "E2EPM", "prefix is upper-cased");
  assert.equal(gen.body.participants.length, 10);
  for (const p of gen.body.participants) assert.match(p.code, /^E2EPM-E-\d{3}$/, `code shape: ${p.code}`);
  const codes = gen.body.participants.map(p => p.code);

  // Labels landed on the SESSION ROSTER, not the participant documents.
  const freshSession = await Session.findById(people.session._id).lean();
  const rosterLabels = freshSession.roster.map(r => r.label).filter(Boolean).sort();
  assert.deepEqual(rosterLabels, [...people.labels].sort(), "every label is on the session roster");
  const pDocs = await Participant.find({ code: { $in: codes } }).lean();
  const pDocsJson = JSON.stringify(pDocs);
  for (const label of people.labels) assert.ok(!pDocsJson.includes(label), `label "${label}" must NOT be on any participant document`);
  assert.ok(pDocs.every(p => p.pinHash == null), "generated codes start with no PIN");

  // Labels without a session have nowhere to live -> refused.
  const noSession = await request("POST", "/admin/participants/generate", { prefix: "E2EPM", arm: "C", count: 1, labels: ["orphan"] }, { token: superToken });
  assert.equal(noSession.status, 400, "roster labels without a session must be refused");
  assert.equal(noSession.body.error.code, "LABELS_NEED_SESSION");

  // --- No session, no labels: auto-attached to a standing open session ---
  // Otherwise the code sits at sessionId: null forever (no session-control
  // UI exists yet to fix it after the fact) and POST /play/attempts refuses
  // it with NO_SESSION on the very first sign-in.
  // The default session is meant to be a real, persistent, reused fixture
  // (that's the whole point of the fix) — so only clean it up in teardown
  // if THIS run is the one that minted it; never delete one that already
  // existed, since that could be a real standing session from actual use.
  const preExistingDefault = await Session.findOne({ isSystemDefault: true, deletedAt: null, status: { $ne: "ended" } }).lean();

  const autoGen = await request("POST", "/admin/participants/generate", { prefix: "E2EPM", arm: "E", count: 2 }, { token: superToken });
  assert.equal(autoGen.status, 201, JSON.stringify(autoGen.body));
  assert.ok(autoGen.body.sessionId, "a session id is returned even though none was requested");
  assert.equal(autoGen.body.sessionAutoAttached, true);
  if (!preExistingDefault) people.defaultSessionId = autoGen.body.sessionId;

  const autoParticipants = await Participant.find({ code: { $in: autoGen.body.participants.map(p => p.code) } }).lean();
  assert.ok(
    autoParticipants.every(p => String(p.sessionId) === autoGen.body.sessionId),
    "every auto-generated participant is attached to the default session, not left at null"
  );
  const defaultSessionDoc = await Session.findById(autoGen.body.sessionId).lean();
  assert.equal(defaultSessionDoc.mode, "open");
  assert.equal(defaultSessionDoc.isSystemDefault, true, "the fallback session is flagged so it's never confused with an admin-created open session");
  assert.equal(
    defaultSessionDoc.roster.filter(r => autoParticipants.some(p => String(p._id) === String(r.participantId))).length,
    0,
    "auto-attach must never add a roster entry — that's reserved for an explicitly chosen session (SPEC 6.2)"
  );

  // Prove the root cause is actually fixed: a freshly auto-attached code
  // must clear the sessionId gate on /play/attempts (an unrelated 404 for
  // the bogus levelKey proves the NO_SESSION check was passed, not skipped).
  const autoJti = newJti();
  await Participant.updateOne({ _id: autoParticipants[0]._id }, { $set: { activeJti: autoJti } });
  const autoToken = signParticipantToken({ participantId: autoParticipants[0]._id, sessionId: autoParticipants[0].sessionId, jti: autoJti });
  const firstAttemptCall = await request("POST", "/play/attempts", { levelKey: "no-such-level-e2e-autogen" }, { token: autoToken });
  assert.notEqual(firstAttemptCall.body?.error?.code, "NO_SESSION", "an auto-attached participant must not hit NO_SESSION");
  assert.equal(firstAttemptCall.status, 404, "unknown levelKey reaches the normal LEVEL_NOT_FOUND check, proving the session gate passed");

  // Calling generate again with still no session must reuse the SAME
  // standing session rather than minting a new one every time.
  const autoGenAgain = await request("POST", "/admin/participants/generate", { prefix: "E2EPM", arm: "C", count: 1 }, { token: superToken });
  assert.equal(autoGenAgain.body.sessionId, autoGen.body.sessionId, "the default open session is found and reused, not recreated, on a second call");

  // --- List: filterable by session and arm ---------------------------
  const list = await request("GET", `/admin/participants?sessionId=${people.session._id}`, undefined, { token: superToken });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.participants.length, 10);
  const byCode = new Map(list.body.participants.map(r => [r.code, r]));
  const first = byCode.get(codes[0]);
  assert.equal(first.pinSet, false);
  assert.equal(first.state, "no pin yet");
  assert.equal(first.excluded, false);
  assert.ok(people.labels.includes(first.sessionLabel), "the list row carries the roster label from the session, looked up separately");

  const armFiltered = await request("GET", `/admin/participants?sessionId=${people.session._id}&arm=C`, undefined, { token: superToken });
  assert.equal(armFiltered.body.participants.length, 0, "arm=C filter excludes the arm-E scratch codes");

  // --- Reset PIN: clears the hash and severs the live session -------
  const target = byCode.get(codes[1]);
  const oldToken = await playToken(codes[1], "1111");
  assert.equal((await request("GET", "/play/levels", undefined, { token: oldToken })).status, 200, "the freshly set PIN signs in");

  const reset = await request("POST", `/admin/participants/${target.participantId}/reset-pin`, { reason: "e2e reset" }, { token: superToken });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.equal(reset.body.participant.pinSet, false, "reset clears the PIN hash");
  assert.equal((await request("GET", "/play/levels", undefined, { token: oldToken })).status, 401, "reset also severs the old device's session");

  const newToken = await playToken(codes[1], "2222"); // set-pin works again because the hash is gone
  assert.equal((await request("GET", "/play/levels", undefined, { token: newToken })).status, 200, "a NEW PIN can be set and used after a reset");

  assert.ok(await AuditLog.findOne({ action: "participant_pin_reset", "target.id": target.participantId }), "reset-pin writes an audit row");

  // --- Exclude with a reason, admin note, then un-exclude ----------
  const exTarget = byCode.get(codes[2]);
  const exToken = await playToken(codes[2], "3333");
  assert.equal((await request("GET", "/play/levels", undefined, { token: exToken })).status, 200);

  const missingReason = await request("PATCH", `/admin/participants/${exTarget.participantId}`, { excluded: true }, { token: superToken });
  assert.equal(missingReason.status, 400, "excluding needs a reason");
  assert.equal(missingReason.body.error.code, "REASON_REQUIRED");

  const excluded = await request("PATCH", `/admin/participants/${exTarget.participantId}`, { excluded: true, excludeReason: "code sharing", adminNote: "seat 4, arrived late" }, { token: superToken });
  assert.equal(excluded.status, 200, JSON.stringify(excluded.body));
  assert.equal(excluded.body.participant.excluded, true);
  assert.equal(excluded.body.participant.excludeReason, "code sharing");
  assert.equal(excluded.body.participant.adminNote, "seat 4, arrived late");
  assert.equal(excluded.body.participant.state, "excluded");
  assert.equal((await request("GET", "/play/levels", undefined, { token: exToken })).status, 401, "excluding a participant signs them out");

  const unExcluded = await request("PATCH", `/admin/participants/${exTarget.participantId}`, { excluded: false }, { token: superToken });
  assert.equal(unExcluded.body.participant.excluded, false);
  assert.equal(unExcluded.body.participant.excludeReason, null, "un-excluding clears the reason (history is in the audit row)");
  assert.equal(unExcluded.body.participant.adminNote, "seat 4, arrived late", "the admin note is untouched by an exclude change");
  assert.ok(await AuditLog.findOne({ action: "participant_updated", "target.id": exTarget.participantId }), "PATCH writes an audit row");

  // --- Slips: code + arm only, plus the PIN instructions ----------
  const slips = await request("GET", `/admin/participants/slips?sessionId=${people.session._id}`, undefined, { token: superToken });
  assert.equal(slips.status, 200, JSON.stringify(slips.body));
  assert.equal(slips.body.slips.length, 10);
  for (const s of slips.body.slips) assert.deepEqual(Object.keys(s).sort(), ["arm", "code"], "a slip carries ONLY code and arm");
  assert.ok(Array.isArray(slips.body.pinInstructions) && slips.body.pinInstructions.every(x => typeof x === "string"));
  const slipsJson = JSON.stringify(slips.body);
  for (const label of people.labels) assert.ok(!slipsJson.includes(label), `no roster label reaches the slips payload ("${label}")`);

  // --- The SPEC 6.2 guarantee: no roster label in ANY export -------
  // Give a labelled participant a real attempt so the export rows aren't empty.
  const attemptOwner = pDocs.find(p => p.code === codes[0]);
  const att = await Attempt.create({
    participantId: attemptOwner._id,
    sessionId: people.session._id,
    levelId: people.level._id,
    attemptNo: 1,
    kind: "first",
    isPractice: false,
    questionIds: [people.questionId],
    startedAt: new Date(),
    submittedAt: new Date(),
    activeMs: 4000,
    hiddenMs: 0,
    score: 100,
    accuracy: 100,
    passed: true,
    starsAwarded: 3,
    status: "submitted"
  });
  people.attemptIds.push(att._id);
  await Response.create({
    attemptId: att._id,
    participantId: attemptOwner._id,
    sessionId: people.session._id,
    questionId: people.questionId,
    questionVersion: 1,
    levelId: people.level._id,
    given: { selected: "A" },
    isCorrect: true,
    partialScore: 100,
    shownAt: new Date(Date.now() - 4000),
    answeredAt: new Date(),
    hiddenMs: 0,
    isRetry: false
  });

  for (const file of ["participants", "attempts", "responses", "items"]) {
    for (const inc of ["", "&includeExcluded=true&includePractice=true"]) {
      const res = await fetch(`${baseUrl}/admin/records/export?file=${file}&sessionId=${people.session._id}${inc}`, { headers: { Authorization: `Bearer ${superToken}` } });
      const text = await res.text();
      for (const label of people.labels) {
        assert.ok(!text.includes(label), `roster label "${label}" leaked into ${file}.csv${inc ? " (with includes)" : ""}`);
      }
    }
  }

  // --- Delete is a SOFT delete (SPEC 6, CLAUDE.md rule 5) -------------
  // super_admin-only, requires a reason, sets deletedAt rather than
  // removing the document, and is invisible to everything downstream —
  // list, sign-in, and every records/export view — without touching the
  // row's own attempts/responses.
  const plainToken = await adminToken(plainAdmin.email, plainAdminPassword);
  const deleteTarget = byCode.get(codes[3]);

  const asPlain = await request("DELETE", `/admin/participants/${deleteTarget.participantId}`, { reason: "e2e probe" }, { token: plainToken });
  assert.equal(asPlain.status, 403, "a plain admin must not be able to delete a participant");
  assert.equal(asPlain.body.error.code, "SUPER_ADMIN_REQUIRED");

  const missingDeleteReason = await request("DELETE", `/admin/participants/${deleteTarget.participantId}`, {}, { token: superToken });
  assert.equal(missingDeleteReason.status, 400, "deleting needs a reason");
  assert.equal(missingDeleteReason.body.error.code, "REASON_REQUIRED");

  const deleted = await request("DELETE", `/admin/participants/${deleteTarget.participantId}`, { reason: "duplicate code, generated by mistake" }, { token: superToken });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal(deleted.body.deleted, true);

  const rawAfterDelete = await Participant.findById(deleteTarget.participantId).lean();
  assert.ok(rawAfterDelete, "the document itself must still exist — this is a soft delete, never a real removal");
  assert.ok(rawAfterDelete.deletedAt, "deletedAt must be set");
  assert.equal(rawAfterDelete.activeJti, null, "deleting also drops any live session");

  const listAfterDelete = await request("GET", `/admin/participants?sessionId=${people.session._id}`, undefined, { token: superToken });
  assert.ok(!listAfterDelete.body.participants.some(p => p.participantId === deleteTarget.participantId), "a deleted participant must vanish from the list");

  const signInAfterDelete = await request("POST", "/auth/play/set-pin", { code: deleteTarget.code, pin: "9999" });
  assert.equal(signInAfterDelete.status, 401, "a deleted code must no longer be able to sign in");

  const doubleDelete = await request("DELETE", `/admin/participants/${deleteTarget.participantId}`, { reason: "again" }, { token: superToken });
  assert.equal(doubleDelete.status, 404, "deleting an already-deleted participant 404s, same as any other participant route");

  const exportAfterDelete = await exportCsv("participants", `&sessionId=${people.session._id}&includeExcluded=true&includePractice=true`, superToken);
  assert.ok(!exportAfterDelete.rows.some(r => r.code === deleteTarget.code), "a deleted participant must be absent from the export even with every include toggle on");

  assert.ok(await AuditLog.findOne({ action: "participant_deleted", "target.id": deleteTarget.participantId }), "delete writes an audit row");

  log("participant management OK — prefixed bulk generation, labels on the session roster only, list filters, reset-pin severs the session, exclude/note with audit, slips carry code+arm only, no roster label reaches any of the four exports, and delete is a super_admin-only soft delete that hides the row everywhere without touching the document");
};

const run = async () => {
  await setup();
  try {
    await testCreateAllSevenTypesAsDrafts();
    await testPublishValid();
    await testPublishInvalidNamesFailures();
    await testFallbackTextRequiredWithMedia();
    await testInterludeIsUnscored();
    testInterludeExcludedFromScoring();
    await testReorder();
    await testLockForksOnEdit();
    await testAdminRouteAuthMatrix();
    await testDeleteArchivesAndAudits();
    await testArchivedCannotBeEdited();
    await testRecordsAndAnalytics();
    await testExportsAndHandCheck();
    await testParticipantManagement();
    log("ALL CHECKS PASSED");
  } finally {
    await teardown();
  }
};

run().catch(async error => {
  console.error("[e2e-admin-content] FAILED:", error);
  process.exitCode = 1;
  try {
    await teardown();
  } catch {
    // best-effort cleanup after a failure
  }
});
