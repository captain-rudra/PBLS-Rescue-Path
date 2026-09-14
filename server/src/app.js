import "dotenv/config";
import express from "express";
import playRouter from "./routes/play/index.js";
import adminRouter from "./routes/admin/index.js";
import authRouter from "./routes/auth/index.js";
import { sendError, HttpError } from "./lib/httpError.js";

// CORS is opt-in via CLIENT_ORIGIN (comma-separated if there's more than
// one — e.g. a staging client alongside production). Left unset, no CORS
// headers are added at all: the default assumption is that the client is
// served from the same origin as this API (e.g. both behind one reverse
// proxy), which needs no CORS. Hand-rolled rather than pulling in the
// `cors` package — this is a handful of lines, not worth a new dependency
// (CLAUDE.md: "do not add libraries beyond this list without asking").
// Bearer tokens live in memory/localStorage, never a cookie, so nothing
// here needs Access-Control-Allow-Credentials.
const corsMiddleware = () => {
  const allowedOrigins = (process.env.CLIENT_ORIGIN || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

  return (request, response, next) => {
    const origin = request.headers.origin;
    if (allowedOrigins.length > 0 && origin && allowedOrigins.includes(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    }
    if (request.method === "OPTIONS") return response.sendStatus(204);
    next();
  };
};

export const createApp = () => {
  const app = express();
  app.use(corsMiddleware());
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
