// Thin fetch wrapper around the Step 2a /play API. No auth headers yet —
// the server resolves the participant from DEV_PARTICIPANT_ID (see
// server/src/middleware/requireParticipant.js).

const request = async (method, path, body) => {
  const res = await fetch(`/play${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error(json?.error?.message || `Request failed with status ${res.status}`);
    error.code = json?.error?.code || "UNKNOWN_ERROR";
    error.status = res.status;
    throw error;
  }
  return json;
};

export const getLevels = () => request("GET", "/levels");

export const getAchievements = () => request("GET", "/achievements");

export const startAttempt = (levelKey, kind = "first") => request("POST", "/attempts", { levelKey, kind });

export const postResponse = payload => request("POST", "/responses", payload);

export const submitAttempt = attemptId => request("POST", `/attempts/${attemptId}/submit`);

export const abandonAttempt = attemptId => request("POST", `/attempts/${attemptId}/abandon`);

export const getAttemptReview = attemptId => request("GET", `/attempts/${attemptId}/review`);

// Fire-and-forget: reports time lingered on the read-only review screen so
// it lands on the attempt separate from time-on-task. `keepalive` lets it
// still send while the page is being navigated away from.
export const reportReviewTime = (attemptId, ms) =>
  fetch(`/play/attempts/${attemptId}/review-time`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ms }),
    keepalive: true
  }).catch(() => {});
