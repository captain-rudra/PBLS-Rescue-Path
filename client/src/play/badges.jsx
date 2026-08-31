// Badge iconography and per-badge accent colours. Names are NOT hard-coded
// here — the server owns them (`level.badge` for the four level badges,
// `achievement.name` for the global ones) — this file only maps a stable
// key to a distinct icon and a colour drawn from SPEC 2.2's palette.
//
// Each icon is its own drawing, not one silhouette recoloured: a
// magnifying glass, a compression heart, a lifebuoy, a team of three, a
// rosette medal. They all use `currentColor` for their strokes so the
// Badge wrapper can switch the whole thing between full colour (earned)
// and slate (locked) without touching these paths.

// SPEC 2.2 visual tokens
export const PALETTE = {
  navy: "#16243D",
  slate: "#1E3050",
  green: "#34D399",
  coral: "#FF6B5B",
  gold: "#FFC94A",
  cyanotic: "#7FB8E8",
  cream: "#FFF7ED",
  lockedSlate: "#3A4A63"
};

const iconProps = { viewBox: "0 0 64 64", fill: "none", stroke: "currentColor", strokeWidth: 3.2, strokeLinecap: "round", strokeLinejoin: "round" };

// l1 — Scene Scout: recognising the scene. A magnifying glass over a
// horizon line.
const SceneScoutIcon = props => (
  <svg {...iconProps} {...props}>
    <circle cx="26" cy="26" r="15" />
    <path d="M14 30h9M37 37l13 13" />
    <path d="M20 27c3-4 9-4 12 0" />
  </svg>
);

// l2 — CPR Champion: high-quality compressions. A heart with two
// downstroke chevrons pressing into it.
const CprChampionIcon = props => (
  <svg {...iconProps} {...props}>
    <path d="M32 52S12 39 12 25a11 11 0 0 1 20-6 11 11 0 0 1 20 6c0 14-20 27-20 27Z" />
    <path d="M23 12l9 8 9-8M23 21l9 8 9-8" />
  </svg>
);

// l3 — Life Saver: AED and rescue. A lifebuoy ring with four lugs.
const LifeSaverIcon = props => (
  <svg {...iconProps} {...props}>
    <circle cx="32" cy="32" r="20" />
    <circle cx="32" cy="32" r="9" />
    <path d="M32 12v6M32 46v6M12 32h6M46 32h6" strokeWidth="5" />
  </svg>
);

// l4 — Team Leader: assigning roles, closed-loop comms. Three figures,
// the centre one leading.
const TeamLeaderIcon = props => (
  <svg {...iconProps} {...props}>
    <circle cx="32" cy="18" r="7" />
    <path d="M20 52c0-8 5-14 12-14s12 6 12 14" />
    <circle cx="13" cy="27" r="5" />
    <path d="M5 50c0-6 3-11 8-12" />
    <circle cx="51" cy="27" r="5" />
    <path d="M59 50c0-6-3-11-8-12" />
  </svg>
);

// bls_expert — a rosette medal: a star in a ring with two ribbon tails.
const BlsExpertIcon = props => (
  <svg {...iconProps} {...props}>
    <path d="M24 40l-6 20 14-8 14 8-6-20" />
    <circle cx="32" cy="24" r="18" />
    <path d="M32 13l3.4 6.9 7.6 1.1-5.5 5.4 1.3 7.6-6.8-3.6-6.8 3.6 1.3-7.6-5.5-5.4 7.6-1.1Z" />
  </svg>
);

export const LEVEL_BADGE_META = {
  l1: { key: "l1", accent: PALETTE.cyanotic, Icon: SceneScoutIcon },
  l2: { key: "l2", accent: PALETTE.green, Icon: CprChampionIcon },
  l3: { key: "l3", accent: PALETTE.gold, Icon: LifeSaverIcon },
  l4: { key: "l4", accent: PALETTE.coral, Icon: TeamLeaderIcon }
};

export const ACHIEVEMENT_BADGE_META = {
  bls_expert: { key: "bls_expert", accent: PALETTE.gold, Icon: BlsExpertIcon }
};
