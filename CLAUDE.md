# PBLS Rescue Path

A gamified Pediatric Basic Life Support learning application, built as the intervention
instrument for an M.Sc Nursing research study.

**Read this before writing any code. Read `docs/SPEC.md` for the full design.**

---

## The one thing to understand first

This is **not an app with a study attached**. It is a measuring instrument. Numbers
produced by this system go into a thesis and will be defended at a viva.

That changes the priority order from a normal web app:

1. **Data integrity** — a number must be traceable to how it was produced
2. **Correctness** — a wrong score is worse than a missing feature
3. **Reliability under bad conditions** — college wifi, forty phones, one afternoon
4. Everything else

When a trade-off appears between "nicer UX" and "defensible data", data wins.
If a shortcut would make a result harder to explain at viva, do not take it.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite, **JavaScript (no TypeScript)** |
| Routing | react-router-dom v6 |
| Styling | Tailwind CSS |
| Animation | framer-motion, @rive-app/react-canvas |
| Drag / sort | @dnd-kit/core, @dnd-kit/sortable |
| Sound | howler |
| Backend | Node + Express |
| Database | MongoDB + Mongoose |
| Realtime | Socket.IO (Phase 2 only) |
| Auth | jsonwebtoken + bcrypt |
| Media | Cloudinary (url strings only — the API never stores files) |

Do not add libraries beyond this list without asking. Every extra dependency is
one more thing that can break on the day of data collection.

---

## Repo structure

```
/
├── CLAUDE.md
├── docs/
│   └── SPEC.md              full design specification
├── seed/
│   ├── levels.json
│   ├── questions.json       extracted from the source question document
│   └── seed.js              idempotent — safe to re-run
├── shared/
│   └── constants.js         QUESTION_TYPES, LEVEL_KEYS, STATUS, ROLES, KICK_REASONS
├── server/
│   ├── src/
│   │   ├── models/          one file per collection
│   │   ├── routes/          admin/, play/, auth/
│   │   ├── middleware/      requireAdmin, requireSuperAdmin, requireParticipant
│   │   ├── services/        scoring, timing, analytics, audit
│   │   ├── sockets/         Phase 2
│   │   └── app.js
│   └── .env.example
└── client/
    ├── src/
    │   ├── admin/           console — bank, builder, sessions, records
    │   ├── play/            game — path, briefing, question engine, result
    │   ├── components/      shared UI
    │   ├── lib/             api client, auth, clock offset
    │   └── main.jsx
    └── vite.config.js
```

`shared/constants.js` is imported by **both** sides. Never redeclare a question type
or a status string anywhere else.

---

## Commands

```bash
npm run dev          # both, concurrently
npm run dev:server
npm run dev:client
npm run seed         # wipes nothing — upserts by (levelKey, sequence)
npm run seed:reset   # drops content collections, then seeds. Never run against real data
```

---

## Non-negotiable rules

These exist because of the study. Breaking any one of them silently corrupts the
dataset, and the corruption is usually undetectable afterwards.

### 1. Responses are append-only
A response document is **never updated and never deleted**. A retry writes a new
row with `isRetry: true`. Every derived figure — first-attempt accuracy, retry
counts, item difficulty — is computed from this collection.

### 2. Pin the question version
Every response stores `questionVersion` — the version the participant actually saw.
Editing a locked question **forks** a new version, it does not overwrite.

### 3. Scoring is server-side only
The client submits a *choice*. It never submits a score, a correctness flag, or a
duration. If the client computes it, it is not evidence.

### 4. The server owns the clock
Every stored timestamp is stamped by the server on receipt. The client applies a
measured offset for display only. Never trust `Date.now()` from the browser.

### 5. Nothing is hard deleted
Set `deletedAt`. This applies to questions, levels, participants, everything.
Kicked or withdrawn participants get `excluded: true`, never removal.

### 6. Timing is always recorded
`showTimer: false` hides the countdown from the player. It does **not** stop
timing capture. These are two separate concerns and two separate fields
(`timeLimitMinutes` and `showTimer`).

### 7. Practice runs are flagged
Any attempt created by an admin carries `isPractice: true` and is excluded from
every default query and every export.

### 8. Every admin action is audited
Write an `auditlog` row with actor, action, target, before, after, reason.

---

## Auth model

Two completely separate systems. **A player token must never satisfy an admin
route, and vice versa.**

```js
// admin token
{ sub: adminId, aud: "admin", role: "super_admin" | "admin", exp: 8h }

// participant token
{ sub: participantId, aud: "play", sessionId, jti, exp: 6h }
```

Every guard checks `aud` **first**, before role or anything else.

**Participants have no email and no password.** They sign in with a pre-generated
code (`PBLS-E-047`) and a 4-digit PIN they choose on first use. The database
contains **no name, no email, no phone**. Do not add these fields, and do not add
a self-registration route.

The `jti` on the participant token is what makes an instant kick possible: the
participant document stores the currently valid `jti`, kicking clears it, and the
next request fails. Do not replace this with a server-side session store.

### Enforced in code
- A super_admin cannot demote themselves
- At least one super_admin must always exist
- An `admin` cannot delete questions (archive only), change a level pass mark, or unlock a locked instrument

---

## Question types

Eight shapes, one collection, discriminated by `type`:

```
mcq | video_mcq | animation_mcq | drag_drop | sequence | split_screen | hotspot_video | interlude
```

Only the fields relevant to the type are validated. Do not try to force everything
into `options` + `correct` — that pair cannot carry seven formats.

`interlude` is the one type that is never scored — a mandatory-viewing bridge (e.g.
between two levels), not an assessment item. It carries no `options`/`correct`, is
excluded from accuracy, streak bonus, objective rollups and item analysis (SPEC 3.8),
and skips the `feedback.text`-required check — everything else about it (append-only
response, real timestamps, `deletedAt` not hard-delete, audited edits) is identical to
every other type.

**Every question with media requires `fallbackText`.** If the video does not load,
the item must still be answerable. This is not a nicety; it is what keeps a session
alive on bad wifi.

**Every question requires `feedback.text`.** The feedback card is the teaching
moment. An item without it is a test question, not a learning one.

**Every question requires an `objective`** drawn from its parent level's list. This
is what makes objective-level reporting possible on both the result card and the
analytics screen.

---

## Timing model

Four timestamps per question:

| Field | Meaning |
|---|---|
| `shownAt` | Question rendered |
| `firstInteractionAt` | First click or drag — splits reading from deciding |
| `answeredAt` | Committed |
| `hiddenMs` | Time the tab spent backgrounded (Page Visibility API) |

Time on item = `answeredAt - shownAt - hiddenMs - (any overlapping paused window)`.

Level time and total time are **derived** from these. Do not store them separately;
a stored summary drifts out of step with its source.

---

## Conventions

- Mongoose models are singular PascalCase files, plural lowercase collections
- Route files mirror the URL: `routes/admin/questions.js` serves `/admin/questions`
- Validation lives in `services/`, not inline in routes
- API errors: `{ error: { code, message } }`, never a bare string
- React components are function components with hooks. No class components
- Game state lives in a reducer, not scattered `useState` calls
- `localStorage` is a **cache for resume only**. The server is the source of truth.
  Never compute progress, unlocks, or scores from localStorage

---

## Build phases

Work in this order. `docs/SPEC.md` page 13 has the full breakdown.

**Phase 1 — the study can run on this alone.** Schema and seed, then the player
game, then response capture and exports, then the admin console, then codes and
open-mode sessions.

**Phase 2 — live session control.** Sockets, lobby, roster, kick, pause.

**Phase 3 — polish.** Cloudinary upload widget, media health checks, item analysis,
version forking UI, audit viewer.

**Do not start Phase 2 until Phase 1 exports have been verified by hand against a
real run.** The study can be run entirely in open mode; the control room is an
improvement, not a prerequisite.

---

## Suggested first task

1. `shared/constants.js`
2. Mongoose models for all eight collections
3. `seed/seed.js` — idempotent upsert by `(levelKey, sequence)`
4. Run the seed, then verify in the shell that every question has an objective,
   a feedback line, and — where media exists — a fallback

No UI until the seed runs clean.

---

## Things that will go wrong if you are not careful

- **Batching responses until level end.** Wifi drops, the browser crashes, or the
  participant is kicked, and everything is lost. Write each response immediately.
- **Computing score on the client.** Fast to build, impossible to defend.
- **Forgetting `isPractice`.** Fifteen of the developer's own test runs sitting
  inside the dataset are very hard to find later and trivial to flag now.
- **Overwriting a question during a live study.** Fork the version.
- **Trusting the browser clock.** Use the server offset.
- **Reordering questions without a transaction.** Two items end up sharing a
  sequence number and the level plays them in an undefined order.
