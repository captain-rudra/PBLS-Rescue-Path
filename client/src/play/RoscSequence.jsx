import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

// SPEC 2.7 — three submit-time outcomes. `mastered` (100%) plays the full
// six-frame sequence, ~4.5s. `fail` (below the pass mark) stops at frame 1
// with "Patient not stabilised" — the whole level restarts from question 1.
// `remediate` (cleared the pass mark but short of 100%) shows a calmer
// "stabilising" beat instead of the flatline/alarm — it isn't a failure —
// then routes into another remediation round over just what's still missed.
const FRAME_STARTS_MS = [0, 900, 1800, 2400, 3200, 4000];
const TOTAL_MS = 4500;

const DARK_BG = "#080b14";
const WARM_BG = "#FFF7ED";

const FlatlineTrace = ({ alarming }) => (
  <svg viewBox="0 0 200 40" className="w-56" aria-hidden="true">
    <motion.path
      d="M0 20 L200 20"
      stroke="#FF6B5B"
      strokeWidth="2"
      fill="none"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 0.9, ease: "linear" }}
    />
    {alarming && (
      <motion.rect
        x="0" y="0" width="200" height="40"
        fill="#FF6B5B"
        animate={{ opacity: [0, 0.15, 0] }}
        transition={{ duration: 0.6, repeat: Infinity }}
      />
    )}
  </svg>
);

// Not flat (they cleared the pass mark) but not full sinus rhythm either
// (not yet 100%) — a couple of small, irregular bumps in gold rather than
// alarm-coral, so it doesn't read as a failure state.
const IrregularTrace = () => (
  <svg viewBox="0 0 200 40" className="w-56" aria-hidden="true">
    <motion.path
      d="M0 20 L60 20 L66 12 L72 26 L78 20 L130 20 L134 15 L138 23 L142 20 L200 20"
      stroke="#FFC94A"
      strokeWidth="2"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 0.9, ease: "easeInOut" }}
    />
  </svg>
);

const SinusTrace = () => (
  <svg viewBox="0 0 200 40" className="w-56" aria-hidden="true">
    <motion.path
      d="M0 20 L44 20 L52 6 L60 34 L68 20 L92 20 L100 2 L108 36 L116 20 L200 20"
      stroke="#34D399"
      strokeWidth="2"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 0.9, ease: "easeInOut" }}
    />
  </svg>
);

const WakingFace = () => (
  <svg viewBox="0 0 120 80" className="h-16 w-24" aria-hidden="true">
    <circle cx="60" cy="40" r="34" fill="#FFD9A8" />
    <motion.ellipse cx="42" cy="38" rx="6" initial={{ ry: 0.5 }} animate={{ ry: 5 }} transition={{ duration: 0.6, delay: 0.2 }} fill="#16243D" />
    <motion.ellipse cx="78" cy="38" rx="6" initial={{ ry: 0.5 }} animate={{ ry: 5 }} transition={{ duration: 0.6, delay: 0.2 }} fill="#16243D" />
    <path d="M46 56 Q60 64 74 56" stroke="#16243D" strokeWidth="3" fill="none" strokeLinecap="round" />
  </svg>
);

const Stars = ({ stars, delayStart }) => (
  <div className="flex gap-1">
    {[1, 2, 3].map(n => (
      <motion.span
        key={n}
        className="text-2xl"
        initial={{ scale: 0, opacity: 0 }}
        animate={n <= stars ? { scale: [0, 1.3, 1], opacity: 1 } : { scale: 1, opacity: 1 }}
        transition={{ duration: 0.35, delay: delayStart + n * 0.22 }}
        style={{ color: n <= stars ? "#FFC94A" : "#3A4A63" }}
      >
        ★
      </motion.span>
    ))}
  </div>
);

export const RoscSequence = ({ outcome, missedCount, headline, onDone, onRestartLevel, onContinueRemediation }) => {
  const [frame, setFrame] = useState(1);
  const mastered = outcome === "mastered";

  useEffect(() => {
    if (!mastered) return undefined; // fail/remediate variants stop at frame 1
    const timers = FRAME_STARTS_MS.slice(1).map((startMs, i) => setTimeout(() => setFrame(i + 2), startMs));
    timers.push(setTimeout(onDone, TOTAL_MS));
    return () => timers.forEach(clearTimeout);
  }, [mastered, onDone]);

  const warm = mastered && frame >= 4;

  return (
    <motion.div
      className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 px-4 text-center"
      animate={{ backgroundColor: warm ? WARM_BG : DARK_BG }}
      transition={{ duration: 0.6 }}
    >
      <AnimatePresence mode="wait">
        {(frame === 1 || !mastered) && (
          <motion.div key="frame1" data-testid="rosc-frame-1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-3">
            {outcome === "remediate" ? (
              <>
                <p className="text-[11px] uppercase tracking-widest text-[#FFC94A]">Stabilising</p>
                <IrregularTrace />
              </>
            ) : (
              <>
                <p className="text-[11px] uppercase tracking-widest text-[#FF6B5B]">Flatline</p>
                <FlatlineTrace alarming={outcome === "fail"} />
              </>
            )}
          </motion.div>
        )}

        {mastered && frame === 2 && (
          <motion.div key="frame2" data-testid="rosc-frame-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-3">
            <p className="text-[11px] uppercase tracking-widest text-[#34D399]">Rhythm returning</p>
            <SinusTrace />
          </motion.div>
        )}

        {mastered && frame === 3 && (
          <motion.div
            key="frame3"
            data-testid="rosc-frame-3"
            initial={{ scale: 0, rotate: 0, opacity: 0 }}
            animate={{ scale: 1, rotate: -6, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 14 }}
            className="rounded-lg border-4 border-[#34D399] bg-[#34D399]/15 px-6 py-3"
          >
            <p className="text-xl font-bold uppercase tracking-wide text-[#34D399]" style={{ fontFamily: "Fredoka, sans-serif" }}>
              ROSC achieved
            </p>
          </motion.div>
        )}

        {mastered && frame === 4 && (
          <motion.div key="frame4" data-testid="rosc-frame-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-3">
            <WakingFace />
            <p className="text-[13px] text-[#16243D]">Patient stabilised</p>
          </motion.div>
        )}

        {mastered && frame === 5 && (
          <motion.div key="frame5" data-testid="rosc-frame-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-4">
            {/* Frozen first-attempt figures, not this round's own 100% — a
                level always eventually reaches 100%, so the number worth
                celebrating here is the one that stays on the record. */}
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-[13px] text-[#16243D]">
              <p className="text-slate-500">First-attempt accuracy</p>
              <p className="text-left font-semibold">{headline.accuracy}%</p>
              <p className="text-slate-500">First-attempt score</p>
              <p className="text-left font-semibold">{headline.score}</p>
            </div>
            <Stars stars={headline.starsAwarded} delayStart={0} />
          </motion.div>
        )}

        {mastered && frame === 6 && (
          <motion.div key="frame6" data-testid="rosc-frame-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-2">
            <p className="text-[12px] uppercase tracking-wide text-[#16243D]">🔓 The path ahead lights up…</p>
          </motion.div>
        )}
      </AnimatePresence>

      {outcome === "fail" && (
        <motion.div
          data-testid="rosc-not-stabilised"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
          className="mt-2 flex flex-col items-center gap-4"
        >
          <p className="rounded-full border border-[#FF6B5B] px-4 py-1 text-sm font-semibold uppercase tracking-wide text-[#FF6B5B]">
            Patient not stabilised
          </p>
          <p className="max-w-xs text-[12px] text-slate-300">
            This round was below the pass mark ({missedCount} item{missedCount === 1 ? "" : "s"} missed) — the level restarts from question 1.
          </p>
          <button
            type="button"
            data-testid="restart-level-button"
            onClick={onRestartLevel}
            className="rounded-md bg-[#34D399] px-4 py-2 text-sm font-semibold text-[#16243D]"
          >
            Restart level
          </button>
        </motion.div>
      )}

      {outcome === "remediate" && (
        <motion.div
          data-testid="rosc-remediate"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
          className="mt-2 flex flex-col items-center gap-4"
        >
          <p className="rounded-full border border-[#FFC94A] px-4 py-1 text-sm font-semibold uppercase tracking-wide text-[#FFC94A]">
            Almost stable
          </p>
          <p className="max-w-xs text-[12px] text-slate-300">
            You cleared the pass mark — {missedCount} item{missedCount === 1 ? "" : "s"} still need{missedCount === 1 ? "s" : ""} review before this level is mastered.
          </p>
          <button
            type="button"
            data-testid="continue-remediation-button"
            onClick={onContinueRemediation}
            className="rounded-md bg-[#34D399] px-4 py-2 text-sm font-semibold text-[#16243D]"
          >
            Continue remediation
          </button>
        </motion.div>
      )}
    </motion.div>
  );
};
