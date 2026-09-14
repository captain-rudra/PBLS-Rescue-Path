import { motion } from "framer-motion";

// SPEC 2.6 node states: locked (slate + padlock, 50% opacity), active
// (green fill, 80px, pulsing ring), complete (green outline, tick, 1-3 gold
// stars — mastered at 100%), remediating (gold outline, review glyph —
// cleared the pass mark but not yet mastered), failed (coral outline,
// retry glyph — below the pass mark, the level restarts).
const STATE_STYLE = {
  locked: { border: "#3A4A63", fill: "#3A4A63", text: "#FFF7ED", size: 64 },
  active: { border: "#34D399", fill: "#34D399", text: "#16243D", size: 80 },
  complete: { border: "#34D399", fill: "transparent", text: "#34D399", size: 64 },
  remediating: { border: "#FFC94A", fill: "transparent", text: "#FFC94A", size: 64 },
  failed: { border: "#FF6B5B", fill: "transparent", text: "#FF6B5B", size: 64 }
};

const Stars = ({ count }) => (
  <div className="mt-1 flex justify-center gap-0.5" aria-label={`${count} of 3 stars`}>
    {[1, 2, 3].map(n => (
      <span key={n} className="text-xs" style={{ color: n <= count ? "#FFC94A" : "#3A4A63" }}>
        ★
      </span>
    ))}
  </div>
);

const Glyph = ({ state }) => {
  if (state === "locked") return <span aria-hidden="true">🔒</span>;
  if (state === "complete") return <span aria-hidden="true">✓</span>;
  if (state === "remediating") return <span aria-hidden="true">✎</span>;
  if (state === "failed") return <span aria-hidden="true">↻</span>;
  return null; // active node just shows the badge label
};

const CAPTIONS = {
  locked: "Locked — master the previous level to unlock",
  failed: "Below the pass mark — restarts the level",
  remediating: "Remediation round due"
};

export const PathNode = ({ level, x, y, justUnlocked, onSelect, onReview }) => {
  const style = STATE_STYLE[level.state] || STATE_STYLE.locked;
  const interactive = level.state !== "locked";
  // Stars are frozen to the first attempt (SPEC 2.3), so they're knowable
  // as soon as one exists — not just once the level is finally mastered.
  const showStars = level.state !== "locked" && level.state !== "active";
  // A persistent review entry point (SPEC 2.6), separate from the main node
  // click (which still goes to the briefing to continue/restart/replay).
  // Gated on `headline` existing rather than on `state`: that's exactly
  // "has at least one submitted attempt", which is the same test the
  // server itself uses to decide whether a review exists at all — locked
  // and never-attempted (`active`) levels have no headline and get no link.
  const reviewable = Boolean(level.headline);

  return (
    <div className="absolute flex -translate-x-1/2 flex-col items-center" style={{ left: `${x}%`, top: y }}>
      <motion.button
        type="button"
        data-testid={`path-node-${level.key}`}
        disabled={!interactive}
        onClick={() => interactive && onSelect(level)}
        aria-label={`${level.title} — ${level.state}`}
        initial={justUnlocked ? { scale: 0.7, opacity: 0.5 } : false}
        animate={{
          scale: 1,
          opacity: level.state === "locked" ? 0.5 : 1,
          boxShadow:
            level.state === "active"
              ? ["0 0 0 0 rgba(52,211,153,0.55)", "0 0 0 12px rgba(52,211,153,0)", "0 0 0 0 rgba(52,211,153,0)"]
              : "0 0 0 0 rgba(0,0,0,0)"
        }}
        transition={
          level.state === "active"
            ? { boxShadow: { duration: 1, repeat: Infinity, ease: "easeOut" }, default: { duration: 0.9 } }
            : { duration: 0.9 }
        }
        whileHover={interactive ? { scale: 1.08, rotateX: 10, rotateY: -10 } : {}}
        whileTap={interactive ? { scale: 0.96 } : {}}
        style={{
          width: style.size,
          height: style.size,
          borderColor: style.border,
          backgroundColor: style.fill,
          color: style.text,
          cursor: interactive ? "pointer" : "not-allowed",
          transformPerspective: 400
        }}
        className="flex flex-col items-center justify-center rounded-full border-2 font-semibold"
      >
        <span className="text-lg leading-none">
          <Glyph state={level.state} />
        </span>
        {level.state === "active" && <span className="mt-0.5 text-[9px] uppercase tracking-wide">Start</span>}
      </motion.button>

      {showStars && <Stars count={level.starsAwarded} />}

      <div className="mt-1 max-w-[9rem] text-center">
        <p className="text-[11px] font-semibold text-[#FFF7ED]">{level.title}</p>
        <p className="text-[10px] text-slate-300">{level.scene}</p>
        <p className="text-[9px] text-slate-400">{CAPTIONS[level.state] ?? `Pass mark ${level.passMark}%`}</p>
      </div>

      {reviewable && (
        <button
          type="button"
          data-testid={`review-node-${level.key}`}
          onClick={() => onReview(level)}
          className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400 underline underline-offset-2 hover:text-[#34D399]"
        >
          Review answers
        </button>
      )}
    </div>
  );
};
