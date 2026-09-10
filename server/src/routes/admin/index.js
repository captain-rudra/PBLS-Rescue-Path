import { Router } from "express";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import recordsRouter from "./records.js";
import participantsRouter from "./participants.js";
import questionsRouter from "./questions.js";
import levelsRouter from "./levels.js";
import sessionsRouter from "./sessions.js";

const router = Router();

router.use(requireAdmin);
router.use("/records", recordsRouter);
router.use("/participants", participantsRouter);
router.use("/questions", questionsRouter);
router.use("/levels", levelsRouter);
router.use("/sessions", sessionsRouter);

export default router;
