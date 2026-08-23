import { motion } from "framer-motion";

const STATE_STYLES = {
  stable: { fill: "#34D399", label: "Stable" },
  one_error: { fill: "#7FB8E8", label: "Desaturating" },
  two_errors: { fill: "#FF6B5B", label: "Alarm" },
  critical: { fill: "#FF6B5B", label: "Critical" }
};

export const VitalsBar = ({ percent, state }) => {
  const style = STATE_STYLES[state] || STATE_STYLES.stable;
  const alarming = state === "two_errors" || state === "critical";

  return (
    <div className="flex items-center gap-2" aria-label="Patient oxygen saturation">
      <span className="text-[10px] uppercase tracking-wide text-slate-300">SpO2</span>
      <div className="relative h-3 w-28 overflow-hidden rounded-full bg-[#3A4A63]">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: style.fill }}
          animate={{ width: `${percent}%`, opacity: alarming ? [1, 0.55, 1] : 1 }}
          transition={alarming ? { opacity: { duration: 0.8, repeat: Infinity } } : { duration: 0.3 }}
        />
      </div>
      <span className="text-[11px] font-medium text-slate-200">{percent}%</span>
    </div>
  );
};
