import mongoose from "mongoose";
import { STATUS } from "../../../shared/constants.js";

const levelSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, immutable: true },
  order: { type: Number, required: true, min: 0 },
  title: { type: String, required: true, trim: true },
  scene: { type: String, required: true, trim: true },
  role: { type: String, required: true, trim: true },
  objectives: { type: [String], required: true, validate: value => value.length > 0 },
  passMark: { type: Number, required: true, min: 0, max: 100 },
  // Optional: the corrected source document gives the prelevel no badge.
  // A schema that rejects that valid state is the thing that's wrong.
  badge: { type: String, required: false, trim: true, default: null },
  status: { type: String, enum: Object.values(STATUS), default: STATUS.DRAFT },
  authoringNote: String,
  deletedAt: { type: Date, default: null }
}, { timestamps: true, collection: "levels" });

export default mongoose.models.Level || mongoose.model("Level", levelSchema);