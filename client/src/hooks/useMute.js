import { useCallback, useEffect, useState } from "react";

// A learner may be in a shared study room (SPEC 2.8), so sound defaults off.
// This is a per-device UI preference, not game state — localStorage is fine
// here in a way it would not be for progress or scores (CLAUDE.md).
const STORAGE_KEY = "pbls.muted";

const readStored = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
};

export const useMute = () => {
  const [muted, setMuted] = useState(readStored);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(muted));
    } catch {
      // best-effort only — private browsing or a locked-down kiosk profile may block storage
    }
  }, [muted]);

  const toggle = useCallback(() => setMuted(value => !value), []);
  return [muted, toggle];
};
