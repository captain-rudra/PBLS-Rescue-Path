import mongoose from "mongoose";

const responseSchema = new mongoose.Schema({
  attemptId: { type: mongoose.Schema.Types.ObjectId, ref: "Attempt", required: true },
  participantId: { type: mongoose.Schema.Types.ObjectId, ref: "Participant", required: true },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true },
  questionId: { type: mongoose.Schema.Types.ObjectId, ref: "Question", required: true },
  questionVersion: { type: Number, required: true, min: 1 },
  levelId: { type: mongoose.Schema.Types.ObjectId, ref: "Level", required: true },
  given: { type: mongoose.Schema.Types.Mixed, required: true },
  isCorrect: { type: Boolean, required: true },
  partialScore: { type: Number, required: true, min: 0 },
  shownAt: { type: Date, required: true },
  firstInteractionAt: { type: Date, default: null },
  answeredAt: { type: Date, required: true },
  hiddenMs: { type: Number, default: 0, min: 0 },
  mediaReplays: { type: Number, default: 0, min: 0 },
  isRetry: { type: Boolean, default: false },
  serverReceivedAt: { type: Date, required: true, default: Date.now }
}, { timestamps: true, collection: "responses", immutable: false });

responseSchema.index({ attemptId: 1, questionId: 1, serverReceivedAt: 1 });

export default mongoose.models.Response || mongoose.model("Response", responseSchema);