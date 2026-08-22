import mongoose from "mongoose";
import { ATTEMPT_KINDS, STATUS } from "../../../shared/constants.js";

const attemptSchema = new mongoose.Schema({
  participantId: { type: mongoose.Schema.Types.ObjectId, ref: "Participant", required: true },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true },
  levelId: { type: mongoose.Schema.Types.ObjectId, ref: "Level", required: true },
  attemptNo: { type: Number, required: true, min: 1 },
  kind: { type: String, enum: ATTEMPT_KINDS, required: true },
  isPractice: { type: Boolean, default: false },
  questionIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Question" }], required: true },
  startedAt: { type: Date, required: true },
  submittedAt: { type: Date, default: null },
  activeMs: { type: Number, default: null, min: 0 },
  hiddenMs: { type: Number, default: 0, min: 0 },
  pausedMs: { type: Number, default: 0, min: 0 },
  score: { type: Number, default: 0, min: 0 },
  accuracy: { type: Number, default: null, min: 0, max: 100 },
  vitalsEnd: { type: Number, default: 100, min: 0, max: 100 },
  passed: { type: Boolean, default: null },
  starsAwarded: { type: Number, default: 0, min: 0, max: 3 },
  status: { type: String, enum: [STATUS.IN_PROGRESS, STATUS.SUBMITTED, STATUS.ABANDONED, STATUS.KICKED], default: STATUS.IN_PROGRESS }
}, { timestamps: true, collection: "attempts" });

export default mongoose.models.Attempt || mongoose.model("Attempt", attemptSchema);