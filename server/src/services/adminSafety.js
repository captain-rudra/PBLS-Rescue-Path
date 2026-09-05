import Admin from "../models/Admin.js";
import { ROLES } from "../../../shared/constants.js";
import { HttpError } from "../lib/httpError.js";

// Two invariants from CLAUDE.md's "Enforced in code" list. Both are pure
// checks against the admins collection so any future route that can change
// an admin's role or active flag (promotion/demotion, deactivation) can
// call them before writing, rather than re-deriving this logic per route.

/** Throws if `actorAdminId` is trying to change their own role/active state away from super_admin. */
export const assertNotSelfDemotion = (actorAdminId, targetAdminId, nextRole) => {
  if (String(actorAdminId) === String(targetAdminId) && nextRole !== ROLES.SUPER_ADMIN) {
    throw new HttpError(403, "CANNOT_SELF_DEMOTE", "A super_admin cannot demote themselves");
  }
};

/** Throws if demoting/deactivating `targetAdminId` would leave zero active super_admins. */
export const assertSuperAdminSurvives = async (targetAdminId, { nextRole, nextActive = true }) => {
  const target = await Admin.findById(targetAdminId);
  if (!target || target.role !== ROLES.SUPER_ADMIN || target.deletedAt) return; // not currently an active super_admin — nothing to protect
  const remainsSuperAdmin = nextRole === ROLES.SUPER_ADMIN && nextActive;
  if (remainsSuperAdmin) return;

  const otherActiveSuperAdmins = await Admin.countDocuments({
    _id: { $ne: targetAdminId },
    role: ROLES.SUPER_ADMIN,
    active: true,
    deletedAt: null
  });
  if (otherActiveSuperAdmins === 0) {
    throw new HttpError(409, "LAST_SUPER_ADMIN", "At least one active super_admin must always exist");
  }
};
