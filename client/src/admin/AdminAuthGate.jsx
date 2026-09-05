import { Navigate, Outlet } from "react-router-dom";
import { getAdminToken } from "../lib/adminAuth.js";

// Same shortcut as the participant's AuthGate.jsx: a UX convenience, not
// the security boundary — every /admin/* call is independently verified
// server-side (requireAdmin, then requireSuperAdmin where SPEC 4 requires
// it) regardless of what this checks.
export const AdminAuthGate = () => {
  const token = getAdminToken();
  if (!token) return <Navigate to="/admin/signin" replace />;
  return <Outlet />;
};
