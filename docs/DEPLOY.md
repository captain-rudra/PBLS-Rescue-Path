# Deploying PBLS Rescue Path

This is a two-part deployment: a Node/Express API server (with MongoDB) and a
static React client. They can be served from one origin (simplest — put a
reverse proxy in front of both, or have the server serve the client's built
files itself) or from two separate origins (a static host/CDN for the
client, a separate service for the API). Both are supported; pick one and
follow the matching notes below where they diverge.

Read this once end to end before touching a real environment — steps 1–4 are
one-time setup, step 5 is what you re-run for every real study session.

---

## 1. MongoDB Atlas

The codebase is written to run against Atlas in production (the two-phase
`bulkWrite` reorder documented in SPEC 4.2 is a deliberate concession to
local MongoDB *not* being a replica set — Atlas is, so nothing there needs
to change).

1. Create a free or dedicated cluster (a small/shared cluster is enough for
   a single study session's traffic — forty participants, one afternoon).
2. **Network access**: add the IP address(es) of wherever the server will
   run. If the platform's outbound IP isn't fixed/known ahead of time,
   allow `0.0.0.0/0` for the initial deploy and tighten it once you know the
   real IP — don't leave it open indefinitely.
3. **Database user**: create one with read/write on the target database
   only (not an Atlas admin user). Save the username/password — they go
   into the connection string.
4. **Connection string**: copy the `mongodb+srv://...` URI from Atlas's
   "Connect your application" panel, substitute the real username/password,
   and set it as `MONGODB_URI` (step 3 below). Keep the database name
   segment (e.g. `/pbls_rescue_path`) — Atlas's default string omits it.

---

## 2. Server

A `render.yaml` blueprint is committed at the repo root for a Render web
service (`npm ci` / `npm run start` / health check at `/health`) — the three
secret env vars (`MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN`) are marked
`sync: false` so Render prompts for them in the dashboard rather than
storing real values in this file. Using it is optional — connecting the
GitHub repo and setting these by hand works identically.

### Env vars

| Var | Required? | Notes |
|---|---|---|
| `MONGODB_URI` | **Required in production** | The service refuses to start without it once `NODE_ENV=production` — see "Audit findings" below. No default is used in production. |
| `JWT_SECRET` | **Required, always** | Signs and verifies both token systems (admin and participant). Generate a real one: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Never reuse the value from a dev `.env`. Rotating it instantly signs out every admin and participant. |
| `NODE_ENV` | **Required in production** | Set to `production`. Gates the dev auth bypass, the local-Mongo fallback, and the startup refusal below — all three assume this is set correctly. |
| `PORT` | Optional | Defaults to `3000`. Most platforms (Render, Railway, Fly, etc.) inject their own `PORT` — leave it to them rather than hardcoding one. |
| `CLIENT_ORIGIN` | Optional | Only needed if the client is served from a **different origin** than this API. Comma-separated if there's more than one (e.g. a staging client alongside production). Leave unset for a same-origin deployment (see §2's split below) — no CORS headers are sent at all in that case, which is what same-origin needs. |
| `DOTENV_CONFIG_QUIET` | Optional | Purely cosmetic — silences dotenv's own startup banner. No functional effect either way. |
| `ALLOW_DEV_AUTH_BYPASS`, `DEV_ADMIN_ID`, `DEV_PARTICIPANT_ID` | **Must be absent** in production | Dev-only. Already inert once `NODE_ENV=production` (both auth middlewares check the audience/environment before ever looking at these), but the server now goes further: it **refuses to start at all** if `NODE_ENV=production` and any of the three is present, at any value — not a warning, a hard failure before the database is even touched. Delete these three lines from a production `.env`/platform config entirely; don't set them blank or `false`. |

There is no other configuration surface — no feature flags, no third-party
API keys (Cloudinary is used as bare URL strings pasted by an admin, never
called from the server).

### Same-origin vs. separate-origin

- **Same origin (simplest)**: put a reverse proxy (Nginx, Caddy, the
  platform's own routing) in front of both, forwarding `/auth`, `/play`,
  `/admin` to the API service and everything else to the built client's
  static files. Leave `CLIENT_ORIGIN` and the client's `VITE_API_BASE_URL`
  both unset — every request the client makes is already a relative path,
  so "no base URL" already means "call my own origin" with zero
  configuration.
- **Separate origins**: deploy the API as its own service, the client as a
  static site elsewhere. Set `CLIENT_ORIGIN` on the server to the client's
  real URL, and set `VITE_API_BASE_URL` on the client to the API's real URL
  **before running the client build** (see §3 — Vite bakes it in at build
  time, not read at runtime).

### Install and start

```bash
npm ci                      # not `npm install` — installs the exact
                             # versions in the committed package-lock.json;
                             # several dependencies are pinned "latest" in
                             # package.json itself, so a plain `npm install`
                             # on a fresh machine could resolve differently
                             # than what was tested here.
npm run start                # -> npm run start --workspace server
                              # -> node src/server.js (NOT --watch — that's
                              #    the dev script only)
```

`bcrypt` has a native (compiled) addon. Run `npm ci` **on the deployment
target itself** (or in a CI step running the same OS/architecture as
production) — don't copy a `node_modules` built on a different platform
(e.g. a Windows dev machine) into a Linux container.

Requires Node ≥ 20.10 (`engines` in both `package.json`s now says so —
`seed/seed.js`'s `import ... with { type: "json" }` needs it).

`GET /health` returns `{ "ok": true }` with no auth required — point
whatever health check the platform offers at it.

### Scaling

**Run exactly one instance.** Two things are deliberately in-process,
single-server state, not built to coordinate across replicas:

- The sign-in rate limiter (`server/src/services/rateLimit.js`) — an
  in-memory fixed-window counter, by design, documented in the file itself:
  this instrument runs as a single Express process for a single study
  session, so there's no case for pulling in Redis for one counter. Behind
  a load balancer with 2+ instances, the limit would effectively multiply
  by however many instances handle a given participant's requests.
- Everything else (participant `activeJti`, admin sessions, attempts,
  responses) is Mongo-backed and would actually be fine across replicas —
  it's specifically the rate limiter that isn't. Don't autoscale this
  service.

---

## 3. Client

`client/vercel.json` handles the client-side router's rewrite (every path
falls back to `index.html`). Point Vercel's **Root Directory** at `client`
(not the repo root) when importing the project — `client/package.json` is
self-contained (`npm run build` there is plain `vite build`, no workspace
flag needed), and the shared `../../../shared/constants.js` import still
resolves at build time since Vercel checks out the whole repo regardless
of which directory Root Directory points at; only the install/build
commands' working directory changes. Leave Build/Install/Output Directory
on their framework defaults (Vite preset: `npm install`, `vite build`,
`dist`) — don't hand-type a `--workspace` command, it only makes sense run
from the repo root, not from inside `client/`. Set `VITE_API_BASE_URL` as a
Vercel project env var (Production scope) to the Render API's URL — Vite
only reads it at build time, so this still applies as described below.

### Build

```bash
npm run build                # -> npm run build --workspace client
                              # -> vite build, outputs client/dist
```

If deploying to a **separate origin** from the API, set
`VITE_API_BASE_URL` (client/.env.example documents it) to the API's
absolute origin **before** this build step — Vite only exposes
`VITE_`-prefixed vars to client code, and only whatever was set at build
time. Setting it later, on whatever serves the already-built files, does
nothing.

```bash
VITE_API_BASE_URL=https://api.example.com npm run build
```

Serve `client/dist` as static files (any static host/CDN, or the same
reverse proxy mentioned in §2 if going same-origin). It's a client-side
router (react-router-dom) — configure the host to fall back to
`index.html` for unknown paths (a direct load/refresh on e.g.
`/briefing/l2` must still serve the SPA, not 404).

### What NOT to do

Don't try to serve the client from the Express server in this repo as-is —
`server/src/app.js` has no `express.static()` call and no catch-all route
serving `index.html`. If you want a single Node process serving both
(instead of two services behind a reverse proxy), that's a small addition
to `app.js` you'd make deliberately, not something already wired up here.

---

## 4. First seed + first super_admin

Run these once, against the **production** `MONGODB_URI`, after the server
env is in place (both scripts read the same env the server does — see
"Audit findings" below on how):

```bash
# from the repo root, with MONGODB_URI (and NODE_ENV=production) set in
# the shell or a .env the scripts can see
npm run seed:validate         # sanity check first — validates seed/*.json
                               # against the Mongoose schemas, touches no DB
npm run seed                  # upserts levels + questions by
                               # (levelKey, sequence) — safe on a fresh,
                               # completely empty database (nothing to
                               # collide with), and safe to re-run later
                               # (never deletes, only upserts)

npm run create-super-admin -- --email=you@example.com --password=<16+ chars> --name="Your Name"
```

There is no sign-up route by design (CLAUDE.md: admins are provisioned, not
self-registered) — `create-super-admin` is the only way to get the first
admin account. It's safe to run again later for additional admins; it only
refuses a duplicate email.

**Note on `seed:reset`**: CLAUDE.md's own command list documents
`npm run seed:reset` ("drops content collections, then seeds — never run
against real data") as an available command. It is not currently an actual
script in `package.json` — only `seed` and `seed:validate` exist. If you
need a hard reset of content collections, there is deliberately no
one-command way to do it right now; don't improvise one against production
without adding and reviewing that script first; ask if this is needed
before a real session.

---

## 5. Pre-session checklist

Run through this before every real data-collection session, not just the
first deploy:

- [ ] `NODE_ENV=production` is actually set (not left at `development` by a
      copy-pasted env file)
- [ ] `ALLOW_DEV_AUTH_BYPASS` / `DEV_ADMIN_ID` / `DEV_PARTICIPANT_ID` are
      **absent**, not blank — the server won't even start otherwise, so
      this one is self-checking, but confirm the deploy actually came up
      rather than crash-looping on it
- [ ] `GET /health` returns `200 {"ok":true}` from wherever the client will
      actually reach it (through the real reverse proxy / CDN path, not
      just localhost on the server box)
- [ ] Signed in as the real super_admin, not a leftover test account
- [ ] Question bank: no question is `published` that shouldn't be — this
      project has already hit real accidental-publish incidents (a
      non-discriminating drag_drop item with an `authoringNote` explicitly
      saying `BLOCKING ... before publishing` got republished four
      separate times during content authoring). Read every question's
      status and `authoringNote` in the bank before a real session, don't
      assume the last known-good state holds.
  - [ ] Level lock state matches intent (locking sweeps every question in
        that level to `locked` — SPEC 4.3)
- [ ] Generate the real participant codes for this session (`/admin/people`
      → Generate codes) and print the slips (`/admin/slips`) — both scoped
      to a real session, not a scratch one
- [ ] Confirm the client resolves the API correctly from a device that
      isn't the deployment machine itself (a phone on the venue's wifi,
      not just localhost) — this is exactly the class of thing that only
      shows up once you leave your own dev machine (see the mobile
      viewport-meta fix in the commit history: everything worked in every
      browser tested until the first real mobile-device check)
- [ ] Decide up front whether this session's real attempts should be
      flagged `isPractice` (admin-triggered dry runs are; real participant
      play is not, automatically) — don't let a facilitator's own
      walkthrough end up counted as data

---

## Audit findings (this pass)

What changed to get here, and what to keep in mind:

1. **Client API base URL** — was hardcoded to relative paths everywhere
   (assumed same-origin, works only via the Vite dev proxy or a same-origin
   prod deployment). Added `VITE_API_BASE_URL` (`client/src/lib/apiBase.js`,
   used by every fetch in `lib/api.js` and `lib/adminApi.js`, including the
   two that bypassed the shared `coreFetch` helper). Empty by default —
   existing dev workflow and a same-origin production deployment both need
   zero configuration; only a separate-origin deployment needs to set it.

2. **CORS** — was not configured at all (no `cors` package, no manual
   headers). Added a small hand-rolled middleware in `app.js`, opt-in via
   `CLIENT_ORIGIN` (chose not to add the `cors` package for a handful of
   header lines — CLAUDE.md: don't add a dependency without asking). With
   `CLIENT_ORIGIN` unset, no CORS headers are added at all, matching a
   same-origin deployment.

3. **Env vars / hardcoded fallbacks** — `JWT_SECRET` already throws loudly
   if unset, in any environment; that was already correct. `MONGODB_URI`
   was not: `server/src/db.js`, `seed/seed.js`, and
   `scripts/create-super-admin.js` each independently hardcoded the same
   `mongodb://127.0.0.1:27017/...` fallback. Centralized into
   `db.js`'s `connectDB()` (the other two now import and call it instead of
   duplicating the logic) and made the fallback conditional: still applies
   in development (matches `npm run dev` working with zero config), but
   `connectDB()` now throws if `MONGODB_URI` is unset and
   `NODE_ENV=production` — a forgotten env var fails loudly instead of
   quietly pointing at a database that doesn't exist in that environment.
   See the full var table above for the complete list, required vs.
   optional.

4. **Dev bypass in production** — confirmed `requireAdmin.js` /
   `requireParticipant.js` already check `NODE_ENV !== "production"` before
   even looking at `ALLOW_DEV_AUTH_BYPASS`, so the bypass was already
   provably inert in production (there's an existing test for exactly
   this — `scripts/test-auth-guards.js`'s "dev-bypass two-gate" check).
   What was missing: the server did nothing at all — no warning, no
   refusal — if these vars were simply *present* alongside
   `NODE_ENV=production`; it silently and correctly ignored them, which
   also means a leaked dev `.env` in production would never be caught.
   Added `server/src/lib/assertProductionEnv.js`, called at the very top of
   `server.js` before the database is even touched: refuses to start if
   `NODE_ENV=production` and any of `ALLOW_DEV_AUTH_BYPASS` / `DEV_ADMIN_ID`
   / `DEV_PARTICIPANT_ID` is set to anything at all — including the literal
   string `"false"`, which is truthy in JS and exactly what
   `.env.example` ships for local dev. Both directions are covered by new
   tests in `test-auth-guards.js`.

5. **Start script** — `server/package.json` already had `"start": "node
   src/server.js"` (no `--watch`) alongside the dev script that does use
   `--watch`. This was already correct; nothing needed fixing here. Added
   root-level `npm run build` / `npm run start` / `npm run create-super-admin`
   convenience scripts (delegating to the workspace scripts) since some
   platforms run `npm start`/`npm run build` from the repo root rather than
   a workspace.

6. **Seed on a fresh database** — `Level.findOneAndUpdate` /
   `Question.findOneAndUpdate` both use `upsert: true` keyed on
   `(levelKey, sequence)` and touch nothing else, so a completely empty
   collection has nothing to collide with; this was already safe. The one
   thing fixed here is the hardcoded Mongo fallback described in #3, which
   `seed.js` had its own independent copy of. Separately: CLAUDE.md
   documents an `npm run seed:reset` command that does not currently exist
   as a script — flagged above, not implemented (a "drop and reseed"
   command against a real database isn't something to improvise without
   review).

7. **Local disk / localhost assumptions** — no filesystem writes anywhere
   in `server/src` (grepped for it; consistent with the media model being
   Cloudinary URL strings only, never a file the server itself handles).
   The only `127.0.0.1`/`localhost` references were the `MONGODB_URI`
   fallbacks covered in #3 and the e2e test scripts' own throwaway local
   HTTP servers (`scripts/e2e-*.js` — test-only, never run in production).
   `app.listen(port, ...)` binds all interfaces by default (no hardcoded
   host), which is what every common deployment target expects.

   Separately (not one of the seven checks, but found while doing this):
   **`client/index.html` had no `<!doctype>`/`<html>`/`<head>` at all — no
   viewport meta tag.** Invisible in every check this project had done so
   far because all of it ran against fixed-size desktop viewports; a real
   mobile browser with no viewport meta assumes a ~980px desktop layout and
   scales the whole page down to fit the screen. Confirmed with a mobile
   device emulation (innerWidth read 981 instead of the device's real
   412) and fixed with a proper document + `width=device-width,
   initial-scale=1.0`. Already deployed to this branch, not part of this
   audit's changes, but worth knowing the app was never actually
   phone-usable until that fix landed.
