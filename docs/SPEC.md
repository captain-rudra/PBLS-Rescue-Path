# PBLS Rescue Path — specification

Full design and build reference. `CLAUDE.md` holds the rules; this file holds the detail.

---

## 1. What this is

A gamified Pediatric Basic Life Support learning application, built as the intervention
instrument for an M.Sc Nursing research study. Content comes from a source question
document covering a prelevel and four levels; that content is already extracted into
`seed/questions.json` and `seed/levels.json`.

Two applications share one API and one database:

- **Player app** (`/play/*`) — the game. Participants sign in with a code and PIN.
- **Admin console** (`/admin/*`) — content authoring, session control, records.

---

## 2. Game design

### 2.1 Theme

The learner moves through five real-world scenes, and their role grows with each level:
from a confused bystander in a playground to the leader of a resuscitation team in an
emergency room. Each level in the source document already carries its own setting; the
design makes that setting visible.

| Level key | Scene | Player role | Badge | Questions |
|---|---|---|---|---|
| `prelevel` | The playground | Bystander | Vigilant eye | 10 |
| `l1` | The living room | First responder | Scene secured | 10 |
| `l2` | Poolside | CPR provider | Rhythm keeper | 17 |
| `l3` | The football field | AED operator | Shock ready | 7 (6 are stubs) |
| `l4` | The emergency room | Team leader | Closed loop | 5 |

The world is warm and illustrated; the HUD layered on top is clinical. That contrast is
the visual signature. Do not make the whole interface a dark clinical monitor — the
scenes are playgrounds and living rooms, not wards.

### 2.2 Visual tokens

```
Night navy     #16243D   map, HUD
Slate          #1E3050   cards
Vital green    #34D399   correct, ECG, primary action
Alert coral    #FF6B5B   wrong, alarm
Gold           #FFC94A   stars, badges, score
Cyanotic       #7FB8E8   desaturation tint on error
Warm cream     #FFF7ED   scene surfaces
Locked slate   #3A4A63   disabled nodes
```

Display font: Fredoka. Interface and clinical text: Inter. Sentence case throughout.
Scale — level title 22, question stem 15, option 13, feedback 12, HUD label 10.

### 2.3 The vitals bar — the lives system

Instead of hearts, the HUD carries the virtual child's oxygen saturation.

| State | SpO2 | Effect |
|---|---|---|
| Stable | 100% | Normal scene colour |
| One error | 93% | Scene takes a cyanotic tint |
| Two errors | 86% | Alarm tone loops |
| Three errors | 79% | Deterioration screen, level restarts |

The bar never reaches zero on screen. Deterioration is signalled by the alarm and a
dimmed scene, not a death animation. A partially correct drag costs proportionally
(one misplaced token out of six costs 2, not the full 7). This cost model is shared
between the live HUD and the server's stored `vitalsEnd` — one function, imported by
both — never two implementations computing two numbers for the same reading.

"Restarts" means exactly that: the in-progress attempt is abandoned (7) and a new one
begins at question one. It is not a soft reset — the interrupted attempt remains in the
data as its own row, `status: abandoned`.

This mechanic is deliberate: the consequence of an error inside the game is the same
consequence it has in the ward, which is what makes it defensible in the methodology
chapter rather than merely decorative.

### 2.4 Motion vocabulary

| Event | Duration | Behaviour |
|---|---|---|
| Correct answer | 320 ms | Ring expands from the chosen card, points fly to the HUD, ECG spikes, monitor beep |
| Wrong answer | 420 ms | 2px shake, coral vignette, vitals drop, cyanotic tint |
| Feedback card | 260 ms | Slides up from the bottom, overshoot easing |
| Level complete | 4.5 s | ROSC sequence, see 2.7 |
| Path unlock | 900 ms | Route draws itself, lock breaks, camera pans |

### 2.5 Screen flow

```
Dashboard (rescue path)
  → Mission briefing (objectives, pass mark)
    → Question  ⇄  Feedback card        [loop until level end]
      → Score ≥ passMark?
          no  → Remediation (missed items only, 1 star on pass)
          yes → ROSC sequence → Result card → next node unlocks → Dashboard
```

### 2.6 Screens

**Dashboard.** A winding path with one node per level. Completed route drawn in vital
green, the rest in dead slate. Active node oversized, pulsing at 60 bpm, the only
filled accent on screen. Locked nodes desaturated with a padlock.

Node states: `locked` (slate + padlock, 50% opacity), `active` (green fill, 80px,
pulsing ring), `complete` (green outline, tick, 1–3 gold stars), `failed` (coral
outline, retry glyph).

Stars: below passMark = none and locked; 80–89% = 1; 90–96% = 2; 97%+ = 3 plus a
bonus badge.

**Mission briefing.** Shown once on entering a level. Scene name, level title, the
scenario line, the full objectives list from the level document, mission parameters
(question count, formats, pass mark, badge), and a Begin rescue button. Objectives
must be reopenable from the pause menu.

**Question.** HUD strip on top (level and scene, question counter, vitals bar, live
ECG, points, streak). Media panel left, question and options right, so the video never
pushes options below the fold. On narrow screens the columns stack with media pinned
to the top. Answer locks on selection — no going back.

**Feedback card.** Slides up after every answer, correct or wrong. Carries
`feedback.text` and, if present, `feedback.videoUrl` as an optional inline player.
On a wrong answer the chosen card turns coral and the correct card turns green
simultaneously, both staying visible while the explanation is read. No score
deduction and no buzzer — the cost is the vitals bar plus a guaranteed second
encounter in the remediation round.

**Result card.** Stars, four metric tiles (accuracy, time, best streak, points), the
objectives list marked against performance, the missed items list, and two actions:
continue, or replay for three stars. An objective is ticked only when every item
mapped to it was answered correctly.

**Pause menu.** Objectives, mute toggle, restart level, exit to path. No skip.
Exiting mid-level preserves the resume point but records the attempt as incomplete.

### 2.7 The ROSC sequence

Six frames, roughly 4.5 seconds, on passing a level:

1. **0.0–0.9s** — Screen goes near-black, a flat coral trace crosses it, sustained alarm tone
2. **0.9–1.8s** — The flatline converts left to right into normal sinus rhythm; alarm gives way to a steady beep at 60 bpm
3. **1.8–2.4s** — `ROSC ACHIEVED` stamp scales in with overshoot easing, settling at a slight angle
4. **2.4–3.2s** — Cyanotic tint lifts, warm daylight returns, the child opens their eyes (Rive)
5. **3.2–4.0s** — Metrics tick up; stars fill one at a time with a rising chime
6. **4.0–4.5s** — Camera pans to the path, route draws forward, padlock breaks, next scene gains colour

**Below the pass mark** the sequence stops at frame 1. The banner reads
`Patient not stabilised`, no stars are awarded, and the only route forward is a
remediation round containing just the missed items. Passing remediation awards one
star and unlocks the next level.

### 2.8 Sound

Six cues: monitor beep on correct, low thud on error, sustained alarm on flatline,
rising chime per star, latch click on unlock, soft ambient bed per scene. **Muted by
default** with a visible toggle — a learner may be in a shared study room.

---

## 3. Question types

Seven shapes, one collection, discriminated by `type`. Only fields relevant to the
type are validated and rendered.

| Type | Screen treatment |
|---|---|
| `mcq` | No media panel, question centred, options in one wide column |
| `video_mcq` | Gated player left, options right, replay allowed |
| `animation_mcq` | Looping Rive scene, no gate, options live immediately |
| `drag_drop` | Token tray plus labelled buckets |
| `sequence` | Draggable ordered rows |
| `split_screen` | Two synchronised players, one shared scrub bar |
| `hotspot_video` | Single player with a timed hotspot overlay, plus a fallback option list |

### 3.1 Gating

`media.gateOnFirstPlay` — the video must finish once before options become selectable.
Without the gate the media becomes decoration and the item stops measuring what it is
meant to measure. Replays after the first play are unlimited and counted in
`mediaReplays`.

### 3.2 Drag and drop

Tokens snap to the nearest bucket. Confirm stays disabled until every token is placed.
**Scoring is per token, not all-or-nothing** — five of six is not the same as guessing.

### 3.3 Sequence

`items[]` is authored in `correctOrder` — every seeded sequence question happens to list
its rows already sorted. The player must never see that order: the client shuffles the
rows before first render, seeded from `(attemptId, questionId)` rather than a fresh
random draw, so a mid-question refresh reproduces the same shuffled arrangement instead
of reshuffling it (the attempt stays the same across a refresh because starting an
attempt is idempotent, 7). Without the shuffle the item is trivial — the source order
already answers it, and confirming requires no rearrangement at all.

On confirm, correctly positioned rows lock green and only misplaced rows stay
draggable, so feedback is positional rather than a bare pass or fail.

### 3.4 Split screen

One scrub bar drives both players so the learner always compares the same moment. The
`sides[].parameters` list under each clip is drawn from the source document verbatim
and doubles as the fallback, so the item works even if the video fails to load.

### 3.5 Hotspot video

```js
hotspots: [
  { tStart: 6.0, tEnd: 9.5, x: 0.22, y: 0.61, r: 0.09, isError: true, label: "pause" }
]
```

Coordinates are **fractions of the frame, not pixels**, so one record works on a phone
and a projector. A tap inside the hotspot during its window scores full. The four
options remain as a fallback route for devices where the tap does not register.

### 3.6 Accessibility

Every drag and sequence interaction needs a keyboard route: tab to a token, space to
lift, arrows to move, space to drop. `@dnd-kit` supports this natively — do not build
a custom drag that loses it.

### 3.7 Scoring

| Format | Points |
|---|---|
| MCQ family | 120 first attempt |
| Bucket sort | 20 per correct token, no negative marking |
| Sequence | 15 per correctly positioned row, +40 if the whole order is right first time |
| Streak bonus | +10 per consecutive correct, capped at +100 |

All computed server-side. The client submits a choice, never a score.

---

## 4. Admin console

### 4.1 Roles

| Capability | admin | super_admin |
|---|---|---|
| Create and edit questions | yes | yes |
| Delete questions | archive only | yes |
| Level create, reorder, pass mark | no | yes |
| Lock and unlock the instrument | no | yes |
| Generate codes, reset PINs | yes | yes |
| Run a session, admit, kick, pause, end | yes | yes |
| View records | yes | yes |
| Raw CSV export | no | yes |
| Promote and demote admins | no | yes |

### 4.2 Question bank

Filterable list by level, type and status. Drag rows to reorder within a level —
**reordering rewrites `sequence` for the whole level in one transaction** so two items
can never share a position.

A background job issues a HEAD request against every media url once a day and marks
anything unreachable. The point is to find a dead link on a Tuesday afternoon rather
than in front of forty students.

### 4.3 Status lifecycle

| Status | Meaning |
|---|---|
| `draft` | Never served to a player, not counted in level totals |
| `published` | Live and editable; edits apply immediately and bump the version |
| `locked` | Study running; editing forks version n+1 and leaves n intact |
| `archived` | Soft deleted, retained for responses that reference it |

Only super_admin moves a level to locked. Locking sweeps every question in scope.

### 4.4 Validation before publish

1. A correct answer exists and matches an option key
2. At least two options for any mcq-family item
3. Every drag item names a bucket that exists
4. `correctOrder` covers every sequence item exactly once
5. Each hotspot window falls inside the clip duration
6. `feedback.text` is present
7. `fallbackText` is present whenever media is attached
8. An `objective` is selected from the parent level's list

Rule 8 is what makes objective-level reporting possible on both the result card and
the analytics screen.

### 4.5 Question builder

The top block (level, sequence, objective, points, title, scenario, prompt) never
changes. Only the middle block swaps when the type changes, and switching type keeps
any field the two shapes share.

A **Preview as player** action opens the real game component with the current draft.
This is the only reliable way to catch a hotspot placed off-frame or a scenario that
overruns the panel.

### 4.6 Media

One url string per asset. The builder offers two routes into the same field: paste a
link, or upload. Upload sends the file **directly from the browser to Cloudinary**
using a signed preset and drops the returned url in. The API only ever stores a string.

Do not upload to the Express server — free hosting tiers use ephemeral disks and files
vanish on redeploy. Do not use YouTube embeds — blocked on many campus networks, and
the end-of-video recommendations pull attention away mid-study.

### 4.7 Bulk import

Paste JSON, upload `.json`, or upload `.csv`. Always **dry run first**: show a row-by-row
preview marking will create / will update / blocked, and write nothing until the admin
commits. Matching export produces a full JSON backup that can be committed to the repo.

### 4.8 Editing a locked question

Saving does not overwrite. It writes a new document with `version` incremented and
`supersedes` pointing at the old one, then flips the level pointer. Anyone mid-attempt
continues on the version they started with. The confirmation dialog must state plainly
that the study is running and the change will split the dataset.

---

## 5. Sessions

### 5.1 Configuration

```js
{
  mode: "controlled" | "open",
  capacity: 40,
  levelKeys: ["prelevel", "l1", "l2"],
  timeLimitMinutes: 45 | null,
  showTimer: true | false,
  showLeaderboard: false,
  lowBandwidth: false
}
```

**`timeLimitMinutes` and `showTimer` are separate on purpose.** One controls whether a
limit exists; the other only controls whether the player sees the clock. Timing is
recorded either way.

**Leaderboard defaults off.** A visible ranking changes motivation through social
comparison, which is a confound in a study measuring the effect of gamified learning,
and it is unpleasant for whoever sits at the bottom. If switched on it must be
declared in the methodology.

**Keep one mode per cohort.** Running some participants proctored and others self-paced
introduces an engagement difference unrelated to the intervention. Store `mode` on
every attempt.

### 5.2 Controlled mode flow

```
Admin creates session → preflight → open lobby
Participant signs in → lands in waiting room
Admin sees them on the roster → Admit → seat claimed
Admin presses Start → session:started pushed → player Start button goes live
```

In open mode there is no lobby and no admit step; Start is live from the first moment.
Kick, pause and end still work.

### 5.3 Seats

A seat belongs to a **participant**, not a connection.

| Event | Seat |
|---|---|
| Admitted | Claimed for the session |
| Wifi drops and reconnects | Kept — losing a seat to a flaky network would lock out a genuine participant |
| Kicked | Released immediately, code blocklisted |
| Finished | Released only if rolling batches are enabled |
| Released manually | Available to anyone still invited |

### 5.4 Live control room

Six counters across the top: waiting, active now, idle over 2 min, disconnected,
finished, median progress. Lobby list on the left with Admit and Deny per row and an
Admit all. Live roster on the right: connection dot, label, code, current position,
score, wrong count, elapsed, Kick.

Connection states come from a **10 second heartbeat**: green active, amber idle over
2 minutes, grey disconnected.

Everything on this screen is **pushed over a socket, not polled**. A kick that takes
eight seconds to land is a kick that failed.

### 5.5 Kick

1. A reason must be chosen: `code_sharing`, `disengaged`, `technical_issue`, `participant_request`, `other`
2. Confirm, with a ten second undo before anything commits
3. Clear `activeJti` — the next request from that device fails immediately
4. Add the participant to the session `blocklist`
5. Release the seat
6. Mark the attempt `kicked` and set `excluded: true` — **never delete**
7. Their screen shows a neutral message: *Your session has been ended by the facilitator. Please speak to them.* No blame language
8. Write an audit row. An **Allow back in** action reverses steps 3–5

Removing a participant mid-test falls under the withdrawal clause of the consent form.
Keeping the flagged data is what makes it possible to honour whatever the consent
document promises. Deleting on the spot removes that option permanently.

### 5.6 Pause versus end

| Action | Effect |
|---|---|
| **Pause** | Clocks stop for everyone, overlay reads *paused by facilitator*, `pausedTotalMs` accumulates so it never enters anyone's time on task. Reversible. Resume shows a 3 second countdown. |
| **End** | Every in-progress attempt is submitted where it stands, session closes. Not reversible — requires a typed confirmation. |

Two buttons, deliberately. Merging them means one mis-click ends a session that only
needed a two minute look.

To simply see where everyone has reached, **Export snapshot** writes a CSV of the
current state without touching the session at all.

### 5.7 Preflight

Run before any session starts:

1. Every question in the selected levels is `published` or `locked`, none `draft`
2. Every media url returned 200 in the last 24 hours
3. Every question carries a feedback line and an objective
4. Enough participant codes exist for the stated capacity
5. Instrument is locked

---

## 6. Participants

### 6.1 Identity

Pre-generated code (`PBLS-E-047`) plus a 4-digit PIN the participant chooses on first
use. **No name, no email, no phone in the database.** No self-registration route.

The arm allocation is baked into the code prefix (`E` / `C`), so randomisation happens
before the app is ever opened and allocation concealment is preserved.

### 6.2 Roster labels

An admin-set label such as `Roll 21` lets a facilitator recognise a row on the control
screen. It lives on the **session roster document only**, never on the participant
document, and is **stripped from every export**. The mapping from a real person to a
code exists only on the facilitator's printed attendance sheet.

### 6.3 Sign-in guards

- Five wrong PINs locks the code for ten minutes and flags the roster
- A second device replaces `activeJti`, signing the first out and raising a device-change flag
- A blocklisted code is refused with a neutral message
- Outside the session window, the screen says when it opens

### 6.4 Distribution

Codes are handed out on printed slips against a signed attendance sheet. Identity is
verified in the room, not in software — which is why there is nothing to falsify.

---

## 7. Data model

Eight collections. Full field lists in the models; the notable shapes:

**`questions`** — `levelId, sequence, title, objective, type, scenario, prompt, media{},
fallbackText, options[], buckets[], items[], correctOrder[], hotspots[], sides[],
correct, feedback{text,videoUrl}, points, status, version, supersedes, deletedAt,
createdBy, updatedBy`

**`levels`** — `order, key, title, scene, role, objectives[], passMark, badge, status, deletedAt`

**`admins`** — `email, passwordHash, name, role, active, lastLoginAt, createdBy`

**`participants`** — `code, pinHash, arm, sessionId, activeJti, deviceChangedAt,
failedPinCount, lockedUntil, excluded, excludeReason, adminNote`

**`sessions`** — see 5.1, plus `status, startedAt, endedAt, pausedTotalMs, pausedAt,
roster[], blocklist[], instrumentVersion`

**`attempts`** — `participantId, sessionId, levelId, attemptNo, kind, isPractice,
questionIds[], startedAt, submittedAt, activeMs, hiddenMs, pausedMs, score, accuracy,
vitalsEnd, passed, starsAwarded, status`

`questionIds` pins the exact question set served for this attempt at creation time, so
scoring and submission-completeness checks are never at the mercy of the bank changing
underneath an in-progress attempt.

`kind` is `first | remediation | replay`.
`status` is `in_progress | submitted | abandoned | kicked`.

**A participant can only meaningfully have one `in_progress` attempt per level.**
`POST /play/attempts` is idempotent on `(participantId, levelId)`: if an `in_progress`
attempt already exists it is returned as-is, never duplicated. This is what makes the
endpoint safe under a double-click, a retried request on flaky wifi, or two tabs open
on the same level — not just a client-side guard against re-firing. A unique index on
`(participantId, levelId, attemptNo)` backstops the same rule at the database layer for
the narrow race window between the check and the insert.

Nothing that starts an attempt may leave it `in_progress` with no way to reach a
terminal status. The vitals-restart mechanic (2.3) is the one case in this build that
interrupts an attempt outright: hitting the third error band abandons the current
attempt (`status: abandoned`) and starts a fresh one. An `in_progress` document with no
route to `submitted`, `abandoned` or `kicked` is a bug — `attempts per level` is a
reported measure (11), and an orphaned row corrupts it.

**`responses`** — append only — `attemptId, participantId, sessionId, questionId,
questionVersion, levelId, given, isCorrect, partialScore, shownAt, firstInteractionAt,
answeredAt, hiddenMs, mediaReplays, isRetry, serverReceivedAt`

**`auditlog`** — `actorId, actorRole, action, target{kind,id}, before, after, reason, at, ip`

---

## 8. Timing model

Four timestamps per question:

| Field | Meaning |
|---|---|
| `shownAt` | Question rendered |
| `firstInteractionAt` | First click or drag — splits reading from deciding |
| `answeredAt` | Committed |
| `hiddenMs` | Time the tab spent backgrounded (Page Visibility API) |

```
timeOnItem = answeredAt - shownAt - hiddenMs - (overlapping paused window)
```

Splitting at first interaction gives a more informative measure than a single elapsed
figure. Subtracting hidden time means six minutes with four minutes in another tab does
not read the same as six minutes of work.

**Derived, never stored twice:** time per level, total time, wrong attempts, retries,
first-attempt accuracy, attempts per level. A stored summary drifts out of step with
its source.

**Clock authority.** On joining, the browser performs an offset handshake against the
server clock and applies that offset for display only. Every stored timestamp is
stamped by the server on receipt.

---

## 9. API

### Auth
```
POST /auth/admin/login          email + password → admin token
POST /auth/play/login           code + PIN → participant token with fresh jti
POST /auth/play/set-pin         only valid when no hash exists
GET  /auth/me                   resolves whichever token was presented
```

### Content — admin
```
GET    /admin/questions              filter by level, type, status
POST   /admin/questions              create, runs the eight checks
PATCH  /admin/questions/:id          edit, or fork a version if locked
DELETE /admin/questions/:id          soft delete, super_admin only
POST   /admin/questions/reorder      rewrites sequence atomically
POST   /admin/questions/import       dry run, then commit
GET    /admin/questions/export
GET/POST/PATCH /admin/levels
POST   /admin/levels/:id/lock
```

### Participants — admin
```
POST  /admin/participants/generate      bulk codes with arm and labels
POST  /admin/participants/:id/reset-pin
PATCH /admin/participants/:id           admin note, exclude flag
GET   /admin/participants/slips         printable PDF
```

### Sessions — admin
```
POST /admin/sessions
GET  /admin/sessions/:id/preflight
POST /admin/sessions/:id/lobby
POST /admin/sessions/:id/admit          one participant or all waiting
POST /admin/sessions/:id/start
POST /admin/sessions/:id/pause
POST /admin/sessions/:id/resume
POST /admin/sessions/:id/end
POST /admin/sessions/:id/kick           reason required
POST /admin/sessions/:id/unkick
GET  /admin/sessions/:id/snapshot       CSV, changes nothing
```

### Records — admin
```
GET /admin/records/participants
GET /admin/records/items                difficulty and discrimination
GET /admin/records/export               the four CSVs
GET /admin/audit
```

### Gameplay — participant
```
GET  /play/session                  mode, status, timer settings, server clock
GET  /play/levels                   unlock state for this participant only
POST /play/attempts                 idempotent — returns the existing in_progress attempt
                                     for this level if one exists, otherwise starts a new
                                     one and returns questions at pinned versions
POST /play/responses                one answer, written immediately, never batched
POST /play/attempts/:id/submit      scores, awards stars, unlocks or routes to remediation
POST /play/attempts/:id/abandon     closes an in_progress attempt as abandoned; required
                                     before starting a new one over it (see 7)
GET  /play/me/records               this participant's own rows only
```

### Guards and limits
- Every route checks token `aud` **before** role or anything else
- Participant routes reject a token whose `jti` no longer matches the stored one
- A response is refused if the attempt is submitted, abandoned or kicked
- A response is refused while the session is paused
- Sign-in limited to ten attempts per code per minute
- Scoring server-side only

---

## 10. Sockets (Phase 2)

```
rooms:  admin:{sessionId}   play:{sessionId}   play:{participantId}

server → player
  session:started            { startedAt, serverNow }
  session:paused             { pausedAt }
  session:resumed            { pausedTotalMs }
  session:ended              { reason }
  participant:kicked         { message }
  participant:admitted
  session:signedOutElsewhere

server → admin
  roster:update              { rows[] }        throttled to 2s
  lobby:joined               { code, label, flags }
  seat:changed               { used, capacity }

player → server
  heartbeat                  { attemptId, questionId }    every 10s
```

---

## 11. Records and analytics

### Player view
Only their own rows. No cohort mean, no rank, no other code. The restriction is applied
**server side from the participant id on the token**, not a client-side filter.

Their record screen shows per-level accuracy, time, attempts and stars, plus an
"objectives still open" line tying unfinished objectives back to the exact questions
missed. Points and stars motivate; the objectives line teaches.

### Admin view
Per-participant: attempts, wrong count, retries, active time, hidden time, best score,
state. Expandable to per-level attempt rows.

Excluded and practice rows are hidden unless explicitly included, and the export
carries that choice in its filename so two files can never be confused.

### Item analysis
- **Difficulty** — proportion answering correctly on first encounter
- **Discrimination** — point-biserial correlation between item and total score

Both fall out of the `responses` collection for free, and together they are how the
instrument itself gets validated in the results chapter rather than merely used.

### Exports
```
participants.csv   one per code: arm, totals, state — no labels, no names
attempts.csv       one per level run: kind, accuracy, active time, hidden time, stars
responses.csv      one per answer: item, version, correctness, all four timestamps
items.csv          difficulty and discrimination per question
```

---

## 12. Build phases

### Phase 1 — the study can run on this alone
Admin sign-in and roles · level management · question bank · question builder for all
seven types · media by pasted url · bulk import and export · code generation, PIN
sign-in, printed slips · the game itself · per-response save with all four timestamps ·
open-mode sessions with optional time limit · player's own record screen · admin
records table and the four CSV exports.

**This is the cut line.** Everything the results chapter needs is produced here.

### Phase 2 — nicer to run, not required
Socket.IO with session rooms and heartbeat · controlled mode lobby and admit · live
roster · kick with reason and undo · pause and resume · end with typed confirmation ·
export snapshot · timer visibility toggle and auto-submit · device-change and
failed-PIN flags.

### Phase 3 — polish
Cloudinary upload widget · daily media health check and preflight · item analysis ·
version forking UI · audit log viewer · low bandwidth mode · admin practice mode ·
keyboard routes for drag and sequence.

### Order of work
1. `shared/constants.js`, Mongoose models, `seed/seed.js` — verify the seed runs clean
2. Player game against seeded data, no admin panel at all
3. Response capture and the four CSV exports — **verify by hand against one real run**
4. Admin sign-in, bank and builder
5. Codes, PINs, slips, open-mode sessions — the study can now be run
6. Sockets and the control room
7. Phase 3 as time allows

Do not start Phase 2 until Phase 1 exports have been verified by hand.

---

## 13. Content still to be written

Not a build problem, but it blocks a real session. Schedule alongside step 2, not
step 5. All are seeded as `status: "draft"` with a `authoringNote` explaining why.

| Item | Needed |
|---|---|
| `l1` Q9 | Source lists only four correct findings and no distractors, so every token belongs in the same bucket and the item cannot discriminate. Add 3–4 findings that do **not** indicate arrest |
| `l2` Q17 | Hotspot coordinates cannot be authored until the clip exists |
| `l3` Q2–Q6 | Five stubs, one per uncovered objective — no content in the source |
| `l3` Q7 | Choking management appears in the level title but has no objective and no items. Add the objective to the level first |

Several published items carry feedback text **written for the build rather than taken
from the source document**; each is marked with an `authoringNote`. These are clinical
statements and need review by the supervising faculty before the study runs.

Two source items labelled *Drag & Drop* are ordering tasks and are seeded as
`type: "sequence"` (`l2` Q2 and Q12).

---

## 14. Before the first real session

1. Full pilot run with five volunteers who are not in the study
2. Verify the exports by hand against those five runs
3. Delete the pilot data, or flag it as practice
4. Lock the instrument
5. Take a backup and confirm it restores
## Known accepted risks

**react-router-dom 6.30.x — GHSA-wrjc-x8rr-h8h6 (moderate, CWE-601).**
Fixed only in 7.18.0; no 6.x patch exists. Not upgraded: v7 is a major
bump with routing API changes, and the vulnerability requires an
attacker-controlled navigation target. This application has none — every
`to` and `navigate()` argument is a hardcoded internal path. Re-check if
a redirect parameter is ever added.