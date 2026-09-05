// A minimal fixed-window limiter, in-process only — this instrument runs
// as a single Express process for a single study session (CLAUDE.md: "one
// afternoon, forty phones"), so there is no multi-instance deployment to
// coordinate across and no case for pulling in Redis for one counter.
//
// `key` is caller-chosen (e.g. a participant code) so the same limiter can
// gate independent buckets. Returns true if the call is allowed (and counts
// it), false if the caller is over limit for the current window.
const windows = new Map();

export const checkRateLimit = (key, { max, windowMs }) => {
  const now = Date.now();
  const entry = windows.get(key);
  if (!entry || now - entry.windowStart >= windowMs) {
    windows.set(key, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count += 1;
  return true;
};

// Sweeps windows that ended over an hour ago so this Map can't grow
// unboundedly across a long-running process. Not required for correctness
// (a stale entry just ages out naturally on next check), only for memory.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const STALE_AFTER_MS = 60 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - STALE_AFTER_MS;
  for (const [key, entry] of windows) if (entry.windowStart < cutoff) windows.delete(key);
}, SWEEP_INTERVAL_MS).unref();
