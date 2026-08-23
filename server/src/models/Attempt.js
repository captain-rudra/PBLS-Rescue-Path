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

// Two independent invariants, each backstopping a real race in
// server/src/routes/play/attempts.js — the idempotency check there is a
// plain read with no locking, so two concurrent requests can each pass it
// before either has written:
//
// 1. No two attempts for the same participant+level may ever share an
//    attemptNo (protects the reported "attempts per level" counter).
attemptSchema.index({ participantId: 1, levelId: 1, attemptNo: 1 }, { unique: true });

// 2. At most one attempt per participant+level may be in_progress at a
//    time — this is the one that actually matters for idempotency. Index 1
//    alone does not catch it: if request B's "does one exist?" check runs
//    before request A's insert lands, but B's own insert lands after A's,
//    B computes a *different*, higher attemptNo than A and never collides
//    with it on index 1 — two genuinely different in_progress rows for the
//    same level, no duplicate-key error to catch. A partial index scoped to
//    status is the only thing that closes that gap regardless of timing.
attemptSchema.index({ participantId: 1, levelId: 1 }, { unique: true, partialFilterExpression: { status: STATUS.IN_PROGRESS } });

export default mongoose.models.Attempt || mongoose.model("Attempt", attemptSchema);