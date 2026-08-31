// Visible sound toggle, muted by default (SPEC 2.8). Shared by every screen
// that needs it rather than each owning its own mute state, so the
// preference (see useMute) stays in sync across the app.
export const MuteToggle = ({ muted, onToggle, className = "" }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-pressed={muted}
    aria-label={muted ? "Unmute sound" : "Mute sound"}
    className={`flex items-center gap-1.5 rounded-full border border-[#3A4A63] bg-[#1E3050] px-3 py-1.5 text-[11px] font-medium text-[#FFF7ED] transition hover:brightness-110 ${className}`}
  >
    <span aria-hidden="true">{muted ? "🔇" : "🔊"}</span>
    {muted ? "Sound off" : "Sound on"}
  </button>
);
