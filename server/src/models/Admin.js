import mongoose from "mongoose";
import { ROLES } from "../../../shared/constants.js";

const adminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true, trim: true },
  role: { type: String, enum: Object.values(ROLES), required: true },
  active: { type: Boolean, default: true },
  lastLoginAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  deletedAt: { type: Date, default: null }
}, { timestamps: true, collection: "admins" });

export default mongoose.models.Admin || mongoose.model("Admin", adminSchema);