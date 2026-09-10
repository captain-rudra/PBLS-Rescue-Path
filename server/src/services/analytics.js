// Records and analytics derivations (docs/SPEC.md §11).
//
// Every figure here is recomputed from the append-only `responses`
// collection and the `attempts` rows it rolls up to. Nothing is stored —
// each function is pure, and a study is small enough (dozens of
// participants, a few thousand responses) that one in-memory pass per
// request is the right shape. The exact item-analysis formulas are
// written out in SPEC §11 so the numbers can be defended.

import { STATUS } from "../../../shared/constants.js";
import { remediationRoundFor, outcomeFor } from "./scoring.js";

const LEVEL_ORDER = new Map([["prelevel", 0], ["l1", 1], ["l2", 2], ["l3", 3], ["l4", 4]]);
const levelSort = key => LEVEL_ORDER.get(key) ?? 99;

const groupBy = (rows, keyFn) => {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
};

// SPEC §8 time-on-item, taken straight off the raw response row rather
// than read from a stored attempt rollup — so a records figure always
// traces back to the four timestamps that produced it.
export const timeOnResponse = r => Math.max(0, new Date(r.answeredAt) - new Date(r.shownAt) - (r.hiddenMs || 0));

// SPEC §11 "first encounter": a participant's chronologically earliest
// non-retry response to a question (min `answeredAt`). A retry is never a
// first encounter, so retries drop out here.
export const firstEncounters = responses => {
  const byKey = new Map();
  for (const r of responses) {
    if (r.isRetry) continue;
    const key = `${r.participantId}:${r.questionId}`;
    const prev = byKey.get(key);
    if (!prev || new Date(r.answeredAt) < new Date(prev.answeredAt)) byKey.set(key, r);
  }
  return [...byKey.values()];
};

// Population Pearson r (÷n, not ÷(n−1)). null when either series has no
// spread — with a dichotomous x that means everyone answered the item the
// same way, or every contributing participant has the identical total.
export const pearson = (xs, ys) => {
  const n = xs.length;
  if (n === 0) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  return cov / Math.sqrt(vx * vy);
};

// Conventional classical-test-theory rules of thumb (SPEC §11 documents
// the exact bands and that they are tunable conventions, not law).
export const DIFFICULTY_HARD = 0.3;
export const DIFFICULTY_EASY = 0.85;
export const DISCRIM_GOOD = 0.3;
export const DISCRIM_WEAK = 0.15;

const classifyItem = (difficulty, discrimination, n) => {
  if (n === 0) return { needsReview: false, reading: "Not yet answered by anyone in this set." };

  const pct = Math.round(difficulty * 100);
  const hard = difficulty < DIFFICULTY_HARD;
  const diffText = hard
    ? `Hard — ${pct}% right on first encounter.`
    : difficulty > DIFFICULTY_EASY
      ? `Easy — ${pct}% right on first encounter.`
      : `Moderate — ${pct}% right on first encounter.`;

  let discText;
  if (discrimination === null) {
    discText =
      difficulty === 0 || difficulty === 1
        ? "Discrimination can't be computed — everyone answered it the same way."
        : "Discrimination can't be computed — not enough spread in participant totals.";
  } else if (discrimination < 0) {
    discText = `Negative discrimination (${discrimination.toFixed(2)}) — stronger participants miss it more often.`;
  } else if (discrimination < DISCRIM_WEAK) {
    discText = `Does not discriminate (${discrimination.toFixed(2)}).`;
  } else if (discrimination < DISCRIM_GOOD) {
    discText = `Weak discrimination (${discrimination.toFixed(2)}).`;
  } else {
    discText = `Discriminates well (${discrimination.toFixed(2)}).`;
  }

  const nonDiscriminating = discrimination === null || discrimination < DISCRIM_WEAK;
  const needsReview = hard && nonDiscriminating;
  return {
    needsReview,
    reading: needsReview ? `${diffText} ${discText} Both hard and non-discriminating — the wording needs review.` : `${diffText} ${discText}`
  };
};

/**
 * Per-question difficulty and discrimination (SPEC §11).
 *
 * Discrimination is a CORRECTED, WITHIN-LEVEL point-biserial: for a
 * question in level L it correlates the participant's dichotomous score on
 * that item (0/1, on first encounter) with their number-correct across
 * L's other first encounters. Within-level because progression gating
 * means participants who reached more levels have mechanically higher
 * instrument totals — see SPEC §11's "Known limitation".
 *
 * @param questions  [{ questionId, levelKey, sequence, type, objective, version }] to report (n=0 rows included)
 * @param responses  already scope-filtered response rows (practice / excluded / session / arm handled by the caller)
 */
export const itemAnalysis = ({ questions, responses }) => {
  const fe = firstEncounters(responses);

  // (participant, level) -> set of questionIds right on first encounter.
  const rightByPL = new Map();
  for (const r of fe) {
    if (!r.isCorrect) continue;
    const key = `${r.participantId}:${r.levelId}`;
    if (!rightByPL.has(key)) rightByPL.set(key, new Set());
    rightByPL.get(key).add(String(r.questionId));
  }
  const levelTotal = (participantId, levelId) => rightByPL.get(`${participantId}:${levelId}`)?.size ?? 0;

  const feByQ = groupBy(fe, r => String(r.questionId));

  return questions
    .map(question => {
      const rows = feByQ.get(question.questionId) || [];
      const n = rows.length;
      const correct = rows.filter(r => r.isCorrect).length;
      const difficulty = n > 0 ? correct / n : null;

      let discrimination = null;
      if (n >= 2 && difficulty !== null && difficulty > 0 && difficulty < 1) {
        const xs = [];
        const ys = [];
        for (const r of rows) {
          const x = r.isCorrect ? 1 : 0;
          xs.push(x);
          ys.push(levelTotal(String(r.participantId), String(r.levelId)) - x); // corrected: drop this item from the total
        }
        discrimination = pearson(xs, ys);
      }

      return {
        questionId: question.questionId,
        levelKey: question.levelKey ?? null,
        sequence: question.sequence ?? null,
        type: question.type ?? null,
        objective: question.objective ?? null,
        version: question.version ?? null,
        n,
        correct,
        difficulty,
        discrimination,
        ...classifyItem(difficulty, discrimination, n)
      };
    })
    .sort((a, b) => levelSort(a.levelKey) - levelSort(b.levelKey) || (a.sequence ?? 0) - (b.sequence ?? 0));
};

const participantState = (participant, attempts, levelsMastered, totalLevels) => {
  if (participant.excluded) return "excluded";
  if (attempts.length === 0) return "not started";
  if (attempts.some(a => a.status === STATUS.IN_PROGRESS)) return "in progress";
  if (totalLevels > 0 && levelsMastered >= totalLevels) return "finished";
  return "active";
};

/**
 * The admin participants table (SPEC §11): one row per participant with
 * arm, totals, state, and a nested per-level / per-attempt breakdown
 * (kind, accuracy, active/hidden time recomputed from responses, stars,
 * missed items).
 */
export const participantsTable = ({ participants, attempts, responses, levels, questions }) => {
  const levelById = new Map(levels.map(l => [String(l._id), l]));
  const questionById = new Map(questions.map(q => [String(q._id), q]));
  const attemptsByParticipant = groupBy(attempts, a => String(a.participantId));
  const responsesByAttempt = groupBy(responses, r => String(r.attemptId));
  const totalLevels = levels.length;

  const missedItemsFor = attemptResponses =>
    attemptResponses
      .filter(r => !r.isRetry && !r.isCorrect)
      .map(r => {
        const q = questionById.get(String(r.questionId));
        return { questionId: String(r.questionId), title: q?.title ?? null, objective: q?.objective ?? null, sequence: q?.sequence ?? null };
      });

  return participants
    .map(participant => {
      const pAttempts = (attemptsByParticipant.get(String(participant._id)) || []).slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const pResponses = pAttempts.flatMap(a => responsesByAttempt.get(String(a._id)) || []);
      const nonRetry = pResponses.filter(r => !r.isRetry);

      const wrongCount = nonRetry.filter(r => !r.isCorrect).length;
      const retryCount = pResponses.filter(r => r.isRetry).length;
      const activeMs = pResponses.reduce((s, r) => s + timeOnResponse(r), 0);
      const hiddenMs = pResponses.reduce((s, r) => s + (r.hiddenMs || 0), 0);
      const submitted = pAttempts.filter(a => a.status === STATUS.SUBMITTED);
      const bestScore = submitted.length ? Math.max(...submitted.map(a => a.score || 0)) : 0;

      const attemptsByLevel = groupBy(pAttempts, a => String(a.levelId));
      const levelsMastered = [...attemptsByLevel.values()].filter(la => la.some(a => a.accuracy === 100)).length;

      const perLevel = [...attemptsByLevel.entries()]
        .map(([levelId, levelAttempts]) => {
          const level = levelById.get(levelId);
          const sorted = levelAttempts.slice().sort((a, b) => a.attemptNo - b.attemptNo);
          return {
            levelKey: level?.key ?? null,
            levelTitle: level?.title ?? null,
            passMark: level?.passMark ?? null,
            attempts: sorted.map(a => {
              const ar = responsesByAttempt.get(String(a._id)) || [];
              const arNonRetry = ar.filter(r => !r.isRetry);
              return {
                attemptId: String(a._id),
                attemptNo: a.attemptNo,
                kind: a.kind,
                remediationRound: remediationRoundFor(a, sorted),
                status: a.status,
                outcome: a.status === STATUS.SUBMITTED && level ? outcomeFor(a.accuracy, level.passMark, a.kind) : null,
                accuracy: a.accuracy,
                score: a.score,
                starsAwarded: a.starsAwarded,
                activeMs: arNonRetry.reduce((s, r) => s + timeOnResponse(r), 0),
                hiddenMs: arNonRetry.reduce((s, r) => s + (r.hiddenMs || 0), 0),
                responseCount: arNonRetry.length,
                missedItems: missedItemsFor(ar)
              };
            })
          };
        })
        .sort((a, b) => levelSort(a.levelKey) - levelSort(b.levelKey));

      return {
        participantId: String(participant._id),
        code: participant.code,
        arm: participant.arm,
        excluded: Boolean(participant.excluded),
        state: participantState(participant, pAttempts, levelsMastered, totalLevels),
        attemptCount: pAttempts.length,
        wrongCount,
        retryCount,
        activeMs,
        hiddenMs,
        bestScore,
        levelsPlayed: attemptsByLevel.size,
        levelsMastered,
        levels: perLevel
      };
    })
    .sort((a, b) => a.arm.localeCompare(b.arm) || a.code.localeCompare(b.code));
};

/** Flat one-per-answer rows for responses.csv — item, version, correctness, all four §8 timestamps. */
export const responseRows = ({ participants, attempts, responses, levels, questions }) => {
  const pById = new Map(participants.map(p => [String(p._id), p]));
  const aById = new Map(attempts.map(a => [String(a._id), a]));
  const lById = new Map(levels.map(l => [String(l._id), l]));
  const qById = new Map(questions.map(q => [String(q._id), q]));

  return responses
    .slice()
    .sort((a, b) => new Date(a.answeredAt) - new Date(b.answeredAt))
    .map(r => {
      const p = pById.get(String(r.participantId));
      const a = aById.get(String(r.attemptId));
      const l = lById.get(String(r.levelId));
      const q = qById.get(String(r.questionId));
      return {
        code: p?.code ?? null,
        arm: p?.arm ?? null,
        levelKey: l?.key ?? null,
        attemptNo: a?.attemptNo ?? null,
        attemptKind: a?.kind ?? null,
        questionSequence: q?.sequence ?? null,
        questionId: String(r.questionId),
        questionVersion: r.questionVersion,
        isCorrect: r.isCorrect,
        isRetry: r.isRetry,
        partialScore: r.partialScore,
        shownAt: r.shownAt,
        firstInteractionAt: r.firstInteractionAt,
        answeredAt: r.answeredAt,
        hiddenMs: r.hiddenMs
      };
    });
};

/** Flat one-per-attempt rows for attempts.csv, built from the participants table so the two never disagree. */
export const attemptRows = table =>
  table.flatMap(participant =>
    participant.levels.flatMap(level =>
      level.attempts.map(a => ({
        code: participant.code,
        arm: participant.arm,
        levelKey: level.levelKey,
        attemptNo: a.attemptNo,
        kind: a.kind,
        remediationRound: a.remediationRound,
        outcome: a.outcome,
        status: a.status,
        accuracy: a.accuracy,
        score: a.score,
        starsAwarded: a.starsAwarded,
        activeMs: a.activeMs,
        hiddenMs: a.hiddenMs
      }))
    )
  );
