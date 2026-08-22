import mongoose from "mongoose";
import { SESSION_MODES } from "../../../shared/constants.js";

const rosterSchema = new mongoose.Schema({ participantId: { type: mongoose.Schema.Types.ObjectId, ref: "Participant", required: true }, label: String, state: String, admittedAt: Date, seatClaimed: Boolean }, { _id: false });
const sessionSchema = new mongoose.Schema({
  mode: { type: String, enum: SESSION_MODES, required: true },
  capacity: { type: Number, required: true, min: 1, max: 40 },
  levelKeys: { type: [String], required: true, validate: value => value.length > 0 },
  timeLimitMinutes: { type: Number, min: 1, default: null },
  showTimer: { type: Boolean, default: true },
  showLeaderboard: { type: Boolean, default: false },
  lowBandwidth: { type: Boolean, default: false },
  status: { type: String, enum: ["draft", "lobby", "running", "paused", "ended"], default: "draft" },
  startedAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },
  pausedTotalMs: { type: Number, default: 0, min: 0 },
  pausedAt: { type: Date, default: null },
  roster: [rosterSchema],
  blocklist: [{ type: mongoose.Schema.Types.ObjectId, ref: "Participant" }],
  instrumentVersion: { type: Number, required: true, default: 1 },
  deletedAt: { type: Date, default: null }
}, { timestamps: true, collection: "sessions" });

export default mongoose.models.Session || mongoose.model("Session", sessionSchema);