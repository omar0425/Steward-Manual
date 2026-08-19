# Steward Rebuild Plan

Structural and code-quality rebuild. No product design changes, no tier/threshold changes, no tone/copy changes, no new features.

---

## 1. Proposed Folder Structure

### Current

```
Steward/
├── server.js                    (146 lines) — Express entry, routes, boot
├── db.js                        (175 lines) — SQLite helpers
├── package.json
├── .env.example
├── .gitignore
├── LICENSE
├── README.md
├── config/
│   └── brokeragePublic.js       (77 lines)
├── docs/                        (30+ markdown files, screenshots/)
├── routes/
│   └── api.js                   (343 lines)
├── services/
│   ├── tiers.js                 (392 lines)
│   ├── stability.js             (425 lines)
│   ├── climbMetrics.js          (332 lines)
│   ├── brokerage.js             (454 lines)
│   ├── ynab.js                  (393 lines)
│   ├── scheduler.js             (69 lines)
│   ├── debtSyncValidation.js    (106 lines)
│   ├── debtSyncDebugApi.js      (19 lines)
│   └── publicApiClient.js       (117 lines)
├── scripts/                     (test scripts, reset, port resolution)
├── test/                        (5 test files)
├── public/
│   ├── app.js                   (3,463 lines) ← PROBLEM
│   ├── style.css                (3,423 lines) ← large but less critical
│   ├── steward-vnext.js         (831 lines)
│   ├── steward-vnext.css        (1,933 lines)
│   ├── play.html                (607 lines)
│   ├── index.html               (577 lines)
│   ├── steward-vnext.html       (756 lines)
│   ├── showcase.html            (1,657 lines)
│   ├── debt-tier-constants.json
│   ├── debt-tier-narrative.json
│   ├── favicon.svg / favicon.ico
│   └── (no subdirectories)
└── *.bat / *.vbs                (Windows launchers)
```

### Proposed

```
Steward/
├── server.js                      — no change
├── db.js                          — no change
├── package.json
├── .env.example
├── .gitignore
├── LICENSE
├── README.md
├── config/                        — no change
│   └── brokeragePublic.js
├── docs/                          — no change
├── routes/
│   └── api.js                     — no change (343 lines is fine)
├── services/                      — no change (all files are already well-scoped)
│   ├── tiers.js
│   ├── stability.js
│   ├── climbMetrics.js
│   ├── brokerage.js
│   ├── ynab.js
│   ├── scheduler.js
│   ├── debtSyncValidation.js
│   ├── debtSyncDebugApi.js
│   └── publicApiClient.js
├── scripts/                       — no change
├── test/                          — no change
├── public/
│   ├── js/                        ← NEW: app.js split into focused modules
│   │   ├── main.js                — entry point, auto-init, window exports
│   │   ├── character-styles.js    — character CSS injection (side effect)
│   │   ├── character.js           — STEWARD_STATE, theme vars, mount/build character
│   │   ├── tiers.js               — TIER_FLOW, TIER_META, TIER_INDEX, behavior lines
│   │   ├── shell.js               — getDashboardRoot, isPlayDashboardDoc, etc.
│   │   ├── format.js              — all number/date/dollar/runway/gap formatters
│   │   ├── api.js                 — stewardApiUrl, readJsonRes, readBrokerageRes
│   │   ├── layout.js              — upgradeDashboardLayout, applyDashboardTheme, tier rail
│   │   ├── render.js              — render(), fillProgressNarrative, renderBrokerageFootnote
│   │   ├── onboarding.js          — guided tour (steps, spotlight, positioning)
│   │   ├── session.js             — playtime tracking, session meta, foreground accrual
│   │   ├── commitment.js          — first-run promise gate, play reset
│   │   └── boot.js                — APP_MODE, setAppMode, initStartGameGate, load(), initDashboardBoot, manualRefresh
│   ├── css/                       ← OPTIONAL: split style.css (see §2.2)
│   │   └── (only if approved)
│   ├── play.html                  — updated script tag only
│   ├── index.html                 — updated script tag only
│   ├── steward-vnext.html         — updated script tag only
│   ├── steward-vnext.js           — no change (831 lines, already scoped)
│   ├── steward-vnext.css          — no change
│   ├── style.css                  — no change unless CSS split approved
│   ├── showcase.html              — no change
│   ├── debt-tier-constants.json   — no change
│   ├── debt-tier-narrative.json   — no change
│   └── favicon.svg / favicon.ico
└── *.bat / *.vbs                  — no change
```

**Key changes:**
- `public/app.js` (3,463 lines) → `public/js/` directory with 13 focused modules
- HTML files: `<script src="app.js">` → `<script type="module" src="js/main.js">`
- Server-side code: untouched (already well-organized)
- All other files: untouched

---

## 2. How app.js Will Be Broken Down

### 2.1 Module Map

Each module below shows: line range from current app.js, approximate size, what it contains, and what it exports.

---

#### `character-styles.js` (~443 lines)

**Current lines:** 1–443

**Contains:**
- The IIFE that injects a `<style>` element with all Steward character CSS (body parts, poses, animations, per-tier visual effects like sparkles, monocle glow, coin shower, race car)

**Exports:** None (side effect only — importing this module injects the stylesheet)

**Why separate:** This is pure CSS injected via JS. It's the single largest block in app.js and never changes unless the character visual design changes. Isolating it means you never have to scroll past 443 lines of CSS to find logic.

---

#### `character.js` (~100 lines)

**Current lines:** 447–478, 549–570, 887–908, 3044–3057

**Contains:**
- `STEWARD_STATE` — per-tier CSS variable overrides (object mapping tier id → CSS vars)
- `OPTICAL_OFFSETS` — per-card centering nudges
- `DEFAULT_VARS` — base CSS custom properties
- `applyStewardTheme(wrap, stateId)` — applies tier-specific CSS vars to a character element
- `buildSteward(stateId)` — clones and configures a character from the HTML template
- `mountHeroCharacter(stateId)` — mounts the character into the hero section
- `mountStartScreenSteward()` — mounts the character on the Start Game overlay

**Exports:** `STEWARD_STATE`, `applyStewardTheme`, `buildSteward`, `mountHeroCharacter`, `mountStartScreenSteward`

**Imports from:** `tiers.js` (TIER_META), `shell.js` (getDashboardRoot)

---

#### `tiers.js` (~40 lines)

**Current lines:** 481–518

**Contains:**
- `TIER_FLOW` — the 10-tier array with id, badge, label, phase, cue, color palette
- `TIER_META` — lookup by tier id
- `TIER_INDEX` — lookup tier → position index
- `TIER_BEHAVIOR_LINE` — one behavioral directive per tier
- `tierBehaviorLine(tierId)` — safe accessor

**Exports:** `TIER_FLOW`, `TIER_META`, `TIER_INDEX`, `tierBehaviorLine`

**Imports from:** Nothing (leaf module, no dependencies)

**Note:** The tier definitions, thresholds, names, copy, and colors stay **byte-for-byte identical**. This module is a direct extract, not a rewrite.

---

#### `shell.js` (~30 lines)

**Current lines:** 525–546

**Contains:**
- `getDashboardRoot()` — returns whichever dashboard element exists (#dashboard, #dashboard-vnext, #dashboard-play)
- `isClassicDashboardDoc()` — true if #dashboard exists
- `isPlayDashboardDoc()` — true if #dashboard-play exists
- `isClassicLayoutDashboardDoc()` — true if classic OR play (same hero shape)

**Exports:** `getDashboardRoot`, `isClassicDashboardDoc`, `isPlayDashboardDoc`, `isClassicLayoutDashboardDoc`

**Imports from:** Nothing (DOM queries only)

---

#### `format.js` (~370 lines)

**Current lines:** 913–1200, 1253–1296, 1354–1500, 1570–1591

**Contains:** All formatting and display utility functions:
- `formatRunway()`, `fmt()`, `fmtDollar()`, `fmtSignedDollar()`, `fmtDate()`, `timeAgo()`
- `formatNextTierGapHeadline()`, `formatNextTierGapBoardAmount()`, `formatNextTierGapMoneyPrefix()`
- `resolveTierLabelForEscapeHeadline()`
- `resolveBreathingRoomGoalState()`, `formatHeroBreathingRoomLine()`, `formatBoardRunwayHelperLine()`
- `liquidityGuardExplanation()`, `buildLiquidityPillTooltip()`
- `formatNetWorthValue()`, `formatPaidDownDisplay()`, `nextMoveGuidance()`
- `roundDebtTierBandPctClient()`, `debtTierBandDisplayPct()`, `debtTierBandBarDisplay()`
- `syncDebtTierBandDebugOverlay()` (debug query param — kept but flagged)
- Snapshot analysis: `snapshotPaydownWindow()`, `snapshotPaceIsNoisy()`, `snapshotDeltaSinceOldest()`, `paceQualitative()`
- Climb: `cumulativePaidDownFromStats()`, `lifetimeProgressPctFromCumulative()`, `formatClimbNetChangeDollars()`
- Account rows: `formatLastPullAccountRow()`, `formatNetThisTurnLine()`, `lastPullAccountRowsFromStats()`
- `paidDownDetailTooltip()`
- Tooltip constants: `TOOLTIP_ASSET_RUNWAY_YNAB`, `TOOLTIP_LIQUID_CUSHION_RUNWAY`, `CUMULATIVE_PROGRESS_SUBTEXT`
- `WEALTHY_EXPOSED_HERO_PRIMARY` constant

**Exports:** All of the above

**Imports from:** `tiers.js` (TIER_FLOW, TIER_META)

---

#### `api.js` (~80 lines)

**Current lines:** 1266–1290, 3145–3184

**Contains:**
- `stewardApiOrigin()` — resolves API base URL (supports cross-origin dev via `window.__STEWARD_API_ORIGIN__` or meta tag)
- `stewardPublicOriginHint()` — user-facing base URL for hints
- `stewardApiUrl(resourcePath)` — builds full API URL
- `readJsonRes(res, label)` — reads fetch response as JSON with error handling
- `readBrokerageRes(res)` — reads brokerage response with graceful fallback

**Exports:** `stewardApiOrigin`, `stewardPublicOriginHint`, `stewardApiUrl`, `readJsonRes`, `readBrokerageRes`

**Imports from:** Nothing

---

#### `layout.js` (~280 lines)

**Current lines:** 575–600, 602–862

**Contains:**
- `applyDashboardTheme(stateId, stabilityId)` — sets CSS custom properties and data attributes on dashboard root
- `DASHBOARD_LAYOUT_VERSION` constant
- `upgradeDashboardLayout()` — dynamically creates missing DOM elements (hero pills, context strip, climb summary, tier rail, etc.)
- `renderTierRail(currentId, nextTierId)` — builds the 10-step tier rail
- `setupHeroInteraction()` — hero click/hover behavior

**Exports:** `applyDashboardTheme`, `upgradeDashboardLayout`, `renderTierRail`, `setupHeroInteraction`

**Imports from:** `tiers.js` (TIER_FLOW, TIER_META, TIER_INDEX), `shell.js` (getDashboardRoot, isClassicLayoutDashboardDoc), `format.js` (TOOLTIP_ASSET_RUNWAY_YNAB)

---

#### `render.js` (~620 lines)

**Current lines:** 1297–1352, 1503–1567, 1593–2194

**Contains:**
- `renderBrokerageFootnote(brokerage, stats)` — brokerage section in stats panel
- `fillVnextHeroTurnAccounts(stats)` — vNext turn-by-turn account display (guarded by `#dashboard-vnext`)
- `fillProgressNarrative({...})` — fills progress section DOM (restructure note, stale note, delta, pace, projection, last-pull details)
- `render(status, snapshots, brokerage)` — **the main render function** — writes all data to DOM: hero badge, stability pill, gap headline, stats, progress bar, climb, data strip timestamps, freshness, breathing room

**Exports:** `render`

**Imports from:** `tiers.js`, `shell.js`, `format.js`, `layout.js`, `character.js`

**This is the most import-heavy module** because render() orchestrates everything. All the function calls currently happen through file-level scope; with modules they become explicit imports.

---

#### `onboarding.js` (~590 lines)

**Current lines:** 2196–2787

**Contains:**
- `DASHBOARD_ONBOARDING_STEPS` — 9-step guided tour configuration
- `onboardingResolveDashboardTarget()` — resolves targets within dashboard root
- `dashboardOnboardingState` — active/step/timer state
- `getDashboardOnboardingEls()` — DOM element references
- `DASHBOARD_ONBOARDING_MARKUP` — callout/arrow HTML templates
- `ensureDashboardOnboardingUi()` — creates onboarding overlay elements
- `positionOnboardingCallout()` — positions callout relative to target
- `drawOnboardingConnector()` — SVG arrow between callout and target
- `showOnboardingStep()`, `advanceOnboardingStep()`, `dismissDashboardOnboarding()`
- `startDashboardOnboarding()`, `offerFirstVisitDashboardOnboarding()`
- `installDashboardHowItWorksButton()` — adds "How this works" button (classic/vNext only, not play)

**Exports:** `installDashboardHowItWorksButton`, `offerFirstVisitDashboardOnboarding`, `startDashboardOnboarding`

**Imports from:** `shell.js` (getDashboardRoot, isPlayDashboardDoc)

**Note:** The `if (getDashboardRoot() && !isPlayDashboardDoc()) installDashboardHowItWorksButton()` side-effect at line 2783 moves into `main.js`.

---

#### `session.js` (~190 lines)

**Current lines:** 2789–2979

**Contains:**
- `STEWARD_SESSION_META_KEY` — localStorage key
- `defaultSessionMeta()`, `normalizeSessionMeta()`, `readSessionMeta()`, `writeSessionMeta()`
- `formatDurationClockHMS()` — HH:MM:SS formatting
- `sessionWallSecondsFrom()` — wall-clock seconds since ISO timestamp
- `stewardPlaytime` — single-flight foreground accrual state
- Accrual constants: `MIN_FLUSH_DELTA_MS`, `MAX_FLUSH_DELTA_MS`
- `clearStewardPlaytimeIntervals()`, `applyForegroundAccrual()`
- Visibility/focus listeners: `onPlaytimeVisibility()`, `onPlaytimePageHide()`, `onWindowBlur()`, `onWindowFocus()`
- `shouldAccrueOnForegroundTick()`, `onForegroundAccrualInterval()`
- `updateSessionTimeDisplay()`, `startPlaytimeTracking()`

**Exports:** `startPlaytimeTracking`, `readSessionMeta`, `writeSessionMeta`

**Imports from:** Nothing (pure localStorage + DOM)

---

#### `commitment.js` (~100 lines)

**Current lines:** 3186–3294

**Contains:**
- `STEWARD_PROMISE_MADE_KEY`, `STEWARD_PROMISE_AT_KEY`, `STEWARD_PROMISE_TEXT_KEY`
- `readPromiseMadeFlag()` — checks localStorage for commitment
- `persistPromiseAck(customText)` — saves commitment to localStorage
- `hydrateCommitmentDebtAmount(amountEl)` — fetches debt from API, shows in commitment screen
- `openCommitmentGate(done)` — orchestrates the commitment flow
- `resetPlayGame()` — clears all play-only localStorage/sessionStorage
- `initPlayResetBtn()` — wires up the reset button on play shell

**Exports:** `readPromiseMadeFlag`, `openCommitmentGate`, `resetPlayGame`, `initPlayResetBtn`

**Imports from:** `api.js` (stewardApiUrl, readJsonRes)

---

#### `boot.js` (~250 lines)

**Current lines:** 2986–3042, 3059–3143, 3296–3432

**Contains:**
- `APP_MODE` — mode constants (START, LOADING, READY, ERROR)
- `SESSION_APP_READY_KEY` — sessionStorage key
- `startupBootComplete`, `appMode` — module-level boot state
- `STARTUP_UI_DEBUG` flag (see §3 dead code)
- `logStartupVisibilityDirect()` — debug helper
- `setAppMode(nextMode, reason)` — state machine for app mode transitions
- `safeSessionStorageGet()`, `setBootErrorMessage()`
- `mountStartScreenSteward()` call delegation
- `initStartGameGate()` — Start Game overlay with clock, button, animation
- `initDashboardBoot()` — commitment gate → start gate → load() orchestration
- `load(options)` — fetches /api/status, /api/snapshots, /api/brokerage → calls render()
- `manualRefresh(source)` — manual refresh button handler

**Exports:** `APP_MODE`, `setAppMode`, `initDashboardBoot`, `load`, `manualRefresh`

**Imports from:** `shell.js`, `api.js`, `render.js`, `session.js`, `commitment.js`, `character.js`, `onboarding.js`

---

#### `main.js` (~50 lines) — NEW entry point

**Contains:**
- Imports all modules
- Side-effect imports: `character-styles.js`
- Window exports for HTML onclick handlers:
  - `window.manualRefresh = manualRefresh`
  - `window.resetPlayGame = resetPlayGame`
  - `window.stewardApiUrl = stewardApiUrl`
  - `window.formatNextTierGapHeadline = formatNextTierGapHeadline`
  - `window.stewardTierFlow = TIER_FLOW`
  - `window.stewardTierMeta = TIER_META`
  - `window.startDashboardOnboarding = startDashboardOnboarding`
- Debug exposure: `window.__stewardStartupUi` (if STARTUP_UI_DEBUG)
- Auto-init block (currently lines 3442–3463):
  - Set document.title based on shell
  - Handle `?reset` on play
  - Set loading text
  - Call `initDashboardBoot()`
- "How it works" button install for classic/vNext

---

### 2.2 CSS Split (Optional)

`style.css` at 3,423 lines is large but CSS doesn't have the same maintainability issues as JS. **Propose as optional** — only do it if you want it:

| Proposed file | Approx lines | Contains |
|---------------|-------------|----------|
| `css/base.css` | ~200 | Resets, typography, CSS custom properties, body/html |
| `css/app-modes.css` | ~280 | `[data-app-mode]` visibility rules, commitment screen, start game, loading, error |
| `css/start-game.css` | ~400 | Start Game overlay, character breathe, balloon cluster, launch animation |
| `css/dashboard.css` | ~1,200 | Hero card, stats, board, tier rail, progress, data strip |
| `css/stability.css` | ~450 | Liquidity pills, breathing room, stability overlays |
| `css/onboarding.css` | ~400 | Guided tour callouts, spotlight, arrows, steps |
| `css/play.css` | ~100 | Play-specific: shell note, meta actions, reset button |
| `css/responsive.css` | ~400 | Media queries (currently scattered) |

All CSS would be `@import`'d from a single `style.css` or loaded as separate `<link>` tags. Visual output stays identical.

**My recommendation:** Skip CSS split for v1 of the rebuild. Focus on the JS module split first. CSS can be split later if wanted.

---

## 3. How Shared Render Logic Will Be Organized

### Current problem

`render()` at line 1808 is a 386-line function that calls ~30 helper functions scattered across app.js. There's no visibility into what render() depends on without reading the entire file.

### Proposed organization

```
render.js
├── imports from format.js    (formatters: fmtDollar, formatRunway, formatNextTierGapHeadline, etc.)
├── imports from layout.js    (upgradeDashboardLayout, applyDashboardTheme, renderTierRail, setupHeroInteraction)
├── imports from character.js (mountHeroCharacter)
├── imports from shell.js     (isClassicLayoutDashboardDoc, isPlayDashboardDoc, getDashboardRoot)
├── imports from tiers.js     (TIER_META, TIER_FLOW)
│
├── renderBrokerageFootnote()  — local helper
├── fillVnextHeroTurnAccounts()  — local helper (guarded: early returns if #dashboard-vnext missing)
├── fillProgressNarrative()    — local helper (fills progress section DOM)
│
└── render(status, snapshots, brokerage)  — main export
    ├── calls upgradeDashboardLayout()
    ├── calls applyDashboardTheme()
    ├── calls setupHeroInteraction()
    ├── calls renderTierRail()
    ├── calls mountHeroCharacter()
    ├── writes hero section (badge, pills, gap headline, breathing room)
    ├── writes stats panel (debt, assets, income, expenses, net worth, runway)
    ├── writes progress section (via fillProgressNarrative)
    ├── writes data strip (YNAB/brokerage timestamps, freshness)
    ├── writes brokerage section (via renderBrokerageFootnote)
    └── calls fillVnextHeroTurnAccounts() + window.stewardVnextEnhance()
```

### What this changes

- **Before:** render() calls 30+ functions via file-level scope. You can't tell what it depends on without reading all 3,463 lines.
- **After:** render.js has explicit imports at the top. Every dependency is visible. The function body is unchanged.

### What stays identical

- The `render()` function body: **identical logic, identical DOM writes, identical null checks**
- All helper functions: **identical implementation**
- The call order: `upgradeDashboardLayout → applyDashboardTheme → setupHeroInteraction → renderTierRail → mountHeroCharacter → DOM writes`
- Shell branching: `isClassicLayoutDashboardDoc()` gates stay exactly where they are
- vNext guards: `fillVnextHeroTurnAccounts` still early-returns if `#dashboard-vnext` is missing

---

## 4. What Stays Exactly the Same vs What Is Refactored

### Stays identical (no changes to logic, values, or output)

| Area | Detail |
|------|--------|
| **10 tiers** | IDs, labels, badges, thresholds, colors, phases, cues — all byte-for-byte identical |
| **Stability scoring** | All server-side (stability.js untouched) |
| **Climb metrics** | All server-side (climbMetrics.js untouched) |
| **API endpoints** | /api/status, /api/refresh, /api/snapshots, /api/brokerage — untouched |
| **API response shapes** | Identical JSON structure |
| **server.js** | Routes, port fallback, CORS, boot — untouched |
| **db.js** | Schema, queries, helpers — untouched |
| **All services/** | tiers.js, stability.js, climbMetrics.js, brokerage.js, ynab.js, scheduler.js, debtSyncValidation.js, debtSyncDebugApi.js, publicApiClient.js — untouched |
| **routes/api.js** | Untouched |
| **config/** | Untouched |
| **HTML structure** | play.html, index.html, steward-vnext.html — only the script tag changes |
| **CSS** | style.css, steward-vnext.css — untouched |
| **steward-vnext.js** | Untouched |
| **Commitment gate flow** | Same localStorage keys, same DOM, same UX |
| **Start Game flow** | Same clock, same button, same animation delay, same session tracking |
| **render() output** | Same DOM writes, same null checks, same branching |
| **Onboarding tour** | Same 9 steps, same positioning, same spotlight |
| **Playtime tracking** | Same foreground accrual, same visibility events |
| **Copy/tone** | Every string literal stays identical |
| **TIER_BEHAVIOR_LINE** | All 10 directives stay identical |
| **Narrative copy** | debt-tier-narrative.json untouched |
| **Showcase** | showcase.html untouched |
| **Windows launchers** | .bat/.vbs files untouched |
| **Scripts** | reset-local-data.js, resolve-steward-port.js, etc. untouched |
| **Tests** | All test files untouched |
| **Docs** | All documentation untouched |

### What gets refactored

| Change | Before | After | Risk |
|--------|--------|-------|------|
| **app.js split** | 1 file, 3,463 lines | 13 modules in `public/js/`, avg ~265 lines | Low — logic identical, only file boundaries change |
| **Script loading** | `<script src="app.js">` | `<script type="module" src="js/main.js">` | Low — module scripts are deferred (current script is at `</body>` so already effectively deferred). Modules run in strict mode, but app.js line 1 is already `'use strict'` |
| **Global scope → module scope** | Functions in global scope | Functions scoped to modules; HTML-referenced ones explicitly on `window` | Low — current code already does `window.manualRefresh = manualRefresh` etc. |
| **Implicit deps → explicit imports** | Functions call each other via file-level scope | ES module `import/export` | Zero — purely organizational |
| **Module-level state** | `let heroWrap`, `let currentTierTheme`, etc. in global scope | Same variables, now module-scoped (shared via imports) | Low — only accessed by functions in the same module |
| **Side-effect code → main.js** | Auto-init block at bottom of app.js, `installDashboardHowItWorksButton()` call at line 2783 | Moved to `main.js` entry point | Zero — same code, same execution order |

### Dead/debug code to clean up

| Item | Lines | Status | Action |
|------|-------|--------|--------|
| `STARTUP_UI_DEBUG = true` | 3001 | Always-on debug flag, marked "Temporary" | Convert to `false` default or gate behind `?debug=1` |
| `logStartupVisibilityDirect()` | 3004–3006 | Temporary debug logging, marked "Temporary" | Remove (or gate behind debug flag) |
| `syncDebtTierBandDebugOverlay()` | 1201–1252 | Marked "Temporary: remove when team is done validating" | Keep but gate behind `?debugDebtTier=1` (already gated — just noting it's intentionally temporary) |
| `window.__stewardStartupUi` | 3434–3439 | Debug exposure gated by `STARTUP_UI_DEBUG` | Keep only if debug flag stays |
| `console.debug` calls (~6) | scattered | Debug logging | Keep — they're gated and useful for debugging |
| Unused CSS classes in HTML | play.html:13 | `steward-play-page`, `dashboard--play` set but no CSS targets them | Keep — they're available for future play-specific CSS scoping |
| `data-steward-shell="play"` | play.html:13 | Set but nothing reads it | Keep — intentional future hook |

### Naming improvements (during module extraction)

These are naming clarifications within the code, not behavior changes:

| Current | Issue | Proposed | Scope |
|---------|-------|----------|-------|
| `isClassicLayoutDashboardDoc()` | Returns true for classic AND play — name suggests classic-only | Add JSDoc: "Classic or play layout (shared hero shape)" | Comment only |
| `classicDoc` (in render) | Local variable that's true for play too | Rename to `classicOrPlayLayout` | Local var in render.js |
| Stability `id: 'stabilizing'` vs tier `id: 'stabilizing'` | Same string for two different axes | No rename (would break API contract) — add clear comments at every usage point | Comments only |

### Null check improvements

Current app.js has inconsistent patterns:

```js
// Some places: null-safe
const heroBadge = document.getElementById('hero-badge');
if (heroBadge) { heroBadge.textContent = '...'; }

// Other places: unguarded
document.getElementById('stat-debt-remaining').textContent = '...';  // crash if missing
```

During module extraction, all `getElementById` + property access patterns will get consistent null checks. This doesn't change behavior for the current HTML (which has all required IDs), but prevents crashes if a future HTML edit removes an ID.

---

## 5. Module Dependency Graph

```
main.js
├── character-styles.js  (side effect: CSS injection)
├── tiers.js             (leaf: no deps)
├── shell.js             (leaf: no deps)
├── format.js            ← tiers.js
├── api.js               (leaf: no deps)
├── character.js          ← tiers.js, shell.js
├── layout.js            ← tiers.js, shell.js, format.js
├── render.js            ← tiers.js, shell.js, format.js, layout.js, character.js, api.js
├── onboarding.js        ← shell.js
├── session.js           (leaf: no deps)
├── commitment.js        ← api.js
└── boot.js              ← shell.js, api.js, render.js, session.js, commitment.js, character.js, onboarding.js, format.js
```

No circular dependencies. `tiers.js` and `shell.js` are leaf modules (imported by many, import nothing). `main.js` is the only entry point.

---

## 6. Migration Strategy

1. **Extract modules in dependency order:** tiers → shell → format → api → character → layout → render → onboarding → session → commitment → boot → main
2. **Each extraction is one commit** — easy to review and bisect
3. **After each extraction:** verify all three shells load correctly (play, classic, vNext)
4. **Final commit:** delete the original `app.js`, update HTML script tags
5. **Run existing tests** (`npm test`) after every commit — they test server-side code, but confirm nothing is broken by file moves

### What to verify after rebuild

- [ ] `/play` — commitment gate → start game → loading → hero card renders correctly
- [ ] `/classic` — dashboard loads, onboarding tour works, "How this works" button appears
- [ ] `/` (vNext) — preview loads, steward-vnext.js enhancements apply
- [ ] Manual refresh buttons work on all three shells
- [ ] `?reset` on `/play` clears state and reloads
- [ ] `?debugDebtTier=1` overlay appears when enabled
- [ ] Playtime tracking accrues correctly on `/play`
- [ ] Showcase page loads independently
