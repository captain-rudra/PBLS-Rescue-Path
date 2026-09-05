import { Router } from "express";
import Admin from "../../models/Admin.js";
import { sendError } from "../../lib/httpError.js";
import { signAdminToken, compareSecret } from "../../services/auth.js";
import { checkRateLimit } from "../../services/rateLimit.js";
import { SIGNIN_RATE_LIMIT_PER_MINUTE } from "../../../../shared/constants.js";

const router = Router();

// Same "don't tell an attacker which half was wrong" principle as the
// participant login (routes/auth/play.js) — unknown email and wrong
// password get the identical response.
const INVALID_CREDENTIALS_MESSAGE = "Incorrect email or password.";

router.post("/login", async (request, response) => {
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const { password } = request.body || {};
  if (!email || typeof password !== "string" || password.length === 0) {
    return sendError(response, 400, "INVALID_CREDENTIALS_FORMAT", "email and password are required");
  }

  if (!checkRateLimit(`admin-login:${email}`, { max: SIGNIN_RATE_LIMIT_PER_MINUTE, windowMs: 60_000 })) {
    return sendError(response, 429, "RATE_LIMITED", "Too many sign-in attempts for this account. Please wait a minute and try again.");
  }

  const admin = await Admin.findOne({ email, deletedAt: null });
  if (!admin || !admin.active) return sendError(response, 401, "INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE);

  const correct = await compareSecret(password, admin.passwordHash);
  if (!correct) return sendError(response, 401, "INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE);

  admin.lastLoginAt = new Date();
  await admin.save();

  const token = signAdminToken({ adminId: admin._id, role: admin.role });
  response.json({ token, admin: { adminId: String(admin._id), email: admin.email, name: admin.name, role: admin.role } });
});

export default router;
