import { Router } from "express";
import Session from "../../models/Session.js";
import Attempt from "../../models/Attempt.js";

const router = Router();

// Read-only session list — just enough to populate the records filter
// (SPEC §11: "Filterable by session and arm"). Session CONTROL — create,
// lobby, admit, start, pause, kick, end — is a separate build (SPEC §12
// Phase 2) and none of it lives here.
router.get("/", async (request, response) => {
  const sessions = await Session.find({ deletedAt: null }).sort({ createdAt: -1 }).lean();
  const counts = sessions.length
    ? await Attempt.aggregate([
        { $match: { sessionId: { $in: sessions.map(s => s._id) } } },
        { $group: { _id: "$sessionId", attempts: { $sum: 1 }, participants: { $addToSet: "$participantId" } } }
      ])
    : [];
  const byId = new Map(counts.map(c => [String(c._id), c]));

  response.json({
    sessions: sessions.map(s => ({
      sessionId: String(s._id),
      mode: s.mode,
      status: s.status,
      levelKeys: s.levelKeys,
      createdAt: s.createdAt,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      attemptCount: byId.get(String(s._id))?.attempts ?? 0,
      participantCount: byId.get(String(s._id))?.participants?.length ?? 0
    }))
  });
});

export default router;
