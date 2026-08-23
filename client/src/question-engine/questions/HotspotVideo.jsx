import { useEffect, useRef, useState } from "react";
import { MediaFrame } from "../MediaFrame.jsx";
import { OptionsList } from "../OptionsList.jsx";
import { useMediaGate } from "../../hooks/useMediaGate.js";

// Hotspots carry no explicit link to an option key (the schema only stores
// tStart/tEnd/x/y/r/label — see server/src/models/Question.js). We assume
// they are authored in the same order as `options`, so hotspot[i] answers
// options[i]. Tapping one commits immediately, same as picking the fallback
// option it maps to.
const HotspotOverlay = ({ hotspots, videoRef, disabled, onTap }) => {
  const [time, setTime] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const handleTimeUpdate = () => setTime(video.currentTime);
    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => video.removeEventListener("timeupdate", handleTimeUpdate);
  }, [videoRef]);

  return (
    <div className="pointer-events-none absolute inset-0">
      {hotspots.map((hotspot, index) => {
        if (time < hotspot.tStart || time > hotspot.tEnd) return null;
        return (
          <button
            key={index}
            type="button"
            disabled={disabled}
            onClick={() => onTap(index)}
            aria-label={hotspot.label || "hotspot"}
            className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full border-2 border-[#FFC94A] bg-[#FFC94A]/20"
            style={{
              left: `${hotspot.x * 100}%`,
              top: `${hotspot.y * 100}%`,
              width: `${hotspot.r * 200}%`,
              height: `${hotspot.r * 200}%`
            }}
          />
        );
      })}
    </div>
  );
};

// Single player with a timed hotspot overlay, plus the four options as a
// fallback route for devices where the tap does not register (SPEC 3.5).
export const HotspotVideo = ({ question, onFirstInteraction, onCommit, result }) => {
  const gate = useMediaGate(question.media);
  const videoRef = useRef(null);
  const [chosenKey, setChosenKey] = useState(null);
  const hotspots = question.hotspots || [];

  const commit = key => {
    if (!gate.satisfied || chosenKey || result) return;
    onFirstInteraction();
    setChosenKey(key);
    onCommit({ selected: key }, { mediaReplays: gate.replays }).catch(() => setChosenKey(null));
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <MediaFrame ref={videoRef} media={question.media || {}} fallbackText={question.fallbackText} gate={gate} onInteract={onFirstInteraction}>
        {!gate.showFallback && hotspots.length > 0 && (
          <HotspotOverlay
            hotspots={hotspots}
            videoRef={videoRef}
            disabled={!gate.satisfied || Boolean(chosenKey || result)}
            onTap={index => {
              const option = question.options[index];
              if (option) commit(option.key);
            }}
          />
        )}
      </MediaFrame>
      <OptionsList options={question.options} disabled={!gate.satisfied} pendingKey={chosenKey} result={result} onSelect={commit} />
    </div>
  );
};
