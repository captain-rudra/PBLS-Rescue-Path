// Token storage for the admin session — completely separate key from the
// participant's (lib/auth.js). Two different token systems (CLAUDE.md's
// Auth model), so they never share storage either.
const TOKEN_KEY = "pbls.admin.token";

export const getAdminToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const setAdminToken = token => {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Session still works for this page load; it just won't survive a refresh.
  }
};

export const clearAdminToken = () => {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // see setAdminToken
  }
};

export const ADMIN_SIGNED_OUT_EVENT = "pbls:admin-signed-out";

export const signalAdminSignedOut = code => {
  clearAdminToken();
  window.dispatchEvent(new CustomEvent(ADMIN_SIGNED_OUT_EVENT, { detail: { code } }));
};
