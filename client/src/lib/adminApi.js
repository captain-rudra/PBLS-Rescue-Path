// Thin fetch wrapper for the admin console, mirroring lib/api.js's shape
// but against the admin token and the /admin + /auth/admin routes.
import { getAdminToken, signalAdminSignedOut } from "./adminAuth.js";

const coreFetch = async (path, { method = "GET", body, auth = true } = {}) => {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getAdminToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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

export const getLevels = () => request("GET", "/levels");
export const lockLevel = (levelId, reason) => request("POST", `/levels/${levelId}/lock`, { reason });
export const unlockLevel = (levelId, reason) => request("POST", `/levels/${levelId}/unlock`, { reason });

export const getQuestions = (filters = {}) => {
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const query = params.toString();
  return request("GET", `/questions${query ? `?${query}` : ""}`);
};
export const getQuestion = id => request("GET", `/questions/${id}`);
export const createQuestion = payload => request("POST", "/questions", payload);
export const updateQuestion = (id, payload) => request("PATCH", `/questions/${id}`, payload);
export const archiveQuestion = (id, reason) => request("DELETE", `/questions/${id}`, { reason });
export const reorderQuestions = (levelKey, orderedQuestionIds, reason) => request("POST", "/questions/reorder", { levelKey, orderedQuestionIds, reason });
