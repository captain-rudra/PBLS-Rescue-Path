import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { loginAdmin } from "../lib/adminApi.js";
import { setAdminToken } from "../lib/adminAuth.js";

// Email + password, bcrypt-checked server-side (CLAUDE.md's admin auth
// model) — completely separate from the participant's code+PIN sign-in.
export const AdminSignIn = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice] = useState(location.state?.supersededElsewhere ? "Signed out — your token was no longer valid." : null);

  const handleSubmit = async event => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await loginAdmin(email.trim(), password);
      setAdminToken(response.token);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FFF7ED] px-4 text-[#16243D]">
      <div className="w-full max-w-sm rounded-lg border border-[#3A4A63]/20 bg-white/60 p-6">
        <h1 className="text-xl font-semibold" style={{ fontFamily: "Fredoka, sans-serif" }}>
          Admin console
        </h1>
        <p className="mt-1 text-[12px] text-slate-500">Sign in to author content.</p>

        {notice && <p className="mt-3 rounded-md bg-[#FFC94A]/15 px-3 py-2 text-[12px] text-[#16243D]">{notice}</p>}
        {error && <p className="mt-3 rounded-md bg-[#FF6B5B]/10 px-3 py-2 text-[12px] text-[#FF6B5B]">{error}</p>}

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
            Email
            <input
              data-testid="admin-signin-email"
              autoFocus
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              className="rounded-md border border-[#3A4A63]/40 bg-white px-3 py-2 text-[14px] font-normal normal-case text-[#16243D] focus:border-[#34D399] focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
            Password
            <input
              data-testid="admin-signin-password"
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              className="rounded-md border border-[#3A4A63]/40 bg-white px-3 py-2 text-[14px] font-normal normal-case text-[#16243D] focus:border-[#34D399] focus:outline-none"
            />
          </label>
          <button
            type="submit"
            data-testid="admin-signin-submit"
            disabled={busy || !email.trim() || !password}
            className="mt-1 w-full rounded-md bg-[#34D399] px-4 py-2.5 text-sm font-semibold text-[#16243D] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
};
