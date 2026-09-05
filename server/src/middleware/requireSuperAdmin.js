import { ROLES } from "../../../shared/constants.js";
import { sendError } from "../lib/httpError.js";

// Must run after requireAdmin — it only refines the role check on the
// admin requireAdmin already resolved and attached to `request.admin`.
export const requireSuperAdmin = (request, response, next) => {
  if (!request.admin) return sendError(response, 500, "CONFIG_ERROR", "requireSuperAdmin must be mounted after requireAdmin");
  if (request.admin.role !== ROLES.SUPER_ADMIN) return sendError(response, 403, "SUPER_ADMIN_REQUIRED", "This action requires a super_admin");
  next();
};
