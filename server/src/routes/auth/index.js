import { Router } from "express";
import Participant from "../../models/Participant.js";
import Admin from "../../models/Admin.js";
import { sendError } from "../../lib/httpError.js";
import { verifyToken, extractBearerToken } from "../../services/auth.js";
import { TOKEN_AUDIENCE } from "../../../../shared/constants.js";
import playAuthRouter from "./play.js";
import adminAuthRouter from "./admin.js";

const router = Router();

router.use("/play", playAuthRouter);
router.use("/admin", adminAuthRouter);

// Resolves whichever token type was presented — the one route in this
// build that doesn't already know which audience to expect, since its job
// is to answer "who does this token say I am" for either side.
router.get("/me", async (request, response) => {
  const token = extractBearerToken(request);
  if (!token) return sendError(response, 401, "NO_TOKEN", "No token presented");

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return sendError(response, 401, "INVALID_TOKEN", "Token is invalid or expired");
  }

  if (payload.aud === TOKEN_AUDIENCE.PLAY) {
    const participant = await Participant.findOne({ _id: payload.sub, deletedAt: null });
    if (!participant || participant.activeJti !== payload.jti) return sendError(response, 401, "SESSION_SUPERSEDED", "Signed in elsewhere, or signed out");
    return response.json({ aud: "play", participant: { participantId: String(participant._id), code: participant.code, arm: participant.arm } });
  }

  if (payload.aud === TOKEN_AUDIENCE.ADMIN) {
    const admin = await Admin.findOne({ _id: payload.sub, deletedAt: null, active: true });
    if (!admin) return sendError(response, 401, "ADMIN_NOT_FOUND", "No such active admin");
    return response.json({ aud: "admin", admin: { adminId: String(admin._id), email: admin.email, name: admin.name, role: admin.role } });
  }

  return sendError(response, 401, "WRONG_AUDIENCE", "Unrecognised token audience");
});

export default router;
