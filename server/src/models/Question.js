import mongoose from "mongoose";
import { QUESTION_TYPES, STATUS } from "../../../shared/constants.js";

const optionSchema = new mongoose.Schema({ key: { type: String, required: true }, text: { type: String, required: true } }, { _id: false });
// durationSeconds is optional and hotspot_video-only: SPEC 4.4 check 5
// ("each hotspot window falls inside the clip duration") has nothing to
// check against without it. Nothing else reads or requires it.
const mediaSchema = new mongoose.Schema(
  { videoUrl: String, videoUrlB: String, posterUrl: String, riveSrc: String, loop: Boolean, gateOnFirstPlay: Boolean, sharedScrub: Boolean, durationSeconds: Number },
  { _id: false }
);
const feedbackSchema = new mongoose.Schema({ text: { type: String, required: true, trim: true }, videoUrl: String, imageUrl: String }, { _id: false });
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
  // Set on the OLD document the moment a locked-question edit forks a new
  // one (SPEC 4.8): "supersedes" points backward (new -> old), this points
  // forward (old -> new) and is what actually marks the old row retired.
  // Every serving/counting query filters on this being null — that's the
  // "current, active version" of this (levelKey, sequence), and it's also
  // the partial-uniqueness key below: two ACTIVE rows can never share a
  // sequence, but an active row and its whole retired lineage can, which
  // is exactly what forking without overwriting requires.
  supersededBy: { type: mongoose.Schema.Types.ObjectId, ref: "Question", default: null },
  authoringNote: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  deletedAt: { type: Date, default: null }
}, { timestamps: true, collection: "questions" });

// Partial, not plain: a whole superseded lineage legitimately shares a
// (levelKey, sequence) with the one row that replaced it (SPEC 4.8). Only
// the currently-active, non-deleted row for a given slot is covered by
// the uniqueness constraint — that row is unique by definition, and it's
// exactly the row every serving query means when it says "this question".
questionSchema.index({ levelKey: 1, sequence: 1 }, { unique: true, partialFilterExpression: { supersededBy: null, deletedAt: null } });
questionSchema.index({ levelId: 1, status: 1, deletedAt: 1 });

export default mongoose.models.Question || mongoose.model("Question", questionSchema);