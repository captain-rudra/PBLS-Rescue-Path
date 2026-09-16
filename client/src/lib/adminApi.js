// Thin fetch wrapper for the admin console, mirroring lib/api.js's shape
// but against the admin token and the /admin + /auth/admin routes.
import { getAdminToken, signalAdminSignedOut } from "./adminAuth.js";
import { API_BASE } from "./apiBase.js";

const coreFetch = async (path, { method = "GET", body, auth = true } = {}) => {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getAdminToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && auth) signalAdminSignedOut(json?.error?.code);
    const error = new Error(json?.error?.message || `Request failed with status ${res.status}`);
    error.code = json?.error?.code || "UNKNOWN_ERROR";
    error.status = res.status;
    throw error;
  }
  return json;
};

const request = (method, path, body) => coreFetch(`/admin${path}`, { method, body });

export const loginAdmin = (email, password) => coreFetch("/auth/admin/login", { method: "POST", body: { email, password }, auth: false });

export const getMe = () => coreFetch("/auth/me", { method: "GET" });

export const getLevels = ({ includeDeleted } = {}) => request("GET", `/levels${includeDeleted ? "?includeDeleted=true" : ""}`);
export const lockLevel = (levelId, reason) => request("POST", `/levels/${levelId}/lock`, { reason });
export const unlockLevel = (levelId, reason) => request("POST", `/levels/${levelId}/unlock`, { reason });
// Soft delete (sets deletedAt — CLAUDE.md rule 5, never a real removal).
export const deleteLevel = (levelId, reason) => request("DELETE", `/levels/${levelId}`, { reason });
// Irreversible — only succeeds once already soft-deleted AND never played.
export const hardDeleteLevel = (levelId, reason) => request("DELETE", `/levels/${levelId}/permanent`, { reason });

export const getQuestions = (filters = {}) => {
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const query = params.toString();
  return request("GET", `/questions${query ? `?${query}` : ""}`);
};
export const getQuestion = id => request("GET", `/questions/${id}`);
export const createQuestion = payload => request("POST", "/questions", payload);
export const updateQuestion = (id, payload) => request("PATCH", `/questions/${id}`, payload);
export const archiveQuestion = (id, reason) => request("DELETE", `/questions/${id}`, { reason });
// Straight back to published. May force some participants to redo the
// level (see the server route's comment) — the response's
// affectedParticipantCount says how many.
export const unarchiveQuestion = (id, reason) => request("POST", `/questions/${id}/unarchive`, { reason });
// Irreversible — only succeeds once already archived AND never served to a real attempt.
export const hardDeleteQuestion = (id, reason) => request("DELETE", `/questions/${id}/permanent`, { reason });
export const reorderQuestions = (levelKey, orderedQuestionIds, reason) => request("POST", "/questions/reorder", { levelKey, orderedQuestionIds, reason });

// --- Records and analytics (SPEC §11) ---------------------------------
const scopeQuery = scope => {
  const params = new URLSearchParams();
  if (scope.includeExcluded) params.set("includeExcluded", "true");
  if (scope.includePractice) params.set("includePractice", "true");
  if (scope.sessionId) params.set("sessionId", scope.sessionId);
  if (scope.arm) params.set("arm", scope.arm);
  const q = params.toString();
  return q ? `?${q}` : "";
};

export const getSessions = () => request("GET", "/sessions");

// --- Participant management (SPEC 6) ---------------------------------
const participantQuery = ({ sessionId, arm, ids, includeDeleted } = {}) => {
  const params = new URLSearchParams();
  if (sessionId) params.set("sessionId", sessionId);
  if (arm) params.set("arm", arm);
  if (ids && ids.length) params.set("ids", Array.isArray(ids) ? ids.join(",") : ids);
  if (includeDeleted) params.set("includeDeleted", "true");
  const q = params.toString();
  return q ? `?${q}` : "";
};

export const getParticipants = (filters = {}) => request("GET", `/participants${participantQuery(filters)}`);
export const generateCodes = ({ arm, count, prefix, sessionId, labels }) =>
  request("POST", "/participants/generate", {
    arm,
    count,
    ...(prefix ? { prefix } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(labels ? { labels } : {})
  });
export const resetParticipantPin = (id, reason) => request("POST", `/participants/${id}/reset-pin`, { reason });
export const updateParticipant = (id, patch) => request("PATCH", `/participants/${id}`, patch);
export const getSlips = (filters = {}) => request("GET", `/participants/slips${participantQuery(filters)}`);
// Soft delete (sets deletedAt — CLAUDE.md rule 5, never a real removal).
export const deleteParticipant = (id, reason) => request("DELETE", `/participants/${id}`, { reason });
// Irreversible — only succeeds once already soft-deleted AND never played.
export const hardDeleteParticipant = (id, reason) => request("DELETE", `/participants/${id}/permanent`, { reason });
// Never touches an existing Attempt/Response — see the server route's comment.
export const resetParticipantLevel = (id, levelId, reason) => request("POST", `/participants/${id}/reset-level`, { levelId, reason });
export const getRecordsParticipants = (scope = {}) => request("GET", `/records/participants${scopeQuery(scope)}`);
export const getItemAnalysis = (scope = {}) => request("GET", `/records/items${scopeQuery(scope)}`);
export const getRecordsTrail = (participantId, levelKey) =>
  request("GET", `/records/trail?participantId=${encodeURIComponent(participantId)}&levelKey=${encodeURIComponent(levelKey)}`);

// Downloads one CSV. The auth token is in localStorage, not a cookie, so a
// plain <a href> can't carry it — fetch with the header, then hand the
// browser a Blob to save. The filename comes from the server's
// Content-Disposition (it encodes the include choices — SPEC §11).
export const downloadExport = async (file, scope = {}) => {
  const token = getAdminToken();
  const res = await fetch(`${API_BASE}/admin/records/export?file=${file}${scopeQuery(scope).replace(/^\?/, "&")}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    if (res.status === 401) signalAdminSignedOut(json?.error?.code);
    const error = new Error(json?.error?.message || `Export failed with status ${res.status}`);
    error.code = json?.error?.code || "UNKNOWN_ERROR";
    error.status = res.status;
    throw error;
  }
  const blob = await res.blob();
  const filename = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || `${file}.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return filename;
};
