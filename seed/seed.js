import levels from "./levels.json" with { type: "json" };
import questions from "./questions.json" with { type: "json" };
import { LEVEL_KEYS, QUESTION_TYPES } from "../shared/constants.js";

let mongoose;

const validate = () => {
  const levelMap = new Map(levels.map(level => [level.key, level]));
  if (levels.length !== LEVEL_KEYS.length || LEVEL_KEYS.some(key => !levelMap.has(key))) throw new Error("Seed levels do not match LEVEL_KEYS");
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
  const [{ default: dotenv }, mongooseModule, { default: Level }, { default: Question }] = await Promise.all([
    import("dotenv"),
    import("mongoose"),
    import("../server/src/models/Level.js"),
    import("../server/src/models/Question.js")
  ]);
  mongoose = mongooseModule.default;
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