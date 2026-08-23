import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { startAttempt, submitAttempt, abandonAttempt } from "../lib/api.js";
import { Hud } from "./Hud.jsx";
import { QuestionRunner } from "./QuestionRunner.jsx";
import { responseDamage, vitalsDisplayFrom, vitalsStateFrom, RESTART_THRESHOLD } from "../lib/vitals.js";

const initialState = {
  phase: "loading", // loading | playing | submitting | deteriorating | complete | error
  attempt: null,
  level: null,
  questions: [],
  index: 0,
  points: 0,
  streak: 0,
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
      return {
        ...state,
        points: state.points + action.partialScore,
        streak: action.isCorrect ? state.streak + 1 : 0,
        damage: state.damage + action.damage,
        pointsFlash
      };
    }
    case "GO_DETERIORATE":
      return { ...state, phase: "deteriorating" };
    case "GO_NEXT":
      return { ...state, phase: "playing", index: state.index + 1 };
    case "GO_SUBMIT":
      return { ...state, phase: "submitting" };
    case "SUBMIT_OK":
      return { ...state, phase: "complete", completion: action.result };
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

// SPEC 2.3: three full-error-equivalents of vitals damage dims the scene and
// restarts the level. No death animation, no ROSC sequence here — 2c owns
// that; this is just the trigger and the plain restart.
const DeteriorationScreen = () => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-[#16243D]"
  >
    <motion.div
      animate={{ opacity: [1, 0.4, 1] }}
      transition={{ duration: 0.6, repeat: Infinity }}
      className="rounded-full border-2 border-[#FF6B5B] px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#FF6B5B]"
    >
      Patient deteriorating
    </motion.div>
    <p className="text-sm text-slate-300">Restarting the level…</p>
  </motion.div>
);

const CompletionScreen = ({ result, levelKey }) => (
  <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#FFF7ED] px-4 text-center text-[#16243D]">
    <p className="text-xs uppercase tracking-wide text-slate-500">Attempt submitted</p>
    <h1 className="text-xl font-semibold" style={{ fontFamily: "Fredoka, sans-serif" }}>
      {result.attempt.passed ? "Patient stabilised" : "Not stabilised yet"}
    </h1>
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
      <dt className="text-slate-500">Score</dt>
      <dd className="text-left font-medium">{result.attempt.score}</dd>
      <dt className="text-slate-500">Accuracy</dt>
      <dd className="text-left font-medium">{result.attempt.accuracy}%</dd>
      <dt className="text-slate-500">Stars</dt>
      <dd className="text-left font-medium">{result.attempt.starsAwarded}</dd>
      <dt className="text-slate-500">Vitals at end</dt>
      <dd className="text-left font-medium">{result.attempt.vitalsEnd}%</dd>
    </dl>
    {result.remediation.required && <p className="text-xs text-[#FF6B5B]">Remediation required: {result.remediation.questionIds.length} item(s) missed.</p>}
    {result.unlockedNextLevelKey && <p className="text-xs text-[#34D399]">Unlocked: {result.unlockedNextLevelKey}</p>}
    <Link to={`/play/${levelKey}`} className="mt-2 text-xs underline">Play again</Link>
    <Link to="/" className="text-xs underline">Back to levels</Link>
  </div>
);

export const QuestionEnginePage = () => {
  const { levelKey } = useParams();
  const [searchParams] = useSearchParams();
  const kind = searchParams.get("kind") || "first";
  const [state, dispatch] = useReducer(reducer, initialState);
  const [restartToken, setRestartToken] = useState(0);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    dispatch({ type: "LOAD_START" });
    try {
      const { attempt, level, questions } = await startAttempt(levelKey, kind);
      if (requestIdRef.current !== requestId) return; // superseded by a newer load (StrictMode double-invoke, fast nav, or restart)
      dispatch({ type: "LOAD_OK", attempt, level, questions });
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      dispatch({ type: "LOAD_ERROR", error: error.message });
    }
  }, [levelKey, kind]);

  useEffect(() => {
    load();
  }, [load, restartToken]);

  useEffect(() => {
    if (state.phase !== "deteriorating") return undefined;
    // A restart must close the old attempt out with a terminal status —
    // POST /play/attempts is idempotent and will just hand this same
    // in_progress attempt back otherwise, instead of starting a fresh one.
    // Runs alongside the minimum display time, not after it, so the
    // restart never fires before the abandon call has landed.
    let cancelled = false;
    const attemptId = state.attempt?.attemptId;
    const minDisplay = new Promise(resolve => setTimeout(resolve, 1800));
    const closeOldAttempt = attemptId
      ? abandonAttempt(attemptId).catch(error => console.error("Failed to abandon attempt before restart:", error))
      : Promise.resolve();

    Promise.all([minDisplay, closeOldAttempt]).then(() => {
      if (!cancelled) setRestartToken(token => token + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [state.phase, state.attempt]);

  const handleAnswered = ({ isCorrect, partialScore, question }) => {
    dispatch({ type: "ANSWERED", isCorrect, partialScore, damage: responseDamage(question, partialScore) });
  };

  const handleContinue = async () => {
    if (state.phase !== "playing") return;
    // `state.damage` already reflects the response just answered — ANSWERED
    // is dispatched synchronously before the feedback card (and its
    // Continue button) ever renders — so this check is current as of the
    // click, not stale.
    if (state.damage >= RESTART_THRESHOLD) {
      dispatch({ type: "GO_DETERIORATE" });
      return;
    }
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

  if (state.phase === "loading") return <CenteredMessage>Loading attempt…</CenteredMessage>;
  if (state.phase === "error") return <CenteredMessage>Something went wrong: {state.error}</CenteredMessage>;
  if (state.phase === "deteriorating") return <DeteriorationScreen />;
  if (state.phase === "complete") return <CompletionScreen result={state.completion} levelKey={levelKey} />;

  const question = state.questions[state.index];
  const vitalsPercent = vitalsDisplayFrom(state.damage);
  const vitalsState = vitalsStateFrom(state.damage);

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
        />
      </AnimatePresence>
      {state.phase === "submitting" && (
        <p className="fixed bottom-2 right-3 text-[11px] text-slate-400">Saving…</p>
      )}
    </div>
  );
};
