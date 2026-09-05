import { Navigate, Outlet } from "react-router-dom";
import { getToken } from "../lib/auth.js";

// Gates every game route behind a stored token. This is a UX shortcut, not
// the security boundary — every /play/* call is independently verified
// server-side regardless of what this checks (CLAUDE.md), so this only
// ever saves a flash of the dashboard before an inevitable redirect when
// there is plainly no token yet.
export const AuthGate = () => {
  const token = getToken();
  if (!token) return <Navigate to="/signin" replace />;
  return <Outlet />;
};
