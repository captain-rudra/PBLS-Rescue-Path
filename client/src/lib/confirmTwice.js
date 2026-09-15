// The one double-confirmation pattern this codebase uses for irreversible
// or high-stakes admin actions: a mandatory reason prompt, then a second
// prompt requiring the admin to retype an identifying value verbatim.
// Returns the trimmed reason on success, or null if the admin backed out
// or either step didn't match — callers should treat null as "do nothing".
export const confirmTwice = ({ reasonPrompt, retypeLabel, retypeValue }) => {
  const reason = window.prompt(reasonPrompt);
  if (reason == null) return null;
  if (!reason.trim()) {
    window.alert("A reason is required — it goes in the audit log.");
    return null;
  }
  const typed = window.prompt(`Type "${retypeValue}" to confirm.`);
  if (typed !== retypeValue) {
    window.alert(`${retypeLabel} didn't match — nothing was done.`);
    return null;
  }
  return reason.trim();
};
