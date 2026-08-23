import { useCallback, useRef, useState } from "react";

// gateOnFirstPlay (SPEC 3.1): options stay unselectable until the video has
// played through once. A null videoUrl, or a video that fails to load,
// counts as "gate already satisfied" so the item stays answerable — see
// CLAUDE.md's fallbackText rule. Replays after the first play-through are
// unlimited and reported back in mediaReplays.
export const useMediaGate = media => {
  const requiresGate = Boolean(media?.gateOnFirstPlay);
  const hasVideo = Boolean(media?.videoUrl);

  const [satisfied, setSatisfied] = useState(!requiresGate || !hasVideo);
  const [failed, setFailed] = useState(false);
  const [replays, setReplays] = useState(0);
  const hasPlayedOnceRef = useRef(false);

  const onPlay = useCallback(() => {
    if (hasPlayedOnceRef.current) setReplays(count => count + 1);
  }, []);

  const onEnded = useCallback(() => {
    hasPlayedOnceRef.current = true;
    setSatisfied(true);
  }, []);

  const onError = useCallback(() => {
    setFailed(true);
    setSatisfied(true);
  }, []);

  return { satisfied, failed, replays, hasVideo, showFallback: failed || !hasVideo, onPlay, onEnded, onError };
};
