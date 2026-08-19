# Steward — Full Improvement Proposal

## For: Omar + team
## Date: April 2026
## Status: PROPOSAL — no code changes until approved

---

## Overview

Four workstreams that take Steward from its current state (working but scattered) to a polished, consolidated product. Each workstream is independent — you can approve any combination in any order.

**Total estimated cost: $50–63**
**Recommended execution: 3 sessions**

---

## Workstream 1: Card Gradient Improvements

**What:** Improve the background gradients on all 10 tier cards so each stage feels visually distinct and emotionally appropriate.

**Why:** The early tiers (01-03) feel flat compared to the richly layered upper tiers. The middle tiers (04-06) all trend green and blur together in the showcase grid.

**Estimated cost: $8–10**

### Changes per card

| Tier | Current | Proposed | Key Change |
|------|---------|----------|------------|
| 01 Rock Bottom | Dark maroon, flat | Gritty, textured | Add grain texture pseudo-element at 4% opacity, deepen bottom-edge shadow |
| 02 Broke | Grey, neutral | Cold, metallic | Shift radial glow to blue-grey (`rgba(120,130,148,0.3)`), add edge vignette |
| 03 Struggling | Muted red-brown | Warm ember | Add bottom heat glow (`rgba(180,80,40,0.12)`), increase saturation slightly |
| 04 Surviving | Green (blurs with 05/06) | Amber-olive | Replace green undertones with warm amber/olive (`rgba(180,155,80,0.25)`) |
| 05 Stabilizing | Medium green, flat | Green with light source | Add top-left radial highlight (`rgba(160,210,140,0.15)`) |
| 06 Stable | Deeper green (blurs with 05) | Forest with teal edge | Push cooler/deeper (`rgba(30,100,70,0.28)`), add faint teal highlight |
| 07 Building | Navy blue | Deeper navy with glow | Add bottom radial glow (`rgba(60,100,200,0.15)`), faint blue-white top edge |
| 08 Thriving | Purple | Richer purple | Increase inner glow opacity 0.4→0.5, add warm top-right highlight |
| 09 Winning | Teal-aqua | Deeper teal | Add bottom-center oceanic glow, slightly more saturated edges |
| 10 Wealthy | Gold layered (already best) | Gold with shimmer | Brighter top highlight (0.72→0.80), subtle slow-moving shimmer pseudo-element |

**Files changed:** `public/style.css` only
**Risk:** Low — CSS gradient changes, no logic

---

## Workstream 2: Card Animation Improvements

**What:** Give each tier's character a distinct idle animation that matches the emotional state of that stage.

**Why:** Currently tiers 01-03 all use the same tremble keyframe at different speeds. Tiers 04-06 all do nearly identical 1px vertical lifts. The character's pose changes per tier but the motion doesn't match.

**Estimated cost: $15–20**

### Changes per card

| Tier | Current Motion | Proposed Motion | Emotional Read |
|------|---------------|----------------|----------------|
| 01 Rock Bottom | Fast tremble (2.1s) | Tremble + periodic stagger + sign sway (±6deg) + hat wobble (1.8deg) | Broken, barely standing |
| 02 Broke | Medium tremble (2.7s) | Weary sway + periodic head drop + slower sign sway (±4deg) | Exhausted, not jittery |
| 03 Struggling | Slow tremble (3.5s) | Posture correction cycle (straightens up, falls back) + sign fade pulse | Trying to stand, fighting |
| 04 Surviving | 0.8px lift | Left-right weight shift + subtle breathing + cane grip oscillation | Finding footing |
| 05 Stabilizing | 1.1px lift | Periodic cane tap + steady chest breathing + monocle glint active | Asserting control |
| 06 Stable | 1.3px lift | Proud chest-out breathing + rock-solid head + ground shadow pulse | Comfortable, settled |
| 07 Building | 4px bounce | Bounce + periodic head look-up + coin emphasis + confident cane shift | Forward energy |
| 08 Thriving | 6px bounce | Bounce + wider stance oscillation + hat flair + more visible halo | Taking up space |
| 09 Winning | 2.5px float | Float + cane flourish (outward gesture) + faster hat glint + gold pulse | Gentleman's ease |
| 10 Wealthy | 2px micro-float | Regal lateral sway (±0.8px, 8s) + dog body sync + enhanced car/mansion glow | Surveying the domain |

**Files changed:** `public/js/character.js` (new keyframes + updated animation assignments)
**Risk:** Medium — animation timing is subjective, may need tuning after first pass

---

## Workstream 3: Consolidation (Phase 1)

**What:** Make `/play` the main route (`/`). Keep `/classic` and `/showcase` as-is.

**Why:** The app currently has 4 shells doing the same job. `/play` is the only one designed as a product (commitment gate, intentional boot flow, JS-built DOM). Making it the default eliminates confusion and focuses development.

**Estimated cost: $12–15**

### Steps

| Step | What | Detail |
|------|------|--------|
| 1 | Route swap | `server.js`: `/` serves `play.html` instead of `steward-vnext.html`. `/play` redirects to `/`. |
| 2 | Update shell detection | `shell.js`: `currentShell()` returns `'play'` for `/` path. |
| 3 | Add onboarding button | Port the "How this works" button from classic into the play shell. Only thing classic has that play doesn't. |
| 4 | Update nav links | Play's nav strip: remove "Play" self-link, add "Classic" and "Showcase" links. |
| 5 | Update page title | `/` shows "Steward" (not "Steward | Play"). |
| 6 | Archive vNext as route | Keep `/preview` as an alias to `steward-vnext.html` for reference. |

**Files changed:** `server.js` (route mapping), `public/js/shell.js`, `public/js/main.js`, `public/js/views/play.js`
**Risk:** Low — route change only, no logic changes. All shells continue to work.

**Not included in Phase 1:**
- Absorbing vNext features into play (Phase 2, separate proposal)
- Retiring classic/vNext files (Phase 4, after all features absorbed)
- CSS cleanup (Phase 3, separate)

---

## Workstream 4: Styling & Polish

**What:** 10 specific CSS improvements to tighten the existing UI.

**Why:** Small visual issues that collectively make the app feel less polished than it should.

**Estimated cost: $15–18**

### All 10 recommendations

| # | Recommendation | Impact | Effort | Detail |
|---|---------------|--------|--------|--------|
| 1 | **Fix responsive layout below 920px** | HIGH | 30 min | Hero min-height 700px→480px on tablet. Tier rail switches to horizontal scroll (`display:flex; overflow-x:auto; scroll-snap-type:x mandatory`). Showcase grid goes 1-col at 620px. |
| 2 | **Tighten commitment screen** | MEDIUM | 15 min | Show real debt dollar amount ("You are $64,219 in debt."). Inset textarea with darker bg (`rgba(0,0,0,0.15)`). Button border 2px→3px. |
| 3 | **Add depth to early tier gradients** | MEDIUM | 15 min | *(Covered by Workstream 1 — skip if doing both)* |
| 4 | **Slow Start Game character animation** | LOW | 10 min | Breathing cycle 5.6s→7s. Entry animation 0.38s→0.6s. Character scale 0.52→0.58. |
| 5 | **Give loading state more weight** | MEDIUM | 30 min | Add character to loading screen (smaller scale). Error text: all-caps→sentence case. Thicker spinner stroke 3px→4px. |
| 6 | **Fix or remove hero parallax tilt** | LOW | 10 min | Tilt multiplier 0.18→0.5, or remove entirely. Currently invisible. |
| 7 | **Strengthen tier rail current-tier highlight** | MEDIUM | 20 min | Lift 4px→8px. Stronger box-shadow. Add left border with accent color. Abbreviate labels on narrow screens. |
| 8 | **Tone down progress bar shimmer** | LOW | 5 min | Change from infinite to single run on page load, or slow from 2.8s→6s and reduce opacity 42%→20%. |
| 9 | **Polish data strip** | LOW | 15 min | Match border-radius to hero. Larger freshness badge. Add separator rule between strip and hero. |
| 10 | **Micro-interactions** | MEDIUM | 20 min | Button `:active` press-in. Showcase card hover lift. Progress bar fill delay. Commitment screen fade-in. Badge chip hover frost. |

**Files changed:** `public/style.css`, minor changes to `public/js/boot.js` (loading screen character), `public/js/commitment.js` (real debt amount)
**Risk:** Low — CSS-only for most, small JS for items 2 and 5

---

## Recommended Execution Order

### Session 1 (~$20-25)
- **Workstream 1: Card gradients** ($8-10)
- **Workstream 3: Consolidation Phase 1** ($12-15)

*Why first:* Gradients are quick and visually satisfying. Consolidation has the highest product impact — after this session, `/play` is the main app.

### Session 2 (~$15-20)
- **Workstream 2: Card animations** ($15-20)

*Why second:* Animations are the most time-intensive and need browser tuning. Dedicating a full session means no rushing.

### Session 3 (~$15-18)
- **Workstream 4: Styling & polish** ($15-18)

*Why last:* These are refinements. They make the most sense after the structural work (consolidation) and visual work (gradients/animations) are done.

---

## What's NOT in This Proposal

- **Absorbing vNext features into play** (Explore the climb, Today section, Next move panel) — separate proposal after consolidation Phase 1 is live
- **Converting `steward-vnext.js` to a module** — part of the consolidation roadmap, Phase 2
- **CSS file split by feature** — optional, low priority
- **Backend changes** — none needed, server-side is clean
- **New features** — this is a rebuild/polish, not a redesign

---

## Summary

| Workstream | Cost | Impact | Risk |
|-----------|------|--------|------|
| 1. Card gradients | $8–10 | Visual polish | Low |
| 2. Card animations | $15–20 | Character personality | Medium |
| 3. Consolidation Phase 1 | $12–15 | Product structure | Low |
| 4. Styling & polish | $15–18 | UI refinement | Low |
| **Total** | **$50–63** | | |

All proposals, comparison docs, and analysis from previous sessions are saved and ready to reference when you start each workstream.
