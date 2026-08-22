export const QUESTION_TYPES = Object.freeze([
  "mcq",
  "video_mcq",
  "animation_mcq",
  "drag_drop",
  "sequence",
  "split_screen",
  "hotspot_video"
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
export const ATTEMPT_KINDS = Object.freeze(["first", "remediation", "replay"]);