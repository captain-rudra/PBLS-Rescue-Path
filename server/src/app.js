import "dotenv/config";
import express from "express";
import playRouter from "./routes/play/index.js";
import adminRouter from "./routes/admin/index.js";
import authRouter from "./routes/auth/index.js";
import { sendError, HttpError } from "./lib/httpError.js";

export const createApp = () => {
  const app = express();
  app.use(express.json());

  app.get("/health", (_request, response) => response.json({ ok: true }));
  app.use("/auth", authRouter);
  app.use("/play", playRouter);
  app.use("/admin", adminRouter);

  app.use((_request, response) => sendError(response, 404, "NOT_FOUND", "No such route"));

  // eslint-disable-next-line no-unused-vars
  app.use((error, _request, response, _next) => {
    if (error instanceof HttpError) return sendError(response, error.status, error.code, error.message);
    if (error.name === "ValidationError") return sendError(response, 400, "VALIDATION_ERROR", error.message);
    if (error.name === "CastError") return sendError(response, 400, "INVALID_ID", error.message);
    console.error(error);
    sendError(response, 500, "INTERNAL_ERROR", "Something went wrong");
  });

  return app;
};
