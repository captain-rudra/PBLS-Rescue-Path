// Deterministic shuffle for sequence questions (SPEC 3.3). Every seeded
// sequence item happens to be authored with items[] already in
// correctOrder, so without this the question is trivial — press confirm,
// no rearrangement needed. Seeded by (attemptId, questionId) rather than
// Math.random() so a mid-question refresh reproduces the same shuffled
// arrangement instead of reshuffling — attemptId stays stable across a
// refresh because POST /play/attempts is idempotent (returns the same
// in_progress attempt), and questionId never changes.

const hashSeed = key => {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

// mulberry32
const seededRandom = seed => {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const seededShuffle = (items, seedKey) => {
  const random = seededRandom(hashSeed(seedKey));
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};
