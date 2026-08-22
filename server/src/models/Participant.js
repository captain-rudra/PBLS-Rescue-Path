import mongoose from "mongoose";

const participantSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true, immutable: true },
  pinHash: { type: String, default: null },
  arm: { type: String, enum: ["E", "C"], required: true },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "Session", default: null },
  activeJti: { type: String, default: null },
  deviceChangedAt: { type: Date, default: null },
  failedPinCount: { type: Number, default: 0, min: 0 },
  lockedUntil: { type: Date, default: null },
  excluded: { type: Boolean, default: false },
  excludeReason: String,
  adminNote: String,
  deletedAt: { type: Date, default: null }
}, { timestamps: true, collection: "participants" });

export default mongoose.models.Participant || mongoose.model("Participant", participantSchema);