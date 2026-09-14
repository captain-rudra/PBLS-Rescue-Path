import { motion } from "framer-motion";

// Decorative backdrop for the non-testing screens (sign-in, dashboard,
// briefing, result, review) — a dark medical/digital aesthetic: a deep
// navy-teal gradient, a couple of slow drifting glow "auras", a
// periodic diagonal light sweep, a faint circuit-grid texture, and a
// handful of floating medical/AI motifs (ECG line, pulse dot, molecule,
// circuit node). Deliberately NOT used on the question-answering screen
// itself (QuestionEnginePage) — that screen's timing capture and
// performance on low-end phones over shared wifi matter more than
// decoration (CLAUDE.md: reliability under bad conditions).
//
// Pure CSS/SVG/framer-motion, transform-only animations (no blur-heavy
// full-viewport filters, no layout-triggering top/left animation) so this
// stays cheap on weak hardware. `pointer-events-none` and a negative-ish
// stacking context so it never intercepts a click; callers wrap real
// content in a `relative z-10` container.
const AURAS = [
  { color: "#34D399", size: 520, x: "10%", y: "-8%", dur: 22 },
  { color: "#7FB8E8", size: 460, x: "78%", y: "18%", dur: 26 },
  { color: "#FFC94A", size: 380, x: "35%", y: "72%", dur: 30 }
];

const ECG_PATH = "M0 20 L20 20 L26 4 L34 36 L40 20 L60 20 L66 10 L72 30 L78 20 L100 20";

const EcgMotif = ({ style, delay = 0 }) => (
  <motion.svg
    viewBox="0 0 100 40"
    width="120"
    height="48"
    className="absolute opacity-[0.14]"
    style={style}
    initial={{ opacity: 0 }}
    animate={{ opacity: [0, 0.14, 0.14, 0], y: [0, -14, -14, -28] }}
    transition={{ duration: 9, repeat: Infinity, delay, ease: "easeInOut" }}
  >
    <path d={ECG_PATH} fill="none" stroke="#34D399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </motion.svg>
);

const MoleculeMotif = ({ style, delay = 0 }) => (
  <motion.svg
    viewBox="0 0 60 60"
    width="64"
    height="64"
    className="absolute opacity-[0.12]"
    style={style}
    animate={{ y: [0, -16, 0], rotate: [0, 12, 0] }}
    transition={{ duration: 14, repeat: Infinity, delay, ease: "easeInOut" }}
  >
    <circle cx="14" cy="14" r="4" fill="#7FB8E8" />
    <circle cx="46" cy="18" r="3" fill="#34D399" />
    <circle cx="30" cy="44" r="4" fill="#FFC94A" />
    <line x1="14" y1="14" x2="30" y2="44" stroke="#7FB8E8" strokeWidth="1.5" />
    <line x1="46" y1="18" x2="30" y2="44" stroke="#34D399" strokeWidth="1.5" />
  </motion.svg>
);

const CircuitMotif = ({ style, delay = 0 }) => (
  <motion.svg
    viewBox="0 0 80 40"
    width="96"
    height="48"
    className="absolute opacity-[0.10]"
    style={style}
    animate={{ x: [0, 18, 0] }}
    transition={{ duration: 18, repeat: Infinity, delay, ease: "easeInOut" }}
  >
    <path d="M0 20 H24 M56 20 H80 M24 20 V6 H40 V20 M40 20 V34 H56 V20" fill="none" stroke="#FFF7ED" strokeWidth="1.5" />
    <circle cx="24" cy="20" r="2.5" fill="#34D399" />
    <circle cx="56" cy="20" r="2.5" fill="#7FB8E8" />
  </motion.svg>
);

// `absolute`, not `fixed`: this sits inside a `relative` page wrapper whose
// height is set by its own content (often taller than one viewport, e.g.
// the Dashboard's path) — `fixed` would size itself to the viewport alone
// and leave a plain white gap below the first screenful once the page
// scrolls past it.
export const GameBackground = () => (
  <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-[#0B1A2E]">
    {/* base gradient wash */}
    <div className="absolute inset-0" style={{ background: "radial-gradient(120% 90% at 15% -10%, #16243D 0%, #0B1A2E 55%, #081321 100%)" }} />

    {/* faint circuit-grid texture */}
    <div
      className="absolute inset-0 opacity-[0.05]"
      style={{
        backgroundImage:
          "linear-gradient(#7FB8E8 1px, transparent 1px), linear-gradient(90deg, #7FB8E8 1px, transparent 1px)",
        backgroundSize: "42px 42px"
      }}
    />

    {/* drifting glow auras */}
    {AURAS.map((a, i) => (
      <motion.div
        key={i}
        className="absolute rounded-full"
        style={{ width: a.size, height: a.size, left: a.x, top: a.y, background: a.color, opacity: 0.16, filter: "blur(70px)" }}
        animate={{ x: [0, 30, -20, 0], y: [0, -20, 15, 0] }}
        transition={{ duration: a.dur, repeat: Infinity, ease: "easeInOut" }}
      />
    ))}

    {/* periodic diagonal light pass */}
    <motion.div
      className="absolute -inset-y-1/2 w-1/3"
      style={{ background: "linear-gradient(75deg, transparent, rgba(255,255,255,0.06), transparent)" }}
      initial={{ x: "-40vw" }}
      animate={{ x: "140vw" }}
      transition={{ duration: 6, repeat: Infinity, repeatDelay: 5, ease: "easeInOut" }}
    />

    {/* floating medical/AI motifs */}
    <EcgMotif style={{ left: "6%", top: "22%" }} delay={0} />
    <EcgMotif style={{ right: "8%", bottom: "16%" }} delay={3} />
    <MoleculeMotif style={{ right: "12%", top: "12%" }} delay={1.2} />
    <MoleculeMotif style={{ left: "10%", bottom: "10%" }} delay={4} />
    <CircuitMotif style={{ left: "40%", top: "6%" }} delay={2} />
  </div>
);
