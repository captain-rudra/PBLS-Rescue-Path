import { Router } from "express";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import recordsRouter from "./records.js";
import participantsRouter from "./participants.js";

const router = Router();

router.use(requireAdmin);
router.use("/records", recordsRouter);
router.use("/participants", participantsRouter);

export default router;
