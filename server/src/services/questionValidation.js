// The type-to-field mapping the admin builder and bank both need to agree
// on, plus the eight publish-gate checks from docs/SPEC.md 4.4. Kept in
// one place so "what does this type need" is answered identically
// whichever screen is asking.
import { OPTION_BASED_TYPES } from "./scoring.js";
import { HttpError } from "../lib/httpError.js";

// Every media sub-field a type's builder form shows. Boolean flags
// (loop, gateOnFirstPlay, sharedScrub) are included here for the builder's
// benefit but are never "assets" for the bank's media-state column below.
export const MEDIA_FIELDS_BY_TYPE = Object.freeze({
  mcq: [],
  video_mcq: ["videoUrl", "posterUrl", "gateOnFirstPlay"],
  animation_mcq: ["riveSrc", "loop"],
  drag_drop: [],
  sequence: [],
  split_screen: ["videoUrl", "videoUrlB", "posterUrl", "sharedScrub"],
  hotspot_video: ["videoUrl", "posterUrl", "gateOnFirstPlay", "durationSeconds"]
});

// The subset of those fields that are actual required ASSETS — the ones
// SPEC 4.2's bank row reports as present/missing. video_mcq/hotspot_video
// need one clip; split_screen needs two (SPEC 3.4's two synced players);
// animation_mcq needs its Rive scene. mcq/drag_drop/sequence carry no
// media at all (SPEC 3's screen-treatment table).
const REQUIRED_MEDIA_ASSETS_BY_TYPE = Object.freeze({
  mcq: [],
  video_mcq: ["videoUrl"],
  animation_mcq: ["riveSrc"],
  drag_drop: [],
  sequence: [],
  split_screen: ["videoUrl", "videoUrlB"],
  hotspot_video: ["videoUrl"]
});

export const usesMedia = type => (MEDIA_FIELDS_BY_TYPE[type] || []).length > 0;

/** Per-row "which required assets are present, which are missing" for the question bank (SPEC 4.2). */
export const mediaStatusFor = question => {
  const required = REQUIRED_MEDIA_ASSETS_BY_TYPE[question.type] || [];
  const media = question.media || {};
  const present = required.filter(field => Boolean(media[field]));
  const missing = required.filter(field => !media[field]);
  return { required, present, missing };
};

const isNonEmptyString = value => typeof value === "string" && value.trim().length > 0;

/**
 * The eight publish-gate checks (SPEC 4.4), run against a question object
 * (plain object or a Mongoose doc — only reads, via plain property access)
 * and its parent level. Returns an array of named failure strings; empty
 * means clear to publish. Never throws — the caller decides what a
 * non-empty list means for the request in front of it.
 */
export const validateForPublish = (question, level) => {
  const failures = [];
  const options = question.options || [];

  // 1 & 2: a correct answer matching an option key, and at least two options.
  if (OPTION_BASED_TYPES.has(question.type)) {
    if (!isNonEmptyString(question.correct) || !options.some(o => o.key === question.correct)) {
      failures.push("A correct answer must be selected and must match one of the options.");
    }
    if (options.length < 2) {
      failures.push("At least two options are required for this question type.");
    }
  }

  // 3: every drag item names a bucket that exists.
  if (question.type === "drag_drop") {
    const items = question.items || [];
    const buckets = question.buckets || [];
    if (items.length === 0) failures.push("At least one draggable item is required.");
    if (buckets.length === 0) failures.push("At least one bucket is required.");
    const bucketKeys = new Set(buckets.map(b => b.key));
    const orphaned = items.filter(item => !bucketKeys.has(item.bucket));
    if (orphaned.length > 0) {
      failures.push(`Every drag item must name a bucket that exists — ${orphaned.map(i => `"${i.text}"`).join(", ")} name${orphaned.length === 1 ? "s" : ""} one that isn't defined.`);
    }
  }

  // 4: correctOrder covers every sequence item exactly once.
  if (question.type === "sequence") {
    const items = question.items || [];
    const correctOrder = question.correctOrder || [];
    const itemIds = new Set(items.map(i => i.id));
    const orderIds = new Set(correctOrder);
    const coversExactlyOnce = correctOrder.length === items.length && orderIds.size === correctOrder.length && [...itemIds].every(id => orderIds.has(id));
    if (items.length === 0) failures.push("At least one sequence item is required.");
    else if (!coversExactlyOnce) failures.push("correctOrder must cover every sequence item exactly once — no duplicates, none left out.");
  }

  // 5: each hotspot window falls inside the clip duration.
  if (question.type === "hotspot_video") {
    const hotspots = question.hotspots || [];
    const duration = question.media?.durationSeconds;
    if (hotspots.length === 0) failures.push("At least one hotspot is required.");
    hotspots.forEach((hotspot, index) => {
      const label = hotspot.label || `#${index + 1}`;
      if (!(hotspot.tStart >= 0) || !(hotspot.tEnd > hotspot.tStart)) {
        failures.push(`Hotspot "${label}"'s window (${hotspot.tStart}–${hotspot.tEnd}s) is invalid — tEnd must be greater than tStart, and tStart must be 0 or later.`);
      } else if (typeof duration === "number" && hotspot.tEnd > duration) {
        failures.push(`Hotspot "${label}"'s window (${hotspot.tStart}–${hotspot.tEnd}s) extends past the clip duration (${duration}s).`);
      }
      if (!(hotspot.x >= 0 && hotspot.x <= 1 && hotspot.y >= 0 && hotspot.y <= 1)) {
        failures.push(`Hotspot "${label}"'s x/y must be given as a fraction of the frame (0–1), not pixels.`);
      }
    });
  }

  // 6: feedback.text is present.
  if (!isNonEmptyString(question.feedback?.text)) {
    failures.push("feedback.text is required.");
  }

  // 7: fallbackText required whenever media is attached.
  if (question.media && !isNonEmptyString(question.fallbackText)) {
    failures.push("fallbackText is required whenever media is attached.");
  }

  // 8: an objective selected from the parent level's list.
  if (!level || !level.objectives.includes(question.objective)) {
    failures.push("An objective must be selected from the parent level's list.");
  }

  return failures;
};

const sanitizeOptions = options => (options || []).map(o => ({ key: o.key, text: o.text }));

// Builds ONLY the middle-block fields a type actually has (SPEC 3: "Only
// fields relevant to the type are validated and rendered" — this is what
// keeps a document from accumulating stray fields left over from trying
// other types in the same form session before settling on this one).
const TYPE_FIELD_BUILDERS = Object.freeze({
  mcq: input => ({ options: sanitizeOptions(input.options), correct: input.correct || null }),
  video_mcq: input => ({
    options: sanitizeOptions(input.options),
    correct: input.correct || null,
    media: { videoUrl: input.media?.videoUrl || null, posterUrl: input.media?.posterUrl || null, gateOnFirstPlay: Boolean(input.media?.gateOnFirstPlay) },
    fallbackText: input.fallbackText || null
  }),
  animation_mcq: input => ({
    options: sanitizeOptions(input.options),
    correct: input.correct || null,
    media: { riveSrc: input.media?.riveSrc || null, loop: input.media?.loop !== false },
    fallbackText: input.fallbackText || null
  }),
  drag_drop: input => ({
    items: (input.items || []).map(i => ({ id: i.id, text: i.text, bucket: i.bucket || null })),
    buckets: (input.buckets || []).map(b => ({ key: b.key, label: b.label }))
  }),
  sequence: input => ({
    items: (input.items || []).map(i => ({ id: i.id, text: i.text })),
    correctOrder: input.correctOrder || []
  }),
  // Video sources live on media.videoUrl/videoUrlB (one clip per side),
  // NOT sides[].videoUrl — sides[] carries only the label and the
  // fallback parameter list (SPEC 3.4's "doubles as the fallback").
  split_screen: input => ({
    options: sanitizeOptions(input.options),
    correct: input.correct || null,
    media: {
      videoUrl: input.media?.videoUrl || null,
      videoUrlB: input.media?.videoUrlB || null,
      posterUrl: input.media?.posterUrl || null,
      sharedScrub: Boolean(input.media?.sharedScrub)
    },
    sides: (input.sides || []).map(s => ({ label: s.label, parameters: s.parameters || [] })),
    fallbackText: input.fallbackText || null
  }),
  hotspot_video: input => ({
    options: sanitizeOptions(input.options),
    correct: input.correct || null,
    media: {
      videoUrl: input.media?.videoUrl || null,
      posterUrl: input.media?.posterUrl || null,
      gateOnFirstPlay: Boolean(input.media?.gateOnFirstPlay),
      durationSeconds: typeof input.media?.durationSeconds === "number" ? input.media.durationSeconds : null
    },
    hotspots: (input.hotspots || []).map(h => ({ tStart: h.tStart, tEnd: h.tEnd, x: h.x, y: h.y, r: h.r, isError: Boolean(h.isError), label: h.label || null })),
    fallbackText: input.fallbackText || null
  })
});

/**
 * Builds the exact set of fields to persist for `input.type` — the top
 * block (always present) plus only that type's own middle-block fields.
 * `input` is trusted only for its VALUES, never for which keys exist on
 * it — a leftover `options` array from a type the admin tried earlier in
 * the same form session is simply not in a drag_drop's output.
 */
export const sanitizeQuestionForType = input => {
  const builder = TYPE_FIELD_BUILDERS[input.type];
  if (!builder) throw new HttpError(400, "INVALID_TYPE", `Unknown question type: ${input.type}`);

  const common = {
    levelKey: input.levelKey,
    type: input.type,
    title: (input.title || "").trim(),
    objective: (input.objective || "").trim(),
    scenario: input.scenario ? input.scenario.trim() : null,
    prompt: (input.prompt || "").trim(),
    points: Number(input.points),
    feedback: {
      text: (input.feedback?.text || "").trim(),
      videoUrl: input.feedback?.videoUrl || null,
      videoUrlB: input.feedback?.videoUrlB || null,
      imageUrl: input.feedback?.imageUrl || null
    },
    authoringNote: input.authoringNote || null
  };

  return { ...common, ...builder(input) };
};
