import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { startAttempt, submitAttempt } from "../lib/api.js";
import { Hud } from "./Hud.jsx";
import { QuestionRunner } from "./QuestionRunner.jsx";
import { RoscSequence } from "../play/RoscSequence.jsx";
import { ResultCard } from "../play/ResultCard.jsx";
import { responseDamage, vitalsDisplayFrom, vitalsStateFrom } from "../lib/vitals.js";

const initialState = {
  phase: "loading", // loading | playing | submitting | rosc | complete | error
  attempt: null,
  level: null,
  questions: [],
  index: 0,
  points: 0,
  streak: 0,
  bestStreak: 0,
  damage: 0,
  pointsFlash: null,
  completion: null,
  error: null
};

function reducer(state, action) {
  switch (action.type) {
    case "LOAD_START":
      return { ...initialState, phase: "loading" };
    case "LOAD_OK":
      return { ...initialState, phase: "playing", attempt: action.attempt, level: action.level, questions: action.questions };
    case "LOAD_ERROR":
      return { ...state, phase: "error", error: action.error };
    case "ANSWERED": {
      const pointsFlash = action.partialScore > 0 ? { amount: action.partialScore, key: `${state.index}:${Date.now()}` } : state.pointsFlash;
      const streak = action.isCorrect ? state.streak + 1 : 0;
      return {
        ...state,
        points: state.points + action.partialScore,
        streak,
        bestStreak: Math.max(state.bestStreak, streak),
        // Cumulative damage still drives the live vitals bar (SPEC 2.3: "the
        // vitals bar stays as live feedback only"). It no longer triggers
        // anything — the level always runs to completion.
        damage: state.damage + action.damage,
        pointsFlash
      };
    }
    case "GO_NEXT":
      return { ...state, phase: "playing", index: state.index + 1 };
    case "GO_SUBMIT":
      return { ...state, phase: "submitting" };
    case "SUBMIT_OK":
      return { ...state, phase: "rosc", completion: action.result };
    case "ROSC_DONE":
      return { ...state, phase: "complete" };
    case "SUBMIT_ERROR":
      return { ...state, phase: "error", error: action.error };
    default:
      return state;
  }
}

const CenteredMessage = ({ children }) => (
  <div className="flex min-h-screen items-center justify-center bg-[#FFF7ED] px-4 text-center text-[#16243D]">
    <p className="text-sm">{children}</p>
  </div>
);

export const QuestionEnginePage = () => {
  const { levelKey } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const kind = searchParams.get("kind") || "first";
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, initialState);
  const requestIdRef = useRef(0);
  // A restart or a repeated remediation round often requests the SAME
  // `kind` value the current (just-submitted) attempt already had — e.g.
  // failing a kind:"first" attempt asks for another kind:"first". Setting
  // an unchanged search param doesn't change `kind`'s value, so `load`'s
  // identity wouldn't change and the reload effect below would never
  // refire. This token forces the reload regardless of whether `kind`
  // itself actually changed.
  const [reloadToken, setReloadToken] = useState(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    dispatch({ type: "LOAD_START" });
    try {
      const { attempt, level, questions } = await startAttempt(levelKey, kind);
      if (requestIdRef.current !== requestId) return; // superseded by a newer load (StrictMode double-invoke, fast nav, or another restart)
      dispatch({ type: "LOAD_OK", attempt, level, questions });
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      dispatch({ type: "LOAD_ERROR", error: error.message });
    }
  }, [levelKey, kind]);

  useEffect(() => {
    load();
  }, [load, reloadToken]);

  const handleAnswered = ({ isCorrect, partialScore, question }) => {
    dispatch({ type: "ANSWERED", isCorrect, partialScore, damage: responseDamage(question, partialScore) });
  };

  const handleContinue = async () => {
    if (state.phase !== "playing") return;
    const isLast = state.index + 1 >= state.questions.length;
    if (!isLast) {
      dispatch({ type: "GO_NEXT" });
      return;
    }
    dispatch({ type: "GO_SUBMIT" });
    try {
      const result = await submitAttempt(state.attempt.attemptId);
      dispatch({ type: "SUBMIT_OK", result });
    } catch (error) {
      dispatch({ type: "SUBMIT_ERROR", error: error.message });
    }
  };

  const handleRoscDone = useCallback(() => dispatch({ type: "ROSC_DONE" }), []);
  // Sets the `kind` search param (right even when unchanged — keeps the URL
  // an accurate reflection of what's being played) and bumps reloadToken to
  // guarantee a fresh load either way: a full question set on fail, or the
  // missed-items-only round on remediate.
  const handleRestartLevel = useCallback(() => {
    setSearchParams({ kind: "first" });
    setReloadToken(token => token + 1);
  }, [setSearchParams]);
  const handleContinueRemediation = useCallback(() => {
    setSearchParams({ kind: "remediation" });
    setReloadToken(token => token + 1);
  }, [setSearchParams]);
  const handleResultContinue = useCallback(
    () => navigate("/", { state: { justUnlockedLevelKey: state.completion?.unlockedNextLevelKey ?? null } }),
    [navigate, state.completion]
  );
  // Read-only review of the FROZEN first attempt (headline.attemptId) —
  // the attempt whose figures the result card shows. Carries the unlock
  // key through so "Done" on the review still plays the path animation.
  const handleResultReview = useCallback(() => {
    const attemptId = state.completion?.headline?.attemptId;
    if (!attemptId) return;
    navigate(`/review/${attemptId}`, { state: { justUnlockedLevelKey: state.completion?.unlockedNextLevelKey ?? null } });
  }, [navigate, state.completion]);

  if (state.phase === "loading") return <CenteredMessage>Loading attempt…</CenteredMessage>;
  if (state.phase === "error") return <CenteredMessage>Something went wrong: {state.error}</CenteredMessage>;
  if (state.phase === "rosc") {
    return (
      <RoscSequence
        outcome={state.completion.outcome}
        accuracy={state.completion.attempt.accuracy}
        missedCount={state.completion.missedItems.length}
        headline={state.completion.headline}
        onDone={handleRoscDone}
        onRestartLevel={handleRestartLevel}
        onContinueRemediation={handleContinueRemediation}
      />
    );
  }
  if (state.phase === "complete") {
    return (
      <ResultCard
        result={state.completion}
        levelTitle={state.level.title}
        levelKey={state.level.key}
        levelBadge={state.level.badge}
        bestStreak={state.bestStreak}
        onContinue={handleResultContinue}
        onReview={handleResultReview}
      />
    );
  }

  const question = state.questions[state.index];
  const vitalsPercent = vitalsDisplayFrom(state.damage);
  const vitalsState = vitalsStateFrom(state.damage);
  // From the third remediation round onward the feedback card auto-expands
  // the full explanation and video instead of hiding them behind a toggle
  // (SPEC 2.6) — a participant who is still missing items after two
  // remediation rounds shouldn't be able to skip past the teaching moment.
  const autoExpandFeedback = state.attempt.kind === "remediation" && state.attempt.remediationRound >= 3;

  return (
    <div className="min-h-screen bg-[#FFF7ED]">
      <Hud
        levelTitle={state.level.title}
        scene={state.level.scene}
        questionNumber={state.index + 1}
        totalQuestions={state.questions.length}
        vitalsPercent={vitalsPercent}
        vitalsState={vitalsState}
        points={state.points}
        streak={state.streak}
        pointsFlash={state.pointsFlash}
      />
      <AnimatePresence mode="wait">
        <QuestionRunner
          key={`${state.attempt.attemptId}:${question.questionId}`}
          attemptId={state.attempt.attemptId}
          question={question}
          onAnswered={handleAnswered}
          onContinue={handleContinue}
          isLast={state.index + 1 >= state.questions.length}
          autoExpandFeedback={autoExpandFeedback}
        />
      </AnimatePresence>
      {state.phase === "submitting" && (
        <p className="fixed bottom-2 right-3 text-[11px] text-slate-400">Saving…</p>
      )}
    </div>
  );
};
