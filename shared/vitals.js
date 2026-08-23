// The vitals-bar cost model (SPEC 2.3), shared by the client's live HUD and
// the server's stored `vitalsEnd`. A full wrong answer costs one band
// (100 -> 93 -> 86 -> 79, 7 points each). A partial result (a drag with some
// tokens misplaced, a sequence with rows out of place) costs the same 7
// points scaled by how wrong it was, rounded up so any mistake costs at
// least something: one token wrong out of six costs ceil(7 * 1/6) = 2, not
// the full 7. Both sides must import this — a client-only or server-only
// reimplementation is how the HUD and the stored figure end up disagreeing.
export const VITALS_BAND_COST = 7;
export const VITALS_RESTART_BANDS = 3;
export const VITALS_RESTART_THRESHOLD = VITALS_BAND_COST * VITALS_RESTART_BANDS; // 21

/** Damage (0-7) a single response costs the vitals bar. */
export const responseDamage = (maxPoints, partialScore) => {
  const max = maxPoints || 0;
  if (max <= 0) return 0;
  const wrongFraction = Math.min(1, Math.max(0, 1 - partialScore / max));
  if (wrongFraction === 0) return 0;
  return Math.ceil(VITALS_BAND_COST * wrongFraction);
};

/** Cumulative damage across a run of responses -> the SpO2 reading. */
export const vitalsFromDamage = cumulativeDamage => Math.max(0, 100 - cumulativeDamage);
