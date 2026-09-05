import mongoose from "mongoose";
import { QUESTION_TYPES, STATUS } from "../../../shared/constants.js";

const optionSchema = new mongoose.Schema({ key: { type: String, required: true }, text: { type: String, required: true } }, { _id: false });
const mediaSchema = new mongoose.Schema({ videoUrl: String, videoUrlB: String, posterUrl: String, riveSrc: String, loop: Boolean, gateOnFirstPlay: Boolean, sharedScrub: Boolean }, { _id: false });
const feedbackSchema = new mongoose.Schema({ text: { type: String, required: true, trim: true }, videoUrl: String }, { _id: false });
const bucketSchema = new mongoose.Schema({ key: { type: String, required: true }, label: { type: String, required: true } }, { _id: false });
const itemSchema = new mongoose.Schema({ id: { type: String, required: true }, text: { type: String, required: true }, bucket: String }, { _id: false });
const hotspotSchema = new mongoose.Schema({ tStart: Number, tEnd: Number, x: Number, y: Number, r: Number, isError: Boolean, label: String }, { _id: false });
const sideSchema = new mongoose.Schema({ label: String, videoUrl: String, parameters: [String] }, { _id: false });

const questionSchema = new mongoose.Schema({
  levelId: { type: mongoose.Schema.Types.ObjectId, ref: "Level", required: true },
  levelKey: { type: String, required: true, immutable: true },
  sequence: { type: Number, required: true, min: 1 },
  type: { type: String, required: true, enum: QUESTION_TYPES },
  title: { type: String, required: true, trim: true },
  objective: { type: String, required: true, trim: true },
  scenario: String,
  prompt: { type: String, required: true, trim: true },
  media: mediaSchema,
  fallbackText: String,
  options: [optionSchema],
  buckets: [bucketSchema],
  items: [itemSchema],
  correctOrder: [String],
  hotspots: [hotspotSchema],
  sides: [sideSchema],
  correct: String,
  feedback: { type: feedbackSchema, required: true },
  points: { type: Number, required: true, min: 0 },
  status: { type: String, enum: Object.values(STATUS), default: STATUS.DRAFT },
  version: { type: Number, required: true, min: 1, default: 1 },
  supersedes: { type: mongoose.Schema.Types.ObjectId, ref: "Question", default: null },
  authoringNote: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  deletedAt: { type: Date, default: null }
}, { timestamps: true, collection: "questions" });

questionSchema.index({ levelKey: 1, sequence: 1 }, { unique: true });
questionSchema.index({ levelId: 1, status: 1, deletedAt: 1 });

export default mongoose.models.Question || mongoose.model("Question", questionSchema);