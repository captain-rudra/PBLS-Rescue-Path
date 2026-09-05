import dotenv from "dotenv";
import mongoose from "mongoose";
import Level from "../server/src/models/Level.js";
import Question from "../server/src/models/Question.js";
import levels from "./levels.json" with { type: "json" };
import questions from "./questions.json" with { type: "json" };
import { LEVEL_KEYS, QUESTION_TYPES } from "../shared/constants.js";

// Mongoose silently drops any key on write that its schema was never taught
// (`strict: true`) — the sideSchema.label class of bug, and, as of the
// media.videoUrlB/sharedScrub incident, not limited to top-level fields:
// media, feedback, sides, items, buckets and hotspots are all their own
// embedded subschemas, and a stray key inside any of THEM was invisible to
// a check that only ever looked at the question's own top-level keys.
//
// This walks the real thing instead of a flat key list: for whatever
// `value` is at this level, check its keys against `schema`'s own paths,
// then for every key that is itself an embedded subdocument (single, like
// media/feedback) or a document array (like sides/items/buckets/hotspots/
// options) — recognisable by that path's SchemaType exposing a `.schema` —
// recurse into it with the matching nested schema. A document array walks
// every element. Fails loudly on the first unknown key at ANY depth.
const walkSchema = (label, value, schema) => {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkSchema(`${label}[${index}]`, item, schema));
    return;
  }
  const knownKeys = new Set(Object.keys(schema.paths).map(path => path.split(".")[0]));
  const unknown = Object.keys(value).filter(key => !knownKeys.has(key));
  if (unknown.length) throw new Error(`${label} has field(s) not in its Mongoose schema — they would be silently dropped on write: ${unknown.join(", ")}`);
  for (const key of Object.keys(value)) {
    const nestedSchema = schema.path(key)?.schema;
    if (nestedSchema) walkSchema(`${label}.${key}`, value[key], nestedSchema);
  }
};

const validate = () => {
  const levelMap = new Map(levels.map(level => [level.key, level]));
  if (levels.length !== LEVEL_KEYS.length || LEVEL_KEYS.some(key => !levelMap.has(key))) throw new Error("Seed levels do not match LEVEL_KEYS");
  for (const level of levels) walkSchema(`Level ${level.key}`, level, Level.schema);
  const keys = new Set();
  const preparedQuestions = questions.map(question => ({
    ...question,
    feedback: {
      ...question.feedback,
      text: question.feedback?.text || (question.status === "draft" ? "Feedback pending authoring." : question.feedback?.text)
    }
  }));
  for (const question of preparedQuestions) {
    const uniqueKey = `${question.levelKey}:${question.sequence}`;
    if (keys.has(uniqueKey)) throw new Error(`Duplicate question key: ${uniqueKey}`);
    keys.add(uniqueKey);
    walkSchema(`Question ${uniqueKey}`, question, Question.schema);
    const level = levelMap.get(question.levelKey);
    if (!level) throw new Error(`Unknown level: ${question.levelKey}`);
    if (!QUESTION_TYPES.includes(question.type)) throw new Error(`Unknown question type: ${question.type}`);
    if (!level.objectives.includes(question.objective) && question.status !== "draft") throw new Error(`Invalid objective for ${uniqueKey}`);
    if (!question.feedback?.text) throw new Error(`Missing feedback.text for ${uniqueKey}`);
    if (question.media && !question.fallbackText) throw new Error(`Missing fallbackText for ${uniqueKey}`);
  }
  return { levelMap, preparedQuestions, questionCount: preparedQuestions.length };
};

const seed = async () => {
  const { levelMap, preparedQuestions, questionCount } = validate();
  if (process.argv.includes("--validate-only")) {
    console.log(`Seed validation passed: ${levels.length} levels, ${questionCount} questions`);
    return;
  }
  dotenv.config();
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/pbls_rescue_path");
  const levelIds = new Map();
  for (const level of levels) {
    const saved = await Level.findOneAndUpdate({ key: level.key }, { $set: level, $setOnInsert: { deletedAt: null } }, { upsert: true, returnDocument: "after", runValidators: true });
    levelIds.set(level.key, saved._id);
  }
  for (const question of preparedQuestions) {
    await Question.findOneAndUpdate(
      { levelKey: question.levelKey, sequence: question.sequence },
      { $set: { ...question, levelId: levelIds.get(question.levelKey) }, $setOnInsert: { version: 1, deletedAt: null } },
      { upsert: true, returnDocument: "after", runValidators: true }
    );
  }
  console.log(`Seeded ${levels.length} levels and ${questionCount} questions`);
  await mongoose.disconnect();
};

seed().catch(async error => {
  console.error(error);
  if (mongoose?.connection.readyState) await mongoose.disconnect();
  process.exitCode = 1;
});