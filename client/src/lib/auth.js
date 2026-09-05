// Token storage for the participant session. localStorage here is just a
// resume convenience (survives a refresh) — every route still enforces the
// real thing server-side; nothing here is treated as a source of truth for
// game state (CLAUDE.md).
const TOKEN_KEY = "pbls.participant.token";

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // private window / site data blocked — fall back to signed-out
  }
};

export const setToken = token => {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Session still works for this page load; it just won't survive a refresh.
  }
};

export const clearToken = () => {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // see setToken
  }
};

// Fired whenever the API layer sees a 401 on an authenticated call (token
// expired, superseded by a sign-in elsewhere, or never valid) so the app
// shell can react by routing to sign-in without every call site needing to
// know how to do that itself. `code` is the server's error code (e.g.
// "SESSION_SUPERSEDED") so the sign-in screen can show an accurate reason
// rather than a generic message for every kind of 401.
export const SIGNED_OUT_EVENT = "pbls:signed-out";

export const signalSignedOut = code => {
  clearToken();
  window.dispatchEvent(new CustomEvent(SIGNED_OUT_EVENT, { detail: { code } }));
};
