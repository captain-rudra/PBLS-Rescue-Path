import AuditLog from "../models/AuditLog.js";

// CLAUDE.md rule 8: every admin action is audited — actor, action, target,
// before, after, reason. One row per row-level change rather than one row
// per API call, so a bulk action (e.g. generating fifty codes) leaves a
// trail exactly as granular as "which fifty rows changed and how".
export const writeAuditLog = ({ actorId, actorRole, action, target, before = null, after = null, reason = null, ip = null }) =>
  AuditLog.create({ actorId, actorRole, action, target, before, after, reason, ip });
