import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import Rive, { Layout, Fit } from "@rive-app/react-canvas";
import { getAttemptReview, getLevelAttempts, reportReviewTime } from "../lib/api.js";
import { GameBackground } from "../components/GameBackground.jsx";

// SPEC 2.6 — the read-only level review. Reached from the result card after
// an attempt is submitted (SPEC 2.7), AND persistently from the dashboard
// path node and the mission briefing for any level with at least one
// submitted attempt (never for a locked or never-attempted level). Every
// question from the chosen attempt, in its clinical order: the stem, any
// scenario text, media (or fallbackText), the answer given, the correct
// answer, and the feedback text. Nothing here is editable and nothing is
// re-scored; opening it writes no responses. It deliberately does NOT bring
// free navigation into a level — the question engine still shows one
// question at a time with the answer locked on selection.
//
// Defaults to the FIRST attempt (every entry point links the level's frozen
// headline attemptId) since that's the permanent record, but the attempt
// selector below the header lets the participant switch to any restart or
// remediation round they've since done.

const optionLabel = (options, key) => {
  if (key === null || key === undefined) return "—";
  const option = options.find(o => o.key === key);
  return option ? `${option.key} — ${option.text}` : String(key);
};
const tokenText = (tokens, id) => tokens.find(t => t.id === id)?.text ?? id;
const bucketLabel = (buckets, key) => buckets.find(b => b.key === key)?.label ?? key;

// Only for the option-based types (mcq, video_mcq, animation_mcq,
// split_screen, hotspot_video) — sequence and drag_drop get their own
// dedicated, per-item-detail renderers below (SPEC 2.6).
const describeOptionAnswer = (item, which) => {
  const source = which === "given" ? item.given : item.correct;
  if (which === "given" && source === null) return "Not answered";
  const key = which === "given" ? source?.selected : source?.correct;
  return optionLabel(item.options, key);
};

const AnswerBlock = ({ label, children, tone }) => (
  <div>
    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <div className="mt-1 text-[13px]" style={{ color: tone }}>
      {children}
    </div>
  </div>
);

// Shows the order the participant was actually PRESENTED (shownOrder) —
// the seeded per-participant shuffle from SPEC 3.3 — alongside what they
// submitted and the canonical correct order. Showing only the canonical
// order here would misrepresent what this participant saw. Each submitted
// row is toned by its own position, not just an overall right/wrong.
const SequenceAnswer = ({ item }) => {
  const { tokens, correct } = item;
  const shownOrder = item.given?.shownOrder ?? null;
  const submittedOrder = item.given?.order ?? null;
  const correctOrder = correct?.correctOrder ?? [];

  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Shown to you</p>
        <ol className="mt-1 flex flex-col gap-0.5">
          {(shownOrder ?? []).map((id, index) => (
            <li key={id} className="text-[13px] text-[#16243D]">
              {index + 1}. {tokenText(tokens, id)}
            </li>
          ))}
        </ol>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Your order</p>
        {submittedOrder ? (
          <ol className="mt-1 flex flex-col gap-0.5">
            {submittedOrder.map((id, index) => {
              const right = correctOrder[index] === id;
              return (
                <li key={id} className="text-[13px]" style={{ color: right ? "#16243D" : "#FF6B5B" }}>
                  {index + 1}. {tokenText(tokens, id)}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="mt-1 text-[13px] text-[#FF6B5B]">Not answered</p>
        )}
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Correct order</p>
        <ol className="mt-1 flex flex-col gap-0.5">
          {correctOrder.map((id, index) => (
            <li key={id} className="text-[13px]" style={{ color: "#0f9d6b" }}>
              {index + 1}. {tokenText(tokens, id)}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
};

// Per-token placement against its correct bucket, not just an overall
// right/wrong (SPEC 2.6) — each row is toned by whether THAT token landed
// in its correct bucket.
const DragDropAnswer = ({ item }) => {
  const { tokens, buckets, correct } = item;
  const placements = item.given?.placements ?? null;
  const correctPlacements = correct?.correctPlacements ?? {};

  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Your placement</p>
        {placements ? (
          <ul className="mt-1 flex flex-col gap-0.5">
            {tokens.map(token => {
              const right = placements[token.id] === correctPlacements[token.id];
              return (
                <li key={token.id} className="text-[13px]" style={{ color: right ? "#16243D" : "#FF6B5B" }}>
                  {token.text} → {bucketLabel(buckets, placements[token.id])}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1 text-[13px] text-[#FF6B5B]">Not answered</p>
        )}
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Correct placement</p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {tokens.map(token => (
            <li key={token.id} className="text-[13px]" style={{ color: "#0f9d6b" }}>
              {token.text} → {bucketLabel(buckets, correctPlacements[token.id])}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

// Media renders if present, otherwise fallbackText (CLAUDE.md: "the item
// must still be answerable" applies equally to reviewing it later). No
// gating, no hotspot overlay, no synced scrub bar here — this is read-only
// playback, not the live interaction, so it's kept to the simplest player
// that shows what the participant saw.
const ReviewMedia = ({ item }) => {
  const { type, media, fallbackText, sides } = item;

  if (type === "split_screen" && sides?.length) {
    return (
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {sides.map((side, index) =>
          side.videoUrl ? (
            <div key={side.label || index} className="overflow-hidden rounded-lg bg-black">
              <p className="bg-black/60 px-2 py-1 text-[11px] text-white">{side.label}</p>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video src={side.videoUrl} controls className="max-h-56 w-full" />
            </div>
          ) : (
            <div key={side.label || index} className="rounded-lg border border-dashed border-[#3A4A63] bg-[#1E3050] p-3">
              <p className="text-[11px] font-semibold text-slate-300">{side.label}</p>
              <ul className="mt-1 list-disc pl-4 text-[12px] text-slate-200">
                {(side.parameters || []).map((parameter, i) => (
                  <li key={i}>{parameter}</li>
                ))}
              </ul>
            </div>
          )
        )}
      </div>
    );
  }

  if (media?.riveSrc) {
    return (
      <div className="mt-3 h-40 w-full overflow-hidden rounded-lg bg-[#FFF7ED]">
        <Rive src={media.riveSrc} layout={new Layout({ fit: Fit.Contain })} className="h-full w-full" />
      </div>
    );
  }

  if (media?.videoUrl) {
    return (
      <div className="mt-3 overflow-hidden rounded-lg bg-black">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video src={media.videoUrl} poster={media.posterUrl || undefined} controls className="max-h-72 w-full" />
      </div>
    );
  }

  if (fallbackText) {
    return (
      <div className="mt-3 flex min-h-[90px] w-full items-center justify-center rounded-lg border border-dashed border-[#3A4A63] bg-[#1E3050] p-4 text-center">
        <p className="text-[13px] text-slate-200">{fallbackText}</p>
      </div>
    );
  }

  return null;
};

const attemptLabel = attempt => {
  if (attempt.kind === "remediation") return `Remediation round ${attempt.remediationRound}`;
  if (attempt.attemptNo === 1) return "First attempt";
  return `Restart (attempt ${attempt.attemptNo})`;
};

// Lets the participant switch between every submitted attempt they've made
// on this level — a restart or remediation round, not only the frozen first
// attempt the entry points default to (SPEC 2.6).
const AttemptSelector = ({ attempts, currentAttemptId, onSelect }) => {
  if (attempts.length < 2) return null;
  return (
    <div className="mx-auto max-w-lg px-4 pt-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Viewing</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="attempt-selector">
        {attempts.map(attempt => {
          const active = attempt.attemptId === currentAttemptId;
          return (
            <button
              key={attempt.attemptId}
              type="button"
              data-testid={`attempt-option-${attempt.attemptId}`}
              onClick={() => !active && onSelect(attempt.attemptId)}
              className="rounded-full border px-3 py-1 text-[11px] font-semibold transition"
              style={
                active
                  ? { borderColor: "#34D399", backgroundColor: "#34D399", color: "#16243D" }
                  : { borderColor: "#3A4A63", backgroundColor: "transparent", color: "#3A4A63" }
              }
            >
              {attemptLabel(attempt)} · {attempt.accuracy}%
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const LevelReview = () => {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const justUnlockedLevelKey = location.state?.justUnlockedLevelKey ?? null;

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const sentRef = useRef(false);

  useEffect(() => {
    setData(null);
    getAttemptReview(attemptId)
      .then(setData)
      .catch(err => setError(err.message));
  }, [attemptId]);

  // The attempt selector is level-scoped, not attempt-scoped — only refetch
  // it when the level actually changes, not on every switch between that
  // level's own attempts.
  const levelKey = data?.attempt?.levelKey ?? null;
  useEffect(() => {
    if (!levelKey) return;
    getLevelAttempts(levelKey)
      .then(response => setAttempts(response.attempts))
      .catch(() => setAttempts([]));
  }, [levelKey]);

  // Time on this screen is reported to the server separately (it never
  // enters time-on-task). Flush on unmount, on tab hide, and on pagehide;
  // reset the clock after each flush so a background-then-return still
  // counts. Re-keyed on attemptId so switching attempts via the selector
  // flushes the outgoing attempt's time before starting the incoming one's.
  useEffect(() => {
    let startedAt = Date.now();
    sentRef.current = false;
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
  const switchAttempt = nextAttemptId => navigate(`/review/${nextAttemptId}`, { replace: true });

  if (error) {
    return (
      <div className="relative min-h-screen overflow-x-hidden text-[#FFF7ED]">
        <GameBackground />
        <div className="relative z-10 mx-auto max-w-lg px-4 py-10 text-center">
          <p className="text-sm text-[#FF6B5B]">{error}</p>
          <button type="button" onClick={done} className="mt-3 text-xs underline">
            Back to the path
          </button>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="relative min-h-screen overflow-x-hidden text-[#FFF7ED]">
        <GameBackground />
        <p className="relative z-10 px-4 py-10 text-center text-sm text-slate-300">Loading review…</p>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden text-[#16243D]">
      <GameBackground />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="relative z-10 mx-auto min-h-screen max-w-3xl bg-[#FFF7ED] shadow-[0_0_60px_rgba(0,0,0,0.4)] sm:my-6 sm:min-h-0 sm:rounded-2xl"
      >
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#3A4A63]/20 bg-[#FFF7ED]/95 px-4 py-3 backdrop-blur sm:rounded-t-2xl">
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

      <AttemptSelector attempts={attempts} currentAttemptId={data.attempt.attemptId} onSelect={switchAttempt} />

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

              <ReviewMedia item={item} />

              {item.type === "sequence" ? (
                <SequenceAnswer item={item} />
              ) : item.type === "drag_drop" ? (
                <DragDropAnswer item={item} />
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <AnswerBlock label="Your answer" tone={item.isCorrect ? "#16243D" : "#FF6B5B"}>
                    {describeOptionAnswer(item, "given")}
                  </AnswerBlock>
                  <AnswerBlock label="Correct answer" tone="#0f9d6b">
                    {describeOptionAnswer(item, "correct")}
                  </AnswerBlock>
                </div>
              )}

              <div className="mt-3 rounded-md bg-[#1E3050]/5 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Feedback</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-[#16243D]">{item.feedbackText}</p>
                {item.feedbackImageUrl && (
                  <img data-testid={`review-feedback-image-${item.questionId}`} src={item.feedbackImageUrl} alt="Feedback illustration" className="mt-2 max-h-56 w-full rounded-md bg-black object-contain" />
                )}
                {(item.feedbackVideoUrl || item.feedbackVideoUrlB) && (
                  <div className={`mt-2 grid gap-2 ${item.feedbackVideoUrl && item.feedbackVideoUrlB ? "grid-cols-2" : "grid-cols-1"}`}>
                    {item.feedbackVideoUrl && (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <video data-testid={`review-feedback-video-${item.questionId}`} src={item.feedbackVideoUrl} controls className="max-h-56 w-full rounded-md bg-black" />
                    )}
                    {item.feedbackVideoUrlB && (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <video data-testid={`review-feedback-video-b-${item.questionId}`} src={item.feedbackVideoUrlB} controls className="max-h-56 w-full rounded-md bg-black" />
                    )}
                  </div>
                )}
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
    </div>
  );
};
