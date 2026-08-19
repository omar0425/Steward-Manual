# Test Report: PR #3 — Migrate Remake's /play Shell

**Tested by:** Devin  
**Session:** https://app.devin.ai/sessions/61abfce734ca43d788b6d08fa455f7f0  
**Branch:** `devin/1776766739-remake-migration-v2`  
**Environment:** Node 24.15.0, Chrome, localhost:3006 (no YNAB token — API returns not-ready)

## Summary

Ran all 4 routes locally against the migration branch. The primary `/play` shell was tested through the full boot flow (commitment → Start Game → loading). Regression tests confirmed `/showcase`, `/classic`, and `/` (vNext) are unaffected.

## Escalations

None. All assertions passed. No console errors detected across any route.

## Test Results

- **`/play` commitment gate renders via JS-built DOM** — passed. `document.title` = "Steward | Play" (pipe, not em-dash from HTML `<title>`), proving `main.js` executed. Heading = "Make this real.", body text = "This doesn't fix itself.", "I'm in" button visible.
- **`/play` commitment → Start Game transition** — passed. Commitment screen hidden after click. Start Game screen visible with "Start Game" title, live clock ticking, character mounted (`start-game-steward-root` class present in `#start-game-character`).
- **`/play` Start Game → loading transition** — passed. `body[data-app-mode]` = "loading" (proves `state.js` `transitionTo()` fired). Loading spinner visible. YNAB token error message shown (expected — no token configured).
- **`/showcase` renders 10 character cards** — passed. `document.querySelectorAll('.state-card').length` = 10. `document.querySelectorAll('.steward-wrap').length` = 10. Title = "Steward | Debt tier gallery". Proves `window.TIER_META`, `window.buildSteward`, `window.roundDebtTierBandPctClient` globals are exported correctly.
- **`/classic` unchanged behavior** — passed (Regression). Title = "Steward | Financial Dashboard". No `#commitment-screen` element (classic doesn't have one). Start Game screen visible with character mounted. "How this works" button present.
- **`/` (vNext) unchanged behavior** — passed (Regression). Title = "Steward | The climb (preview)". `#dashboard-vnext` element exists. `window.stewardTierMeta` is object, `window.stewardTierFlow` is array with 10 entries. Proves `main.js` exports are available to `steward-vnext.js`.
- **Zero console errors across all routes** — passed. Only debug-level "poll: status not ready" messages (expected, no YNAB token).

## Screenshots

### /play — Commitment Screen (JS-built DOM)
![Commitment screen](https://app.devin.ai/attachments/9c156dba-28e1-4927-876e-d70d812602a5/screenshot_e2e984293dd14e2f98c1fc994fcc29ee.png)

### /play — Start Game Screen
![Start Game screen](https://app.devin.ai/attachments/b26f20f2-85c0-4df5-8755-f6288d42023a/screenshot_d7bc0914e8ae45be9cdebc76d8682f96.png)

### /play — Loading Screen (YNAB token error expected)
![Loading screen](https://app.devin.ai/attachments/31071476-25f5-4ff3-bd11-32a072caf7c7/screenshot_a805b82e367049979ee9af8bd8ad7ce9.png)

### /showcase — 10 Character Cards
![Showcase gallery](https://app.devin.ai/attachments/9d63077a-8680-4318-9717-5792beec721c/screenshot_713c512bb90e4651892b87a21eca12fd.png)

### /classic — Start Game (no commitment gate)
![Classic shell](https://app.devin.ai/attachments/6de0a7f3-3da4-4803-b455-568b6f698cf3/screenshot_123fde7977b14f0f8574af6f71d88373.png)

### / (vNext) — Start Game
![vNext shell](https://app.devin.ai/attachments/d2f7c736-db29-4453-a517-c70223eeac06/screenshot_a2c5c2b369124e5f884c1990679b1737.png)

## Not Tested

- **Real YNAB data pipeline** — requires YNAB API token (user chose to skip). The hero card rendering after data load was not verified.
- **Hero card with live data** — same reason. The full render() pipeline through to the hero card display requires real API data.
- **Error recovery** — server crash/restart scenarios not tested.
