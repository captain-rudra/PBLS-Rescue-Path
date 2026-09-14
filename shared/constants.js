export const QUESTION_TYPES = Object.freeze([
  "mcq",
  "video_mcq",
  "animation_mcq",
  "drag_drop",
  "sequence",
  "split_screen",
  "hotspot_video",
  "interlude"
]);

export const LEVEL_KEYS = Object.freeze(["prelevel", "l1", "l2", "l3", "l4"]);

export const STATUS = Object.freeze({
  DRAFT: "draft",
  PUBLISHED: "published",
  LOCKED: "locked",
  ARCHIVED: "archived",
  IN_PROGRESS: "in_progress",
  SUBMITTED: "submitted",
  ABANDONED: "abandoned",
  KICKED: "kicked"
});

export const ROLES = Object.freeze({ ADMIN: "admin", SUPER_ADMIN: "super_admin" });

export const KICK_REASONS = Object.freeze([
  "code_sharing",
  "disengaged",
  "technical_issue",
  "participant_request",
  "other"
]);

export const SESSION_MODES = Object.freeze(["controlled", "open"]);

// "replay" was removed: stars are now frozen to the first attempt (see
// scoring.js), so replaying a mastered level can no longer change them and
// there is nothing left for a third kind to mean.
export const ATTEMPT_KINDS = Object.freeze(["first", "remediation"]);

// The three submit-time outcomes (docs/SPEC.md 2.3/2.7): below the pass
// mark restarts the whole level from question 1, at-or-above it but short
// of 100% opens a remediation round over just what was missed, and exactly
// 100% unlocks the next level. Never stored — always derived from
// (accuracy, level.passMark) so it can't drift out of sync with them.
export const ATTEMPT_OUTCOMES = Object.freeze({ FAIL: "fail", REMEDIATE: "remediate", MASTERED: "mastered" });

// Two completely separate token systems (CLAUDE.md "Auth model"). Every
// guard checks `aud` first, before role or anything else — a token issued
// for one audience must never satisfy a route guarded for the other.
export const TOKEN_AUDIENCE = Object.freeze({ ADMIN: "admin", PLAY: "play" });

export const ADMIN_TOKEN_TTL = "8h";
export const PARTICIPANT_TOKEN_TTL = "6h";

// SPEC 6.3 sign-in guards.
export const MAX_FAILED_PIN_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 10;
export const SIGNIN_RATE_LIMIT_PER_MINUTE = 10;

export const BCRYPT_SALT_ROUNDS = 10;