// Global achievements — path-wide awards that the level schema cannot hold
// (SPEC 2.6, 7). The level badges (Scene Scout, CPR Champion, Life Saver,
// Team Leader) live on the level documents themselves; this file is only
// for awards earned across the whole rescue path.
//
// Nothing here is stored. Every achievement is a pure function of the
// attempts + responses collections, recomputed on read — exactly like the
// level headline and star bands in scoring.js. A stored "achievement
// earned" flag would be one more counter that can drift out of sync with
// the evidence it is meant to summarise.

import Level from "../models/Level.js";
import Attempt from "../models/Attempt.js";
import Response from "../models/Response.js";
import { LEVEL_KEYS, STATUS } from "../../../shared/constants.js";

// "BLS Expert" — awarded for scoring above 95% overall on FIRST contact
// with the material, across every level.
//
// "Overall" here is the ITEM-WEIGHTED pooled first-attempt accuracy: the
// total number of questions answered correctly on the frozen first attempt
// (attemptNo 1) of each of the five levels, divided by the total number of
// questions across those five first attempts, as a percentage. It is not
// the unweighted mean of the five per-level accuracies — pooling by item
// stops a short level (prelevel and l4 are the smallest) from swinging the
// figure out of proportion to how much of the instrument it represents.
//
// It is computed from the FIRST attempt only, never from a later restart
// or remediation round. Every level is designed to end at 100% once
// remediation finishes, so an "overall accuracy" taken after remediation
// would be 100% for every participant and the achievement would carry no
// information at all — it has to measure first-contact performance to mean
// anything in the results chapter.
//
// It requires a submitted first attempt for all five levels; until then
// there is no defensible overall figure and the achievement is simply not
// yet earned. (If a level's attemptNo 1 was abandoned rather than
// submitted, that level has no frozen first attempt anywhere in the system
// — see summarizeLevelAttempts in scoring.js — and this award stays out of
// reach until it is played through, which is the conservative, defensible
// reading.)
export const BLS_EXPERT_THRESHOLD = 95;

export const ACHIEVEMENTS = Object.freeze([
  {
    key: "bls_expert",
    name: "BLS Expert",
    description: `Above ${BLS_EXPERT_THRESHOLD}% overall on your first attempt at every level.`,
    criterion: `Item-weighted first-attempt accuracy across all ${LEVEL_KEYS.length} levels above ${BLS_EXPERT_THRESHOLD}%.`
  }
]);

/**
 * Pure BLS Expert derivation.
 *
 * @param {Map<string, object>} firstAttemptsByLevelKey  submitted attemptNo:1
 *        attempt per level key (levels with no submitted first attempt are absent).
 * @param {Map<string, number>} firstAttemptCorrectById  count of counted
 *        (isRetry:false) correct responses per first-attempt id.
 */
export const computeBlsExpert = (firstAttemptsByLevelKey, firstAttemptCorrectById) => {
  const haveAllLevels = LEVEL_KEYS.every(key => firstAttemptsByLevelKey.has(key));

  let totalCorrect = 0;
  let totalQuestions = 0;
  let latestSubmittedAt = null;
  for (const key of LEVEL_KEYS) {
    const attempt = firstAttemptsByLevelKey.get(key);
    if (!attempt) continue;
    totalCorrect += firstAttemptCorrectById.get(String(attempt._id)) || 0;
    totalQuestions += attempt.questionIds.length;
    const submittedAt = attempt.submittedAt ? new Date(attempt.submittedAt) : null;
    if (submittedAt && (!latestSubmittedAt || submittedAt > latestSubmittedAt)) latestSubmittedAt = submittedAt;
  }

  // Comparison is on the exact ratio, not the rounded display value, so a
  // genuine 95.04% counts as "above 95" and the shown 95.0 does not
  // contradict the earned state.
  const exactAccuracy = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0;
  const earned = haveAllLevels && exactAccuracy > BLS_EXPERT_THRESHOLD;

  return {
    earned,
    earnedAt: earned ? latestSubmittedAt : null,
    progress: {
      levelsWithFirstAttempt: LEVEL_KEYS.filter(key => firstAttemptsByLevelKey.has(key)).length,
      levelsTotal: LEVEL_KEYS.length,
      overallFirstAttemptAccuracy: Math.round(exactAccuracy * 10) / 10
    }
  };
};

/**
 * The full achievement list with earned / lock state, ready for the API.
 * Pure function of the passed-in attempt/response rollups.
 */
export const summarizeAchievements = ({ firstAttemptsByLevelKey, firstAttemptCorrectById }) => {
  const blsExpert = computeBlsExpert(firstAttemptsByLevelKey, firstAttemptCorrectById);
  return ACHIEVEMENTS.map(achievement => {
    if (achievement.key === "bls_expert") {
      return { ...achievement, earned: blsExpert.earned, earnedAt: blsExpert.earnedAt, progress: blsExpert.progress };
    }
    return { ...achievement, earned: false, earnedAt: null, progress: null };
  });
};

/**
 * Loads exactly what the pure functions above need from the database: the
 * submitted attemptNo:1 attempt for each level, and the count of counted
 * correct responses within each. `excludeAttemptId` drops one attempt from
 * the rollup so a submit handler can compare "achievements before this
 * submit" against "after".
 */
export const loadAchievementInputs = async (participantId, { excludeAttemptId = null } = {}) => {
  const levels = await Level.find({ deletedAt: null }).select("_id key");
  const levelKeyById = new Map(levels.map(level => [String(level._id), level.key]));

  const firstAttempts = (
    await Attempt.find({ participantId, isPractice: false, status: STATUS.SUBMITTED, attemptNo: 1 })
  ).filter(attempt => !excludeAttemptId || String(attempt._id) !== String(excludeAttemptId));

  const firstAttemptsByLevelKey = new Map();
  for (const attempt of firstAttempts) {
    const key = levelKeyById.get(String(attempt.levelId));
    if (key) firstAttemptsByLevelKey.set(key, attempt);
  }

  const correctResponses = firstAttempts.length
    ? await Response.find({ attemptId: { $in: firstAttempts.map(a => a._id) }, isRetry: false, isCorrect: true }).select("attemptId")
    : [];
  const firstAttemptCorrectById = new Map();
  for (const response of correctResponses) {
    const key = String(response.attemptId);
    firstAttemptCorrectById.set(key, (firstAttemptCorrectById.get(key) || 0) + 1);
  }

  return { firstAttemptsByLevelKey, firstAttemptCorrectById };
};
