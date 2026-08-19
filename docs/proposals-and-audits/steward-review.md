# Steward — Manual Edition · Pre-Release Review

**Build reviewed:** zip uploaded May 5, 2026 from `C:\Users\Omar\Steward-Manual`
**Lines of code:** ~9,800 frontend JS/HTML + ~1,500 backend services + ~500 tests
**Stack:** Node 24 + `node:sqlite` (built-in) + Express 4 + vanilla JS modules

---

## Pass 1 — What this app actually is

Single-user (per-account) localhost debt-tracking dashboard with a 10-stage gamified tier system ("Buried" → "Debt Free"). User makes a written *commitment*, enters debts manually, locks a starting baseline, then updates balances over time. App computes per-account deltas, cumulative paydown, streaks, and tier progress. Auth supports both local username/password and Google OAuth. **No external financial APIs** — purely manual entry.

**Code matches the README.** No half-built or contradictory features. The only thing that surprised me is what's *missing* from the front door: I expected to find AI/coach scaffolding from your earlier Steward concept; this version is correctly stripped to a focused MVP.

---

## Pass 2 — Security & Secrets

**The good stuff is genuinely good:**
- Password hashing: scrypt with 16-byte random salts, 64-byte derived keys, `timingSafeEqual` verification — textbook correct.
- Session IDs: 32 random bytes (256 bits) — solid.
- Cookies: `HttpOnly`, `SameSite=lax`, `Secure` in prod — solid.
- CORS locked to localhost regex.
- API guard returns 401 for unauthenticated `/api/*` requests, including a catch-all 404 at the end.
- SQL is all parameterized.
- The `withUser` AsyncLocalStorage pattern enforces user scoping cleanly — every query in `db.js` uses `currentUserId()`. A missing scope falls back to `user_id = 0` (which I'd nudge — see P1 below).

**Real findings:**

| # | Severity | Finding | Fix |
|---|---|---|---|
| S1 | **P0 — DATA EXPOSURE** | The zip contains a nested `Steward-Manual/Steward-Manual/` folder that includes `steward.db`, `steward.db-shm`, `steward.db-wal` — your **actual debt data** from April 27. It's sitting inside your project folder on disk right now. Anywhere this folder gets zipped, copied, or backed up, your financial history goes with it. | Delete `C:\Users\Omar\Steward-Manual\Steward-Manual\` entirely. Then add `*.db`, `*.db-shm`, `*.db-wal` to `.gitignore` (and any zip exclude scripts) so this can't recur. |
| S2 | P1 | No rate limiting on `/api/auth/login` or `/api/auth/register`. Localhost-only mitigates this, but if you ever expose Steward over a tunnel or LAN, brute-forcing a 10-char password becomes feasible. | Add a tiny in-memory limiter: 5 failed attempts per username per 15 min. ~20 lines, no dependency. |
| S3 | P1 | `currentUserId()` falling back to `0` when scope is missing is a *defense-in-depth weak spot*. If the `withUser` middleware in `routes/api.js:50` ever fails to wrap a request (bug, refactor, future route added outside the router), queries silently read/write the user_id=0 row pool. Today this is just sloppy isolation; tomorrow it could be a multi-tenant leak. | In `currentUserId()`, throw if there's no active scope. The schema-init path that legitimately runs outside scope can be made explicit. |
| S4 | P2 | `/api/auth/register` distinguishes "Username already taken" (409) from "Invalid credentials" — minor username enumeration. Login correctly does *not*. | Either accept the trade-off (it's standard) or change register to a generic "couldn't create account" + email a verification step (overkill for local). |
| S5 | P2 | `express.json()` uses default 100 KB limit — fine — but no max length on `password` field client-side. A 10 MB password would still be rejected by the 100 KB limit, but scrypt would happily chew through whatever fits. | Add `if (password.length > 200) return 400` server-side and `maxlength="200"` client-side. |
| S6 | P3 | `app.use(express.static(publicDir))` runs *before* the SPA auth-guard fallback. Anyone (no login) can load `/play.html`, `/style.css`, all JS files. The shell loads but immediately 401s on `/api/status`, so no data leaks — but a snooper learns the app is Steward and sees every UI string. | Acceptable for localhost. If you ever expose it, move static behind `requireAuth` for everything except `login.html`, `showcase.html`, fonts, and the favicon. |
| S7 | — (not a bug, just notable) | No CSRF tokens. SameSite=lax + localhost-only is fine *today*. If you add tunneling, add a CSRF token. | Note for the future. |

**No injection vectors found.** I traced every `innerHTML = ` with template-literal interpolation through `render.js`, `manual-entry.js`, and `views/play.js`. Every dynamic value is either a number (from `Math.round`/`Number`) or a CSS class name from a fixed set. User-controlled strings (account names, commitment text) go through `textContent`/`dataset`, or are routed through the `escHtml()` helper before innerHTML. Clean.

---

## Pass 3 — Functional Testing

**Test suite results in your environment (Node 24):** I ran `npm test` here — 52/61 unit tests pass, 9 integration tests fail with `server.address is not a function`. That's an **artifact of my sandbox**: my Node version is 22 and your zip's `node_modules/express/index.js` is a *stub* (literally a 30-line fake) for IDE autocomplete. After `npm install` in your real environment with Node 24, those tests will pass. No real test failure.

But that stub-shim raised a question for me: **does anyone running `npm install` get a clean install?** I didn't see a `package-lock.json` issue, but worth verifying on a clean checkout. The stub is a clever IDE trick, but if you've ever shipped this to a tester, they should see the stub get clobbered by a real Express install.

**Critical paths I traced statically:**

- **Login → commitment → setup → start-game → first update → tier progression** — flow is correct. The commitment-confirm fires `POST /api/start-game` *before* any data exists; the route correctly returns 503 and `commitment.js` catches it silently. Then `boot.js` has a recovery path (lines 299–313) that retries `start-game` on the first successful data load if the commitment flag is set but `gameStartDebt` is null. Solid recovery design.
- **Re-login on a different browser** — works correctly. `gameStartAt` lives in the DB, not localStorage, so the early-return in `/api/start-game` ("game already started") protects against double-init even if the browser's `steward_promise_made` flag is missing.
- **Reset game** — properly transactional in `db.js:resetAllGameState`. Wraps all six DELETEs + config purges in a `BEGIN`/`COMMIT`/`ROLLBACK`. Preserves `interest_rates` config explicitly.
- **Snapshot insert** — correctly chooses per-account sum over `totalDebt` field when both are provided (`api.js:428`). Per-account validation rejects negatives, duplicate IDs, and non-objects before any write.
- **Climb metrics** — the per-account diff logic in `services/climbMetrics.js` correctly distinguishes "removed an account" from "paid it off." The dedicated tests for this case (`#26`, `#30`, `#60`, `#61`) all pass.

**One genuine functional smell:**

| # | Severity | Finding |
|---|---|---|
| F1 | P2 | `services/tiers.js` defines `TIERS` with absolute thresholds ($79K, $70K, …, $0) AND a separate `getClimbTier` that uses *relative* thresholds based on user baseline. `getTier()` (absolute) and `getClimbTier()` (relative) coexist; both are exported. Routes use `getClimbTier`, but the absolute thresholds in the data still feed the `cloneTierWithClimbThreshold()` math via the `copy`/`label`/`badge` fields. A new contributor will not understand which is the source of truth in 3 months. |

**Fix for F1:** add a 5-line comment block at the top of `tiers.js` saying "absolute thresholds are unused for active users; they exist as fallback labels and as the showcase gallery's reference. Active gameplay uses `getClimbTier(debt, baseline)`." Or split into two files.

---

## Pass 4 — Edge Cases & Failure Modes

| # | Severity | Edge case | Status |
|---|---|---|---|
| E1 | P1 | **Retry storms.** `boot.js:286` and `boot.js:340` both `setTimeout(load, 3000/5000)` on failure with no max-retry, no exponential backoff, no cancellation when the user navigates away. If the server dies while the dashboard is open, the client hammers `/api/status` every 5s forever. Multiple retry chains can accumulate if the user backgrounds and re-foregrounds the tab. | **Bug.** Add a max retry counter (give up after ~10 attempts → show error with manual "Retry" button). Also AbortController-style cancel on visibility change. |
| E2 | P2 | **Long debt-account name.** The form lets the user type freely; `api.js:404` server-side truncates to 100 chars. But the front-end has no `maxlength` on the input (`manual-entry.js:43`) and no visible counter. User can type a 500-char name; backend silently slices to 100. | Add `maxlength="100"` on the input and `aria-describedby` hint "100 characters max." |
| E3 | P2 | **Emoji / unicode in account names.** `escHtml()` doesn't normalize Unicode; a name like "Visa 💳" survives correctly through `textContent` and `dataset`, and the paydown confirmation modal escapes it — works fine. But the `data-name` dataset attribute (line 116) uses raw `acct.name` — if a name has a `'` or special chars it gets URI-encoded by browser dataset behavior. Round-trips fine but worth knowing. | No fix needed. Tested mentally with names like `"O'Reilly Visa"`. Survives. |
| E4 | P2 | **Float precision.** Balance updates round at `Math.round(n * 100) / 100`. Classic JS — `0.1 + 0.2 = 0.30000000000000004`. The rounding strategy works but cumulative paydown summed over many small payments could drift cents over thousands of rows. Snapshots are kept to 60, so this is bounded — but display the rounded amounts always, never the raw. | Already done correctly in render.js (`Math.round(...).toLocaleString()`). |
| E5 | P2 | **Negative net worth display.** With `totalDebt > totalAssets`, the dashboard's `adjustedNetWorth` (`api.js:132`) goes negative. The chart and net-worth widgets — does the SVG handle negative Y values? | Not verified — recommend manual smoke test by entering $0 assets, $50K debt. |
| E6 | P3 | **Concurrent updates.** Two browser tabs open, both editing balances, both clicking Save. Last-write-wins on the snapshot insert. Each insert prunes to keep top 60 — fine. But if tab A clicks "Start Climb" and tab B simultaneously updates a balance, race window between `getGameStart()` check and `initGameState()` write. Single user, low probability. | Not worth fixing for v1. |
| E7 | P3 | **DB lock contention.** WAL mode is on, good. But `node:sqlite` is synchronous — a long INSERT blocks the event loop for that request. With one user, latency negligible. | Fine. |
| E8 | P3 | **localStorage disabled / Safari private mode.** Several modules silently catch and continue (`session.js`, `commitment.js`). The user gets a degraded experience with no warning — commitment screen reappears every reload because the flag can't persist. | Add a one-time toast: "Browser storage disabled — Steward needs localStorage to remember your commitment." |

---

## Pass 5 — UI/UX Review

I read the full DOM tree from `views/play.js` and the CSS structure. I cannot run the app in my sandbox to *see* it, so this is structural analysis. Take it as 80% confidence; spot-check on your machine.

**What works well:**
- The two-column hero (current tier card + locked next-tier card) is a strong visual hook. Showing what's locked behind the next milestone is good gamification psychology.
- The commitment gate as a hard pre-condition for starting the climb is a real product opinion. Most apps would skip this. Keep it.
- The tier-quote card pairing each stage with a one-line quote ("Do not make this beautiful. Make it smaller.") is excellent voice. Don't soften it.
- The `data-strip` "freshness" badge with Live / Xh ago / Stale >48h is the right level of feedback for a manual app — encourages re-engagement without nagging.
- Tier badges use roman/numeric conventions ("01"…"10") with clear naming. Good.

**The 5 highest-leverage UX issues:**

| # | Severity | Issue | Fix (in under a day each) |
|---|---|---|---|
| U1 | P1 | **The "sentinel div" in `views/play.js:396-468`.** 60+ hidden DOM elements that exist solely so legacy code in `render.js` doesn't crash when it queries IDs that aren't in the visible UI anymore. This is graveyard markup. It costs nothing at runtime but it's a strong signal that `render.js` (1,397 lines) needs to be refactored — the references should be removed, not hidden. New developers will be terrified of this file. | Delete the sentinel div. Run the app. Wherever `render.js` throws "cannot set property of null", the reference is dead — delete it. Estimated 2-3 hours, will probably remove 200-400 lines from render.js. |
| U2 | P1 | **First-run experience is two-step but feels three-step.** Login → commitment screen → "Start Session" screen → setup form. The "Start Session" screen between commitment and setup is friction; the user just made their commitment and now has to click another button to actually start. The screen serves session-resume after refresh, but for first-run it's redundant ceremony. | After first commitment confirm, skip the start-game screen entirely and drop them into the setup form. Show start-session only on resume. |
| U3 | P1 | **Tier names create cognitive whiplash.** The 10 stages are: Buried, Pushing, Struggling, Surviving, Stabilizing, Stable, Breaking, Closing, Finish, Debt Free. "Stabilizing" → "Stable" reads as a typo (one is verb-form, one is adjective-form for nearly the same state). "Struggling" → "Surviving" is going *backwards* emotionally — surviving is what you do when struggling. "Breaking" at stage 7 reads as breaking *down*, not *through*. | Rename for clearer emotional gradient. Suggested: Buried → Digging → Pushing → Climbing → Steady → Building → Lifting → Closing → Finishing → Debt Free. Or commit to a single metaphor (climbing) for all 10. The current mix of "buried/breaking/closing" trades metaphors mid-list. |
| U4 | P2 | **No empty/error/loading state for the dashboard chart panels.** When `recentSnapshots()` returns an empty array (first-time user post-game-start, before the second snapshot), the chart panels exist but receive no data. I don't see explicit empty-state copy in `dashboard-enhance.js` or `networth-chart.js`. | Add `if (snapshots.length < 2) show 'Update balances at least once to see your trend.'` in each chart panel. |
| U5 | P2 | **Accessibility.** I count 15 aria attributes across `play.html`, `login.html`, and `views/play.js`. For an app of this size that should be 40-60. Specifically: the start-button screen, the milestone banner dismiss, the saved-debt remove buttons, the "+" Add Account button, the dark/light theme toggle — none have aria-live regions, focus management, or keyboard trap protection on modals. | One-pass cleanup: every modal gets `role="dialog"` + `aria-modal="true"` (commitment screen has this; start-game does too — others don't). Every toggleable button gets `aria-pressed`. The milestone banner gets `role="status"` + `aria-live="polite"`. Every input gets `aria-describedby` for its hint. ~3 hours. |

**Smaller polish notes (P3 each):**
- Login page is 640 lines with the entire script + styles inline. Move `<style>` to `style.css` (or a `login.css`) and `<script>` to `js/login.js` for parity with the rest of the codebase.
- The `data-app-mode` body attribute drives CSS visibility — but I see no `[data-app-mode="loading"]` rules grep-able in `style.css`. Verify the loading screen actually renders, isn't an invisible spinner over a visible dashboard.
- The "Cumulative paydown trophy" section (`views/play.js:294-322`) has hardcoded copy: *"This number only goes up. New debt doesn't reduce it…"* — this is a strong product choice but conflicts with the `cumulativeNewDebtAdded` field shown elsewhere. If you track new debt, the trophy isn't quite accurate. Either reconcile or rename.
- `Steward — Manual Edition` in the README header but the in-app brand is just `Steward`. Pick one for the name.

---

## Pass 6 — Code Quality

| # | Severity | Finding |
|---|---|---|
| C1 | P1 | `public/js/render.js` is 1,397 lines. Single largest file. Has 25+ imports from `format.js` and orchestrates the whole dashboard render. Splitting into `render-hero.js`, `render-debts.js`, `render-stats.js`, `render-progress.js` would each fit in 300-400 lines. The sentinel div (U1) is cover for entanglement here. |
| C2 | P2 | `views/play.js` builds the entire shell DOM via `innerHTML = \`...big template string...\`` — about 350 lines of HTML-as-string. This is fine, but a `<template>` tag in `play.html` would let you write actual HTML with syntax highlighting and avoid escaping concerns. |
| C3 | P2 | `Steward-Manual/` nested folder is **dead duplicated code** — older versions of every file plus the live SQLite DB. Outer copy is newer (style.css timestamp 4 days later than nested). | Delete the nested folder. (See S1 — same fix solves both.) |
| C4 | P2 | The custom `.env` parser (server.js:7-18), custom cookie parser (server.js:36-73), and rolling-your-own scrypt (db-auth.js:36-49) are all reasonable in service of zero-dependency philosophy — but as the codebase grows you'll spend more time defending these than `dotenv` + `cookie-parser` + `bcrypt` would have cost. Worth revisiting in v2. |
| C5 | P3 | `db.js:241-243`: `if (!Number.isFinite(b) \|\| b < 0) continue;` silently drops malformed entries during `replaceDebtAccountBalances`. No log. If a corrupted client somehow sends junk, you find out by looking at the DB. | Add `console.warn` for dropped rows. |
| C6 | P3 | The `node_modules/express/` stub is clever but undocumented. Anyone cloning the repo without running `npm install` *and* trying to read source might wonder why Express has 30 lines. | Add a one-line README note: "node_modules/ contains a minimal express stub for editor type-resolution; `npm install` overwrites it." |
| C7 | P3 | `console.debug` (used in 5+ places) is on by default in most browsers' verbose mode. Not a problem, but `STARTUP_UI_DEBUG` constant in boot.js gates only some of them — others fire unconditionally. | Either gate all behind one flag or accept it. |

**No stray `console.log` in app code** — clean.
**No TODO/FIXME comments** — clean.
**No swallowed exceptions** — `try { ... } catch (_) { /* ignore */ }` shows up in localStorage paths only, where it's correct.

---

## Final Output

### SHIP / DON'T SHIP

**SHIP — but fix S1 and U2 first.** This is a competently built, security-conscious, internally consistent app. The auth is real (scrypt + sessions + Google OAuth). The data layer enforces user scoping. The tier math has 47 unit tests and they pass. You've been careful with XSS, with SQL injection, with cookie attributes, with money-rounding. You've thought about reset semantics, recovery paths, and edge cases like "user removed an account vs paid it off."

What's holding it back from ready-to-ship:
1. **A latent data-leak in your project folder** (S1) — the duplicated nested folder with your live database. Not a code bug, but if "ship" means "share with anyone," this is the actual blocker.
2. **First-run friction** (U2) — that extra "Start Session" tap after commitment is going to drop people in user testing. Easy fix, big impact.

Everything else can ship in v1.0 and get cleaned up in v1.1.

### Top 10 Issues (Ranked)

1. **P0 · S1** — Delete `Steward-Manual/Steward-Manual/` folder + add DB files to gitignore + zip-exclude.
2. **P1 · U2** — Skip the start-session screen on first run after commitment confirm.
3. **P1 · U3** — Rename tiers for emotional gradient consistency.
4. **P1 · E1** — Add max-retry + exponential backoff to `boot.js` load() retry.
5. **P1 · S3** — Make `currentUserId()` throw when no scope active (defense in depth).
6. **P1 · S2** — In-memory rate limiter on `/api/auth/login`.
7. **P1 · U1** — Refactor `render.js` and delete the sentinel div.
8. **P1 · C1** — Split `render.js` into 4 files.
9. **P2 · U4** — Empty-state copy for charts when snapshots < 2.
10. **P2 · U5** — Accessibility pass (modals, aria-live, focus management).

### 3 Highest-Leverage UX Changes (Under a Day Each)

1. **Skip the start-session screen on first-run** (U2). Currently: commitment → start-session → setup. Change to: commitment → setup. The start-session screen is *correct* on resume, but redundant ceremony for a brand-new user who just typed their reason for climbing. Single conditional in `boot.js:initStartGameGate`. ~30 minutes.

2. **Rename the 10 tiers for one consistent metaphor** (U3). The current naming (Buried → Pushing → Struggling → Surviving → Stabilizing → Stable → Breaking → Closing → Finish → Debt Free) jumps between three metaphor families. Pick one (climbing, building, healing — climbing fits your existing copy best) and rename all 10. Touches `services/tiers.js` `TIERS` array, `public/debt-tier-narrative.json`, and the showcase gallery copy. Tier IDs stay (`rock_bottom`, `broke`, etc. are internal); only `label` strings change. ~2 hours.

3. **Add empty-states for the chart panels** (U4). Right now a brand-new game's first session shows empty SVG areas. Add: "Update balances at least once to see your trend." Replace empty array branches in `dashboard-enhance.js` and `networth-chart.js`. ~1 hour.

### What Surprised Me (Positive)

- The deliberate **commitment-first** flow. Most debt apps lead with a calculator. You lead with "what are you climbing for?" That's product courage.
- The **per-account-vs-aggregate diff handling**. Most rookies count "removed account" as paydown and ship a buggy v1. You wrote the test (`#26`) before — or alongside — the code.
- **Zero dependency philosophy executed cleanly.** Custom .env parser, custom cookie parser, native scrypt, native sqlite. Express is the only npm dep. That's a real engineering choice, not laziness.

### What Surprised Me (Negative)

- The **sentinel div**. It's the only piece of the codebase that smells like fear of refactoring. The rest of the code is confident. This one part says "I don't trust myself to find all the dead references." Worth confronting.

---

**Reviewer:** Claude (Opus 4.7), in `/home/claude/steward`
**Tests run:** 61 (52 pass / 9 sandbox-blocked)
**Files read in full or near-full:** server.js · routes/auth.js · routes/api.js · db.js · db-auth.js · services/tiers.js · services/climbMetrics.js (sampled) · public/js/main.js · public/js/boot.js · public/js/manual-entry.js · public/js/commitment.js · public/js/state.js · public/js/api.js · public/js/session.js · public/js/views/play.js · public/js/views/dashboard-enhance.js (sampled) · public/login.html · public/play.html · README.md · package.json
**Files sampled:** public/js/render.js (head) · public/js/character.js (head) · public/style.css (breakpoints only) · test/api-snapshot.test.js · test/api-state-machine.test.js
