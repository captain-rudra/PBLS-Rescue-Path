import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { getAttemptReview, reportReviewTime } from "../lib/api.js";

// SPEC 2.6 — the read-only level review. Reached from the result card
// after an attempt is submitted (SPEC 2.7). Every question from that
// attempt, in its clinical order: the stem, the answer given, the correct
// answer, and the feedback text. Nothing here is editable and nothing is
// re-scored; opening it writes no responses. It deliberately does NOT
// bring free navigation into a level — the question engine still shows one
// question at a time with the answer locked on selection.

const optionLabel = (options, key) => {
  if (key === null || key === undefined) return "—";
  const option = options.find(o => o.key === key);
  return option ? `${option.key} — ${option.text}` : String(key);
};
const tokenText = (tokens, id) => tokens.find(t => t.id === id)?.text ?? id;
const bucketLabel = (buckets, key) => buckets.find(b => b.key === key)?.label ?? key;

// Returns an array of display lines for either the given or the correct answer.
const describeAnswer = (item, which) => {
  const { type, options, buckets, tokens } = item;
  const source = which === "given" ? item.given : item.correct;
  if (which === "given" && source === null) return ["Not answered"];

  if (type === "drag_drop") {
    const placements = which === "given" ? source?.placements ?? {} : source?.correctPlacements ?? {};
    return tokens.map(token => `${token.text}  →  ${bucketLabel(buckets, placements[token.id])}`);
  }
  if (type === "sequence") {
    const order = which === "given" ? source?.order ?? [] : source?.correctOrder ?? [];
    return order.map((id, index) => `${index + 1}. ${tokenText(tokens, id)}`);
  }
  const key = which === "given" ? source?.selected : source?.correct;
  return [optionLabel(options, key)];
};

const AnswerBlock = ({ label, lines, tone }) => (
  <div>
    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <ul className="mt-1 flex flex-col gap-0.5">
      {lines.map((line, index) => (
        <li key={index} className="text-[13px]" style={{ color: tone }}>
          {line}
        </li>
      ))}
    </ul>
  </div>
);

export const LevelReview = () => {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const justUnlockedLevelKey = location.state?.justUnlockedLevelKey ?? null;

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const sentRef = useRef(false);

  useEffect(() => {
    getAttemptReview(attemptId)
      .then(setData)
      .catch(err => setError(err.message));
  }, [attemptId]);

  // Time on this screen is reported to the server separately (it never
  // enters time-on-task). Flush on unmount, on tab hide, and on pagehide;
  // reset the clock after each flush so a background-then-return still
  // counts.
  useEffect(() => {
    let startedAt = Date.now();
    const flush = () => {
      const elapsed = Date.now() - startedAt;
      startedAt = Date.now();
      if (elapsed > 0) reportReviewTime(attemptId, elapsed);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      if (!sentRef.current) {
        sentRef.current = true;
        flush();
      }
    };
  }, [attemptId]);

  const done = () => navigate("/", { state: { justUnlockedLevelKey } });

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center text-[#16243D]">
        <p className="text-sm text-[#FF6B5B]">{error}</p>
        <button type="button" onClick={done} className="mt-3 text-xs underline">
          Back to the path
        </button>
      </div>
    );
  }
  if (!data) return <p className="px-4 py-10 text-center text-sm text-slate-500">Loading review…</p>;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="min-h-screen bg-[#FFF7ED] text-[#16243D]">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#3A4A63]/20 bg-[#FFF7ED]/95 px-4 py-3 backdrop-blur">
        <div>
          <h1 className="text-lg font-semibold" style={{ fontFamily: "Fredoka, sans-serif" }}>
            Answer review
          </h1>
          <p className="text-[11px] text-slate-500">
            {data.level.title} — read-only. Nothing here changes your result.
          </p>
        </div>
        <button
          type="button"
          data-testid="review-done"
          onClick={done}
          className="rounded-md bg-[#34D399] px-3 py-1.5 text-[13px] font-semibold text-[#16243D] transition hover:brightness-95"
        >
          Done
        </button>
      </header>

      <div className="mx-auto max-w-lg px-4 py-6">
        <ol className="flex flex-col gap-4" data-testid="review-list">
          {data.items.map(item => (
            <li key={item.questionId} data-testid={`review-item-${item.sequence}`} className="rounded-lg border border-[#3A4A63]/20 bg-white/60 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">
                  {item.sequence}. {item.title}
                </p>
                {item.isCorrect !== null && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    style={{ backgroundColor: item.isCorrect ? "#34D399" : "#FF6B5B", color: "#16243D" }}
                  >
                    {item.isCorrect ? "Correct" : "Missed"}
                  </span>
                )}
              </div>

              {item.scenario && <p className="mt-1 text-[12px] italic text-slate-500">{item.scenario}</p>}
              <h2 className="mt-1 text-[14px] font-semibold">{item.prompt}</h2>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <AnswerBlock label="Your answer" lines={describeAnswer(item, "given")} tone={item.isCorrect ? "#16243D" : "#FF6B5B"} />
                <AnswerBlock label="Correct answer" lines={describeAnswer(item, "correct")} tone="#0f9d6b" />
              </div>

              <div className="mt-3 rounded-md bg-[#1E3050]/5 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Feedback</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-[#16243D]">{item.feedbackText}</p>
              </div>
            </li>
          ))}
        </ol>

        <button
          type="button"
          data-testid="review-done-bottom"
          onClick={done}
          className="mt-6 w-full rounded-md bg-[#34D399] px-4 py-3 text-sm font-semibold text-[#16243D] transition hover:brightness-95"
        >
          Done
        </button>
      </div>
    </motion.div>
  );
};
