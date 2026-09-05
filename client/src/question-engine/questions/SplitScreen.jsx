import { useRef, useState } from "react";
import { OptionsList } from "../OptionsList.jsx";

const SidePlayer = ({ side, videoRef, muted, posterUrl, onLoadedMetadata, onTimeUpdate }) => {
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
      <video
        ref={videoRef}
        src={side.videoUrl}
        poster={posterUrl || undefined}
        muted={muted}
        playsInline
        className="max-h-56 w-full"
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
      />
    </div>
  );
};

// Two synchronised players, one shared scrub bar (SPEC 3.4). The two clip
// URLs live on media.videoUrl/media.videoUrlB (one clip per side) rather
// than on sides[] itself — sides[].parameters is the source-document
// fallback, shown for whichever side has no clip. This is also exactly
// what the admin builder's split_screen fields (videoUrl, videoUrlB) edit,
// so "Preview as player" (SPEC 4.5) renders from the same place the
// builder writes to.
export const SplitScreen = ({ question, onFirstInteraction, onCommit, result }) => {
  const rawSides = question.sides || [];
  const sides = rawSides.map((side, index) => ({ ...side, videoUrl: index === 0 ? question.media?.videoUrl : question.media?.videoUrlB }));
  const anyVideo = Boolean(question.media?.videoUrl || question.media?.videoUrlB);
  const videoRefs = useRef([]);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [chosenKey, setChosenKey] = useState(null);
  const interactedRef = useRef(false);

  const markInteract = () => {
    if (!interactedRef.current) {
      interactedRef.current = true;
      onFirstInteraction();
    }
  };

  const handleLoadedMetadata = event => {
    if (event.target.duration > duration) setDuration(event.target.duration);
  };

  const togglePlay = () => {
    markInteract();
    videoRefs.current.forEach(video => video && (playing ? video.pause() : video.play()));
    setPlaying(value => !value);
  };

  const handleScrub = event => {
    markInteract();
    const fraction = Number(event.target.value);
    setProgress(fraction);
    videoRefs.current.forEach(video => {
      if (video && duration) video.currentTime = fraction * duration;
    });
  };

  const handleLeaderTimeUpdate = event => {
    if (duration) setProgress(event.target.currentTime / duration);
  };

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2">
        {sides.map((side, index) => (
          <SidePlayer
            key={side.label || index}
            side={side}
            muted={index !== 0}
            posterUrl={question.media?.posterUrl}
            videoRef={el => {
              videoRefs.current[index] = el;
            }}
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={index === 0 ? handleLeaderTimeUpdate : undefined}
          />
        ))}
      </div>

      {anyVideo && (
        <div className="mt-2 flex items-center gap-2">
          <button type="button" onClick={togglePlay} className="rounded-md bg-[#34D399] px-3 py-1.5 text-[12px] font-semibold text-[#16243D]">
            {playing ? "Pause both" : "Play both"}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={progress}
            onChange={handleScrub}
            className="h-1.5 flex-1 accent-[#34D399]"
            aria-label="Shared scrub bar"
          />
        </div>
      )}

      {!anyVideo && question.fallbackText && <p className="mt-2 text-[12px] text-slate-300">{question.fallbackText}</p>}

      <div className="mt-4">
        <OptionsList
          options={question.options}
          disabled={false}
          pendingKey={chosenKey}
          result={result}
          onSelect={key => {
            if (chosenKey || result) return;
            markInteract();
            setChosenKey(key);
            onCommit({ selected: key }).catch(() => setChosenKey(null));
          }}
        />
      </div>
    </div>
  );
};
