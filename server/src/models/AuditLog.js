import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", required: true },
  actorRole: { type: String, required: true },
  action: { type: String, required: true },
  target: { kind: { type: String, required: true }, id: { type: mongoose.Schema.Types.ObjectId, required: true } },
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after: { type: mongoose.Schema.Types.Mixed, default: null },
  reason: String,
  at: { type: Date, required: true, default: Date.now },
  ip: String
}, { collection: "auditlog", versionKey: false });

export default mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema);