import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { loginPlay, setPlayPin } from "../lib/api.js";
import { setToken } from "../lib/auth.js";

// SPEC 6.1/6.3 — sign in with a pre-generated code and a 4-digit PIN the
// participant chooses on first use. No email, no password, no
// self-registration: the code is handed out on a printed slip, so it is
// the only credential needed to choose the first PIN (identity was already
// verified in person — CLAUDE.md). Three steps, but only ever one call per
// submit:
//
//   "code"   -> POST /auth/play/login with no pin. The response tells us
//               which of the other two steps this code needs: `needsPin`
//               (never signed in before) or a 400 on the missing pin (a
//               PIN already exists) — never a guess on the client's part.
//   "pin"    -> returning participant, POST /auth/play/login with the pin.
//   "setpin" -> first sign-in, POST /auth/play/set-pin.
const CODE_FORMAT_HINT = "e.g. PBLS-E-047";

const digitsOnly = value => value.replace(/\D/g, "").slice(0, 4);

export const SignIn = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState("code");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Set by App.jsx's signed-out handler when THIS device's session was
  // superseded by a sign-in elsewhere (SPEC 6.3) — shown once, here, since
  // this is the screen the kicked-out device actually lands on.
  const [notice] = useState(location.state?.supersededElsewhere ? "Signed in on another device — you were signed out here." : null);

  const settle = response => {
    setToken(response.token);
    navigate("/", { replace: true });
  };

  const handleCodeSubmit = async event => {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await loginPlay(code.trim());
      if (response.needsPin) {
        setStep("setpin");
      } else {
        // The server only ever replies here with `needsPin: true` when a
        // pin wasn't required — an OK with no needsPin (a stored PIN was
        // somehow satisfied by an empty pin) can't happen, so reaching
        // this branch just means "ask for the existing PIN".
        setStep("pin");
      }
    } catch (err) {
      if (err.code === "INVALID_PIN_FORMAT") {
        // Signal, not a failure: this code already has a PIN — ask for it.
        setStep("pin");
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePinSubmit = async event => {
    event.preventDefault();
    if (pin.length !== 4) return;
    setBusy(true);
    setError(null);
    try {
      const response = await loginPlay(code.trim(), pin);
      settle(response);
    } catch (err) {
      setError(err.message);
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const handleSetPinSubmit = async event => {
    event.preventDefault();
    if (pin.length !== 4) return;
    if (pin !== confirmPin) {
      setError("Those two PINs don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await setPlayPin(code.trim(), pin);
      settle(response);
    } catch (err) {
      if (err.code === "PIN_ALREADY_SET") {
        // Race with another tab/device setting it first — fall back to
        // asking for the PIN instead of dead-ending here.
        setStep("pin");
        setPin("");
        setConfirmPin("");
        setError("A PIN was just set for this code — enter it below.");
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const backToCode = () => {
    setStep("code");
    setPin("");
    setConfirmPin("");
    setError(null);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FFF7ED] px-4 text-[#16243D]">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-sm rounded-lg border border-[#3A4A63]/20 bg-white/60 p-6"
      >
        <h1 className="text-xl font-semibold" style={{ fontFamily: "Fredoka, sans-serif" }}>
          The rescue path
        </h1>
        <p className="mt-1 text-[12px] text-slate-500">Sign in with the code on your printed slip.</p>

        {notice && <p className="mt-3 rounded-md bg-[#FFC94A]/15 px-3 py-2 text-[12px] text-[#16243D]">{notice}</p>}
        {error && <p className="mt-3 rounded-md bg-[#FF6B5B]/10 px-3 py-2 text-[12px] text-[#FF6B5B]">{error}</p>}

        {step === "code" && (
          <form onSubmit={handleCodeSubmit} className="mt-5 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
              Code
              <input
                data-testid="signin-code"
                autoFocus
                value={code}
                onChange={event => setCode(event.target.value.toUpperCase())}
                placeholder={CODE_FORMAT_HINT}
                className="rounded-md border border-[#3A4A63]/40 bg-white px-3 py-2 text-[15px] font-normal normal-case text-[#16243D] tracking-widest focus:border-[#34D399] focus:outline-none"
              />
            </label>
            <button
              type="submit"
              data-testid="signin-continue"
              disabled={busy || !code.trim()}
              className="mt-1 w-full rounded-md bg-[#34D399] px-4 py-2.5 text-sm font-semibold text-[#16243D] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Checking…" : "Continue"}
            </button>
          </form>
        )}

        {step === "pin" && (
          <form onSubmit={handlePinSubmit} className="mt-5 flex flex-col gap-3">
            <p className="text-[12px] text-slate-500">
              Code <span className="font-semibold text-[#16243D]">{code.trim()}</span>
            </p>
            <label className="flex flex-col gap-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
              4-digit PIN
              <input
                data-testid="signin-pin"
                autoFocus
                inputMode="numeric"
                type="password"
                value={pin}
                onChange={event => setPin(digitsOnly(event.target.value))}
                className="rounded-md border border-[#3A4A63]/40 bg-white px-3 py-2 text-center text-[20px] tracking-[0.5em] text-[#16243D] focus:border-[#34D399] focus:outline-none"
              />
            </label>
            <button
              type="submit"
              data-testid="signin-submit-pin"
              disabled={busy || pin.length !== 4}
              className="mt-1 w-full rounded-md bg-[#34D399] px-4 py-2.5 text-sm font-semibold text-[#16243D] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button type="button" onClick={backToCode} className="text-[11px] text-slate-500 underline">
              Not your code? Start over
            </button>
          </form>
        )}

        {step === "setpin" && (
          <form onSubmit={handleSetPinSubmit} className="mt-5 flex flex-col gap-3">
            <p className="text-[12px] text-slate-500">
              First time signing in with <span className="font-semibold text-[#16243D]">{code.trim()}</span> — choose a 4-digit PIN.
            </p>
            <label className="flex flex-col gap-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
              Choose a PIN
              <input
                data-testid="signin-new-pin"
                autoFocus
                inputMode="numeric"
                type="password"
                value={pin}
                onChange={event => setPin(digitsOnly(event.target.value))}
                className="rounded-md border border-[#3A4A63]/40 bg-white px-3 py-2 text-center text-[20px] tracking-[0.5em] text-[#16243D] focus:border-[#34D399] focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
              Confirm PIN
              <input
                data-testid="signin-confirm-pin"
                inputMode="numeric"
                type="password"
                value={confirmPin}
                onChange={event => setConfirmPin(digitsOnly(event.target.value))}
                className="rounded-md border border-[#3A4A63]/40 bg-white px-3 py-2 text-center text-[20px] tracking-[0.5em] text-[#16243D] focus:border-[#34D399] focus:outline-none"
              />
            </label>
            <button
              type="submit"
              data-testid="signin-submit-setpin"
              disabled={busy || pin.length !== 4 || confirmPin.length !== 4}
              className="mt-1 w-full rounded-md bg-[#34D399] px-4 py-2.5 text-sm font-semibold text-[#16243D] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Saving…" : "Set PIN and start"}
            </button>
            <button type="button" onClick={backToCode} className="text-[11px] text-slate-500 underline">
              Not your code? Start over
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
};
