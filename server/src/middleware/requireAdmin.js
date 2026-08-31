import mongoose from "mongoose";
import Admin from "../models/Admin.js";
import { sendError } from "../lib/httpError.js";

/**
 * Temporary stand-in for real admin auth (JWT + roles) — the admin console
 * itself (sign-in, bank, builder) is a later build phase and does not
 * exist yet. Resolves the admin from DEV_ADMIN_ID instead of an admin
 * token, mirroring requireParticipant.js. Replace with real token
 * verification when admin sign-in lands; every route below only ever
 * reads `req.admin`, so the swap is contained to this file.
 */
export const requireAdmin = async (request, response, next) => {
  const adminId = process.env.DEV_ADMIN_ID;
  if (!adminId || !mongoose.isValidObjectId(adminId)) {
    return sendError(response, 500, "CONFIG_ERROR", "DEV_ADMIN_ID is not set to a valid admin id");
  }
  const admin = await Admin.findOne({ _id: adminId, deletedAt: null, active: true });
  if (!admin) return sendError(response, 401, "ADMIN_NOT_FOUND", "No admin matches DEV_ADMIN_ID");
  request.admin = admin;
  next();
};
