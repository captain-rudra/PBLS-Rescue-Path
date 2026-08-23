import { AnimatePresence, motion } from "framer-motion";
import { VitalsBar } from "./VitalsBar.jsx";
import { EcgLine } from "./EcgLine.jsx";
import { pointsFlyVariants } from "./motion.js";

export const Hud = ({ levelTitle, scene, questionNumber, totalQuestions, vitalsPercent, vitalsState, points, streak, pointsFlash }) => {
  const alarming = vitalsState === "two_errors" || vitalsState === "critical";

  return (
    <header className="sticky top-0 z-20 border-b border-[#3A4A63] bg-[#16243D]/95 px-4 py-2 text-[#FFF7ED] backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" style={{ fontFamily: "Fredoka, sans-serif" }}>{levelTitle}</p>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">{scene}</p>
        </div>

        <div className="text-[11px] font-medium text-slate-200">
          Question {questionNumber} / {totalQuestions}
        </div>

        <div className="flex items-center gap-3">
          <EcgLine alarming={alarming} />
          <VitalsBar percent={vitalsPercent} state={vitalsState} />
        </div>

        <div className="relative flex items-center gap-3">
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Points</p>
            <p className="text-sm font-semibold text-[#FFC94A]">{points}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Streak</p>
            <p className="text-sm font-semibold text-[#34D399]">{streak}</p>
          </div>
          <AnimatePresence>
            {pointsFlash && (
              <motion.span
                key={pointsFlash.key}
                variants={pointsFlyVariants}
                initial="initial"
                animate="animate"
                className="pointer-events-none absolute -top-1 right-0 text-xs font-semibold text-[#FFC94A]"
              >
                +{pointsFlash.amount}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
};
