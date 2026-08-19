# Steward Migration Plan — Remake → Main App

## Scope

Replace the `/play` frontend shell with the remake's architecture. Keep backend (`server.js`, `routes/`, `services/`, `config/`, `db.js`) completely unchanged. Keep `/classic`, `/`, and `/showcase` shells unchanged.

The remake only built the `/play` view — this migration is scoped to that. Classic, vNext, and showcase shells continue using their existing HTML files and work exactly as before.

---

## 1. Frontend Files — What Changes

### REPLACED: `public/play.html` (607 → ~25 lines)

**Before:** 607-line static HTML containing:
- 260-line hidden sentinel div (`dashboard-render-sentinels`) with all render target IDs hardcoded
- 303-line `<template id="steward-template">` (character SVG) duplicated inline
- Commitment screen, start game screen, loading state — all static HTML

**After:** ~25-line minimal shell with `<div id="app-root">`. All DOM structure built programmatically by `views/play.js`. Character template fetched separately via `template-loader.js`.

### REPLACED: `public/js/main.js` (45 → ~60 lines)

**Before:** Handles all shells via `getDashboardRoot()` DOM ID detection. Imports `onboarding.js`.

**After:** Merged version — if `/play` path detected AND `#app-root` exists, uses remake approach (`mountPlayShell()`, `loadCharacterTemplate()`, then `initDashboardBoot()`). Otherwise falls through to original behavior for classic/vnext/showcase. Still imports and exports `startDashboardOnboarding` for non-play shells.

### REPLACED: `public/js/boot.js` (284 → ~230 lines)

**Before:** Manages state via internal `appMode` variable and `setAppMode()` function. Exports `setAppMode`, `APP_MODE`.

**After:** Uses `state.js` for state management (`transitionTo()`, `AppMode`). Functionally identical — `transitionTo()` sets `data-app-mode` on `document.body` the same way, so all CSS state rules still work. Still calls `offerFirstVisitDashboardOnboarding()` for non-play shells.

### REPLACED: `public/js/shell.js` (25 → 32 lines)

**Before:** Pure DOM ID sniffing — `isPlayDashboardDoc()` checks for `#dashboard-play`.

**After:** URL path detection for `/play` — `isPlayDashboardDoc()` uses `currentShell() === 'play'`. `getDashboardRoot()` still falls back to DOM ID lookup for classic/vnext. `isClassicDashboardDoc()` and `isClassicLayoutDashboardDoc()` still work correctly.

### REPLACED: `public/js/commitment.js` (116 → 109 lines)

**Before:** Imports `DASHBOARD_ONBOARDING_KEY` from `onboarding.js`.

**After:** Exports `DASHBOARD_ONBOARDING_KEY` directly (value identical: `'steward_dashboard_guided_tour_v2'`). Removes circular dependency on onboarding module. All functions identical.

### ADDED: 4 new files

| File | Lines | Purpose |
|------|-------|---------|
| `public/js/state.js` | 54 | Explicit state machine (`AppMode` enum, `transitionTo()`, `isSessionResume()`) |
| `public/js/template-loader.js` | 26 | Fetches `/steward-template.html` and injects `<template>` into DOM |
| `public/js/views/play.js` | 295 | Declarative DOM builder — constructs the same structure `play.html` had statically |
| `public/steward-template.html` | 303 | Character SVG `<template>` extracted from old `play.html` (lines 301–603) |

### UNCHANGED: Everything else

| File | Why unchanged |
|------|--------------|
| `public/index.html` (577 lines) | Classic shell — not in remake scope |
| `public/steward-vnext.html` (756 lines) | vNext shell — not in remake scope |
| `public/showcase.html` (1657 lines) | Showcase — not in remake scope |
| `public/steward-vnext.js` | vNext-specific JS — not in remake scope |
| `public/steward-vnext.css` | vNext-specific CSS — not in remake scope |
| `public/style.css` (3,423 lines) | CSS — already identical in remake |
| `public/js/api.js` | Shared module — identical in both |
| `public/js/character.js` | Shared module — identical in both |
| `public/js/format.js` | Shared module — identical in both |
| `public/js/layout.js` | Shared module — identical in both |
| `public/js/render.js` | Shared module — identical in both |
| `public/js/session.js` | Shared module — identical in both |
| `public/js/tiers.js` | Shared module — identical in both |
| `public/js/onboarding.js` | Still used by classic/vnext shells |
| `public/debt-tier-constants.json` | Shared data — identical |
| `public/debt-tier-narrative.json` | Used by render pipeline |
| `public/favicon.ico`, `public/favicon.svg` | Static assets |

---

## 2. Archived Files

| File | Destination |
|------|------------|
| `public/play.html` (607-line original) | `public/_archive/pre-remake/play.html` |

Only `play.html` is archived because it's the only HTML file being replaced. The original is preserved for reference.

---

## 3. Route Mapping — Before vs After

| Route | Before: serves | After: serves | Behavior change |
|-------|---------------|---------------|-----------------|
| `/play` | `play.html` (607 lines, static DOM) | `play.html` (~25 lines, JS-built DOM) | Same visual output, DOM built by JS instead of HTML |
| `/classic` | `index.html` | `index.html` | None |
| `/` | `steward-vnext.html` | `steward-vnext.html` | None |
| `/showcase` | `showcase.html` | `showcase.html` | None |
| `/steward-vnext` | `steward-vnext.html` | `steward-vnext.html` | None |
| `/merged` | `steward-vnext.html` | `steward-vnext.html` | None |
| `/health` | JSON response | JSON response | None |
| `/api/*` | API router | API router | None |
| `*` (fallback) | `steward-vnext.html` | `steward-vnext.html` | None |

**`server.js` changes: ZERO.** All routes still serve the same file names. The only difference is that `play.html` now contains ~25 lines instead of 607.

---

## 4. Demo Fallback Removal

The demo fallback exists only in the remake's separate `server.js` (port 3002 proxy). It is **not** carried into the main app. The main Steward `server.js` uses the real backend (SQLite + YNAB API) — no demo data, no proxy, no fallback.

The remake's standalone server (`steward-remake/server.js`) remains available as a development tool but is not part of this migration.

---

## 5. Backend Changes: NONE

These files are untouched:
- `server.js` — no route changes, no middleware changes
- `routes/api.js` — unchanged
- `services/*` — unchanged (tiers.js, stability.js, ynab.js, scheduler.js, etc.)
- `config/*` — unchanged
- `db.js` — unchanged
- `package.json` — unchanged (no new dependencies)
- `.env` / `.env.example` — unchanged

---

## 6. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| `/play` DOM built by JS instead of static HTML — any render timing issue could flash unstyled content | Low | `data-app-mode` CSS rules hide content until JS sets the mode; same pattern as before |
| `onboarding.js` import removed from `commitment.js` | Low | `DASHBOARD_ONBOARDING_KEY` value is identical; onboarding still imported by `boot.js` for non-play shells |
| Character template loaded via fetch instead of inline `<template>` | Low | Template is a local file (`/steward-template.html`), loads in <10ms; `await` ensures it's ready before boot |
| `shell.js` uses URL path instead of DOM IDs for play detection | Low | Classic/vnext still use DOM IDs via `getDashboardRoot()`; URL detection only adds the play path |

---

## 7. Execution Order

1. Archive `play.html` → `_archive/pre-remake/play.html`
2. Add new files: `state.js`, `template-loader.js`, `views/play.js`, `steward-template.html`
3. Replace `play.html` with minimal shell
4. Replace `shell.js` with merged version
5. Replace `commitment.js` with merged version
6. Replace `boot.js` with merged version (uses state.js + keeps onboarding for non-play)
7. Replace `main.js` with merged version (play shell mounting + original behavior for other shells)
8. Verify all 4 routes work (`/play`, `/classic`, `/`, `/showcase`)
9. Create PR
