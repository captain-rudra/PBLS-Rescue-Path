import { useEffect, useRef, useCallback } from "react";

// Accumulates time the tab spent backgrounded via the Page Visibility API.
// Mount one of these per question (the caller keys the owning component by
// questionId so a fresh tracker is created per question automatically) — it
// sums every hide/show cycle for that question, not just the last one.
export const useHiddenTracker = () => {
  const hiddenMsRef = useRef(0);
  const hiddenSinceRef = useRef(document.hidden ? Date.now() : null);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenSinceRef.current = Date.now();
      } else if (hiddenSinceRef.current !== null) {
        hiddenMsRef.current += Date.now() - hiddenSinceRef.current;
        hiddenSinceRef.current = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  const getHiddenMs = useCallback(() => {
    let total = hiddenMsRef.current;
    if (hiddenSinceRef.current !== null) total += Date.now() - hiddenSinceRef.current;
    return total;
  }, []);

  return getHiddenMs;
};
