// Thin fetch wrapper around the API. Every call attaches the stored
// participant token (see lib/auth.js) unless explicitly told not to — the
// two sign-in calls are the only ones made before a token exists.
import { getToken, signalSignedOut } from "./auth.js";
import { API_BASE } from "./apiBase.js";

const coreFetch = async (path, { method = "GET", body, auth = true } = {}) => {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    // A 401 on an authenticated call means the token is gone for good
    // (expired, or superseded by a sign-in elsewhere) — never worth
    // retrying, so route back to sign-in rather than surface a dead end.
    if (res.status === 401 && auth) signalSignedOut(json?.error?.code);
    const error = new Error(json?.error?.message || `Request failed with status ${res.status}`);
    error.code = json?.error?.code || "UNKNOWN_ERROR";
    error.status = res.status;
    throw error;
  }
  return json;
};

const request = (method, path, body) => coreFetch(`/play${path}`, { method, body });

export const getLevels = () => request("GET", "/levels");

export const getLevelAttempts = levelKey => request("GET", `/levels/${levelKey}/attempts`);

export const getAchievements = () => request("GET", "/achievements");

export const startAttempt = (levelKey, kind = "first") => request("POST", "/attempts", { levelKey, kind });

export const postResponse = payload => request("POST", "/responses", payload);

export const submitAttempt = attemptId => request("POST", `/attempts/${attemptId}/submit`);

export const abandonAttempt = attemptId => request("POST", `/attempts/${attemptId}/abandon`);

export const getAttemptReview = attemptId => request("GET", `/attempts/${attemptId}/review`);

// Fire-and-forget: reports time lingered on the read-only review screen so
// it lands on the attempt separate from time-on-task. `keepalive` lets it
// still send while the page is being navigated away from.
export const reportReviewTime = (attemptId, ms) => {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${API_BASE}/play/attempts/${attemptId}/review-time`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ms }),
    keepalive: true
  }).catch(() => {});
};

// Auth — no token exists yet for either of these, so they're deliberately
// unauthenticated calls (SPEC 9's /auth/play/login and /auth/play/set-pin).
// `pin` omitted means "just checking this code": the server replies either
// `needsPin: true` (never signed in before) or a 400 on the missing pin
// (an existing PIN is required) — see auth/SignIn.jsx for how that forks.
export const loginPlay = (code, pin) => coreFetch("/auth/play/login", { method: "POST", body: pin === undefined ? { code } : { code, pin }, auth: false });

export const setPlayPin = (code, pin) => coreFetch("/auth/play/set-pin", { method: "POST", body: { code, pin }, auth: false });

export const getMe = () => coreFetch("/auth/me", { method: "GET" });
