import mongoose from "mongoose";

// A "reset" never touches Attempt/Response — those stay append-only forever
// (CLAUDE.md). Instead it's a boundary marker: scoring.js's
// filterAttemptsByLevelResets() ignores any attempt for that level created
// before resetAt when computing CURRENT progress, so a fresh attempt after
// this becomes the new frozen headline while every old attempt still exists
// untouched for records/export. This array itself is append-only — never
// edited or removed — so it's also the permanent record of who reset what
// and when.
const levelResetSchema = new mongoose.Schema({
  levelId: { type: mongoose.Schema.Types.ObjectId, ref: "Level", required: true },
  resetAt: { type: Date, required: true },
  resetBy: { type: String, enum: ["admin", "participant"], required: true },
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null }
}, { _id: false });

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
  levelResets: [levelResetSchema],
  deletedAt: { type: Date, default: null }
}, { timestamps: true, collection: "participants" });

export default mongoose.models.Participant || mongoose.model("Participant", participantSchema);