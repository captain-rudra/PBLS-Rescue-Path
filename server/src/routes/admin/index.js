import { Router } from "express";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import recordsRouter from "./records.js";

const router = Router();

router.use(requireAdmin);
router.use("/records", recordsRouter);

export default router;
