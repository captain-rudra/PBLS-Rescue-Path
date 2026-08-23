// Server-side game rules: scoring, star bands, pass/fail and remediation
// routing. The client only ever submits a `given` payload — everything in
// this file is what turns that into a score. See docs/SPEC.md section 3.7.

import { responseDamage, vitalsFromDamage } from "../../../shared/vitals.js";

const OPTION_BASED_TYPES = new Set(["mcq", "video_mcq", "animation_mcq", "split_screen", "hotspot_video"]);

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
    const order = given?.order;
    if (!Array.isArray(order) || order.length !== correctOrder.length) return false;
    const correctSet = new Set(correctOrder);
    return order.every(id => correctSet.has(id)) && new Set(order).size === order.length;
  }
  return false;
};

/** Pure scoring function: (question, given) -> { isCorrect, partialScore }. */
export const scoreResponse = (question, given) => {
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
 * Star bands apply to `first`/`replay` attempts. A remediation attempt
 * always awards exactly one star on pass, per SPEC 2.7 ("Passing
 * remediation awards one star"). Any pass below the 80% band still earns
 * one star — a level cannot be passed and awarded zero stars.
 */
export const computeStars = ({ accuracy, passed, kind }) => {
  if (!passed) return 0;
  if (kind === "remediation") return 1;
  const band = STAR_BANDS.find(b => accuracy >= b.min);
  return band ? band.stars : 1;
};

/**
 * Rolls a set of counted (non-retry) responses up into the attempt-level
 * figures: score, accuracy, pass/fail, stars, vitals and derived timing.
 * `questions` must be the exact set pinned to the attempt (attempt.questionIds).
 */
export const aggregateAttempt = ({ level, attempt, questions, responses }) => {
  const ordered = [...responses].sort((a, b) => new Date(a.answeredAt) - new Date(b.answeredAt));
  const questionById = new Map(questions.map(q => [String(q._id), q]));

  let totalPoints = 0;
  let correctCount = 0;
  let cumulativeDamage = 0;
  let activeMs = 0;
  let hiddenMs = 0;
  const missedQuestionIds = [];

  for (const response of ordered) {
    totalPoints += response.partialScore;
    if (response.isCorrect) {
      correctCount += 1;
    } else {
      missedQuestionIds.push(String(response.questionId));
    }
    const question = questionById.get(String(response.questionId));
    cumulativeDamage += responseDamage(question?.points, response.partialScore);
    const itemMs = new Date(response.answeredAt) - new Date(response.shownAt) - (response.hiddenMs || 0);
    activeMs += Math.max(0, itemMs);
    hiddenMs += response.hiddenMs || 0;
  }

  const totalQuestions = questions.length;
  const accuracy = totalQuestions ? Math.round((correctCount / totalQuestions) * 100) : 0;
  const streakBonus = computeStreakBonus(ordered.map(r => r.isCorrect));
  const score = totalPoints + streakBonus;
  const passed = accuracy >= level.passMark;
  const starsAwarded = computeStars({ accuracy, passed, kind: attempt.kind });
  const vitalsEnd = vitalsFromDamage(cumulativeDamage);

  return { score, accuracy, passed, starsAwarded, vitalsEnd, activeMs, hiddenMs, streakBonus, missedQuestionIds };
};

/**
 * Server-side level progression. `attemptsByLevelId` must contain only
 * submitted, non-practice attempts. The first level is always unlocked;
 * every later level unlocks once the previous one has a passed attempt.
 */
export const computeLevelProgress = (levels, attemptsByLevelId) => {
  const progress = [];
  let previousPassed = true;
  for (const level of levels) {
    const attempts = attemptsByLevelId.get(String(level._id)) || [];
    const passedAttempts = attempts.filter(a => a.passed);
    const unlocked = previousPassed;
    let state;
    if (!unlocked) state = "locked";
    else if (passedAttempts.length > 0) state = "complete";
    else if (attempts.length > 0) state = "failed";
    else state = "active";
    const starsAwarded = passedAttempts.length ? Math.max(...passedAttempts.map(a => a.starsAwarded)) : 0;
    progress.push({ level, unlocked, state, starsAwarded, attempts });
    previousPassed = unlocked && passedAttempts.length > 0;
  }
  return progress;
};
