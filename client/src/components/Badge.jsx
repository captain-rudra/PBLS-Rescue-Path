import { motion, useReducedMotion } from "framer-motion";
import { PALETTE } from "../play/badges.jsx";

// One badge medallion. Every badge sits on the same dark navy disc with a
// gold rim so they read as a set; they are told apart by their icon shape
// and its accent colour (SPEC 2.2 palette), never by the disc.
//
//  - earned            full colour. `reveal` additionally plays the
//                      one-shot entrance: the disc springs in, a light
//                      sweep crosses it, the rim pulses, the icon pops.
//  - not earned        visible but locked — greyscale, dimmed, a small
//                      padlock — so the player can see what is ahead.
//
// Honours prefers-reduced-motion: the reveal collapses to the final state
// with no sweep or pulse.

const DISC_BG = `radial-gradient(circle at 50% 30%, ${PALETTE.slate}, ${PALETTE.navy})`;

export const Badge = ({ badgeKey, name, accent = PALETTE.gold, Icon, earned = false, reveal = false, subtitle, size = 96 }) => {
  const reduceMotion = useReducedMotion();
  const animateReveal = earned && reveal && !reduceMotion;
  const iconSize = Math.round(size * 0.56);

  return (
    <figure className="flex w-[7.5rem] flex-col items-center gap-1.5 text-center" data-testid={`badge-${badgeKey}`} data-earned={earned ? "true" : "false"}>
      <motion.div
        className="relative grid place-items-center overflow-hidden rounded-full"
        style={{
          width: size,
          height: size,
          background: earned ? DISC_BG : PALETTE.navy,
          border: `${earned ? 3 : 2}px ${earned ? "solid" : "dashed"} ${earned ? PALETTE.gold : PALETTE.lockedSlate}`,
          opacity: earned ? 1 : 0.55,
          filter: earned ? "none" : "grayscale(1)"
        }}
        initial={
          animateReveal
            ? { scale: 0, rotate: -30, opacity: 0 }
            : earned
              ? false
              : { opacity: 0 }
        }
        animate={
          animateReveal
            ? {
                scale: 1,
                rotate: 0,
                opacity: 1,
                boxShadow: [
                  `0 0 0 0 ${PALETTE.gold}99`,
                  `0 0 0 14px ${PALETTE.gold}00`,
                  `0 0 16px 0 ${PALETTE.gold}59`
                ]
              }
            : earned
              ? { opacity: 1, boxShadow: `0 0 16px 0 ${PALETTE.gold}45` }
              : { opacity: 0.55 }
        }
        transition={
          animateReveal
            ? { type: "spring", stiffness: 220, damping: 12, boxShadow: { duration: 1.1, times: [0, 0.7, 1] } }
            : { duration: 0.4 }
        }
      >
        <motion.div
          style={{ color: earned ? accent : PALETTE.lockedSlate, width: iconSize, height: iconSize }}
          initial={animateReveal ? { scale: 0, opacity: 0 } : false}
          animate={animateReveal ? { scale: 1, opacity: 1 } : {}}
          transition={animateReveal ? { delay: 0.16, type: "spring", stiffness: 260, damping: 14 } : undefined}
        >
          <Icon width={iconSize} height={iconSize} />
        </motion.div>

        {animateReveal && (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 w-2/5"
            style={{ background: "linear-gradient(100deg, transparent, rgba(255,255,255,0.55), transparent)", transform: "skewX(-20deg)" }}
            initial={{ x: "-170%" }}
            animate={{ x: "270%" }}
            transition={{ delay: 0.28, duration: 0.7, ease: "easeInOut" }}
          />
        )}

        {!earned && (
          <span
            aria-hidden="true"
            className="absolute bottom-0 right-0 grid h-5 w-5 translate-x-1 translate-y-1 place-items-center rounded-full text-[10px]"
            style={{ background: PALETTE.lockedSlate, color: PALETTE.cream }}
          >
            🔒
          </span>
        )}
      </motion.div>

      <motion.figcaption
        className="leading-tight"
        initial={animateReveal ? { opacity: 0, y: 6 } : false}
        animate={animateReveal ? { opacity: 1, y: 0 } : {}}
        transition={animateReveal ? { delay: 0.42 } : undefined}
      >
        <span className="block text-[12px] font-semibold" style={{ color: earned ? PALETTE.cream : "#94a3b8" }}>
          {name}
        </span>
        {subtitle && <span className="block text-[10px] text-slate-400">{subtitle}</span>}
      </motion.figcaption>
    </figure>
  );
};
