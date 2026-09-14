import { useCallback, useState } from "react";

// Gate for "every one of these clips must be watched through once" —
// split_screen's two independent sides, and a feedback card's optional
// second video. Unlike useMediaGate there's no shared scrub here: each
// clip plays independently, on its own native controls, and this hook
// just tracks which of the given URLs has reached its own `ended` (or
// `error`) at least once.
//
// A null/undefined URL in the list needs nothing watched (that slot has
// no clip), and a clip that fails to load counts as done rather than
// permanently blocking — CLAUDE.md: the item must still be answerable
// even when the media doesn't load.
export const useMultiMediaGate = urls => {
  const present = urls.filter(Boolean);
  const [done, setDone] = useState(() => new Set());

  const markDone = useCallback(url => {
    setDone(prev => (prev.has(url) ? prev : new Set(prev).add(url)));
  }, []);

  const handlersFor = url => ({
    onEnded: () => markDone(url),
    onError: () => markDone(url)
  });

  const satisfied = present.every(url => done.has(url));
  return {
    satisfied,
    isDone: url => !url || done.has(url),
    handlersFor,
    total: present.length,
    remaining: present.filter(url => !done.has(url)).length
  };
};
