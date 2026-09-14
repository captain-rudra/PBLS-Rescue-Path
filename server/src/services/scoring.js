// Server-side game rules: scoring, star bands, and the three-outcome
// progression model (fail / remediate / mastered). The client only ever
// submits a `given` payload — everything in this file is what turns that
// into a score. See docs/SPEC.md sections 2.3, 2.7 and 3.7.

import { responseDamage, vitalsFromDamage } from "../../../shared/vitals.js";
import { ATTEMPT_OUTCOMES } from "../../../shared/constants.js";

export const OPTION_BASED_TYPES = new Set(["mcq", "video_mcq", "animation_mcq", "split_screen", "hotspot_video"]);

const SEQUENCE_POINTS_PER_ROW = 15;
const SEQUENCE_FULL_ORDER_BONUS = 40;

const STAR_BANDS = [
  { min: 97, stars: 3 },
  { min: 90, stars: 2 },
  { min: 80, stars: 1 }
];

/** Strips answer keys so a player payload never leaks the correct answer. */
export const toPlayerQuestion = question => {
  const q = typeof question.toObject === "function" ? question.toObject() : question;
  return {
    questionId: String(q._id),
    levelKey: q.levelKey,
    sequence: q.sequence,
    type: q.type,
    title: q.title,
    objective: q.objective,
    scenario: q.scenario ?? null,
    prompt: q.prompt,
    media: q.media ?? null,
    fallbackText: q.fallbackText ?? null,
    options: (q.options || []).map(({ key, text }) => ({ key, text })),
    buckets: q.buckets || [],
    items: (q.items || []).map(({ id, text }) => ({ id, text })),
    hotspots: (q.hotspots || []).map(({ tStart, tEnd, x, y, r, label }) => ({ tStart, tEnd, x, y, r, label })),
    sides: q.sides || [],
    points: q.points,
    version: q.version
  };
};

/** Validates the shape of `given` against the question type before scoring. */
export const validateGiven = (question, given) => {
  // interlude has nothing to choose — "watched both clips" is enforced
  // client-side only (SPEC 3.8), same trust model as gateOnFirstPlay and
  // mediaReplays elsewhere in this file. Any given (even {}) is accepted.
  if (question.type === "interlude") return true;
  if (OPTION_BASED_TYPES.has(question.type)) {
    return typeof given?.selected === "string" && given.selected.length > 0;
  }
  if (question.type === "drag_drop") {
    const items = question.items || [];
    const placements = given?.placements;
    if (!placements || typeof placements !== "object") return false;
    return items.every(item => typeof placements[item.id] === "string");
  }
  if (question.type === "sequence") {
    const correctOrder = question.correctOrder || [];
    const correctSet = new Set(correctOrder);
    const isValidPermutation = arr =>
      Array.isArray(arr) && arr.length === correctOrder.length && new Set(arr).size === arr.length && arr.every(id => correctSet.has(id));
    // `shownOrder` is the client's seeded-shuffle arrangement at first render
    // (SPEC 3.3) and is required, not optional metadata: without it a wrong
    // `order` cannot later be told apart from "never rearranged the shown
    // rows" versus "rearranged into a different wrong order" — the shuffle
    // means that distinction isn't recoverable from `order` alone once two
    // participants see the same item in different starting arrangements.
    return isValidPermutation(given?.order) && isValidPermutation(given?.shownOrder);
  }
  return false;
};

/** Pure scoring function: (question, given) -> { isCorrect, partialScore }. */
export const scoreResponse = (question, given) => {
  // Always "correct", zero points — interlude is unscored by design
  // (SPEC 3.8). Excluded from accuracy/streak/objectives in
  // aggregateAttempt/summarizeObjectives below, so this isCorrect is never
  // read as a real measurement — it exists only so the response row has a
  // defined shape like every other type's.
  if (question.type === "interlude") return { isCorrect: true, partialScore: 0 };

  if (OPTION_BASED_TYPES.has(question.type)) {
    const isCorrect = given.selected === question.correct;
    return { isCorrect, partialScore: isCorrect ? question.points : 0 };
  }

  if (question.type === "drag_drop") {
    const items = question.items || [];
    const pointsPerToken = items.length ? question.points / items.length : 0;
    const correctCount = items.reduce((count, item) => (given.placements[item.id] === item.bucket ? count + 1 : count), 0);
    return { isCorrect: correctCount === items.length, partialScore: Math.round(correctCount * pointsPerToken * 100) / 100 };
  }

  if (question.type === "sequence") {
    const correctOrder = question.correctOrder || [];
    const correctPositions = correctOrder.reduce((count, id, index) => (given.order[index] === id ? count + 1 : count), 0);
    const isCorrect = correctPositions === correctOrder.length;
    const partialScore = correctPositions * SEQUENCE_POINTS_PER_ROW + (isCorrect ? SEQUENCE_FULL_ORDER_BONUS : 0);
    return { isCorrect, partialScore };
  }

  throw new Error(`Unsupported question type for scoring: ${question.type}`);
};

/** +10 per consecutive correct beyond the first in a streak, capped at 100. */
export const computeStreakBonus = orderedIsCorrect => {
  let streak = 0;
  let bonus = 0;
  for (const correct of orderedIsCorrect) {
    if (correct) {
      streak += 1;
      if (streak >= 2) bonus += 10;
    } else {
      streak = 0;
    }
  }
  return Math.min(bonus, 100);
};

/**
 * Star bands, applied only to the level's frozen first attempt (SPEC 2.3):
 * mastering a level always eventually reaches 100%, so basing stars on the
 * final attempt would make every level end at three stars and the display
 * would carry no information. Pure function of accuracy — no pass/fail or
 * attempt-kind special-casing.
 */
export const computeStars = accuracy => {
  const band = STAR_BANDS.find(b => accuracy >= b.min);
  return band ? band.stars : 0;
};

/**
 * The three submit-time outcomes (SPEC 2.3/2.7). The pass mark gates only
 * a `kind: "first"` attempt — fail restarts the WHOLE level from question
 * 1. Once a `kind: "remediation"` attempt has been reached, the pass mark
 * no longer applies: a remediation round that isn't perfect produces
 * another remediation round over whatever's still missed, never a full
 * restart. Only 100% ends the chain, on either kind.
 *
 * Without this kind-awareness, remediation rounds shrink to their missed
 * subset each time and a round below ~5 items can't land in the pass-mark
 * band at all (no integer k satisfies 0.8n <= k < n for n < 5) — so a
 * second remediation round would be unreachable through real play on any
 * of this seed's levels, and a code path that can't be reached by playing
 * is not production code.
 */
export const outcomeFor = (accuracy, passMark, kind) => {
  if (accuracy === 100) return ATTEMPT_OUTCOMES.MASTERED;
  if (kind === "remediation") return ATTEMPT_OUTCOMES.REMEDIATE;
  if (accuracy >= passMark) return ATTEMPT_OUTCOMES.REMEDIATE;
  return ATTEMPT_OUTCOMES.FAIL;
};

/**
 * Which remediation round `attempt` is (1st, 2nd, ...), counting only
 * kind: "remediation" attempts for the same level up to and including it.
 * 0 for a non-remediation attempt. Used to auto-expand the feedback card
 * from the third round onward (SPEC 2.6) — always recomputed from the
 * attempts collection, never stored.
 */
export const remediationRoundFor = (attempt, allAttemptsForLevel) => {
  if (attempt.kind !== "remediation") return 0;
  return allAttemptsForLevel.filter(a => a.kind === "remediation" && a.attemptNo <= attempt.attemptNo).length;
};

/**
 * Rolls a set of counted (non-retry) responses up into the attempt-level
 * figures: score, accuracy, per-attempt stars, vitals and derived timing.
 * `questions` must be the exact set pinned to the attempt
 * (attempt.questionIds). Does NOT compute `passed` — whether this attempt
 * avoided a restart depends on its `kind` too (outcomeFor), not accuracy
 * alone, so that's the caller's job once it knows the outcome.
 */
export const aggregateAttempt = ({ level, questions, responses }) => {
  const ordered = [...responses].sort((a, b) => new Date(a.answeredAt) - new Date(b.answeredAt));
  const questionById = new Map(questions.map(q => [String(q._id), q]));
  // interlude is unscored (SPEC 3.8) — always isCorrect:true with 0
  // points, which would otherwise silently inflate accuracy (it never
  // lands as a wrong answer) and the streak bonus (a free "correct" between
  // two real ones). Excluded from every figure below except timing —
  // watching it is genuine time-on-task and is kept.
  const isScored = response => questionById.get(String(response.questionId))?.type !== "interlude";

  let totalPoints = 0;
  let correctCount = 0;
  let cumulativeDamage = 0;
  let activeMs = 0;
  let hiddenMs = 0;
  const missedQuestionIds = [];

  for (const response of ordered) {
    totalPoints += response.partialScore;
    if (isScored(response)) {
      if (response.isCorrect) {
        correctCount += 1;
      } else {
        missedQuestionIds.push(String(response.questionId));
      }
    }
    const question = questionById.get(String(response.questionId));
    cumulativeDamage += responseDamage(question?.points, response.partialScore);
    const itemMs = new Date(response.answeredAt) - new Date(response.shownAt) - (response.hiddenMs || 0);
    activeMs += Math.max(0, itemMs);
    hiddenMs += response.hiddenMs || 0;
  }

  const totalQuestions = questions.filter(q => q.type !== "interlude").length;
  const accuracy = totalQuestions ? Math.round((correctCount / totalQuestions) * 100) : 0;
  const streakBonus = computeStreakBonus(ordered.filter(isScored).map(r => r.isCorrect));
  const score = totalPoints + streakBonus;
  const starsAwarded = computeStars(accuracy);
  const vitalsEnd = vitalsFromDamage(cumulativeDamage);

  return { score, accuracy, starsAwarded, vitalsEnd, activeMs, hiddenMs, streakBonus, missedQuestionIds };
};

/**
 * Objective-level rollup for the result card (SPEC 2.6): "an objective is
 * ticked only when every item mapped to it was answered correctly."
 * `applicable: false` means no question in this attempt's pinned set
 * carries that objective — expected for a remediation attempt, which only
 * replays the missed subset of a level's full objective list.
 */
export const summarizeObjectives = ({ level, questions, responses }) => {
  const responseByQuestionId = new Map(responses.map(r => [String(r.questionId), r]));
  return level.objectives.map(objective => {
    // interlude carries an objective tag (SPEC 4.4 check 8 still applies to
    // it) but is not itself an assessment of that objective (SPEC 3.8) —
    // excluded here so its always-true response can't trivially satisfy one.
    const relevant = questions.filter(q => q.objective === objective && q.type !== "interlude");
    if (relevant.length === 0) return { objective, applicable: false, met: false };
    const met = relevant.every(q => responseByQuestionId.get(String(q._id))?.isCorrect === true);
    return { objective, applicable: true, met };
  });
};

/**
 * Rolls a level's full attempt history into the figures the dashboard,
 * result card and records all need — computed fresh from the attempts
 * collection every time, never stored (SPEC 2.3): the first attempt ever
 * made (attemptNo 1) is frozen as the level's headline score/accuracy/
 * stars forever, regardless of how many restarts or remediation rounds
 * follow; mastery is the first attempt (of any kind) that reached 100%;
 * restart and remediation counts are plain tallies of attempt `kind`.
 */
export const summarizeLevelAttempts = attempts => {
  const sorted = [...attempts].sort((a, b) => a.attemptNo - b.attemptNo);
  const firstAttempt = sorted.find(a => a.attemptNo === 1) || null;
  const masteryAttempt = sorted.find(a => a.accuracy === 100) || null;
  const latestAttempt = sorted.length ? sorted[sorted.length - 1] : null;
  const restartCount = Math.max(0, sorted.filter(a => a.kind === "first").length - 1);
  const remediationCount = sorted.filter(a => a.kind === "remediation").length;
  const headline = firstAttempt
    ? { attemptId: String(firstAttempt._id), score: firstAttempt.score, accuracy: firstAttempt.accuracy, starsAwarded: computeStars(firstAttempt.accuracy) }
    : null;
  return { firstAttempt, masteryAttempt, latestAttempt, restartCount, remediationCount, headline };
};

/**
 * Server-side level progression. `attemptsByLevelId` must contain only
 * submitted, non-practice attempts. The first level is always unlocked;
 * every later level unlocks once the previous one has been MASTERED
 * (100%, not merely past the pass mark) — see SPEC 2.3.
 *
 * Five node states: `locked`, `active` (unlocked, never attempted),
 * `complete` (mastered), `remediating` (latest attempt cleared the pass
 * mark but isn't 100% yet — one more remediation round due) and `failed`
 * (latest attempt was below the pass mark — the whole level restarts).
 */
export const computeLevelProgress = (levels, attemptsByLevelId) => {
  const progress = [];
  let previousMastered = true;
  for (const level of levels) {
    const attempts = attemptsByLevelId.get(String(level._id)) || [];
    const summary = summarizeLevelAttempts(attempts);
    const unlocked = previousMastered;

    let state;
    if (!unlocked) state = "locked";
    else if (summary.masteryAttempt) state = "complete";
    else if (!summary.latestAttempt) state = "active";
    else if (summary.latestAttempt.passed) state = "remediating";
    else state = "failed";

    progress.push({
      level,
      unlocked,
      state,
      starsAwarded: summary.headline?.starsAwarded ?? 0,
      headline: summary.headline,
      restartCount: summary.restartCount,
      remediationCount: summary.remediationCount,
      attempts
    });
    previousMastered = unlocked && Boolean(summary.masteryAttempt);
  }
  return progress;
};
