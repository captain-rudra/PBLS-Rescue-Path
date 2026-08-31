import { Router } from "express";
import { requireParticipant } from "../../middleware/requireParticipant.js";
import levelsRouter from "./levels.js";
import attemptsRouter from "./attempts.js";
import responsesRouter from "./responses.js";
import meRouter from "./me.js";
import achievementsRouter from "./achievements.js";

const router = Router();

router.use(requireParticipant);
router.use("/levels", levelsRouter);
router.use("/attempts", attemptsRouter);
router.use("/responses", responsesRouter);
router.use("/me", meRouter);
router.use("/achievements", achievementsRouter);

export default router;
