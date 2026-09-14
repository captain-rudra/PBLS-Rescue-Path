import { useState } from "react";
import { OptionsList } from "../OptionsList.jsx";
import { useMultiMediaGate } from "../../hooks/useMultiMediaGate.js";

const SidePlayer = ({ side, posterUrl, onPlay, onEnded, onError }) => {
  if (!side.videoUrl) {
    return (
      <div className="rounded-lg border border-dashed border-[#3A4A63] bg-[#1E3050] p-3">
        <p className="text-[11px] font-semibold text-slate-300">{side.label}</p>
        <ul className="mt-1 list-disc pl-4 text-[12px] text-slate-200">
          {(side.parameters || []).map((parameter, i) => (
            <li key={i}>{parameter}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg bg-black">
      <p className="bg-black/60 px-2 py-1 text-[11px] text-white">{side.label}</p>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video src={side.videoUrl} poster={posterUrl || undefined} controls playsInline className="max-h-56 w-full" onPlay={onPlay} onEnded={onEnded} onError={onError} />
    </div>
  );
};

// Two INDEPENDENT players, each with its own controls — no shared scrub,
// no synchronised playback. Both clips must be watched through once
// before the options unlock, same spirit as gateOnFirstPlay on a single
// video_mcq clip but for two clips at once (useMultiMediaGate). A side
// with no clip has nothing to watch and is already satisfied — it shows
// sides[].parameters (the source-document fallback) instead, exactly as
// before.
//
// The two clip URLs live on media.videoUrl/media.videoUrlB (one clip per
// side) rather than on sides[] itself — this is also exactly what the
// admin builder's split_screen fields (videoUrl, videoUrlB) edit, so
// "Preview as player" (SPEC 4.5) renders from the same place the builder
// writes to.
export const SplitScreen = ({ question, onFirstInteraction, onCommit, result }) => {
  const rawSides = question.sides || [];
  const sides = rawSides.map((side, index) => ({ ...side, videoUrl: index === 0 ? question.media?.videoUrl : question.media?.videoUrlB }));
  const gate = useMultiMediaGate([question.media?.videoUrl, question.media?.videoUrlB]);
  const [chosenKey, setChosenKey] = useState(null);
  const [hasInteracted, setHasInteracted] = useState(false);

  const markInteract = () => {
    if (!hasInteracted) {
      setHasInteracted(true);
      onFirstInteraction();
    }
  };

  const anyVideo = Boolean(question.media?.videoUrl || question.media?.videoUrlB);

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2">
        {sides.map((side, index) => (
          <SidePlayer
            key={side.label || index}
            side={side}
            posterUrl={question.media?.posterUrl}
            onPlay={markInteract}
            onEnded={gate.handlersFor(side.videoUrl).onEnded}
            onError={gate.handlersFor(side.videoUrl).onError}
          />
        ))}
      </div>

      {anyVideo && !gate.satisfied && (
        <p className="mt-2 text-center text-[11px] text-slate-400">
          {gate.total > 1
            ? gate.remaining > 1
              ? "Watch both clips through once to unlock the answer options."
              : "Watch the other clip through once to unlock the answer options."
            : "Watch the clip through once to unlock the answer options."}
        </p>
      )}

      {!anyVideo && question.fallbackText && <p className="mt-2 text-[12px] text-slate-300">{question.fallbackText}</p>}

      <div className="mt-4">
        <OptionsList
          options={question.options}
          disabled={!gate.satisfied}
          pendingKey={chosenKey}
          result={result}
          onSelect={key => {
            if (!gate.satisfied || chosenKey || result) return;
            markInteract();
            setChosenKey(key);
            onCommit({ selected: key }).catch(() => setChosenKey(null));
          }}
        />
      </div>
    </div>
  );
};
