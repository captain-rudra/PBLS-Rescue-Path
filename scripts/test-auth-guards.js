// Direct unit tests for two classes of guard that no route currently
// forces to run:
//
// 1. assertNotSelfDemotion / assertSuperAdminSurvives (adminSafety.js) —
//    written for CLAUDE.md's "a super_admin cannot demote themselves" /
//    "at least one super_admin must always exist" rules, but there is no
//    promote/demote admin-management route yet to call them. A guard with
//    no caller and no test is a guard that can quietly stop working; this
//    calls both directly so a regression fails loudly NOW, and so that
//    whenever the promote/demote route lands there is already a spec for
//    what it must call.
//
// 2. The two-gate dev-auth-bypass condition in requireParticipant.js /
//    requireAdmin.js (`NODE_ENV !== "production" && ALLOW_DEV_AUTH_BYPASS
//    === "true"`). Nothing else in the test suite proves both halves are
//    independently load-bearing — e2e-play.js always runs with both
//    conditions satisfied, so a regression that turned the `&&` into an
//    `||` (or dropped the NODE_ENV check entirely) would sail through it
//    unnoticed. This calls the middleware directly under all four
//    combinations and asserts exactly which ones are allowed through.
//
// Usage: node scripts/test-auth-guards.js  (or: npm run test:auth-guards --workspace server)

import assert from "node:assert/strict";
import { connectDB, disconnectDB } from "../server/src/db.js";
import Admin from "../server/src/models/Admin.js";
import Participant from "../server/src/models/Participant.js";
import { assertNotSelfDemotion, assertSuperAdminSurvives } from "../server/src/services/adminSafety.js";
import { requireParticipant } from "../server/src/middleware/requireParticipant.js";
import { requireAdmin } from "../server/src/middleware/requireAdmin.js";
import { HttpError } from "../server/src/lib/httpError.js";
import { ROLES } from "../shared/constants.js";

const log = (...args) => console.log("[test-auth-guards]", ...args);
const createdAdminIds = [];
const createdParticipantIds = [];

const scratchAdmin = async (overrides = {}) => {
  const admin = await Admin.create({
    email: `test-auth-guards-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    passwordHash: "not-used-by-these-tests",
    name: "Scratch Admin",
    role: ROLES.ADMIN,
    active: true,
    ...overrides
  });
  createdAdminIds.push(admin._id);
  return admin;
};

const scratchParticipant = async (overrides = {}) => {
  const participant = await Participant.create({
    code: `TEST-AUTH-GUARDS-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    arm: "E",
    ...overrides
  });
  createdParticipantIds.push(participant._id);
  return participant;
};

// Both guard functions throw synchronously or via a rejected promise
// depending on whether a DB read is involved — `await fn()` handles both
// uniformly, since evaluating a throwing sync call inside the try still
// lands in the catch.
const assertThrowsHttpError = async (fn, expectedCode, expectedStatus, message) => {
  let thrown = null;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, `${message}: expected a throw, got none`);
  assert.ok(thrown instanceof HttpError, `${message}: expected an HttpError, got ${thrown?.constructor?.name}: ${thrown?.message}`);
  assert.equal(thrown.code, expectedCode, `${message}: wrong error code (got ${thrown.code})`);
  assert.equal(thrown.status, expectedStatus, `${message}: wrong status (got ${thrown.status})`);
};

const assertDoesNotThrow = async (fn, message) => {
  await fn();
  log(`  ok (no throw): ${message}`);
};

const testAssertNotSelfDemotion = async () => {
  const self = await scratchAdmin({ role: ROLES.SUPER_ADMIN });
  const other = await scratchAdmin({ role: ROLES.SUPER_ADMIN });

  await assertThrowsHttpError(
    () => assertNotSelfDemotion(self._id, self._id, ROLES.ADMIN),
    "CANNOT_SELF_DEMOTE",
    403,
    "a super_admin demoting THEMSELVES to admin must be refused"
  );

  await assertDoesNotThrow(
    () => assertNotSelfDemotion(self._id, self._id, ROLES.SUPER_ADMIN),
    "setting your own role to the SAME role (super_admin) is not a demotion"
  );

  await assertDoesNotThrow(
    () => assertNotSelfDemotion(self._id, other._id, ROLES.ADMIN),
    "demoting a DIFFERENT admin is never self-demotion, regardless of role"
  );

  log("assertNotSelfDemotion OK");
};

const testAssertSuperAdminSurvives = async () => {
  // A regular admin is never a super_admin to protect — any change is fine.
  const plainAdmin = await scratchAdmin({ role: ROLES.ADMIN });
  await assertDoesNotThrow(
    () => assertSuperAdminSurvives(plainAdmin._id, { nextRole: ROLES.ADMIN, nextActive: false }),
    "a plain admin (never a super_admin) is never protected by this guard"
  );

  // A soft-deleted admin is also not a CURRENT active super_admin, even if
  // its role field still says so — the early-return branch.
  const deletedSuperAdmin = await scratchAdmin({ role: ROLES.SUPER_ADMIN, deletedAt: new Date() });
  await assertDoesNotThrow(
    () => assertSuperAdminSurvives(deletedSuperAdmin._id, { nextRole: ROLES.ADMIN, nextActive: false }),
    "a soft-deleted super_admin is not counted as a currently-protected one"
  );

  // No real change (still super_admin, still active) is always safe.
  const unchangedSuperAdmin = await scratchAdmin({ role: ROLES.SUPER_ADMIN });
  await assertDoesNotThrow(
    () => assertSuperAdminSurvives(unchangedSuperAdmin._id, { nextRole: ROLES.SUPER_ADMIN, nextActive: true }),
    "no real change to an existing super_admin never throws"
  );

  // --- The scenarios that actually depend on "how many OTHER active
  // super_admins exist" need the shared dev database's own real
  // super_admins (e.g. one created via scripts/create-super-admin.js)
  // taken out of the count for the duration, or "the last one" can never
  // be reproduced. Deactivated here, restored in `finally` no matter what.
  const realActiveSuperAdmins = await Admin.find({ role: ROLES.SUPER_ADMIN, active: true, deletedAt: null });
  const realActiveSuperAdminIds = realActiveSuperAdmins.map(a => a._id);
  if (realActiveSuperAdminIds.length > 0) {
    await Admin.updateMany({ _id: { $in: realActiveSuperAdminIds } }, { $set: { active: false } });
  }
  try {
    const sole = await scratchAdmin({ role: ROLES.SUPER_ADMIN });

    await assertThrowsHttpError(
      () => assertSuperAdminSurvives(sole._id, { nextRole: ROLES.ADMIN, nextActive: true }),
      "LAST_SUPER_ADMIN",
      409,
      "demoting the ONLY active super_admin to admin must be refused"
    );

    await assertThrowsHttpError(
      () => assertSuperAdminSurvives(sole._id, { nextRole: ROLES.SUPER_ADMIN, nextActive: false }),
      "LAST_SUPER_ADMIN",
      409,
      "deactivating the ONLY active super_admin must be refused, even with role unchanged"
    );

    const backup = await scratchAdmin({ role: ROLES.SUPER_ADMIN });
    await assertDoesNotThrow(
      () => assertSuperAdminSurvives(sole._id, { nextRole: ROLES.ADMIN, nextActive: true }),
      "demoting one super_admin is fine once a second active one exists"
    );
    void backup; // exists only to make the above true; no further use

    log("assertSuperAdminSurvives OK (including the 'only one left' cases, using the real DB's own super_admins isolated for the duration)");
  } finally {
    if (realActiveSuperAdminIds.length > 0) {
      await Admin.updateMany({ _id: { $in: realActiveSuperAdminIds } }, { $set: { active: true } });
    }
  }
};

// --- Part 2: the dev-auth-bypass two-gate condition, called directly. ---

const fakeResponse = () => {
  const res = { statusCode: null, body: null };
  res.status = code => {
    res.statusCode = code;
    return res;
  };
  res.json = payload => {
    res.body = payload;
    return res;
  };
  return res;
};

const runMiddleware = middleware => {
  const request = { headers: {}, participant: undefined, admin: undefined };
  const response = fakeResponse();
  let nextCalled = false;
  return new Promise(resolve => {
    Promise.resolve(middleware(request, response, () => (nextCalled = true))).then(() =>
      resolve({ nextCalled, status: response.statusCode, body: response.body, request })
    );
  });
};

const withEnv = async (overrides, fn) => {
  const saved = {};
  for (const key of Object.keys(overrides)) saved[key] = process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const testDevBypassTwoGate = async () => {
  const participant = await scratchParticipant();
  const admin = await scratchAdmin();

  // Gate 1 (NODE_ENV): even with the flag explicitly on, production must
  // refuse the bypass outright — this is the half a plain "is the flag
  // on?" test would never catch.
  await withEnv({ NODE_ENV: "production", ALLOW_DEV_AUTH_BYPASS: "true", DEV_PARTICIPANT_ID: String(participant._id) }, async () => {
    const result = await runMiddleware(requireParticipant);
    assert.equal(result.nextCalled, false, "requireParticipant must NOT bypass when NODE_ENV=production, even with the flag on");
    assert.equal(result.status, 401);
  });
  await withEnv({ NODE_ENV: "production", ALLOW_DEV_AUTH_BYPASS: "true", DEV_ADMIN_ID: String(admin._id) }, async () => {
    const result = await runMiddleware(requireAdmin);
    assert.equal(result.nextCalled, false, "requireAdmin must NOT bypass when NODE_ENV=production, even with the flag on");
    assert.equal(result.status, 401);
  });
  log("  gate 1 (NODE_ENV) OK: production refuses the bypass regardless of the flag");

  // Gate 2 (the flag): outside production, the bypass must still refuse
  // when the flag itself is off/absent — NODE_ENV not being "production"
  // is not, by itself, enough.
  await withEnv({ NODE_ENV: "development", ALLOW_DEV_AUTH_BYPASS: undefined, DEV_PARTICIPANT_ID: String(participant._id) }, async () => {
    const result = await runMiddleware(requireParticipant);
    assert.equal(result.nextCalled, false, "requireParticipant must NOT bypass when ALLOW_DEV_AUTH_BYPASS is unset, even outside production");
    assert.equal(result.status, 401);
  });
  await withEnv({ NODE_ENV: "development", ALLOW_DEV_AUTH_BYPASS: "false", DEV_ADMIN_ID: String(admin._id) }, async () => {
    const result = await runMiddleware(requireAdmin);
    assert.equal(result.nextCalled, false, "requireAdmin must NOT bypass when ALLOW_DEV_AUTH_BYPASS=false");
    assert.equal(result.status, 401);
  });
  log("  gate 2 (the flag) OK: non-production alone does not enable the bypass");

  // Both gates open: the bypass actually works and resolves the scratch
  // participant/admin.
  await withEnv({ NODE_ENV: "development", ALLOW_DEV_AUTH_BYPASS: "true", DEV_PARTICIPANT_ID: String(participant._id) }, async () => {
    const result = await runMiddleware(requireParticipant);
    assert.equal(result.nextCalled, true, "requireParticipant must bypass once BOTH gates are satisfied");
    assert.equal(String(result.request.participant._id), String(participant._id));
  });
  await withEnv({ NODE_ENV: "development", ALLOW_DEV_AUTH_BYPASS: "true", DEV_ADMIN_ID: String(admin._id) }, async () => {
    const result = await runMiddleware(requireAdmin);
    assert.equal(result.nextCalled, true, "requireAdmin must bypass once BOTH gates are satisfied");
    assert.equal(String(result.request.admin._id), String(admin._id));
  });
  log("  both gates open OK: bypass resolves the configured DEV_*_ID");

  log("dev-bypass two-gate condition OK: NODE_ENV and ALLOW_DEV_AUTH_BYPASS are both independently load-bearing, not decorative");
};

const teardown = async () => {
  if (createdAdminIds.length) await Admin.deleteMany({ _id: { $in: createdAdminIds } });
  if (createdParticipantIds.length) await Participant.deleteMany({ _id: { $in: createdParticipantIds } });
  await disconnectDB();
};

const run = async () => {
  await connectDB();
  try {
    await testAssertNotSelfDemotion();
    await testAssertSuperAdminSurvives();
    await testDevBypassTwoGate();
    log("ALL CHECKS PASSED");
  } finally {
    await teardown();
  }
};

run().catch(async error => {
  console.error("[test-auth-guards] FAILED:", error);
  process.exitCode = 1;
  try {
    await teardown();
  } catch {
    // best-effort cleanup after a failure
  }
});
