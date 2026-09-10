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
| `prelevel` | The playground | Bystander | — (none) | 10 |
| `l1` | The living room | First responder | Scene Scout | 10 |
| `l2` | Poolside | CPR provider | CPR Champion | 21 |
| `l3` | The football field | AED operator | Life Saver | 21 |
| `l4` | The emergency room | Team leader | Team Leader | 8 |

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

### 2.3 The vitals bar and the progression mechanic

Instead of hearts, the HUD carries the virtual child's oxygen saturation.

| State | SpO2 | Effect |
|---|---|---|
| Stable | 100% | Normal scene colour |
| One error | 93% | Scene takes a cyanotic tint |
| Two errors | 86% | Alarm tone loops |
| Three+ errors | 79% | Scene stays dimmed, alarm keeps looping |

The bar never reaches zero on screen. A partially correct drag costs proportionally
(one misplaced token out of six costs 2, not the full 7). This cost model is shared
between the live HUD and the server's stored `vitalsEnd` — one function, imported by
both — never two implementations computing two numbers for the same reading.

**The bar is live feedback only — it no longer triggers anything.** A level always
runs to completion; there is no mid-level restart. Pass/fail is decided once, at
submit, and **the pass mark gates only a `kind: "first"` attempt**:

| Attempt kind | Accuracy | Outcome |
|---|---|---|
| `first` | below `passMark` | **Fail.** The whole level restarts from question 1 — a fresh `kind: "first"` attempt with the full question set, not just what was missed. |
| `first` | at or above `passMark`, below 100% | **Remediate.** A `kind: "remediation"` round over just the items missed this round. |
| `remediation` | below 100% | **Remediate.** Another `kind: "remediation"` round over just the items missed THIS round — regardless of how low this round's own accuracy is. The pass mark does not apply once remediation has started. |
| either | exactly 100% | **Mastered.** The next level unlocks. |

Once a participant has cleared the pass mark on a `first` attempt, they are in
remediation until they reach 100% — a remediation round that isn't perfect produces
another remediation round over whatever's still missed, never a full restart.
Fail-and-restart is an outcome reserved for a `first` attempt.

This is deliberate, not an oversight: a remediation round's item count shrinks to its
predecessor's miss count every round, and for `n` items there is no accuracy between
the pass mark and 100% unless `n` is large enough (at 80%, `n` must be at least 5 — no
integer `k` satisfies `0.8n ≤ k < n` below that). A remediation round on this
instrument's content is very often down to a handful of items, sometimes one. Gating
remediation rounds on the pass mark the same way a first attempt is gated would make a
second remediation round unreachable through real play on most levels — the round
would fail back to a full restart before it could ever produce another partial-pass
round — and a code path that cannot be reached by playing is not production code.

None of this is stored as a status on the attempt — `outcomeFor(accuracy, passMark,
kind)` is a pure function, recomputed wherever it's needed, so it can never drift out
of sync with the accuracy, pass mark and kind it's derived from.

**Scoring is frozen to the first attempt.** The score and accuracy shown as a level's
headline figure — on the result card, the dashboard, and in every record — are always
`attemptNo: 1`'s, permanently, no matter how many restarts or remediation rounds follow
to eventually reach 100%. Later attempts are still scored and stored in full (every
response is still evidence), they just never overwrite the headline. Stars are banded
off that same frozen accuracy (§3.7) — since every level eventually reaches 100% by
design, banding stars off the *final* accuracy would put every level at three stars and
the display would carry no information about how the participant actually did.

Two counts travel alongside the headline, both derived from the attempts collection —
never a stored counter that could drift out of sync with it:

- **Restarts** — count of `kind: "first"` attempts for the level, minus 1 (the
  original attempt isn't itself a restart).
- **Remediation rounds** — count of `kind: "remediation"` attempts for the level.

This mechanic is deliberate: an error inside the game still has a real, felt
consequence (visible on the vitals bar in the moment, and on the permanent record
after), but it no longer erases in-progress work the way a mid-level restart did — the
consequence is legible and defensible in the methodology chapter, not merely punitive.

### 2.4 Motion vocabulary

| Event | Duration | Behaviour |
|---|---|---|
| Correct answer | 320 ms | Ring expands from the chosen card, points fly to the HUD, ECG spikes, monitor beep |
| Wrong answer | 420 ms | 2px shake, coral vignette, vitals drop, cyanotic tint |
| Feedback card | 260 ms | Slides up from the bottom, overshoot easing |
| Level mastered | 4.5 s | Full ROSC sequence, see 2.7 |
| Path unlock | 900 ms | Route draws itself, lock breaks, camera pans |

### 2.5 Screen flow

```
Dashboard (rescue path)
  → Mission briefing (objectives, pass mark)
    → Question  ⇄  Feedback card        [loop until every question is answered]
      → Submit — kind + accuracy against passMark (§2.3):
          kind:first,       < passMark  → Fail: whole level restarts from question 1
          kind:first,       ≥ passMark  → Remediate: round over just the missed items
          kind:remediation, < 100%      → Remediate: another round, missed items only —
                                           repeats until a round reaches 100%, whatever
                                           THIS round's own accuracy is
          accuracy = 100%   (either kind) → Mastered: ROSC sequence → Result card
                                             → next node unlocks → Dashboard
```

A level always runs to completion in one pass — the loop above never stops mid-level.
"Restart" and "remediate" both mean returning to Mission briefing → Question, just with
a different question set (§2.3); only reaching 100% moves on to the ROSC sequence.

### 2.6 Screens

**Dashboard.** A winding path with one node per level. Completed route drawn in vital
green, the rest in dead slate. Active node oversized, pulsing at 60 bpm, the only
filled accent on screen. Locked nodes desaturated with a padlock.

Five node states: `locked` (slate + padlock, 50% opacity), `active` (green fill, 80px,
pulsing ring, unlocked but never attempted), `complete` (green outline, tick — mastered
at 100%), `remediating` (gold outline, review glyph — latest attempt cleared the pass
mark but isn't 100% yet, one more remediation round due), `failed` (coral outline,
retry glyph — latest attempt was below the pass mark, the whole level restarts).

Stars are banded off the level's frozen first-attempt accuracy (§2.3, §3.7), so they
are knowable — and shown — as soon as a first attempt exists, in any of the four
non-locked states, not only once the level is mastered: below 80% = 0; 80–89% = 1;
90–96% = 2; 97%+ = 3 plus a bonus badge. A level can therefore show, say, one star
while still `remediating` or `failed` — that star is permanent and will not become
three just because the level is eventually mastered.

Every node that already carries a headline — `complete`, `remediating` or `failed`,
i.e. at least one submitted attempt exists — also carries a small persistent "Review
answers" link straight into the level review below, independent of the node's own
click (which still opens the mission briefing to continue, restart, or replay).
`locked` nodes and never-attempted `active` nodes carry no headline and get no link —
there is nothing yet to review.

**Badge shelf.** Below the header the dashboard carries a shelf of every badge the path
can award: the four level badges (`l1` Scene Scout, `l2` CPR Champion, `l3` Life Saver,
`l4` Team Leader) and the global achievements (§7). The prelevel has no badge — per the
corrected source document its `badge` is null — so it contributes no tile and the shelf
shows no empty slot where one would sit. A level badge counts as earned once the level
is `complete` (mastered at 100%); an achievement's earned state comes from the server
(§7). An earned badge is full colour on a gold-rimmed disc; an unearned one sits in the
same place but locked — greyscale, dimmed, a small padlock — so the player can see
what's ahead. Each badge has its own iconography, not one shape recoloured. The shelf
is display only; earning is decided server-side.

**Mission briefing.** Shown once on entering a level. Scene name, level title, the
scenario line, the full objectives list from the level document, mission parameters
(question count, formats, pass mark, badge), and a Begin rescue button — except when
the level is already `complete`, which shows the frozen headline (score, accuracy,
stars, restart and remediation counts) instead, with nothing left to begin. Objectives
must be reopenable from the pause menu. Whenever the level carries a headline (any
non-`active`, non-`locked` state), a Review answers button also sits here — alongside
Begin rescue for `remediating`/`failed`, in place of it for `complete` — as a second,
persistent route into the level review besides the dashboard node link above.

**Question.** HUD strip on top (level and scene, question counter, vitals bar, live
ECG, points, streak). Media panel left, question and options right, so the video never
pushes options below the fold. On narrow screens the columns stack with media pinned
to the top. Answer locks on selection — no going back.

**Feedback card.** Slides up after every answer, correct or wrong. Carries
`feedback.text` and, if present, `feedback.videoUrl` as an optional inline player.
On a wrong answer the chosen card turns coral and the correct card turns green
simultaneously, both staying visible while the explanation is read. No score
deduction and no buzzer — the cost is the vitals bar plus another encounter with the
item, in whichever round (restart or remediation) revisits it.

The explanation is collapsed behind a "Show explanation" toggle by default — it does
not force itself on every correct or wrong answer. From the **third remediation round
onward** for a level, it auto-expands instead: a participant still missing items after
two remediation rounds should not be able to skip past the teaching moment.

**Result card.** Only ever reached on a mastered submit (§2.3). Stars, four metric
tiles (first-attempt accuracy, time on this final round, best streak this round,
first-attempt points), the objectives list and missed items marked against the
**frozen first attempt** — not this final round, which, being mastered, is trivially
all correct and would show nothing useful — the two derived counts (restarts,
remediation rounds), and a single continue action. An objective is ticked only when
every item mapped to it was answered correctly on that first attempt.

The badge earned by mastering this level is revealed here with a one-shot animation as
the card opens — full colour, a light sweep across the disc, the rim pulsing once. The
prelevel has no badge, so nothing is shown there and no slot is left empty. If this
submit also newly unlocked a global achievement (§7 — in this build only BLS Expert,
and only ever on the fifth level's first attempt), that badge is revealed just below
it. The reveal collapses to the final state under `prefers-reduced-motion`.

**Level review.** Read-only, and reachable from three places: the result card ("Review
answers", immediately after a mastered submit), the dashboard's persistent per-node
link, and the mission briefing's own Review answers button — the same screen, the same
route, every time. Every entry point defaults to the level's **frozen first attempt**
(§2.3) — the one whose figures the result card and dashboard headline both show, and
the one where a given answer can most meaningfully differ from the correct one — but an
**attempt selector** beneath the header lists every submitted attempt the participant
has made on that level (first attempt, any restart, any remediation round, labelled and
tagged with its own accuracy) so a restart or remediation round can be reviewed too, not
only the frozen headline.

Each question is laid out **in its pinned clinical order**, one after another: the
stem, any scenario text, its media if present (otherwise `fallbackText` — the same
"must still be answerable" rule from §1/CLAUDE.md applies to reviewing it later), the
participant's answer, the correct answer, a correct/missed marker, and the
`feedback.text`. Right and wrong are both always shown, never just one or the other,
and visually distinguished (coral vs green) rather than left for the reader to infer.
Two question types need more than a single given/correct line to avoid misleading the
reader:

- **Sequence** shows three rows, not two: the order this participant was actually
  **presented** (`shownOrder` — the seeded per-participant shuffle, §3.3), the order
  they **submitted**, and the canonical correct order. Showing only the canonical order
  next to their submission would imply they saw it in that order, which they may not
  have; each submitted row is toned by whether that specific position is right, not by
  a single overall verdict.
- **Drag and drop** shows every token's placement against its own correct bucket, not
  just an overall right/wrong for the item — each token is its own line, independently
  toned, since a drag-and-drop item is scored per token (§3.2, §3.7) and the review
  should read the same way.

Nothing here is editable, nothing is re-scored, and opening it writes no `responses`
row. It is not a way to navigate a level: the question engine still shows one question
at a time, in sequence, with the answer locked on selection — reordering or revisiting
mid-level would give a question several `shownAt` stamps and make time-per-question
meaningless, and the item order carries a deliberate clinical progression. "Done"
returns to the dashboard.

Time spent on this screen is reported to the server and accumulated on the attempt as
`reviewMs`, kept entirely separate from the timing model (§8) — it never enters
time-on-task, level time or total time. This holds across every entry point and every
attempt the selector switches to: switching attempts flushes the outgoing attempt's
`reviewMs` before the incoming one starts its own clock.

**Pause menu.** Objectives, mute toggle, restart level, exit to path. No skip.
Exiting mid-level preserves the resume point but records the attempt as incomplete.

### 2.7 The ROSC sequence

Three variants, one per submit outcome (§2.3).

**Mastered (100%).** The full sequence, six frames, roughly 4.5 seconds:

1. **0.0–0.9s** — Screen goes near-black, a flat coral trace crosses it, sustained alarm tone
2. **0.9–1.8s** — The flatline converts left to right into normal sinus rhythm; alarm gives way to a steady beep at 60 bpm
3. **1.8–2.4s** — `ROSC ACHIEVED` stamp scales in with overshoot easing, settling at a slight angle
4. **2.4–3.2s** — Cyanotic tint lifts, warm daylight returns, the child opens their eyes (Rive)
5. **3.2–4.0s** — Metrics tick up; stars fill one at a time with a rising chime — the **frozen first-attempt** figures (§2.3), not this round's own (always 100%)
6. **4.0–4.5s** — Camera pans to the path, route draws forward, padlock breaks, next scene gains colour

**Fail (a `first` attempt below the pass mark).** Stops at frame 1 exactly as before.
The banner reads `Patient not stabilised`, with a count of items missed this round, and
the only route forward is **Restart level** — a fresh attempt over the full question
set, not a remediation round.

**Remediate (a `first` attempt at or above the pass mark short of 100%, or ANY
`remediation` round short of 100%).** Frame 1 is replaced with a calmer beat: not the
coral flatline and alarm (this is not a failure), but a gold, irregular-but-not-flat
trace, no alarm tone. The banner reads `Almost stable`, with a count of items still
needing review, and the route forward is **Continue remediation** — a round covering
just what this attempt missed. Once in a remediation round, this variant shows
regardless of how low that round's own accuracy was — the pass mark does not apply
here (§2.3), so a remediation round never falls back to the fail variant. This is what
lets it repeat multiple times in real play down to very small item counts; see §2.6 for
the feedback-card behaviour that kicks in from the third round.

**After the result card.** The mastered variant ends on the result card. From there
**Continue** returns to the dashboard (playing the path-unlock animation if a level was
just unlocked), and **Review answers** opens the read-only level review (§2.6) over the
frozen first attempt; "Done" on the review lands on the same dashboard. The review is
the only screen reachable from the result card — there is no path back into the level.

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

All computed server-side, per attempt. The client submits a choice, never a score.

**Star bands**, applied only to the level's frozen first attempt (§2.3) — never to a
later restart or remediation round, and never gated on pass/fail:

| First-attempt accuracy | Stars |
|---|---|
| < 80% | 0 |
| 80–89% | 1 |
| 90–96% | 2 |
| 97–100% | 3 |

A level is only ever unlocked for the next one, and only ever shows `complete`, once
some attempt (of any kind) reaches exactly 100% — but the stars shown for it stay
whatever the first attempt's own accuracy banded to, permanently. A level entered once
at 62%, restarted, remediated twice and finally mastered still shows 0 stars: that 62%
is the number worth remembering for the results chapter, not the eventual 100%, which
every mastered level has by construction.

Every attempt still stores its own `score`/`accuracy`/`starsAwarded` in full — these
per-attempt figures back the item-analysis and "attempts per level" measures (§11) —
only the *displayed headline* (result card, dashboard, records) is pinned to
`attemptNo: 1`.

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

**Implementation note — "one transaction" is a two-phase write in this build.**
Multi-document transactions in MongoDB require a replica set. The development
database is a standalone `mongod`, which has no transaction support at all, so
`POST /admin/questions/reorder` does two sequential `bulkWrite`s instead: pass one
moves every affected row to a temporary out-of-range sequence (`1_000_000 + i`),
pass two sets every row to its final sequence (`i + 1`). The temporary values
cannot collide with each other or with any real sequence, and the final values are
a validated permutation, so neither pass can ever trip the partial unique index on
`(levelKey, sequence)`.

The compromise is the gap between the two passes: a read landing there sees
out-of-range sequence numbers, and a crash there leaves them persisted — harmless
in that nothing ever *shares* a position, and re-running the reorder repairs it,
but not the isolation a real transaction gives.

Production runs on MongoDB Atlas, which **is** a replica set. The transactional
version keeps the same two-phase structure — a unique index is still enforced per
write even inside a transaction, so a non-monotonic permutation (swapping positions
3 and 5, say) still needs the offset pass — but wraps it so the intermediate state
is never visible to another reader and any failure rolls the whole batch back:

```js
const session = await mongoose.startSession();
try {
  await session.withTransaction(async () => {
    const offset = providedIds.map((id, i) => ({
      updateOne: { filter: { _id: id }, update: { $set: { sequence: 1_000_000 + i } } }
    }));
    const final = providedIds.map((id, i) => ({
      updateOne: { filter: { _id: id }, update: { $set: { sequence: i + 1 } } }
    }));
    await Question.bulkWrite(offset, { session });
    await Question.bulkWrite(final, { session });
  });
} finally {
  await session.endSession();
}
```

Swap to this once the deployment target is fixed. This is a deliberate
dev-environment compromise, **not** a conclusion that a transaction was never
possible here.

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
— `badge` is nullable; the prelevel has none (§2.6, §13).

**`admins`** — `email, passwordHash, name, role, active, lastLoginAt, createdBy`

**`participants`** — `code, pinHash, arm, sessionId, activeJti, deviceChangedAt,
failedPinCount, lockedUntil, excluded, excludeReason, adminNote`

**`sessions`** — see 5.1, plus `status, startedAt, endedAt, pausedTotalMs, pausedAt,
roster[], blocklist[], instrumentVersion`

**`attempts`** — `participantId, sessionId, levelId, attemptNo, kind, isPractice,
questionIds[], startedAt, submittedAt, activeMs, hiddenMs, pausedMs, reviewMs, score,
accuracy, vitalsEnd, passed, starsAwarded, status`

`reviewMs` accumulates time the participant spent on the read-only level review screen
(§2.6). It is client-reported, server-clamped, and deliberately **outside the timing
model (§8)** — it is never part of time-on-task, level time or total time. Nothing on
the review screen writes a `responses` row or changes a score.

`questionIds` pins the exact question set served for this attempt at creation time, so
scoring and submission-completeness checks are never at the mercy of the bank changing
underneath an in-progress attempt.

`kind` is `first | remediation`. `outcome` (`fail | remediate | mastered`) is never
stored on the attempt — it is always `outcomeFor(accuracy, level.passMark)`, derived
fresh wherever it's needed (§2.3), so it can't drift out of sync with the accuracy and
pass mark it comes from.

`status` is `in_progress | submitted | abandoned | kicked`.

**A participant can only meaningfully have one `in_progress` attempt per level.**
`POST /play/attempts` is idempotent on `(participantId, levelId)`: if an `in_progress`
attempt already exists it is returned as-is, never duplicated. This is what makes the
endpoint safe under a double-click, a retried request on flaky wifi, or two tabs open
on the same level — not just a client-side guard against re-firing. A unique index on
`(participantId, levelId, attemptNo)` backstops the same rule at the database layer for
the narrow race window between the check and the insert.

Nothing that starts an attempt may leave it `in_progress` with no way to reach a
terminal status. A level now always runs to completion (§2.3 — there is no mid-level
restart), so in this build every `in_progress` attempt reaches `submitted` by normal
play; `abandoned` remains available for a facilitator-side exit (kick, Phase 2) rather
than anything the vitals bar triggers. An `in_progress` document with no route to
`submitted`, `abandoned` or `kicked` is a bug — `attempts per level` is a reported
measure (11), and an orphaned row corrupts it.

**`responses`** — append only — `attemptId, participantId, sessionId, questionId,
questionVersion, levelId, given, isCorrect, partialScore, shownAt, firstInteractionAt,
answeredAt, hiddenMs, mediaReplays, isRetry, serverReceivedAt`

**`auditlog`** — `actorId, actorRole, action, target{kind,id}, before, after, reason, at, ip`

### Achievements — derived, not a collection

The four level badges live on the `levels` documents. Path-wide awards that the level
schema can't hold are **not stored anywhere** — there is no `achievements` collection
and no per-participant "earned" flag. Each is a pure function of the `attempts` and
`responses` collections, recomputed on every read, the same discipline as the level
headline and star bands (§3.7). A stored flag is one more figure that can fall out of
step with the evidence it summarises.

Exposed at `GET /play/achievements` (this participant only, from the token) and, for
the reveal, as `newAchievements` on the `POST /play/attempts/:id/submit` response —
the achievements earned *after* this submit minus those earned *before* it.

**BLS Expert** — the one such award in this build. Earned for scoring **above 95%
overall on first contact with the material, across every level**.

- **"Overall" is the item-weighted pooled first-attempt accuracy:** total questions
  answered correctly on the frozen first attempt (`attemptNo: 1`) of each of the five
  levels, divided by the total number of questions across those five first attempts.
  Not the unweighted mean of the five per-level accuracies — pooling by item stops a
  short level (prelevel, `l4`) from swinging the figure out of proportion to how much
  of the instrument it represents. The comparison is on the exact ratio; the API also
  returns it rounded to one decimal for display.
- **First attempt only.** Every level is designed to end at 100% once remediation
  finishes, so an "overall accuracy" measured after remediation would be 100% for
  every participant and the award would carry no information. It has to measure
  first-contact performance to mean anything in the results chapter.
- **Requires a submitted first attempt for all five levels.** Until then there is no
  defensible overall figure and the award is simply not yet earned. If a level's
  `attemptNo: 1` was abandoned rather than submitted it has no frozen first attempt
  anywhere in the system (§2.3), and the award stays out of reach until that level is
  played through — the conservative reading.
- **`earnedAt`** is the `submittedAt` of the last of the five first attempts, which by
  the unlock ordering is always `l4`'s.

Both numbers in the criterion — the 95% threshold and the requirement that every level
reach 100% before the next unlocks — are the design decisions still pending supervisor
sign-off (§13); the derivation above is written to make either easy to revise.

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

`attempts.reviewMs` (§2.6) is the one duration stored directly rather than derived. It
sits outside this model on purpose: reviewing answers after a level is finished is not
time on task, so it must never be added into any figure above — regardless of which of
the review's three entry points (result card, dashboard node, mission briefing) was
used to open it, and regardless of how many separate visits or attempt switches it
accumulates across.

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
GET /admin/records/trail                one participant, one level: every attempt in
                                         order (kind, outcome, remediation round) and
                                         every response within it in the order it was
                                         answered, with all four §8 timestamps — "see
                                         exactly where a participant struggled"
GET /admin/audit
```

`GET /admin/records/trail` is real today, ahead of the rest of this section — real
admin auth (sign-in, roles) is a later build phase and doesn't exist yet, so this one
route is gated by a temporary dev stand-in (`DEV_ADMIN_ID`), the same pattern already
used for participant auth. It exists so the underlying data is actually reachable
before the admin console itself is built, not as a substitute for it.

### Gameplay — participant
```
GET  /play/session                  mode, status, timer settings, server clock
GET  /play/levels                   unlock state for this participant only
POST /play/attempts                 idempotent — returns the existing in_progress attempt
                                     for this level if one exists, otherwise starts a new
                                     one and returns questions at pinned versions
POST /play/responses                one answer, written immediately, never batched
POST /play/attempts/:id/submit      scores, derives the outcome (fail / remediate /
                                     mastered — see 2.3), unlocks the next level on
                                     mastery, freezes the headline if this was attemptNo 1
POST /play/attempts/:id/abandon     closes an in_progress attempt as abandoned
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
step 5. All are seeded as `status: "draft"` with an `authoringNote` explaining why.

Exactly three items remain, all in the first two levels:

| Item | Needed |
|---|---|
| `l1:9` (drag_drop) | The source lists only correct arrest findings and no distractors, so every token belongs in the same bucket and the item cannot discriminate. Add three or four findings that do **not** indicate arrest — a strong palpable pulse, normal chest rise, crying — before publishing. |
| `l2:3` (sequence) | The corrected document lists the in-hospital Chain of Survival under the same question number as the out-of-hospital chain (`l2:2`). Decide with the supervisor whether this is one question or two: publish it as its own item, or merge both chains into `l2:2` and drop this. Seeding it separately has already shifted every later `l2` sequence number by one relative to the source document. |
| `l2:18` (hotspot_video) | Hotspot coordinates cannot be authored until the clip is filmed. Publish only once the video exists and the hotspot window and `correct` option key are set in the builder. The four options are the fallback route and are already written. |

`l3` is now fully authored: the five former stubs (`l3:2`–`l3:6`, one per AED
objective) and the foreign-body-airway-obstruction items all carry real content and are
published.

Several published items carry feedback text **written for the build rather than taken
from the source document**, each flagged with an `authoringNote`. They are clinical
statements and need review by the supervising faculty before the study runs. Other
`authoringNote`s record where the corrected document changed an answer, a parameter
list or a step count from the original — those are informational, not gaps.

Two source items labelled *Drag & Drop* are ordering tasks and are seeded as
`type: "sequence"` (`l2:2` and `l2:13`).

**The progression mechanic (§2.3) is pending supervisor approval.** Two specific
numbers are design decisions, not yet signed off by the supervising faculty: the 80%
`passMark` that separates a full restart from a remediation round, and the requirement
that a level must reach exactly 100% accuracy (on some attempt) before the next level
unlocks. Both are load-bearing for the results chapter's methodology section and must
be confirmed — or revised — before the instrument is locked for a real session.

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