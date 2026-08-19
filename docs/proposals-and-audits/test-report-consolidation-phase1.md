# Test Report: Consolidation Phase 1 — `/play` as main route

**PR:** [#4 feat: make /play the main route](https://github.com/omar0425/Steward/pull/4)
**Tested by:** Devin (automated end-to-end browser testing)
**Session:** https://app.devin.ai/sessions/61abfce734ca43d788b6d08fa455f7f0
**Method:** Navigated all 5 routes in Chrome, verified shell identity via `document.title`, `data-steward-build`, nav link hrefs, and badge text. Cross-shell navigation tested by clicking actual links.

## Results Summary

| # | Test | Result |
|---|------|--------|
| 1 | `/` serves Play shell (title="Steward", build=remake) | **PASSED** |
| 2 | `/play` serves Play with different title ("Steward \| Play") | **PASSED** |
| 3 | `/steward-vnext` serves vNext (title has "The climb", no build marker) | **PASSED** |
| 4 | `/classic` has updated nav (Main (Play)→/, vNext→/steward-vnext) | **PASSED** |
| 5 | Cross-nav: vNext "Main (Play)" link → `/` loads Play shell | **PASSED** |
| 6 | SPA fallback: `/nonexistent-route` serves Play shell | **PASSED** |
| 7 | Showcase "Back to dashboard" → `/` loads Play shell | **PASSED** |

**7/7 passed. Zero console errors. No escalations.**

## Evidence

### Test 1: Root `/` → Play shell
- Title: `Steward` (not "Steward — The climb")
- `data-steward-build`: `remake`
- Badge: "Steward"
- Nav links: Classic→/classic, vNext→/steward-vnext, Tier gallery→/showcase

![Root route serves Play shell](https://app.devin.ai/attachments/d54d7cab-ae4a-4771-9b0d-733182fafdcb/screenshot_5e11493cd4a847c6b5370e6e06a4434b.png)

### Test 2: `/play` alias → different title
- Title: `Steward | Play` (proves title logic distinguishes alias from main route)
- `data-steward-build`: `remake` (same shell)

![/play alias with different title](https://app.devin.ai/attachments/820a59e7-0c93-421c-82b6-db3fd1f9e6f5/screenshot_e4413b8478b64ea2ae192268e6a2d49b.png)

### Test 3: `/steward-vnext` → vNext shell (regression)
- Title: `Steward | The climb (preview)`
- `data-steward-build`: undefined (not set by vNext — proves it's NOT the play shell)
- Badge: "vNext"
- Nav: "Main (Play)"→/, "Classic"→/classic, "Tier gallery"→/showcase

![vNext shell at /steward-vnext](https://app.devin.ai/attachments/1ecd8073-9f72-411c-b7b9-8b89dcf4c95b/screenshot_7b270e47060447e48b565834c46b8dd9.png)

### Test 4: `/classic` → updated nav links
- Title: `Steward | Financial Dashboard`
- Top nav: "Main (Play)"→/, "vNext"→/steward-vnext, "Tier gallery"→/showcase
- Hero secondary nav: "vNext (preview)"→/steward-vnext (was "Merged climb (vNext)"→/ — fixed)

![Classic shell with updated nav](https://app.devin.ai/attachments/cd098b1c-c9ab-4747-ac5d-d482d86823d2/screenshot_4e384d26956f4dd08b1c79f64f55fdf9.png)

### Test 6: SPA fallback → Play shell
- URL: `/nonexistent-route`
- Page loaded (200, not 404)
- `data-steward-build`: `remake` (play shell, not vNext)

![SPA fallback serves play shell](https://app.devin.ai/attachments/22195f2f-6182-4823-9ef2-402f43397fe7/screenshot_9c13750e639347e0b6f1483f71f0dfcd.png)

### Test 7: Showcase → Play via "Back to dashboard"
- Clicked "Back to dashboard" on `/showcase`
- Navigated to `/`
- Title: `Steward`, build: `remake`

![Showcase back to dashboard → Play](https://app.devin.ai/attachments/fcf4a2d2-83e6-4e46-9baa-8a77290af81d/screenshot_8271d573012849f4a36bd5d2663b8229.png)

## Not Tested
- **YNAB data rendering** — API token not configured. Hero card loads but shows sample/empty state. This is expected for a local dev environment without credentials.
- **"How this works" onboarding button** — Button is visible on classic and vnext shells (confirmed in DOM). On play shell, the button was enabled in code (`onboarding.js`) but the play shell's JS-built DOM doesn't include the `#how-it-works-btn` element that the onboarding script looks for. This is a pre-existing limitation of the play shell architecture, not a regression from this PR.
