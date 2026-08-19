# Steward — Branch-by-Branch Breakdown

---

## 1. `devin/1776755384-repo-cleanup` (PR #1 — MERGED)

### Files changed
- `README.md` — rewritten from 2 lines to 93 lines
- `.gitignore` — added `*.db` (SQLite files)
- `LOCAL-LINKS.md` → moved to `docs/LOCAL-LINKS.md`
- `docs/local-servers-ports-and-api.md` — updated path reference from `LOCAL-LINKS.md` to `docs/LOCAL-LINKS.md`
- `docs/start-game-onboarding-entry-map.md` — same path fix
- 8 screenshot PNGs — moved from repo root to `docs/screenshots/`

### Logic changed
None. Zero code changes.

### User-visible behavior changed
None.

### Risks / regressions
- If any external tooling or bookmarks referenced the old root-level `LOCAL-LINKS.md` path, they'd break. Low risk — internal dev doc only.

### Type: **Structural**

---

## 2. `devin/1776757307-rebuild-app-js-modules` (PR #2 — MERGED)

### Files changed
- `public/app.js` — **deleted** (3,463 lines)
- `public/index.html` — changed `<script src="app.js">` to `<script src="js/main.js" type="module">`
- `public/play.html` — same script tag update
- `public/showcase.html` — same script tag update
- `public/steward-vnext.html` — same script tag update
- **14 new files created** in `public/js/`:
  - `api.js` (66 lines) — `stewardApiUrl()`, `stewardPublicOriginHint()`, `readJsonRes()`, `readBrokerageRes()`
  - `boot.js` (284 lines) — `AppMode` enum, `startPlayGame()`, `load()`, `manualRefresh()`, `setBootErrorMessage()`
  - `character.js` (542 lines) — CSS injection, optical offsets, character state maps, `mountHeroCharacter()`, `mountStartScreenSteward()`
  - `commitment.js` (116 lines) — `readPromiseMadeFlag()`, `openCommitmentGate()`, `initPlayResetBtn()`, `resetPlayGame()`
  - `format.js` (565 lines) — all number/dollar/date/runway/gap formatters, tooltip constants, `roundMoney()`, `fmtDollar()`, `formatDebtGapHeadline()`
  - `layout.js` (319 lines) — `upgradeDashboardLayout()`, `applyDashboardTheme()`, `renderTierRail()`, `setupHeroInteraction()`
  - `main.js` (45 lines) — entry point, detects shell type, calls `initDashboardBoot()` or `mountPlayShell()`
  - `onboarding.js` (597 lines) — guided tour system, spotlight overlays, `startDashboardOnboarding()`, `installDashboardHowItWorksButton()`
  - `render.js` (733 lines) — main render orchestration, `render(status, snapshots, brokerage)`, all DOM updates for hero/progress/board
  - `session.js` (191 lines) — `readSessionMeta()`, `writeSessionMeta()`, `startPlaytimeTracking()`
  - `shell.js` (25 lines) — `currentShell()`, `getDashboardRoot()`, `isClassicDashboardDoc()`, `isPlayDashboardDoc()`
  - `tiers.js` (38 lines) — tier definitions array, `tierById()`, `debtTierBandBarDisplay()`, `syncDebtTierBandDebugOverlay()`
  - `format.js` also contains `WEALTHY_EXPOSED_HERO_PRIMARY` constant

### Logic changed
None. Every function was cut from `app.js` and pasted into a module with `export` added. No logic was altered.

### User-visible behavior changed
None. Same UI, same behavior.

### Risks / regressions
- ES module `import`/`export` requires `type="module"` on script tags. If any HTML file missed the update, it would fail to load. All 4 HTML files were updated.
- `app.js` exposed many functions as `window.*` globals. `main.js` re-exposes the ones needed by inline HTML event handlers (`window.stewardApiUrl`, `window.debtTierBandBarDisplay`, etc.). If a global was missed, an `onclick` handler in HTML would throw.
- Unicode smart quotes (U+2019) in tiers.js were initially corrupted during extraction — fixed in commit `22d04c3`.
- Duplicate `OPTICAL_OFFSETS` and `DEFAULT_VARS` constants in character.js — fixed in commit `e74cf27`.

### Type: **Structural (refactor)**

---

## 3. `devin/1776766739-remake-migration-v2` (PR #3 — MERGED)

### Files changed
- `public/play.html` — gutted from 600-line static HTML to 12-line minimal shell with `<div id="app-root"></div>`
- `public/_archive/pre-remake/play.html` — archived original (607 lines)
- `public/js/views/play.js` — **new** (295 lines). JS-builds the entire Play shell DOM: commitment screen, top nav, hero section, journey/sentinel/climb blocks, financial board, data strip, start game screen.
- `public/js/state.js` — **new** (54 lines). `AppMode` enum (`INIT`, `COMMITMENT`, `LOADING`, `READY`), `transitionTo()`, `isSessionResume()`
- `public/js/template-loader.js` — **new** (26 lines). Fetches and caches `steward-template.html` (character SVGs)
- `public/steward-template.html` — **new** (303 lines). Character SVG templates extracted from old play.html
- `.gitignore` — added `*.db-journal`, `*.db-wal`
- `public/js/boot.js` — refactored to use `state.js` imports (`AppMode`, `transitionTo`, `isSessionResume`). Removed duplicated `AppMode` enum that was inline. Removed `isPlayDashboardDoc()` guard on onboarding.
- `public/js/main.js` — added play shell mounting: if `shell === 'play'`, calls `mountPlayShell(root)` to build DOM via JS. Classic/vNext still use static HTML.
- `public/js/shell.js` — detection changed: `/play` detected by URL path (not DOM ID), classic/vnext still use DOM-based detection
- `public/js/onboarding.js` — import path fix for `DASHBOARD_ONBOARDING_KEY`
- `public/js/commitment.js` — export added for `DASHBOARD_ONBOARDING_KEY`
- `public/js/character.js` — added window global for `stewardTierFlow`

### Logic changed
- **Play shell DOM is now JS-built.** Instead of the browser parsing 600 lines of static HTML, `views/play.js` constructs every element programmatically using an `el()` helper. Same IDs, same classes, same structure — but built at runtime.
- **State machine introduced.** `state.js` manages app mode transitions: `INIT → COMMITMENT → LOADING → READY`. `transitionTo()` logs transitions and sets `document.body.dataset.stewardMode`.
- **Template loading.** Character SVGs moved from inline HTML to a separate `steward-template.html` fetched asynchronously and injected into `<body>`.
- **Shell detection.** `/play` is detected via URL path (`window.location.pathname`), not by checking for `#dashboard-play` in the DOM (since the DOM doesn't exist yet when detection runs).

### User-visible behavior changed
None directly — same UI renders. But the page load sequence changed: blank `#app-root` → JS builds DOM → content appears. No visible flash because the loading screen covers it.

### Risks / regressions
- If `views/play.js` has a bug building any element, that section silently won't appear (no static HTML fallback).
- Character template fetch (`steward-template.html`) is a new network request. If it 404s or is slow, characters won't render.
- The `el()` helper sets attributes via `setAttribute()` — if `innerHTML` is passed, it uses `setAttribute('innerHTML', ...)` which doesn't work. The code handles this with a special case check, but it's fragile.

### Type: **Structural (architecture change)**

---

## 4. `devin/1776777367-consolidation-phase1` (PR #4 — OPEN)

### Files changed (unique to this branch, on top of merged main)
- `server.js` — changed `/` route from serving `steward-vnext.html` to serving `play.html`. Added `/play` and `/play/` aliases. Classic and vNext still served at their routes.
- `docs/LOCAL-LINKS.md` — updated to show `/` as "Main (Play)" instead of "vNext home"
- `docs/local-servers-ports-and-api.md` — route table updated to show `/` → `play.html`

### Logic changed
- **`server.js`:** The root URL `/` now serves `play.html` (the JS-built Play shell) instead of `steward-vnext.html`. Previously `/` was the vNext shell, `/play` was the Play shell. Now both serve the same thing. `/classic` and `/steward-vnext` still serve their own HTML files.

### User-visible behavior changed
- **Visiting `localhost:3000/` now shows the Play shell** (with commitment screen, JS-built hero, etc.) instead of the vNext static dashboard. This is the primary user-facing change.
- Users who bookmarked `/` expecting vNext would see a different UI.

### Risks / regressions
- Any user or script that expected `/` to serve `steward-vnext.html` would get a different page.
- The nav still had a link to `/classic` and `/steward-vnext` — fixed in commit `bfc7a21` (Devin Review finding: stale nav link pointing to non-primary route).

### Type: **Behavioral (routing change)**

---

## 5. `devin/1776816963-behavior-hardening` (PR #5 — OPEN, stacked on #4)

### Files changed (unique to this branch, on top of PR #4)
- `services/tiers.js` — `getTier()` and `roundMoney()` functions
- `services/climbMetrics.js` — `debtTierBandProgress()` and `debtTierJourneyProgress()`
- `routes/api.js` — `/api/status` endpoint
- `public/js/format.js` — `WEALTHY_EXPOSED_HERO_PRIMARY` constant
- `public/js/render.js` — `fillProgressNarrative()` function
- `public/js/views/play.js` — DOM element addition

### Logic changed

1. **`services/tiers.js` — `getTier()` NaN guard:**
   - Before: `getTier(NaN)` or `getTier(null)` fell through all tier ceiling checks (all return false for NaN comparisons) and hit the final return — `wealthy`. A user with corrupted data would appear as tier "Wealthy".
   - After: Early return `rock_bottom` if input is not a finite number.

2. **`services/tiers.js` — `roundMoney()` NaN guard:**
   - Before: `roundMoney(NaN)` returned `NaN`, which propagated into display strings like `$NaN`.
   - After: Returns `0` for non-finite inputs.

3. **`services/climbMetrics.js` — progress bar baseline fix:**
   - Before: `debtTierBandProgress(debt, tier, snapshots, 0)` used `0` as baseline. For users above Rock Bottom's ceiling ($25,000), progress within their tier band showed 0% because the math divided by the tier's range starting from 0.
   - After: Uses `max(tierCeiling, climbBaselineDebt)` as the effective ceiling, so the progress bar reflects actual movement within the tier.

4. **`routes/api.js` — `debtDirection` field:**
   - Added: Compares `snapshots[0].debt_remaining` vs `snapshots[1].debt_remaining`. Returns `'decreasing'`, `'increasing'`, `'stable'`, or `'unknown'`.
   - Added `stats.debtDirection` to the `/api/status` response payload.

5. **`public/js/render.js` — debt direction warning:**
   - Added: If `stats.debtDirection === 'increasing'`, shows "Debt moved up this period." in a `#progress-debt-direction` element.

6. **`public/js/format.js` — messaging softening:**
   - Before: `WEALTHY_EXPOSED_HERO_PRIMARY` = `'Debt is at zero. Breathing room is still thin — your safety buffer is not fully built yet.'`
   - After: `'No debt. Thin cushion — protect the win.'`

### User-visible behavior changed
- Users with NaN/null debt data no longer incorrectly appear as "Wealthy" tier — they show as "Rock Bottom"
- `$NaN` strings no longer appear in the UI
- Progress bars no longer stuck at 0% for users above Rock Bottom ceiling
- New message "Debt moved up this period." appears when debt increased between snapshots
- Wealthy+Exposed hero message is shorter and less alarming

### Risks / regressions
- `getTier(NaN) → rock_bottom` means corrupted data shows the worst tier. This is intentional (fail-safe) but could alarm a user whose data is temporarily corrupted.
- `roundMoney(NaN) → 0` silently hides data issues. A `$0` display when the real value is unknown could be misleading.
- The `debtDirection` comparison only looks at the two most recent snapshots. If there's a stale snapshot, the direction might reflect an old time period.

### Type: **Behavioral (logic fixes)**

---

## 6. `devin/1776817467-behavior-features` (PR #6 — OPEN, stacked on #5)

### Files changed (unique to this branch, on top of PR #5)
- `public/js/boot.js` — 70 lines added (notification system)
- `public/js/render.js` — 39 lines added (streak + breathing room display)
- `public/js/views/play.js` — 2 elements added to hero section DOM
- `public/style.css` — 14 lines added (streak + alert styles)
- `routes/api.js` — 38 lines added (notifications endpoints + streak in status)
- `services/climbMetrics.js` — 50 lines added (`computeStreak()` function)

### Logic changed

1. **`services/climbMetrics.js` — `computeStreak(snapshots)`:**
   - New function. Walks snapshots newest-to-oldest. Each consecutive pair where `debt_remaining` decreased counts as one streak period.
   - Returns `{ current, best, lastBrokenAt }`. `current` is the active streak (0 if latest period didn't decrease). `best` is the all-time longest streak. `lastBrokenAt` is the timestamp when the current streak broke.
   - Exported and called from `/api/status`.

2. **`routes/api.js` — streak in `/api/status`:**
   - Calls `computeStreak(snapshots)` and adds `streak: { current, best, lastBrokenAt }` to the response payload.

3. **`routes/api.js` — `GET /api/config/notifications-sent`:**
   - New endpoint. Reads `notifications_sent` key from app config (SQLite). Returns `{ sent: [...] }` — an array of milestone keys already fired.
   - Includes `Array.isArray` guard: if stored JSON parses to a non-array, returns `[]`.

4. **`routes/api.js` — `POST /api/config/notifications-sent`:**
   - New endpoint. Accepts `{ milestone: "pct_25" }`. Appends to the stored array if not already present. Deduplicates.
   - Same `Array.isArray` guard on stored data.

5. **`public/js/boot.js` — milestone notification system:**
   - `loadNotificationsSent()` — fetches sent milestones from server, caches in memory.
   - `markMilestoneSent(milestone)` — POSTs to server, updates cache only if `res.ok`.
   - `fireNotification(title, body)` — triggers browser `Notification` API. Requests permission if not yet granted.
   - `checkPayoffMilestones(status)` — called after each `render()`. Checks if `pctPaid` crossed 25/50/75/90 thresholds or tier changed. Fires browser notification + records to server.
   - Thresholds and messages:
     - `pct_25`: "25% paid. You're moving."
     - `pct_50`: "50% paid. You're not the same person who started this."
     - `pct_75`: "75% paid. The end is real now."
     - `pct_90`: "90% paid. Almost there. Don't stop."
     - Tier change: "New tier reached: {label}. Keep moving."

6. **`public/js/render.js` — streak display:**
   - If `streak.current > 0`: shows "🔥 X-period streak"
   - If `streak.current === 0 && streak.best > 0`: shows "You broke a X-period streak. Start a new one."
   - Otherwise: hidden.

7. **`public/js/render.js` — breathing room alert:**
   - Computes `breathingRoomPct = (effectiveRunwayMonths / breathingRoomGoalMonths) * 100`.
   - If this value dropped since last render AND is below 100%: shows "Your breathing room shrank this period. Runway: X months (goal: Y months)".
   - Tracks `lastRenderedBreathingRoomPct` across renders.

8. **`public/js/views/play.js` — DOM elements:**
   - Added `<p id="streak-line">` and `<p id="breathing-room-alert">` to hero section, after `hero-desc`.

9. **`public/style.css` — styles:**
   - `.streak-line`: font-weight 600, `var(--ink-700)` color
   - `.breathing-room-alert`: font-weight 600, red (`var(--red-700, #b91c1c)`) color

### User-visible behavior changed
- **Streak counter** appears below the hero description: "🔥 3-period streak" or "You broke a 2-period streak. Start a new one."
- **Breathing room alert** appears in red when runway shrinks: "Your breathing room shrank this period."
- **Browser notifications** fire at 25/50/75/90% paid and on tier changes. One-time per milestone (server-side dedup).

### Risks / regressions
- Browser notifications require user permission. If denied, notifications silently don't fire.
- The breathing room alert only fires when the value *decreases between renders* (same page session). If you close and reopen the app, the drop isn't detected because `lastRenderedBreathingRoomPct` resets to null.
- Streak display uses `best` (all-time longest) in the "broken" message, not the length of the streak that was actually just broken. (Fixed in PR #7.)
- `notificationsSentCache` permanently caches `[]` on fetch failure, preventing retry. (Fixed in PR #7.)

### Type: **Behavioral (3 new features) + Visual/UI (2 new UI elements)**

---

## 7. `devin/1776819459-consolidate-responsive` (PR #7 — OPEN, stacked on #6)

### Files changed (unique to this branch, on top of PR #6)
- `server.js` — routing overhaul (redirects)
- `public/js/shell.js` — simplified shell detection
- `public/js/main.js` — dark mode + init fallback
- `public/js/boot.js` — first-boot sentinel + cache fix + onboarding button call
- `public/js/onboarding.js` — deferred button install
- `public/js/render.js` — net worth chart (~170 lines) + streak fix
- `public/js/views/play.js` — absorbed all vNext sections + new nav + dark mode toggle
- `public/play.html` — added steward-vnext.css and steward-vnext.js script/link tags
- `public/style.css` — responsive breakpoints (920/620/380px) + dark mode CSS vars + net worth chart styles (~340 lines added)
- `public/steward-vnext.css` — dark mode overrides for all vNext-origin sections (~238 lines added). Fixed selectors from `#dashboard-play` to `#dashboard-vnext`.
- `public/steward-vnext.js` — removed vnext-specific init (now handled by main.js)
- `routes/api.js` — `netWorthHistory` array added to `/api/status`
- `services/climbMetrics.js` — `lastBroken` field + broken-streak detection fix
- `docs/LOCAL-LINKS.md` — updated to reflect redirects
- `docs/local-servers-ports-and-api.md` — route table + architecture table updated

### Logic changed

1. **`server.js` — route consolidation:**
   - Before: `/classic` → `index.html`, `/steward-vnext` → `steward-vnext.html`, `/merged` → `steward-vnext.html`
   - After: `/classic`, `/steward-vnext`, `/merged`, `/dashboard-merged` all → `res.redirect('/')`. Only `/` serves `play.html` and `/showcase` serves `showcase.html`.
   - The old HTML files (`index.html`, `steward-vnext.html`) still exist in `public/` (served by `express.static` if accessed directly as `.html`), but no routes point to them.

2. **`public/js/shell.js` — simplified detection:**
   - Before: `currentShell()` returned `'classic'`, `'vnext'`, `'showcase'`, or `'play'` based on URL path matching.
   - After: Returns `'showcase'` for `/showcase`, `'play'` for everything else.
   - `isClassicDashboardDoc()` → always returns `false`
   - `isClassicLayoutDashboardDoc()` → always returns `false`
   - `getDashboardRoot()` — reordered: checks `#dashboard-vnext` first (was last)

3. **`public/js/main.js` — dark mode:**
   - New `initDarkMode()` function. Reads `localStorage.getItem('steward-dark-mode')`. If `'true'`, adds `dark` class to `<html>`. 
   - Creates click handler on `#dark-mode-toggle` button: toggles `dark` class, saves to localStorage, updates button text (☾ ↔ ☀) and `aria-label`.
   - Sets `document.documentElement.style.colorScheme` to `'dark'` or `'light'`.

4. **`public/js/main.js` — init fallback:**
   - Before: If `shell === 'play'` and `#app-root` doesn't exist, `init()` returned silently (dead end for steward-vnext.html accessed directly).
   - After: Falls through to `initDashboardBoot()` if `getDashboardRoot()` exists.

5. **`public/js/main.js` — removed classic/vnext branching:**
   - Removed: Title differentiation (`'Steward | The climb (preview)'` vs `'Steward | Financial Dashboard'`). Now always `'Steward'`.
   - Removed: Reset URL param handling in classic/vnext branch (now handled only in play branch).
   - Removed: Loading text override for classic/vnext.

6. **`public/js/boot.js` — first-boot sentinel:**
   - Before: `if (sent.length === 0)` detected first boot. But for a user starting at rock_bottom/0% paid, `toSeed` was empty, nothing stored, and subsequent loads re-entered the seed path — silently marking new milestones as sent without ever firing notifications.
   - After: `if (!sent.includes('__initialized'))` detects first boot. `'__initialized'` is always stored (even if no milestones qualify for seeding), so subsequent loads take the normal notification path.

7. **`public/js/boot.js` — cache failure fix:**
   - Before: `loadNotificationsSent()` set `notificationsSentCache = []` on fetch failure, permanently preventing retries.
   - After: Returns `[]` without caching, so next call retries the fetch.

8. **`public/js/boot.js` — onboarding button timing:**
   - Before: `installDashboardHowItWorksButton()` called at module load time in `onboarding.js` — before `mountPlayShell()` built the DOM. Button never appeared because `document.body` didn't have the expected elements yet.
   - After: Called from `boot.js` after `load()` succeeds and DOM is built.

9. **`public/js/render.js` — net worth chart:**
   - New `renderNetWorthClimb(history)` function (~170 lines). Builds an SVG chart programmatically:
     - Polyline showing net worth over time (green gradient fill)
     - Data dots at each snapshot
     - Grid lines (3 horizontal)
     - Zero-line reference (if range crosses zero)
     - Y-axis labels in `$Xk` format
     - X-axis labels (first and last date as `M/D`)
     - Legend: "Current: $X" and "Change: +$Y" (green for up, red for down)
   - Falls back to "Need at least 2 snapshots" message if < 2 data points.
   - Called from `render()` with `status.netWorthHistory`.

10. **`public/js/render.js` — streak message fix:**
    - Before: "You broke a X-period streak" used `streak.best` (all-time longest).
    - After: Uses `streak.lastBroken` (the length of the most recently broken streak).

11. **`routes/api.js` — `netWorthHistory`:**
    - Sorts snapshots oldest-first. Maps to `{ date, netWorth, totalAssets, totalDebt }`.
    - Net worth computed as `total_assets - total_debt` (YNAB-only, no brokerage overlay — keeps historical values consistent).
    - Added to `/api/status` response payload.

12. **`services/climbMetrics.js` — `lastBroken` field:**
    - `computeStreak()` now returns `{ current, best, lastBroken, lastBrokenAt }`.
    - `lastBroken`: If current streak is 0 and the break happened at the most recent period (i=0), scans forward to find the length of the streak that was just broken. Fixes the bug where `lastBroken` was always 0 when the latest period showed a debt increase.

13. **`public/js/views/play.js` — vNext section absorption:**
    - Hero section: changed nav from `classic-top-nav` to `vnext-top-nav`. Added dark mode toggle button. Removed links to `/classic` and `/steward-vnext`.
    - Absorbed sections now built in JS that were previously in `steward-vnext.html` static HTML:
      - Explore the Climb gallery (10 tier cards with character art)
      - Journey panel with stage progress
      - Today nudge / Next move
      - Financial board with breathing room metrics
      - Sync checkpoints
      - Data strip
      - Net worth climb chart container
    - All character x-offsets zeroed for centering in gallery cards.

14. **`public/style.css` — responsive layout:**
    - `@media (max-width: 920px)`: Nav stacks, sections reduce padding, gallery cards shrink
    - `@media (max-width: 620px)`: Full-width buttons, data strip stacks vertically, tighter spacing
    - `@media (max-width: 380px)`: Single-column health grid, smaller card frames, min font sizes

15. **`public/style.css` + `public/steward-vnext.css` — dark mode:**
    - `html.dark` selector overrides CSS custom properties: backgrounds to deep forest greens (`#0d1f14`, `#132a19`), text to light (`#e8f0eb`), borders to dark green (`#1a3d24`).
    - Covers: hero card, climb gallery cards, journey panel, financial board, checkpoints, data strip, commitment screen, start game screen, nav, buttons, inputs, badges, progress bars, tier rail.
    - 9 selectors in `steward-vnext.css` updated from `#dashboard-play` to `#dashboard-vnext` (old ID no longer exists in consolidated DOM).

### User-visible behavior changed
- **One app at `/`.** No more `/classic` or `/steward-vnext` — they all redirect to `/`. Every section (hero, climb gallery, journey, board, checkpoints, data strip) renders in one page.
- **Dark mode.** ☾ button in top-right of nav. Toggles deep forest green dark palette. Persists across sessions via localStorage.
- **Responsive layout.** App works on phones. Three breakpoints handle nav stacking, grid collapse, button sizing, card shrinking.
- **Net worth chart.** "The Real Climb" section shows SVG line chart of (assets - debt) over time with gradient fill, data dots, and change legend.
- **"How this works" button works.** Previously invisible because it was installed before the DOM existed.
- **Character centering.** All 10 tier card characters centered (x-offsets zeroed).
- **Streak message accuracy.** "You broke a X-period streak" now shows the actual recently-broken streak length, not the all-time best.

### Risks / regressions
- **Old HTML shells are dead.** `steward-vnext.html` and `index.html` still exist in `public/` and are technically accessible via `express.static` at their `.html` paths, but they're not routed and may not work correctly (init fallback added to prevent total breakage).
- **CSS scope expansion.** Dark mode + responsive adds ~580 lines of CSS. Any selector typo could break light mode styling.
- **SVG chart is custom-built.** No charting library. If data has unusual values (very large ranges, single data point, all identical values), edge cases could produce visual artifacts. The `range || 1` guard prevents division by zero.
- **`__initialized` sentinel** is stored as a regular milestone string in the notifications-sent array. If server-side code ever validates milestone format (e.g., must start with `pct_` or `tier_`), the sentinel would be rejected.
- **`isClassicDashboardDoc()` always returns `false`.** Any code path that checked this to show classic-specific UI will never trigger. This is intentional but means classic-specific features are permanently disabled, not just hidden.
- **Net worth chart excludes brokerage.** The chart shows YNAB-only net worth (`total_assets - total_debt`). The dashboard's headline `stats.netWorth` includes brokerage investments. These numbers can differ for users with brokerage enabled — the chart may show a lower value than the headline.

### Type: **Behavioral (routing, dark mode, notifications fixes) + Visual/UI (responsive, dark mode, net worth chart, centering) + Structural (shell consolidation)**
