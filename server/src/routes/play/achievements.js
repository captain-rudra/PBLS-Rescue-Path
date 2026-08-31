import { Router } from "express";
import { loadAchievementInputs, summarizeAchievements } from "../../services/achievements.js";

const router = Router();

// This participant's global achievements (SPEC 2.6, 7) with earned / lock
// state. Derived fresh from the attempts + responses collections every
// call, never stored. Scoped to `request.participant` from the token, the
// same as every other /play route — never a query parameter.
router.get("/", async (request, response) => {
  const inputs = await loadAchievementInputs(request.participant._id);
  response.json({ achievements: summarizeAchievements(inputs) });
});

export default router;
