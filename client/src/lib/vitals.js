// Display-only wrapper around the shared vitals cost model (shared/vitals.js
// — the same module server/src/services/scoring.js imports for the stored
// `vitalsEnd`). This file must never reimplement the cost formula itself;
// that's exactly how the live HUD and the stored figure drifted apart
// before. The only things that belong here are the DISPLAY_FLOOR (a UI
// choice — "never reaches zero on screen", SPEC 2.3 — not a data rule) and
// the coarse state banding used to color the HUD. Purely cosmetic: the bar
// no longer triggers anything at any threshold.
import { responseDamage as sharedResponseDamage, vitalsFromDamage, VITALS_BAND_COST, VITALS_CRITICAL_THRESHOLD } from "../../../shared/vitals.js";

const DISPLAY_FLOOR = 40;

export const responseDamage = (question, partialScore) => sharedResponseDamage(question.points, partialScore);

export const vitalsDisplayFrom = cumulativeDamage => Math.max(DISPLAY_FLOOR, vitalsFromDamage(cumulativeDamage));

export const vitalsStateFrom = cumulativeDamage => {
  if (cumulativeDamage <= 0) return "stable";
  if (cumulativeDamage < VITALS_BAND_COST * 2) return "one_error";
  if (cumulativeDamage < VITALS_CRITICAL_THRESHOLD) return "two_errors";
  return "critical";
};
