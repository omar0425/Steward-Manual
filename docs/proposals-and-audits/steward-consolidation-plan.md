# Steward — Consolidation Plan

## For: Omar + team
## Date: April 2026

---

## The Problem

Steward has 4 shells (`/play`, `/classic`, `/`, `/showcase`) that mostly do the same thing. This creates confusion, duplication, and bugs. The goal is to consolidate down to one primary product shell plus a gallery.

---

## Part 1: What's Confusing Right Now

### 1. Four HTML files doing the same job — HIGH

| File | Lines | Route | What it is |
|------|-------|-------|------------|
| `play.html` | 20 | `/play` | Remake — minimal shell, DOM built by JS |
| `index.html` | 577 | `/classic` | Original prototype — static HTML |
| `steward-vnext.html` | 756 | `/` | Preview sandbox — static HTML + bolted-on script |
| `showcase.html` | 1,657 | `/showcase` | Tier gallery — static HTML + 381-line inline script |

The first three contain copy-pasted Start Game screens, loading screens, and character templates. When you change something in one, you have to remember to change it in the others. When you don't, they drift.

### 2. `steward-vnext.js` is a non-module script — HIGH

`steward-vnext.html` loads two scripts:
```html
<script type="module" src="/js/main.js"></script>
<script src="/steward-vnext.js"></script>  <!-- NOT a module -->
```

`steward-vnext.js` (831 lines) talks to the module system through `window` globals and `typeof` checks. `main.js` has to manually export 12+ functions to `window` so that `steward-vnext.js` can use them. This has already caused **4 separate bugs** — every time a function was missed in the window exports, a feature silently broke with no error.

### 3. Showcase duplicates tier data — MEDIUM

The 381-line inline script in `showcase.html` defines its own `ALL_TIERS` array — IDs, labels, thresholds, flavor text, accent colors. This duplicates `TIER_META` and `TIER_FLOW` from `public/js/tiers.js`, and partially duplicates `services/tiers.js` on the server. Three sources of truth for the same data.

### 4. Shell detection is confusing — MEDIUM

Five functions in `shell.js`, mixing URL-based and DOM-based detection:
- `currentShell()` — URL-based, returns `'play'`, `'classic'`, `'showcase'`, or `'vnext'`
- `getDashboardRoot()` — DOM-based, returns whichever of `#dashboard-play`, `#dashboard`, `#dashboard-vnext` exists
- `isClassicDashboardDoc()` — true for classic only
- `isPlayDashboardDoc()` — true for play only
- `isClassicLayoutDashboardDoc()` — true for **both** classic AND play (misleading name)

Once all shells use JS-built DOM, only `currentShell()` is needed.

### 5. `render.js` is a 733-line function with 76 DOM lookups — MEDIUM

`render()` updates the entire UI via 76 `getElementById` / `querySelector` calls with almost no null checks. If any expected DOM ID is missing, it throws `TypeError: null.textContent`. The function also branches based on `isClassicLayoutDashboardDoc()` which returns true for both classic and play — hard to follow.

### 6. CSS is unsorted — LOW

- `style.css` — 3,423 lines
- `steward-vnext.css` — 1,933 lines

No organization by feature. Finding the CSS for a specific component means searching through thousands of lines.

### 7. Server-side is fine — NO ACTION

`server.js` (146 lines), `db.js` (175 lines), `routes/api.js` (343 lines), and `services/` (2,307 lines across 9 files) are well-organized. Each service has a clear responsibility. Don't touch this.

---

## Part 2: Which Shell Should Be the Main App?

**`/play` should be the main route (`/`).**

| | `/play` | `/classic` | `/` (vNext) |
|---|---|---|---|
| Commitment gate | Yes | No | No |
| Boot flow designed | Commitment → Start Game → Loading → Hero | Start Game → Loading → Hero | Start Game → Loading → Hero |
| Architecture | 20-line HTML, JS-built DOM, state machine | 577-line static HTML | 756-line static HTML + 831-line bolted-on script |
| Philosophy | Guide, not dashboard | Dashboard that looks like a guide | Preview sandbox |
| Product-ready | Yes | No | No |

Classic and vNext are development artifacts that grew into routes. Play is the only shell that was intentionally designed as a product experience.

---

## Part 3: What vNext Has That's Worth Keeping

vNext (`steward-vnext.js`, 831 lines) has 6 features worth absorbing into the play shell:

### Worth absorbing

| # | Feature | What it does | Why it's useful |
|---|---------|-------------|-----------------|
| 1 | **Explore the climb** | Horizontal scrollable row of all 10 tier cards with current position highlighted | Lets the user see the full progression path without leaving the hero screen. Play has no way to see the full ladder. |
| 2 | **Today section** | Single-line daily nudge from hero headline + stage context | Simple, not a dashboard — just "here's what matters today." Fits the guide philosophy. |
| 3 | **Your next move** | Dedicated panel surfacing the tier behavior directive prominently | Three lines: primary move, context, secondary. Stronger than the single line in play's hero card. |
| 4 | **Journey-to-debt-free bar** | Linear scale from top of ladder to $0, tier tick marks, dot for current position | Shows total progress across all tiers. Play only shows in-band %. |
| 5 | **Breathing room visualization** | Progress bar for stability axis (runway months toward goal) | Play shows the stability pill (Exposed/Steady/Fortified) but doesn't visualize progress toward the breathing room goal. |
| 6 | **Data checkpoints** | Scheduled pull windows (1st, 15th, last day) with status badges (Queued/In sync/Refresh) | Play only shows last-pulled timestamp. |

### Not worth absorbing

| Feature | Why skip |
|---------|----------|
| "This turn" hero accounts list | Too detailed for guide philosophy — individual account balances belong in a debug/proof section |
| "Proof — Full ledger follows" bridge | Just a visual divider, not a feature |
| Near-finish cue text ("Push through") | Motivational fluff, contradicts Steward's tone |
| Stage group chips ("early stage") | Adds label noise without adding clarity |

---

## Part 4: The Consolidation Plan

### Phase 1 — Make `/play` the main route

1. Move play to `/` (currently serves vNext)
2. Keep `/classic` alive as-is — reference shell, don't invest in it
3. Keep `/showcase` at `/showcase` — gallery belongs on its own route
4. Add the "How this works" onboarding button from classic to play (only thing classic has that play doesn't)

**Result:** One primary product at `/`. Classic still accessible. Showcase still accessible.

### Phase 2 — Absorb the best of vNext

1. Build "Explore the climb" as a collapsible section below the hero card in play
2. Build "Today" section below the climb
3. Build "Your next move" panel below today
4. All three as ES modules — no window globals, no separate script file

**Result:** Play has vNext's best features. `steward-vnext.js` and `steward-vnext.html` can be retired.

### Phase 3 — Clean up

1. Convert showcase inline script to an ES module (imports tier data from `tiers.js`)
2. Extend play's dynamic template loading to showcase (eliminate last duplicated character template)
3. Remove the 5 shell detection functions, replace with `currentShell()` everywhere
4. Split `render.js` into focused functions (`renderHeroCard`, `renderClimbProgress`, `renderStabilityAxis`, `renderDataStrip`)
5. Optionally split CSS by feature

**Result:** Clean codebase. One source of truth for tier data. One shell detection method. Maintainable render pipeline.

### Phase 4 — Retire

1. Archive `index.html` (classic), `steward-vnext.html`, `steward-vnext.js`, `steward-vnext.css`
2. Remove classic-specific routes and nav badges
3. Update README

**Result:** Two routes: `/` (product) and `/showcase` (gallery). Everything else archived.

---

## What NOT to Do

- **Don't add a build step.** Zero-build ES modules + Express is a feature.
- **Don't add a framework.** React/Vue/Svelte is overkill. The `el()` helper pattern is the right level.
- **Don't change the server.** It's already clean.
- **Don't change tier logic, math, or copy.** This is structural, not a redesign.
- **Don't change the tone.** No motivational fluff, no fintech dashboard styling, no gamification.

---

## Recommended Execution Order

| Step | What | Risk | Effort |
|------|------|------|--------|
| 1 | Make `/play` serve from `/` | Low — route change only | Small |
| 2 | Add onboarding button to play | Low — one button | Small |
| 3 | Build "Explore the climb" in play | Medium — new UI section | Medium |
| 4 | Build "Today" + "Next move" in play | Medium — new UI sections | Medium |
| 5 | Convert showcase script to module | Low — no behavior change | Small |
| 6 | Clean up shell detection | Low — rename/replace | Small |
| 7 | Split render.js | Medium — careful refactor | Medium |
| 8 | Archive classic + vNext files | Low — removal only | Small |
| 9 | Split CSS (optional) | Low — no behavior change | Tedious |
