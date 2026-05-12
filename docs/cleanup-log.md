# Steward — Cleanup Log

A team-facing record of the cleanup batches that have shipped to `main`
(or are awaiting review). Each batch is a focused round of UX, security,
and runtime polish — small enough to land safely, big enough to be worth
calling out for QA.

Tests baseline: **60 / 61** passing. See "Known failure" at the bottom.

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

> ⚠️ I could not find a commit on `main` explicitly labeled "Batch 2"
> (only Batch 1 above and Batch 3 below). It may have been squashed into
> Batch 1, or shipped under a different message before the "Batch N"
> convention started. **Omar — please fill in this section** with the
> commit hash(es) and the per-task summary so the team has the full
> history in one place.

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

## Known failure (pre-existing, **not** caused by these batches)

`test/api-state-machine.test.js:60` —
`backend state machine: no data -> setup -> active climb -> reset` —
fails with `400 !== 200`.

The test calls `POST /api/reset-game` with an empty body, but the
endpoint (`routes/api.js:537`) requires `{ confirm: true }`. The
frontend at `public/js/commitment.js:116` always sends the flag, so the
endpoint is correct; the test is the one that needs to be updated. A
follow-up task has been spawned to fix this (see the Cowork chip
"Fix reset-game test missing confirm flag").

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
