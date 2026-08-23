import { motion } from "framer-motion";

// Decorative live ECG trace, SPEC 2.6 ("live ECG" in the HUD strip).
export const EcgLine = ({ alarming }) => (
  <svg viewBox="0 0 120 24" width="72" height="16" className="shrink-0">
    <motion.path
      d="M0 12 L28 12 L34 4 L40 20 L46 12 L58 12 L64 2 L70 22 L76 12 L120 12"
      fill="none"
      stroke={alarming ? "#FF6B5B" : "#34D399"}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: [0, 1] }}
      transition={{ duration: alarming ? 0.6 : 1.1, repeat: Infinity, ease: "linear" }}
    />
  </svg>
);
