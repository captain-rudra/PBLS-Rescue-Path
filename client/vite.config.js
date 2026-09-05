import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// client/src imports shared/vitals.js from outside the client/ project root
// (client/src/lib/vitals.js -> ../../../shared/vitals.js) — Vite's dev
// server otherwise 403s any file outside its detected workspace root.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// The client's own route namespace (SPEC 1: "Player app /play/*") collides
// with the API's /play/* prefix under a blanket proxy rule — a direct
// navigation (or refresh) on /play/:levelKey would get forwarded to the
// Express server and 404, instead of falling through to the SPA's
// index.html. Proxy only the literal API sub-paths, none of which can ever
// match a levelKey ("prelevel" | "l1" | "l2" | "l3" | "l4").
const apiTarget = process.env.VITE_API_TARGET || "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: [repoRoot] },
    proxy: {
      "/play/levels": { target: apiTarget, changeOrigin: true },
      "/play/attempts": { target: apiTarget, changeOrigin: true },
      "/play/responses": { target: apiTarget, changeOrigin: true },
      "/play/me": { target: apiTarget, changeOrigin: true },
      "/play/achievements": { target: apiTarget, changeOrigin: true },
      // No client-side route starts with /auth (unlike /play/*, which
      // collides with the client's own /play/:levelKey — see above), so
      // the whole prefix can proxy straight through.
      "/auth": { target: apiTarget, changeOrigin: true }
    }
  }
});