import { motion } from "framer-motion";
import { correctRingVariants, wrongShakeVariants } from "./motion.js";

// Shared option-card list for mcq / video_mcq / animation_mcq / split_screen
// and the hotspot_video fallback route. `result` is null until the server
// responds; once it lands the chosen card and the correct card are both
// shown simultaneously (SPEC 2.6).
export const OptionsList = ({ options, disabled, pendingKey, result, onSelect }) => (
  <div className="grid gap-2">
    {options.map(option => {
      const isChosen = result ? result.given === option.key : pendingKey === option.key;
      const isCorrectCard = result ? result.correct === option.key : false;
      const isWrongChosen = result && isChosen && !result.isCorrect;
      const isRightChosen = result && isChosen && result.isCorrect;

      // Toned states sit on a light tint (15%/10% opacity over the cream
      // page background), so they need dark text — the near-white default
      // only reads on the untoned card's solid dark background.
      let toneClass = "border-[#3A4A63] bg-[#1E3050] text-[#FFF7ED] hover:border-[#34D399]/60";
      if (isRightChosen || (result && isCorrectCard)) toneClass = "border-[#34D399] bg-[#34D399]/15 text-[#16243D]";
      if (isWrongChosen) toneClass = "border-[#FF6B5B] bg-[#FF6B5B]/15 text-[#16243D]";
      if (!result && pendingKey === option.key) toneClass = "border-[#FFC94A] bg-[#FFC94A]/10 text-[#16243D]";

      return (
        <motion.button
          key={option.key}
          type="button"
          data-testid={`option-${option.key}`}
          disabled={disabled || Boolean(pendingKey) || Boolean(result)}
          onClick={() => onSelect(option.key)}
          variants={isRightChosen ? correctRingVariants : wrongShakeVariants}
          initial="idle"
          animate={isRightChosen ? "correct" : isWrongChosen ? "wrong" : "idle"}
          className={`rounded-lg border px-3 py-2.5 text-left text-[13px] transition disabled:cursor-not-allowed ${toneClass} ${
            disabled ? "opacity-40" : ""
          }`}
        >
          <span className="mr-2 font-semibold">{option.key}.</span>
          {option.text}
        </motion.button>
      );
    })}
  </div>
);
