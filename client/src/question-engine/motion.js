// Shared motion vocabulary, SPEC 2.4.

export const correctRingVariants = {
  idle: { scale: 1, boxShadow: "0 0 0 0 rgba(52,211,153,0)" },
  correct: {
    scale: [1, 1.03, 1],
    boxShadow: ["0 0 0 0 rgba(52,211,153,0.6)", "0 0 0 14px rgba(52,211,153,0)", "0 0 0 0 rgba(52,211,153,0)"],
    transition: { duration: 0.32, ease: "easeOut" }
  }
};

export const wrongShakeVariants = {
  idle: { x: 0 },
  wrong: { x: [0, -2, 2, -2, 2, 0], transition: { duration: 0.42, ease: "easeInOut" } }
};

export const feedbackCardVariants = {
  hidden: { y: "100%", opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { type: "spring", stiffness: 300, damping: 22, mass: 0.9 } },
  exit: { y: "100%", opacity: 0, transition: { duration: 0.18 } }
};

export const pointsFlyVariants = {
  initial: { opacity: 0, y: 0, scale: 0.8 },
  animate: { opacity: [0, 1, 1, 0], y: -28, scale: 1, transition: { duration: 0.7, ease: "easeOut" } }
};

export const questionEnterVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: "easeOut" } }
};
