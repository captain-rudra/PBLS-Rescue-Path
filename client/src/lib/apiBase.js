// The API's origin, prefixed onto every request path. Empty by default —
// every fetch call in this app already uses a path starting with "/", so
// an empty base means "same origin as the page", which is exactly what
// the Vite dev proxy (vite.config.js) and a same-origin production
// deployment (client and API behind one reverse proxy) both need with zero
// configuration.
//
// Set VITE_API_BASE_URL at build time (e.g. "https://api.example.com", no
// trailing slash) when the client is deployed to a different origin than
// the API — a static host/CDN in front of the client, a separate service
// for the API. Vite only exposes env vars prefixed VITE_ to client code,
// and only bakes in whatever was set at BUILD time (see docs/DEPLOY.md).
export const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
