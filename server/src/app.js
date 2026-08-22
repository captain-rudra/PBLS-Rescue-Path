import "dotenv/config";
import express from "express";
import playRouter from "./routes/play/index.js";
import { sendError } from "./lib/httpError.js";

export const createApp = () => {
  const app = express();
  app.use(express.json());

  app.get("/health", (_request, response) => response.json({ ok: true }));
  app.use("/play", playRouter);

  app.use((_request, response) => sendError(response, 404, "NOT_FOUND", "No such route"));

  // eslint-disable-next-line no-unused-vars
  app.use((error, _request, response, _next) => {
    if (error.name === "ValidationError") return sendError(response, 400, "VALIDATION_ERROR", error.message);
    if (error.name === "CastError") return sendError(response, 400, "INVALID_ID", error.message);
    console.error(error);
    sendError(response, 500, "INTERNAL_ERROR", "Something went wrong");
  });

  return app;
};
