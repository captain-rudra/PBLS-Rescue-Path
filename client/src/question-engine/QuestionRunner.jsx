import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { postResponse } from "../lib/api.js";
import { useHiddenTracker } from "../hooks/useHiddenTracker.js";
import { FeedbackCard } from "./FeedbackCard.jsx";
import { questionEnterVariants } from "./motion.js";
import { QUESTION_COMPONENTS } from "./questions/index.js";

// Renders exactly one question and owns everything that has to happen
// exactly once per question: the shownAt/firstInteractionAt/answeredAt
// timestamps, the hidden-tab tracker, and the immediate POST /play/responses
// call. The parent keys this component by questionId so a fresh instance
// (and fresh timestamps) is created for every question.
export const QuestionRunner = ({ attemptId, question, onAnswered, onContinue, isLast, autoExpandFeedback }) => {
  const shownAtRef = useRef(Date.now());
  const firstInteractionAtRef = useRef(null);
  const getHiddenMs = useHiddenTracker();
  const [phase, setPhase] = useState("answering"); // answering | submitting | feedback
  const [result, setResult] = useState(null);
  const [submitError, setSubmitError] = useState(null);

  const handleFirstInteraction = () => {
    if (firstInteractionAtRef.current === null) firstInteractionAtRef.current = Date.now();
  };

  const handleCommit = async (given, meta = {}) => {
    if (phase !== "answering") return Promise.resolve();
    handleFirstInteraction();
    setPhase("submitting");
    setSubmitError(null);
    const answeredAt = Date.now();

    try {
      const response = await postResponse({
        attemptId,
        questionId: question.questionId,
        given,
        shownAt: new Date(shownAtRef.current).toISOString(),
        firstInteractionAt: firstInteractionAtRef.current ? new Date(firstInteractionAtRef.current).toISOString() : null,
        answeredAt: new Date(answeredAt).toISOString(),
        hiddenMs: Math.round(getHiddenMs()),
        mediaReplays: meta.mediaReplays || 0
      });

      const nextResult = { given, isCorrect: response.isCorrect, partialScore: response.partialScore, ...response.feedback };
      setResult(nextResult);
      setPhase("feedback");
      onAnswered({ isCorrect: response.isCorrect, partialScore: response.partialScore, question });
    } catch (error) {
      setSubmitError(error.message);
      setPhase("answering");
      throw error;
    }
  };

  const TypeComponent = QUESTION_COMPONENTS[question.type];

  return (
    <motion.div variants={questionEnterVariants} initial="hidden" animate="visible" className="mx-auto max-w-3xl px-4 pb-32 pt-6">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{question.title}</p>
      {question.scenario && <p className="mt-1 text-[12px] italic text-slate-300">{question.scenario}</p>}
      <h2 className="mt-2 text-[15px] font-semibold text-[#16243D]">{question.prompt}</h2>

      <div className="mt-4">
        {TypeComponent ? (
          <TypeComponent question={question} attemptId={attemptId} onFirstInteraction={handleFirstInteraction} onCommit={handleCommit} result={result} />
        ) : (
          <p className="text-sm text-[#FF6B5B]">Unsupported question type: {question.type}</p>
        )}
      </div>

      {submitError && (
        <p className="mt-3 text-[12px] text-[#FF6B5B]">Could not save your answer: {submitError}. Selecting again will retry.</p>
      )}

      <AnimatePresence>
        {result && (
          <FeedbackCard
            isCorrect={result.isCorrect}
            text={result.text}
            videoUrl={result.videoUrl}
            imageUrl={result.imageUrl}
            isLast={isLast}
            onContinue={onContinue}
            autoExpand={autoExpandFeedback}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};
