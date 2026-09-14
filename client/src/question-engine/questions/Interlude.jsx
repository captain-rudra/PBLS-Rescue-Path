import { useState } from "react";
import { useMultiMediaGate } from "../../hooks/useMultiMediaGate.js";

// A mandatory-viewing bridge (SPEC 3.8) — not an assessment item. No
// options, no correct answer: two independent players (same pattern as
// SplitScreen, no shared scrub) plus an optional photo and text, and a
// single "Done" button that stays disabled until both clips have played
// through once. Replays after that are unlimited, same as every other
// gated clip in this app. QuestionRunner auto-advances on commit instead
// of showing a FeedbackCard — there is nothing to give feedback ON.
export const Interlude = ({ question, onFirstInteraction, onCommit, result }) => {
  const { videoUrl, videoUrlB, imageUrl } = question.media || {};
  const gate = useMultiMediaGate([videoUrl, videoUrlB]);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const anyVideo = Boolean(videoUrl || videoUrlB);

  const markInteract = () => {
    if (!hasInteracted) {
      setHasInteracted(true);
      onFirstInteraction();
    }
  };

  const handleDone = () => {
    if (!gate.satisfied || submitting || result) return;
    setSubmitting(true);
    onCommit({}, {}).catch(() => setSubmitting(false));
  };

  return (
    <div>
      {anyVideo && (
        <div className="grid gap-3 md:grid-cols-2">
          {videoUrl && (
            <div className="overflow-hidden rounded-lg bg-black">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video src={videoUrl} controls playsInline className="max-h-64 w-full" onPlay={markInteract} {...gate.handlersFor(videoUrl)} />
            </div>
          )}
          {videoUrlB && (
            <div className="overflow-hidden rounded-lg bg-black">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video src={videoUrlB} controls playsInline className="max-h-64 w-full" onPlay={markInteract} {...gate.handlersFor(videoUrlB)} />
            </div>
          )}
        </div>
      )}

      {imageUrl && <img src={imageUrl} alt={question.title || "Scene illustration"} className="mt-3 max-h-72 w-full rounded-lg bg-black object-contain" />}

      {!anyVideo && !imageUrl && question.fallbackText && <p className="mt-2 text-[13px] text-slate-300">{question.fallbackText}</p>}

      {anyVideo && !gate.satisfied && (
        <p className="mt-2 text-center text-[11px] text-slate-400">
          {gate.total > 1
            ? gate.remaining > 1
              ? "Watch both clips through once to continue."
              : "Watch the other clip through once to continue."
            : "Watch the clip through once to continue."}
        </p>
      )}

      <button
        type="button"
        data-testid="interlude-done"
        onClick={handleDone}
        disabled={!gate.satisfied || submitting || Boolean(result)}
        className="mt-4 w-full rounded-md bg-[#34D399] px-4 py-3 text-sm font-semibold text-[#16243D] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Done
      </button>
    </div>
  );
};
