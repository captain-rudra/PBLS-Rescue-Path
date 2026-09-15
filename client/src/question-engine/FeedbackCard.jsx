import { useState } from "react";
import { motion } from "framer-motion";
import { feedbackCardVariants } from "./motion.js";
import { useMultiMediaGate } from "../hooks/useMultiMediaGate.js";

// SPEC 2.6: slides up after every answer, carries feedback.text and an
// optional inline feedback.videoUrl (+ an optional second feedback.videoUrlB,
// shown side by side with it — e.g. a wrong-technique/right-technique pair)
// and/or feedback.imageUrl. No score deduction shown here — the cost
// already landed on the vitals bar.
//
// The explanation is collapsed behind a toggle by default when there is
// no video to watch. From the third remediation round onward
// (`autoExpand`) it's shown immediately instead — a participant still
// missing items after two remediation rounds shouldn't be able to skip
// past the teaching moment. When a feedback video IS present it is
// mandatory rather than skippable: the card opens straight away (hiding
// a video behind a collapsed toggle while also blocking Continue on it
// would be a dead end with no visible reason), and Continue/Finish stays
// disabled until every present clip has been watched through once —
// same principle as gateOnFirstPlay, applied here to whichever of
// videoUrl/videoUrlB actually exist.
export const FeedbackCard = ({ isCorrect, text, videoUrl, videoUrlB, imageUrl, onContinue, isLast, autoExpand }) => {
  const hasVideo = Boolean(videoUrl || videoUrlB);
  const [expanded, setExpanded] = useState(Boolean(autoExpand) || hasVideo);
  const gate = useMultiMediaGate([videoUrl, videoUrlB]);
  const canContinue = gate.satisfied;

  return (
    <motion.div
      variants={feedbackCardVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="fixed inset-x-0 bottom-0 z-30 border-t-4 bg-[#1E3050] px-4 pb-5 pt-4 text-[#FFF7ED] shadow-[0_-8px_24px_rgba(0,0,0,0.35)]"
      style={{ borderColor: isCorrect ? "#34D399" : "#FF6B5B" }}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: isCorrect ? "#34D399" : "#FF6B5B", color: "#16243D" }}
          >
            {isCorrect ? "Correct" : "Not quite"}
          </span>
        </div>

        {expanded ? (
          <>
            <p data-testid="feedback-text" className="text-[13px] leading-relaxed text-slate-100">{text}</p>
            {imageUrl && <img data-testid="feedback-image" src={imageUrl} alt="Feedback illustration" className="max-h-40 w-full rounded-md object-contain bg-black" />}
            {hasVideo && (
              <div className={`grid gap-2 ${videoUrl && videoUrlB ? "grid-cols-2" : "grid-cols-1"}`}>
                {videoUrl && (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video data-testid="feedback-video" src={videoUrl} controls playsInline className="max-h-40 w-full rounded-md bg-black" {...gate.handlersFor(videoUrl)} />
                )}
                {videoUrlB && (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video data-testid="feedback-video-b" src={videoUrlB} controls playsInline className="max-h-40 w-full rounded-md bg-black" {...gate.handlersFor(videoUrlB)} />
                )}
              </div>
            )}
            {hasVideo && !canContinue && (
              <p className="text-[11px] text-slate-400">
                {gate.total > 1 && gate.remaining > 1
                  ? "Watch both clips through once to continue."
                  : gate.total > 1
                    ? "Watch the other clip through once to continue."
                    : "Watch the clip through once to continue."}
              </p>
            )}
          </>
        ) : (
          <button
            type="button"
            data-testid="show-explanation-button"
            onClick={() => setExpanded(true)}
            className="self-start text-[12px] font-medium text-[#7FB8E8] underline underline-offset-2"
          >
            Show explanation
          </button>
        )}

        <button
          type="button"
          data-testid="continue-button"
          onClick={onContinue}
          disabled={!canContinue}
          className="ml-auto rounded-md bg-[#34D399] px-4 py-2 text-sm font-semibold text-[#16243D] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isLast ? "Finish" : "Continue"}
        </button>
      </div>
    </motion.div>
  );
};
