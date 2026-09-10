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
import AuditLog from "../server/src/models/AuditLog.js";
import { hashSecret, signParticipantToken, newJti } from "../server/src/services/auth.js";
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
    media: { videoUrl: "https://example.test/a.mp4", videoUrlB: "https://example.test/b.mp4", sharedScrub: true },
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
  log("all seven question types created as drafts OK");
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

const run = async () => {
  await setup();
  try {
    await testCreateAllSevenTypesAsDrafts();
    await testPublishValid();
    await testPublishInvalidNamesFailures();
    await testFallbackTextRequiredWithMedia();
    await testReorder();
    await testLockForksOnEdit();
    await testAdminRouteAuthMatrix();
    await testDeleteArchivesAndAudits();
    await testArchivedCannotBeEdited();
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
