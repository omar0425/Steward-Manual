# Steward — Cleanup Log

A team-facing record of the cleanup batches that have shipped to `main`
(or are awaiting review). Each batch is a focused round of UX, security,
and runtime polish — small enough to land safely, big enough to be worth
calling out for QA.

Tests baseline: **69 / 69** passing (as of Batch 5, June 2026).

---

## Batch 1 — merged
**Commit:** `dd748d3` ("Batch 1: data leak, skip start-session, retry
storms, currentUserId, login rate limit"), May 5 2026.

Five fixes shipped together:

1. **Data leak around user scoping** — `currentUserId()` in `db.js` now
   refuses non-positive ids and logs a warning instead of silently
   falling through to a shared scope. Prevents one user's reads from
   accidentally hitting another user's rows when scope plumbing is
   misconfigured.
2. **Skip the start-session screen on first run** — after the commitment
   gate confirms, `boot.js` calls `startSessionAndLoad()` directly
   instead of showing an empty start gate that has no meaningful state
   to display. New users get straight to the dashboard.
3. **Retry storm fix** — `boot.js` `scheduleLoadRetry()` was firing
   uncapped exponential retries while the laptop was asleep or the tab
   was hidden. Added a bounded retry table (10 attempts, capped
   backoff), pause-on-hidden via `visibilitychange`, and a manual
   "Retry" button when the limit is hit. A closed laptop no longer
   generates a thundering retry storm on wake.
4. **`currentUserId()` hardening** — see #1; same patch.
5. **Login rate limiter** — `routes/auth.js` adds an in-memory limiter:
   5 failed attempts per username per 15-minute window. The 6th failure
   inside the window returns 429 with a `Retry-After` header and a
   user-readable "Try again in N minutes" message. A successful login
   clears the counter. Applies only to local password login; Google
   OAuth is not throttled.

Also in this commit: README note about the `node_modules/express/` stub,
`.gitignore` entry to keep a nested duplicate working tree out of the
repo, and minor test updates so the new behaviour stays green.

---

## Batch 2 — merged

**Merge commit:** `651055b` ("Merge branch 'cleanup-batch-2'"), merged
May 11 2026. Four task commits authored May 5 2026 — they carried `T1…T4`
prefixes but no "Batch 2" label, which is why this section sat empty.

1. **T1 `d331fcc`** — fix the `/api/reset-game` test by sending
   `{ confirm: true }` (the route requires it; the test sent an empty
   body and got a 400). All 61 tests passed after this — which also
   means the "Known failure" entry at the bottom of this log was
   resolved here.
2. **T2 `406f072`** — rename the 10 stage labels to one consistent
   climbing metaphor.
3. **T3 `ecbf127`** — remove a sentinel div; add a null-safety guard
   for `board-tier-gap-headline`.
4. **T4 `da84c53`** — split the ~1,400-line `render.js` into four
   focused helpers (hero, debts, progress, stats) plus a thin
   orchestrator, keeping the public import surface unchanged.

---

## Batch 3 — on branch `cleanup-batch-3`, awaiting review
10 commits, May 11 2026. UX, security, and runtime polish. Each task is
a separate commit (`T1`…`T10`) so you can read or revert them
individually.

### T1 — Document the two tier systems
**File:** `services/tiers.js`. Added a comment block above `TIERS`
explaining that the **relative** climb system (`getClimbTier`,
`nextClimbTierInfo`, `climbTierBandProgress`,
`climbTierJourneyProgress`) is the source of truth for active gameplay,
and the **absolute** system (`getTier`, `nextTierInfo`,
`debtTierBandProgress`, `debtTierJourneyProgress`) is the fallback for
users without a climb baseline yet. Future contributors don't have to
reverse-engineer the relationship.

### T2 — Game reset now clears `debt_account_name_map`
**File:** `db.js`. Added `'debt_account_name_map'` to `GAME_STATE_KEYS`
so `resetAllGameState()` clears the user's custom debt account display
names along with the rest of the game state. Before this fix, old
account names lingered after a reset.

### T3 — Express error handler so malformed JSON does not leak paths
**File:** `server.js`. Added a final 4-arg error-handling middleware
that intercepts `express.json()`'s `entity.parse.failed` SyntaxError
and returns `400 {"ok":false,"error":"Malformed JSON in request body."}`.
A generic 500 fallback handles any other unhandled error.

**Before:** Default Express handler returned an HTML stack trace
including absolute Windows paths
(`C:\Users\Omar\Steward-Manual\…`) — an info leak.
**After:** Verified via `curl -X POST http://127.0.0.1:3458/api/auth/login \
-H "Content-Type: application/json" -d 'not-json{'` → clean JSON 400.

### T4 — Log silently-dropped malformed debt-account data
**Files:** `db.js`, `routes/api.js`.

Two places quietly discarded malformed account data and made debugging
miserable:

- `db.js` `replaceDebtAccountBalances` — a balance that isn't a finite
  non-negative number was `continue`d with no record.
- `routes/api.js` `POST /api/snapshot` — `roundMoney()` coerces
  non-numeric balances to `0`, which the `bal > 0` gate then drops
  silently. `balance: "not a number"` would disappear from the
  snapshot with no trace.

Both sites now `console.warn` with the offending account id and value.
Response shape and validation are unchanged; the drop is now visible in
the server log.

### T5 — Cap password length at 200 characters
**Files:** `routes/auth.js`, `public/login.html`.

Server-side: both `/api/auth/register` and `/api/auth/login` reject
passwords > 200 chars with a 400 + clear message. Without an upper
bound, an attacker could DoS the password hasher with multi-MB inputs.

Client-side: `maxlength="200"` on all three password inputs
(`login-password`, `reg-password`, `reg-confirm`) and a matching length
check in the register form's submit handler parallel to the existing
length-10 check.

### T6 — Cap debt account name length client-side
**File:** `public/js/manual-entry.js`. Added `maxlength="100"` to the
debt name input built in `addDebtAccountRow()`. The server already
truncates at 100 chars in `routes/api.js`; this stops input client-side
so users see the boundary instead of typing past it. Saved-debts list
renders names as static text, so no other site needs the cap.

### T7 — Close username enumeration leak in `/api/auth/register`
**File:** `routes/auth.js`. Changed the existing-username response from
`409 "Username already taken."` to `400 "Could not create account.
Try a different username."` — same generic shape as other validation
errors. Login already returns identical 401s for wrong-username and
wrong-password; register undid that protection by confirming whether
an account exists.

### T8 — Surface a banner when browser storage is disabled
**File:** `public/js/main.js`. At boot, probe `localStorage` by setting,
reading, and removing a disposable key. If any step throws (Safari
private mode, hardened browsers), prepend a sticky amber banner:
"Browser storage is disabled. Steward needs it to remember your
commitment between sessions. Enable site data for this page." Uses
existing `--amber` / `--amber-soft` tokens.

Before: silent failures left the commitment screen reappearing every
reload and theme not sticking. The cause was invisible.

### T9 — Empty state for the debt-reduction chart panel
**Files:** `public/js/views/dashboard-enhance.js`,
`public/js/views/networth-chart.js`.

A brand-new user has < 2 snapshots, so the trend chart had nothing
useful to plot. The SVG either showed a lone dot or stayed blank with
stale delta text from a previous render. The panel looked broken.

In `dashboard-enhance.js`: gate `renderNetWorthChart()` behind
`snapshots.length >= 2`. With 0 snapshots: "No data yet — add your
debts to begin." With 1 snapshot: "Update your balances at least once
to see your trend." Hide the chart SVG, clear the stale
`chart-trend-delta` text; the panel frame and title stay visible so the
layout doesn't jump when data arrives. Matches the existing
`panel-empty-state` pattern used by the debt-accounts and turn lists.

In `networth-chart.js`: added a defensive early-bail for < 2 points
that clears the line/area paths and hides the legacy single-dot.
Removed the now-dead single-point branch.

### T10 — Accessibility pass
Methodical fixes across five files:

| Area | Change |
|---|---|
| **paydown-confirm-dialog** (`manual-entry.js`) | Added `role="dialog"`, `aria-modal="true"`, `aria-labelledby="paydown-confirm-title"`. Focus moves to the Save button on open and returns to the trigger on close (cancel / save / backdrop click). |
| **milestone-banner** (`views/play.js`) | Added `role="status"` and `aria-live="polite"` so milestone copy is announced when the banner appears, without stealing focus. |
| **Form hints** (`login.html`) | Register password input now points to its "Minimum 10 characters" hint via `aria-describedby="reg-password-hint"`. |
| **Theme toggle** (`main.js`, `login.html`) | `aria-pressed` reflects current state (`"true"` while dark mode is on), updated on every click alongside the existing `aria-label`. |
| **Debt account remove buttons** (`manual-entry.js`) | Per-row `aria-label` is dynamic: `Remove <typed name>` while a name is present, `Remove account` when blank. Name and balance inputs also got `aria-label`. |
| **"+ Add Account" button** (`views/play.js`) | `aria-label="Add another debt account"`. |
| **start-game-btn focus** (`boot.js`) | Receives focus when the start-game-screen modal mounts (parity with the commitment gate). |

The two existing modals — `commitment-screen` and `start-game-screen` —
already had `role="dialog"` and `aria-modal="true"` from prior work, so
no change needed there.

---

## Batch 4 — on branch `claude/serene-spence-fa6bba`, awaiting review
**Driven by:** end-to-end UX test playing through a six-month Maya scenario
(see Round 1 test report in the PR description). Twelve issues found across
behaviour and UX; all twelve fixed in two rounds plus polish.

### Round 1 — server-side correctness

1. **Malformed balance silently zeros debt** — POSTing a
   `{"balance":"$3,000.00"}` used to coerce via `Number(...) → NaN → 0`,
   drop the account, then credit the prior aggregate balance as
   phantom paydown. One typo flipped the user to `tier:"wealthy"` with
   $24K of fake paydown. `routes/api.js` now rejects non-finite (and
   absent) balances with 400 before any state change.
2. **Paying an account to $0 erased the paydown credit** — the
   per-account diff treated balance-to-zero identically to "account
   removed from the input," so a $4,200 payoff went uncounted. The
   `/snapshot` handler now keeps explicit zero balances in the diff map
   (`routes/api.js`) and `perAccountDebtDeltaDisplayRows`
   (`services/climbMetrics.js`) emits `kind: "paid_off"` for those rows.
   Removed-from-input behaviour is unchanged.
3. **`lastPullAccountChanges` reported the wrong window** — the route
   preferred a 5-pull aggregate from `getDebtAccountHistory(5)` over
   the per-turn deltas, so a fresh $1,500 paydown rendered as the
   cumulative-since-baseline delta. The override is gone; the
   persisted `account_lines` from `setLastDebtSyncDebug` are
   authoritative again. The unused historical-window helper has been
   deleted entirely.
4. **Paid-off accounts lost their display name** — the helper that
   resolved names looked only at the current `debtAccountLines` list;
   a paid-off account dropped from that list rendered as
   `"name":"Account"`. Fixed implicitly by #2 (paid-off accounts now
   stay in `debtAccountLines` with `paidOff:true`).
5. **Tier transitions were silent** — no field on `/api/status`
   signalled "you just changed stage." A new `recentMilestones` array
   surfaces `tier-change` (with `from`/`to`) and `account-paid-off`
   (with `accountName`) entries. Each milestone has a stable `id` and
   is filtered against the existing `notifications_sent` config so the
   banner shows once per event, not on every refresh.
6. **`nextTier.monthsEstimate` was always `null` in climb mode** —
   `nextClimbTierInfo` had no snapshot context to compute pace. The
   route now computes `monthsEstimateClimb` from the newest 4
   snapshots, with a **1-day minimum elapsed-time guard** so
   rapid-fire snapshots (e.g. correcting a typo) don't produce a bogus
   "1 month away" answer.
7. **Silent zero-asset preservation** — submitting `totalAssets:0`
   silently kept the user's last non-zero value with no UI signal. The
   response now includes `preservedFields: [{field, value}]`, the
   message names the swapped fields, and clients can opt in with
   `{"allowZero": true}` to record a genuine zero.
8. **Dead `suspectedRestructure` surface** — exposed by the API,
   referenced by `render-progress.js`, but never written by any
   server code. Removed from both ends.
9. **`POST /api/reset-game` told the user nothing** — `resetAllGameState`
   now returns counts: `{deleted: {snapshots, debtAccountBalances,
   debtAccountHistory, gameStateConfigKeys}, preserved: {interestRates}}`.
   The API echoes the summary so the user can verify their interest
   rates and theme survived.
10. **Climb-mode tier copy described absolute dollars** — at
    `debtRemaining` of $24K with a $43K baseline the dashboard said
    *"Past the midpoint. Under $50K. The number shrinks"*, copy
    written for a fixed $80K-anchored scale. `services/tiers.js` now
    overlays a 10-stage `CLIMB_COPY` table keyed to % paid, so every
    user reads progress in their own terms.
11. **Empty `POST /api/snapshot` body accepted** — `{}` would create a
    useless all-zeros row. Now returns 400 with
    `"Snapshot body is empty. Include totalAssets, totalDebt, or
    debtAccounts."`.

### Round 2 — frontend wiring and polish

Half the API work was invisible because the renderer didn't read the
new fields. Round 2 wired them up.

- **Milestone banner** — `#progress-milestone-recent` element in the
  Stage Progress panel renders `recentMilestones` with celebratory
  copy for stage-ups (`🎯 Stage up — Buried → Digging`), softer copy
  for slips (`⚠️ Stage slipped — …`), and a confetti note for
  payoffs (`🎉 Paid off: Amex Gold`). After display, each milestone
  ID is POSTed to `/api/config/notifications-sent` for dedupe.
- **Paid-off badge** — `render-debts.js` keeps balance-zero rows in
  the list with a `PAID OFF` chip (emerald) and a tinted row. They no
  longer silently vanish.
- **Preserved-fields notice** — `manual-entry.js` surfaces the
  `preservedFields` message inline below the save button after a
  successful submit, with an amber border, and delays the reload so
  the user can read it.
- **Debt-free user UX** — a user with `totalDebt:0` no longer sees
  "In the hole. The meter is running." `/api/status` returns
  `debtFree:true` with the message *"No debt to track yet. When you
  have one, add it and start the climb. Until then, your snapshots
  still log net-worth history."* `POST /api/start-game` returns 400
  if the latest debt is 0 — climb math divides by baseline and would
  pin the user permanently at Stage 01.
- **Freshness label** — added a `Recent` band so the thresholds are:
  `<10min: "Live"`, `<1h: "Recent"`, `<48h: "Nh ago"`, `≥48h:
  "Stale >48h"`. The old code labelled a 55-minute-old snapshot as
  "Live," which read as "right now" to users.
- **Streak field rename** — `streak.lastBroken` was the length of the
  *previous* streak, not the *current* one, so an unbroken 10-pull
  run reported `lastBroken: 10` confusingly. Added canonical
  `previousStreakLength` / `previousStreakEndedAt`; old names are
  kept as deprecated aliases so external clients aren't broken.
- **Login-attempts Map sweep** — `_loginAttempts` in `routes/auth.js`
  grew unbounded with one entry per attempted username for up to 15
  min. Added a `setInterval` sweep (with `.unref()`) that prunes
  expired entries.
- **Dead `progress-restructure-note` element** — removed from
  `play.js` and the dead branch in `render-progress.js`. The hidden
  `<p>` element from the `suspectedRestructure` feature was lingering
  with no purpose.

### Tests

- **+10 regression tests** in `test/api-snapshot.test.js`:
  empty body rejected, string balance rejected with state intact,
  paying an account to zero counts as paydown, removing an account
  still does not, tier-change milestone fires, zero-asset
  preservation surfaces in response + `allowZero` opt-in, reset
  response reports deleted/preserved counts, debt-free user gets
  friendly copy, `start-game` refuses with no debt, monthsEstimate
  null until ≥1 day of history exists.
- **Suite: 71/71 passing.** The previously-listed "Known failure" for
  `api-state-machine` was already passing at the start of this batch
  (the test file calls `reset-game` with `{confirm:true}`); see the
  Known failure section below — entry is stale, kept for history.

### New API surface (for QA / external clients)

- `GET /api/status`
  - `recentMilestones: [{id, type, ...}]` — `tier-change` or
    `account-paid-off`. Each ID is stable; POST to
    `/api/config/notifications-sent` with `{milestone: id}` to dedupe.
  - `stats.debtAccountLines[*].paidOff: boolean` — true when the
    submitted balance is 0.
  - `streak.previousStreakLength` / `previousStreakEndedAt` — preferred
    names. `lastBroken` / `lastBrokenAt` remain as deprecated aliases.
  - `meta.freshness` adds `"Recent"` between `"Live"` and `"Nh ago"`.
  - `debtFree: true` on the setupIncomplete branch when the user has
    no debt.
- `POST /api/snapshot`
  - Accepts `allowZero: true` to record a genuine zero for income /
    expenses / assets / investments (otherwise zeros are preserved).
  - Returns `preservedFields: [{field, value}]` when preservation
    kicked in.
  - **400** for: empty body, missing balance on a submitted debt
    account, non-finite balance, non-finite money field.
- `POST /api/start-game`
  - **400** when `debtRemaining === 0` — there's nothing to climb.
- `POST /api/reset-game`
  - Returns `{ok:true, deleted: {...counts}, preserved: {interestRates}}`.

### Browser-side smoke tests (Batch 4)

Run against `npm start` before merging:

1. **Stage-up celebration** — register fresh, post a baseline, lock the
   climb, then post a snapshot that crosses the rock_bottom→broke
   boundary. Expect the gold milestone banner with `🎯 Stage up`.
   Refresh once — banner should *not* reappear (dedupe).
2. **Account paid off** — submit a snapshot where one account's balance
   is `0`. Expect the `🎉 Paid off: …` row in the milestone banner
   and a `PAID OFF` chip on the debt list row. Refresh — chip stays,
   banner gone.
3. **Preserved fields notice** — post a snapshot omitting
   `totalAssets` (the manual-entry form does this by default). Expect
   the amber `manual-entry-preserved` note below the save button
   explaining the preservation + `allowZero`.
4. **Malformed balance** — paste `"$1,234.00"` into a debt-account
   input (or POST via DevTools). Expect inline 400 error mentioning
   `must be a number`. State unchanged.
5. **Debt-free welcome** — register fresh, submit
   `{"totalAssets":1000,"totalDebt":0}`. Expect the friendly
   "No debt to track yet…" message and no "In the hole" copy
   anywhere on the page.
6. **Freshness label** — leave the page open for 15+ minutes without
   submitting. Expect the freshness chip to change from `Live` to
   `Recent`.
7. **Reset summary** — load up some debts + interest rates, hit
   reset. Network response should include `deleted` and `preserved`
   counts. Interest rates should still be present after reset
   confirmation.

---

## Batch 5 — dead-code & duplication sweep, June 2026

Behavior-preserving refactor across backend, services, and CSS. No new
features, no API changes beyond two error responses gaining the
standard `ok: false` field.

### Backend / services

- **`latestCombined()` removed** (`db.js`) — pure pass-through to
  `latestSnapshot()`; callers in `routes/api.js` and
  `services/stewardAiContext.js` now call `latestSnapshot()` directly.
- **`debtProgress()` / `debtProgressWithHistory()` removed**
  (`services/tiers.js`) — legacy merged-paydown math superseded by
  `services/climbMetrics.js`; zero callers anywhere.
- **`roundMoney` deduplicated** — `routes/api.js` now imports it from
  `services/climbMetrics.js` instead of carrying its own copy.
  (`tiers.js` keeps its local copy deliberately: it is a pure-math
  module and importing climbMetrics would pull the DB into its
  dependency tree.)
- **JSON-config parsing consolidated** (`routes/api.js`) — four
  hand-rolled `JSON.parse` + fallback blocks replaced with
  `parseJsonArray()` / `parseJsonObject()` helpers.
- **Error shape normalized** — `/api/config/interest-rates` and
  `/api/config/notifications-sent` 400 responses now include
  `ok: false` like every other endpoint.

### Frontend

- **~21 KB of unreachable CSS removed** (`public/style.css`, 191
  selectors) — rules for retired components (breathing-room panel,
  cashflow panel, health grid, narrative grid, old CSS-drawn
  `.steward-card`/`.steward-mini` mascots, `tier-pill`, showcase
  `sc-meta`, demo nav, and the retired `is-thin/steady/solid/strong`
  stability scale). Every removed selector was machine-verified to
  require a class that appears nowhere in HTML, JS (including
  dynamically-built class names), JSON, or e2e specs.
- **Dead DOM marker removed** (`main.js`) — `data-steward-build`
  was written but never read by CSS, JS, or tests.

### Known no-op (resolved)

- `render-stats.js` toggled `is-negative` on the net-worth stat, but
  its only CSS rule required the retired `.ps-value` class — the
  toggle had no visual effect for some time. Resolved by removing the
  toggle: `#stat-net-worth` only exists as a hidden `.stat-sentinel`
  span (play.js), so no styling could ever render on it.

Suite: 69/69 passing before and after.

---

## Batch 6 — UX polish from a 100-user exploratory sweep, June 2026

Nine changes surfaced by driving 100 simulated users (all 10 tiers, debt
$47–$1.25M, 1–20 accounts, unicode/100-char/XSS names, 6 viewport/theme
combos) through the API + Chromium. No backend behavior change except one
new config endpoint. Verified by a 19-assertion targeted Playwright pass
plus the existing 70 unit / 30 e2e suites.

1. **Guided tour now fires after Start Climb** (`manual-entry.js`) — the
   soft-refresh path into the dashboard never offered the first-visit
   tour (boot.js only offers it on a full page load), so new users met
   it on their *second* visit. Now offered once the post-climb dashboard
   renders.
2. **Long account names ellipsize** (`style.css`, `render-debts.js`,
   `render-stats.js`, `manual-entry.js`) — a 100-char name caused
   horizontal page overflow and stretched every row it touched. Added
   `min-width:0` + `text-overflow:ellipsis` to the three row-name
   classes, with the full name in a `title` tooltip.
3. **Long lists collapse** (`render-stats.js`, `render-debts.js`,
   `style.css`) — This Turn now leads with the top 5 movers behind a
   "Show all N" expander; Debt Accounts collapses past 8 rows. Both
   expand for the session.
4. **Commitment promise persists server-side** (`routes/api.js`, `db.js`,
   `commitment.js`, `boot.js`) — the "I'm in" flag was localStorage-only,
   so a returning user on a new device was re-asked mid-climb. New
   `GET/POST /api/config/promise` mirrors it per-user; boot checks the
   server before showing the gate. Cleared by reset-game.
5. **Fonts self-hosted** (`public/fonts/`, `fonts.css`, all HTML) —
   dropped the `fonts.googleapis.com` dependency (128 KB of latin woff2,
   OFL). App now renders identically offline with no third-party
   requests.
6. **Dead `is-negative` toggle removed** — see Batch 5 note; finished
   here.
7. **Payoff projection on the debt chart** (`networth-chart.js`,
   `play.js`, `style.css`) — a dashed gold line extends from the latest
   point toward debt-zero at the recent daily pace, with a "debt-free
   around <Month Year>" caption and a payoff x-axis tick. Only when the
   trend is genuinely downward and the payoff lands within 30 years.
8. **Two-column dashboard above 1500px** (`style.css`) — ultrawide was a
   single centered column; now a 7/5 grid places the entry form beside
   the chart and This Turn. Setup view stays single-column.
9. **Paid-off celebration** (`render-debts.js`, `render-progress.js`,
   `style.css`) — a one-shot gold flash + badge pop when an account hits
   $0, hooked to the `account-paid-off` milestone, honoring
   `prefers-reduced-motion`. The renderer owns the animation via a short
   time-window so the async debt-history rebuild can't wipe it mid-play.

New test: `promise config: roundtrip, trimming, and reset-game clears it`
in `test/api-snapshot.test.js`. Suite: 70/70 unit, 30/30 e2e.

---

## Batch 7 — ops hardening + versioning, June 2026

**Commits:** `5b1e0e0` (versioning), `1dd14c0` (ops). Infrastructure, not
features — protects the data and makes deploys identifiable.

1. **App versioning** — `package.json` version (bump minor per batch;
   currently 1.6.0) surfaces in `/health` (with the Railway deploy SHA
   via `RAILWAY_GIT_COMMIT_SHA`), a Version chip in the dashboard data
   strip, the login footer, and the boot log.
2. **Backups, two layers** — production writes a daily `VACUUM INTO`
   snapshot to `<db-dir>/backups/` (keeps 7); `GET /admin/backup`
   (guarded by `STEWARD_BACKUP_TOKEN`, constant-time compare) streams a
   consistent copy of the live DB. `scripts/pull-backup.ps1` pulls dated
   off-site copies to `~\StewardBackups` and prunes after 30 days —
   schedule it with the schtasks one-liner in its header.
3. **CI** — `.github/workflows/ci.yml` runs the unit suite and the
   Playwright e2e suite on every push/PR to `main`; HTML report uploaded
   as an artifact on failure.
4. **PWA install** — `manifest.json` + 192/512 maskable icons (rendered
   from `favicon.svg`) + `theme-color`; the app installs to a phone home
   screen as a standalone window.
5. **Data export** — `GET /api/export` downloads the signed-in user's
   complete history (snapshots, account balances/history, settings) as
   dated JSON; ⤓ Export button in the data strip. Unit-tested.
6. **Email config warning** — production boot without `RESEND_API_KEY`
   logs a loud warning that password-reset links only print to the log.

Operational follow-ups that live outside the repo: set
`STEWARD_BACKUP_TOKEN` on Railway, schedule `pull-backup.ps1` on a PC,
and point an uptime monitor (e.g. UptimeRobot) at `/health`.

Suite: 71/71 unit, 30/30 e2e.

---

## Batch 8 — security, polish, and the first "smart" features, June 2026 (v1.7.0)

1. **Security headers** — pragmatic CSP (`'unsafe-inline'` retained for
   login.html's inline blocks; everything else locked to `'self'`),
   `frame-ancestors 'none'` + `X-Frame-Options: DENY` (no clickjacking),
   `nosniff`, `Referrer-Policy`, `Permissions-Policy`, and HSTS in
   production. e2e suite passes under the CSP.
2. **Node pinned** — `engines: >=24` + `.nvmrc`; the app depends on
   `node:sqlite`, which older majors don't ship.
3. **APR avalanche guidance** (`render-debts.js`) — each rated account
   shows its ~$/mo interest cost next to the APR; the highest-APR open
   account gets a gold **PAY FIRST** badge (only when ≥2 accounts are
   rated); a summary line under the total reads "Interest costs you
   ~$X/mo right now — extra payments go furthest on <name>." Pure
   frontend; uses the APRs users already enter.
4. **Inactivity nudge** (`services/nudge.js`, `services/email.js`) — in
   production, users whose latest snapshot is older than
   `STEWARD_NUDGE_DAYS` (default 10, 0 disables) get one Resend email
   per lapse; the marker re-arms when they snapshot again. No-op without
   `RESEND_API_KEY`. Selector covered by 4 unit tests.
5. **Housekeeping** — the long-stale "Known failure" section below is
   now marked resolved (fixed by Batch 2 T1); no dead remote branches
   existed.

Suite: 75/75 unit, 30/30 e2e.

---

## Batch 9 — account security, June 2026 (v1.8.0)

1. **Change password while signed in** (`POST /api/auth/change-password`)
   — previously the forgot-password email flow was the ONLY way to
   rotate a password. Verifies the current password, applies register's
   rules, kills every session (a thief's stolen session dies with the
   old password), and re-issues a fresh cookie so the caller stays
   signed in. Hidden in the UI for Google-provider accounts.
2. **"Sign out other devices"** (`POST /api/auth/logout-others`) —
   removes every session except the calling one; reports the count.
3. **Register rate limit** — max 5 new accounts per IP per hour,
   counted only on successful creation so fumbled validation doesn't
   lock anyone out. Disabled under NODE_ENV=test (suites register
   dozens of users from 127.0.0.1); the dedicated limiter test opts
   back in via STEWARD_FORCE_REGISTER_LIMIT.
4. **UI** — the Danger zone panel is now "Account & danger zone":
   Account security (password form + sign-out button) on top, then the
   destructive actions.
5. **Excel-friendly export** — `GET /api/export?format=csv` downloads
   the snapshot time series as a UTF-8-BOM CSV with Excel-parseable
   datetimes; `&table=accounts` gives long-format per-account balance
   history (names joined from the name map, RFC-4180 quoting). The data
   strip now has ⤓ CSV and ⤓ JSON buttons — CSV for spreadsheets, JSON
   as the complete backup.

Suite: 80/80 unit, 30/30 e2e. New file `test/account-security.test.js`
(4 tests, incl. full session-rotation roundtrip with cookie reissue);
CSV export covered in `test/api-snapshot.test.js`.

---

## Batch 10 — motivation trio, June 2026 (v1.9.0)

Three features riding on data the app already collects, forming one
motivational arc: feel the cost → see the escape → celebrate progress.

1. **Interest ticker** (hero, `render-debts.js`) — "Carrying this debt
   costs ~$X every day", computed from the same APR×balance totals as
   the avalanche summary. Hidden until APRs are entered.
2. **What-if slider** (chart panel, `views/networth-chart.js`) — drag an
   extra $0–1000/mo; readout shows the new debt-free date, months
   sooner, and ~interest saved (blended APR × average balance over the
   shortened window). Only visible while the payoff projection is
   active; value persists in localStorage.
3. **Stage-up confetti** (`render-progress.js`) — a dependency-free CSS
   burst (90 pieces, literal brand palette, gold/emerald/cream/rose)
   when a climbed tier-change milestone renders; skipped under
   `prefers-reduced-motion`.

   ⚠️ **Boot-timing note for future maintainers:** the stage-up
   milestone first renders mid-boot, and the boot sequence tears out
   freshly-attached DOM (the shell/`<body>` is rebuilt during mascot
   template injection). The confetti therefore **self-heals**: it
   re-asserts itself onto the current `document.body` each animation
   frame for ~3.5s, so whatever swaps the DOM, the next frame
   re-mounts. Colors are inline literals (not `var(--gold)`) because the
   theme tokens are scoped to `body[data-theme]` and an earlier
   `<html>`-mounted version rendered transparent. Verified in a real
   browser (90 gold pieces on the climbed milestone); note the headless
   Playwright `page.evaluate` rig could not observe the burst — a test
   harness isolation quirk, not a product bug.

Suite: 80/80 unit, 30/30 e2e.

---

## Batch 11 — forgot-a-debt correction, June 2026 (v1.10.0)

Fixes a data-integrity trap: a debt account *added mid-climb* was always
counted as **new debt** — so a user who simply forgot to enter an account
they always had would see their progress spiral backward (new-debt
counter jumps, stage can slip). Now they can say which it is.

- **Server** (`routes/api.js`): `/api/snapshot` accepts
  `preexistingAccountIds`. For each genuinely-new account so flagged while
  a climb is active, its balance is **folded into the baseline**
  (`climb_baseline_debt` + `game_start_debt`) and **excluded from the
  new-debt diff** (the previous-balances map is seeded with it). Net
  effect: "paid down" is unchanged and the stage position is preserved —
  the honest representation that the debt was always there. The tier is
  computed *after* the bump so no false "stage slipped" milestone fires.
  Only active mid-climb; during setup every account is just inventory.
- **Frontend** (`manual-entry.js`): when you add a new account mid-climb,
  the confirm dialog asks per account — "New debt I just took on" vs "A
  debt I already had." No default (guessing either way is wrong); **Save
  stays disabled until every new account is classified.** Existing
  balance-update behavior is untouched.
- **Tests**: two new cases in `test/api-snapshot.test.js` — flagged →
  baseline rises, zero new debt, paid-down preserved; unflagged → still
  counts as new debt (the spiral, unchanged default). Verified end-to-end
  through the real UI (dialog gates Save; POST carries the ids; baseline
  folds $20k→$23k with new-debt 0).

Note: this does NOT add user-settable "as-of" dates — that's a separate,
riskier change (it would touch chart ordering, payoff pace, and account
history). Dating was considered and deferred; the spiral was the real
problem and it's date-independent.

Suite: 82/82 unit, 30/30 e2e.

---

## Batch 12 — start-screen polish + Ask the Steward, June 2026 (v1.11.0)

From real-use feedback on the live app.

1. **Character visibility** (`style.css`) — on the cream light theme the
   mascot washed out against a light `.start-character-frame`. Now the
   frame is a deep green disc (`#16241c`) on both themes with a gold ring
   and drop shadow, so the Steward pops. Verified in light theme.
   **Follow-up (v1.11.1):** the first pass fixed contrast but missed the
   real complaint — the 268px-tall mascot was being *clipped* (hat + feet)
   by the 216px disc's `overflow:hidden`. Scaled the figure to `0.72` with
   a `-26px` upward nudge (the wrap's internal layout is bottom-heavy) so
   the whole character, hat to shoes, sits centered inside the disc.
   Verified by measuring the wrap vs frame rects and a screenshot.
2. **Removed "View all 10 stages" links** — gone from the start screen and
   the hero (`views/play.js`) plus their dead CSS. `/showcase` still
   resolves by URL; it's just no longer linked.
3. **De-duplicated the update CTA** — dropped the redundant data-strip
   "✎ Update Numbers" button (and the dead `#refresh-msg`). The canonical
   action is "Update Balances" in the entry panel; the contextual FAB
   still appears when it scrolls out of view.
4. **Ask the Steward** — a dashboard panel of suggested-question chips
   ("Which debt should I pay first?", "When could I be debt-free?", "How
   am I doing?", "What is interest costing me?") that query the AI about
   the user's own numbers. New `POST /api/steward-ai/ask` +
   `generateAnswer()` reuse the existing context payload, so answers cite
   real figures in the Pennybags voice. Gated by a new `aiEnabled` flag in
   `/api/status` (panel hidden when no `ANTHROPIC_API_KEY`); setup-mode CSS
   hides it pre-climb. Verified end-to-end with a live key — a "pay first"
   question returned correct avalanche advice citing the $166.60/mo
   interest and the account nickname.

Suite: 83/83 unit, 30/30 e2e.

**Follow-up (v1.11.2):** the first Ask answers were poor — they leaked
internal jargon ("the forecasts array is empty", "the system would need")
and refused to answer instead of reasoning. Rewrote the `generateAnswer`
prompt: never reference data/fields/"the system" (speak only about the
player's money); do the arithmetic (monthly ≈ daily × 30); and — critically
— compare monthly paydown to monthly interest, stating plainly when
interest is outrunning payments (no honest payoff date) plus the dollar
lever to reverse it. Verified against the reported scenario ($77,967 debt,
~$6.45/day paydown, $387.60/mo interest): the answer now says the balance
is growing, quantifies the ~$550–600/mo needed to turn it around, and
points to entering the Visa APR — no jargon.

---

## Known failure — RESOLVED (kept for history)

`test/api-state-machine.test.js:60` used to fail with `400 !== 200`
because it called `POST /api/reset-game` with an empty body while the
endpoint requires `{ confirm: true }`. **Fixed by Batch 2 T1
(`d331fcc`, May 5 2026)**, which updated the test to send the flag.
The suite has been fully green since.

---

## Browser-side smoke tests (Batch 3)

Run these against `npm start` before merging Batch 3:

1. **Malformed JSON** — POST `not-json{` to `/api/auth/login` from
   DevTools. Expect clean JSON 400, no HTML stack trace, no Windows
   paths.
2. **Storage banner** — open in Safari private mode. Expect the amber
   sticky banner at the top.
3. **Password length cap** — paste a 250-char password into the
   register form. Expect inline error; `maxlength` should also
   prevent typing past 200.
4. **Register enumeration** — try registering an existing username.
   Expect `"Could not create account. Try a different username."`, not
   `"Username already taken."`.
5. **Debt name cap** — paste a 200-char debt name into the
   `+ Add Account` form. Should clip at 100.
6. **Chart empty state** — reset the game. With 0 snapshots → "No data
   yet…". With 1 snapshot → "Update your balances at least once to see
   your trend." With 2+ → curve renders.
7. **Paydown dialog focus** — save a balance change. Tab key should
   land on Cancel. Closing the dialog should return focus to the
   triggering button.
8. **Milestone banner with screen reader** — cross a paydown threshold
   with VoiceOver on (Cmd+F5). Banner copy should be announced.
9. **Theme toggle** — inspect `#theme-toggle`. Click cycles
   `aria-pressed` between `"true"` and `"false"`.
10. **Debt remove button labels** — add account, type `Chase Sapphire`.
    The × button's `aria-label` should read `Remove Chase Sapphire`.
    Clear the input — label falls back to `Remove account`.
