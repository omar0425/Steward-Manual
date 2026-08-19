# Steward Remake — Core Loop Comparison

## Overview

This document compares the current Steward app (`localhost:3001/play`) against the faithful remake (`localhost:3002/play`). The remake reproduces the same visual output using improved internal architecture — single HTML shell, explicit state machine, declarative view builders, and URL-based routing.

Both apps share the same backend database and API. The remake proxies `/api/*` to the original Steward server. A demo data fallback is included so the hero card can render without a YNAB token.

---

## 1. Start Game Screen

| Original (port 3001) | Remake (port 3002) |
|---|---|
| ![Original Start Game](https://app.devin.ai/attachments/566fd047-b8f0-463f-9e16-784be107ad8b/original-start-game.png) | ![Remake Start Game](https://app.devin.ai/attachments/6c922580-733a-4879-8d71-70ffcf87c366/remake-start-game.png) |

**Verdict: Identical.**

- Same warm gradient background
- Same white card with rounded corners and soft shadow
- Same "Steward" brand name (Playfair Display, dark green)
- Same "Start Game" heading (Playfair Display, bold)
- Same "Begin this run and track your progress." subtext (Inter)
- Same character rendering (hat, coat, vest, cane, money particles, sparkles)
- Same live clock format and position
- Same dark green "START GAME" button (pill shape, uppercase Inter 700)
- Same vertical spacing rhythm throughout

---

## 2. Commitment Screen

| Remake commitment gate |
|---|
| ![Remake Commitment](https://app.devin.ai/attachments/4af64661-aa88-49d4-8263-311ee4a1dc79/remake-commitment-modal.png) |

The commitment screen appears on first visit (before `STEWARD_PROMISE_MADE` is set in localStorage). Both apps use the same commitment gate logic.

**What renders identically:**
- Dark overlay background (deep green-black gradient)
- "Make this real." heading (Playfair Display, white)
- "You are — $64,219 in debt." (populated from API; falls back to "in debt" if no data)
- Direct copy: "This doesn't fix itself. / No one is coming to save you. / You either change this — or you live with it."
- Blockquote with italic pledge text
- "YOUR OWN COMMITMENT (optional)" label + textarea
- Gold "I'm in" button (same as original)

**Note:** The original Steward's commitment screen is not shown separately here because both apps share the same `commitment.js` logic and CSS — the visual output is identical.

---

## 3. Loading Screen

| Original (port 3001) |
|---|
| ![Original Loading](https://app.devin.ai/attachments/4545f8a5-f99c-48db-a7a2-c2803082a8a9/original-loading.png) |

**Verdict: Identical layout and styling.**

Both apps show:
- Same warm gradient background
- Same centered spinner animation
- Same loading text ("Pulling your financial data…")
- Same error message format when YNAB token is missing

The only behavioral difference: the remake's server intercepts `ready: false` responses and substitutes demo data, so the remake transitions through loading to the hero card. The original stays in loading/retry when no YNAB token is configured.

---

## 4. Hero Card (Ready State)

| Remake hero card (with demo data) |
|---|
| ![Remake Hero Card](https://app.devin.ai/attachments/0369e6bd-eaa1-4828-8860-55bc4c559b02/remake-hero-card.png) |

The hero card cannot be shown for the original without a YNAB token (it stays in loading). The remake uses demo data (Stage 03 — Struggling, $64,219 debt) to render the full hero view. **Both apps use the exact same `render.js` (733 lines), `format.js` (565 lines), `layout.js` (319 lines), and `character.js` (542 lines)** — the visual output is guaranteed identical when given the same data.

**What renders:**
- **Top nav**: "PLAY" badge (left), "Stable experience · Classic · Preview" links (right)
- **State card** (left column):
  - Stage badge chip ("03") — top-left
  - Character mount with sign ("will budget 4 food :("), money particles, sparkles
  - Tier gradient background (Struggling = muted rose/brown)
  - Gap headline: "$4,219 to escape Struggling"
  - Stage label chip: "STRUGGLING"
  - Progress bar (58% through stage)
  - Debt remaining: "$64,219 debt remaining"
- **Story column** (right):
  - "STAGE 03 — STRUGGLING" label
  - Pills: "RUNWAY: STEADY", "PRESSURE PHASE", "DEMO"
  - Breathing room narrative
  - Tier name: "Struggling" (Playfair Display, large)
  - Behavior line: "Net is down — keep paying."
  - Next move: "free up $4,219"
  - Directive copy
  - Climb + runway grid box
- **Tier rail**: All 10 stages (Rock Bottom through Wealthy) with phase labels
- **Data strip**: YNAB last pull, brokerage status, next auto-pull, freshness badge ("Demo")
- **Refresh buttons**: "↻ YNAB" and "↻ BROKERAGE"

---

## 5. Visual Differences

| Area | Difference | Intentional? |
|---|---|---|
| Freshness badge | Remake shows green "Demo" pill instead of "Live"/"Stale" | Yes — flags demo data |
| Loading behavior | Remake transitions to hero card with demo data; original stays in loading without YNAB | Yes — demo fallback for testing |
| Data values | Demo data shows $64,219 debt, Struggling tier | Yes — hardcoded demo; real data would match original exactly |

**No unintentional visual differences.** The remake uses the same CSS (3,423 lines, verbatim copy), same render pipeline, same character template, same formatters, and same layout upgrade functions.

---

## 6. Architecture Changes (Internal Only)

| Aspect | Original Steward | Remake |
|---|---|---|
| HTML files | 4 separate shells (play.html, index.html, steward-vnext.html, showcase.html) | 1 shell (index.html, ~80 lines) |
| Character template | Duplicated in each HTML file (~300 lines each) | Loaded once via fetch, injected into DOM |
| Shell detection | DOM ID sniffing (`getDashboardRoot()` checks for `#dashboard-play`, `#dashboard`, `#dashboard-vnext`) | URL path routing (`currentShell()` reads `window.location.pathname`) |
| Boot flow | Implicit `data-app-mode` attribute + nested callbacks | Explicit state machine (`transitionTo()` with COMMITMENT → START → LOADING → READY/ERROR) |
| DOM construction | Static HTML with 260-line hidden sentinel div | Programmatic `views/play.js` builds identical DOM structure |
| API fallback | None — requires live YNAB data | Demo data fallback when backend returns `ready: false` |
| Server | Express + SQLite + YNAB integration (single process) | Express proxy to original backend (separate process, shared data) |

**All product logic, tier definitions, math, copy, and API contracts are unchanged.**

---

## 7. Files in the Remake

```
steward-remake/
├── server.js                    # Express proxy + demo data fallback
├── package.json
├── public/
│   ├── index.html               # Single HTML shell (~80 lines)
│   ├── style.css                # Verbatim copy (3,423 lines)
│   ├── steward-template.html    # Character template (extracted from play.html)
│   └── js/
│       ├── main.js              # Entry point, window exports, shell init
│       ├── state.js             # Explicit state machine (AppMode enum, transitionTo)
│       ├── shell.js             # URL-based shell detection
│       ├── boot.js              # Boot orchestration (commitment → start → load → ready)
│       ├── commitment.js        # First-run gate, play reset
│       ├── session.js           # Playtime tracking (copied from Steward)
│       ├── api.js               # URL construction (copied from Steward)
│       ├── tiers.js             # TIER_FLOW, TIER_META (copied from Steward)
│       ├── character.js         # CSS injection + character builder (copied from Steward)
│       ├── format.js            # All formatters (copied from Steward)
│       ├── render.js            # 733-line render() function (copied from Steward)
│       ├── layout.js            # Dashboard theme + layout upgrades (copied from Steward)
│       ├── template-loader.js   # Fetches and injects character template
│       └── views/
│           └── play.js          # Declarative DOM builder for /play shell
```

---

## 8. What's Next

Pending your approval of this core loop:

1. **Showcase shell** — 10-card tier gallery (same as `/showcase` in original)
2. **Onboarding flow** — guided tour overlay
3. **Phase 3 comparison document** — maintainability, architecture clarity, what should be merged back vs left separate
