# Steward — Card Improvement Proposal

## For: Omar + team
## Date: April 2026
## Status: PROPOSAL — no code changes until approved

---

## What This Covers

Improvements to all 10 tier cards — both the **card background gradients** (in `style.css`) and the **character animations** (in `character.js`). The goal: each card should feel like a distinct emotional stage, and the character's motion should match what's happening at that tier.

No changes to tier logic, math, copy, or API. CSS + animation only.

---

## Current State

**What's already working well:**
- 60+ CSS variables per tier controlling pose, clothing, face, accessories
- Character progressively stands upright from Rock Bottom → Wealthy
- Clothing repairs itself (tattered → pristine), colors warm up, accessories appear
- Facial expression evolves (X-eyes → open eyes, frown → smile)
- Props accumulate (sign → cane → money → sparkles → dog → mansion → car)

**What's weak:**
- The idle animations are measured in fractions of pixels — nearly invisible on showcase cards
- Tiers 01-03 all use the same trembling keyframe (`swTremble1`) at different speeds
- Tiers 04-06 all do essentially the same gentle vertical lift (0.8px, 1.1px, 1.3px) — feel identical
- Card gradients for early tiers feel flat compared to the richly layered upper tiers
- Middle tier (04-06) card colors all trend green and blur together in the showcase grid

---

## Proposed Changes — Card by Card

### Tier 01: Rock Bottom

**Current animation:** `swTremble1` at 2.1s — fast jittery trembling.
**Current gradient:** Dark maroon, single radial glow at center.

| What | Change | Why |
|------|--------|-----|
| **Gradient** | Add a subtle dark grain/noise texture via pseudo-element at 4% opacity. Deepen the bottom-edge shadow gradient. | Rock Bottom should feel heavy and gritty, not just dark. |
| **Sign sway** | New keyframe: the "will budget 4 food :(" sign swings ±6deg on a 3.5s loop. | The sign is the character's most expressive prop here — it should move like it's barely held up. |
| **Hat wobble** | Increase hat settle from 0.22deg to 1.8deg. | The hat is falling apart (tattered clip-path) — it should wobble like it's about to fall off. |
| **Stagger** | Add a secondary keyframe on `--chest-tilt`: periodic 3deg lean to one side before self-correcting. 5s cycle. | Conveys exhaustion — the character can't hold steady. |

---

### Tier 02: Broke

**Current animation:** `swTremble1` at 2.7s — same trembling, slightly slower.
**Current gradient:** Grey-charcoal, single radial glow.

| What | Change | Why |
|------|--------|-----|
| **Gradient** | Add a cold undertone — shift the radial glow from neutral grey to slightly blue-grey (`rgba(120,130,148,0.3)`). Subtle vignette on edges. | Broke should feel cold and metallic, distinct from Rock Bottom's angry maroon. |
| **Tremble → weary sway** | Replace `swTremble1` with a new `swMotionBrokeWeary` — slower, asymmetric sway with a periodic head dip (via `--head-tilt` from -6deg to -12deg and back). 4s cycle. | Broke isn't jittery — it's tired. The head drop says "I'm exhausted" more than trembling does. |
| **Sign sway** | Same sign sway as Rock Bottom but slower (5s loop, ±4deg). | Still holding the sign but with less energy. |
| **Hat wobble** | Increase to 1.2deg (less than Rock Bottom — hat is still tattered but slightly more stable). | Visual progression from 01. |

---

### Tier 03: Struggling

**Current animation:** `swTremble1` at 3.5s — same trembling, slowest.
**Current gradient:** Muted red-brown, single radial glow.

| What | Change | Why |
|------|--------|-----|
| **Gradient** | Add a warm ember undertone — second radial gradient at bottom (`rgba(180,80,40,0.12)`) suggesting heat/effort. Slightly more saturated than current. | Struggling has momentum — it should feel warm, not dead. |
| **Posture correction** | New `swMotionStruggleCorrect` — character periodically straightens up (pose-rotate goes from -6deg toward -2deg) then slowly falls back. 6s cycle. | This is the "trying to stand" tier. The animation should show effort, not just instability. |
| **Sign fade** | Sign opacity at 0.50 (already set) but add a slow pulse: 0.50 → 0.35 → 0.50 on a 4s cycle. | The sign is being let go — not gone yet, but fading. |
| **Monocle glint** | Activate the monocle glint here (currently only fires at tier 05+). Single glint per cycle. | First sign of the character's identity returning. |

---

### Tier 04: Surviving

**Current animation:** `swMotionSurvive` — 0.8px vertical lift. Nearly invisible.
**Current gradient:** Olive-gold, warm. Currently trends green and blurs with 05/06.

| What | Change | Why |
|------|--------|-----|
| **Gradient** | Shift warmer — replace green undertones with amber/olive (`rgba(180,155,80,0.25)` radial). Distinct from the cooler greens of 05/06. | Surviving is halfway — it should feel warm and earned, not yet "green/go." |
| **Weight shift** | New `swMotionSurviveShift` — slow left-right weight transfer via `translateX(-1px)` to `translateX(1px)` on a 4.5s cycle. | Finding footing. The first tier where motion is controlled, not chaotic. |
| **Breathing** | Add subtle chest scale pulse: `--pose-scale` oscillates 0.98 → 1.00 → 0.98 on 3.5s cycle. | The character is catching their breath. Alive, not just static. |
| **Cane grip** | Cane angle oscillates ±2deg on a 5s cycle. | Leaning on the cane — using it for support, not decoration. |

---

### Tier 05: Stabilizing

**Current animation:** `swMotionStabilize` — 1.1px vertical lift. Nearly identical to Surviving.
**Current gradient:** Medium green. Current default — no strong personality.

| What | Change | Why |
|------|--------|-----|
| **Gradient** | Keep the green but add more depth — second radial gradient at top-left (`rgba(160,210,140,0.15)`) for light source. Slightly cooler than Surviving. | Growing confidence, settling into control. |
| **Cane tap** | New `swCaneTap` — cane angle shifts 1deg → -3deg → 1deg on a 3s cycle with sharp easing. | The character is tapping the cane — a small assertion of control. A habit forming. |
| **Chest breathing** | More pronounced than Surviving: `--chest-tilt` oscillates 1.5deg → 0deg → 1.5deg on 4s. | Measured, confident breathing. Not catching breath — breathing steadily. |
| **Monocle** | Glint fires on a 4.2s cycle (already exists, just ensuring it's active at this tier). | Sharpening focus. |

---

### Tier 06: Stable

**Current animation:** `swMotionStable` — 1.3px vertical lift. Nearly identical to 04/05.
**Current gradient:** Deeper green. Blurs with 05 in the showcase.

| What | Change | Why |
|------|--------|-----|
| **Gradient** | Push cooler and deeper — shift toward forest green (`rgba(30,100,70,0.28)` radial) with a faint teal edge highlight. Clearly distinct from 05's lighter green. | Stable is settled. Deep, not light. Confident, not tentative. |
| **Proud breathing** | `--chest-tilt` oscillates 0deg → -2deg → 0deg on 4.5s — chest out, then relaxes. Combined with subtle `--pose-scale` 1.02 → 1.04 → 1.02. | The first tier where the character looks comfortable. Breathing is pride, not recovery. |
| **Head steady** | Remove any residual head tilt oscillation. Head stays rock-solid at 0deg. | Stable means stable. The head doesn't waver. |
| **Ground shadow** | Ground shadow scale pulses slightly with breathing (1.16 → 1.20 → 1.16). | Grounding effect — the character feels heavier, more present. |

---

### Tier 07: Building

**Current animation:** `swMotionBuild` — 4px bounce up. Good energy.
**Current gradient:** Deep navy blue. Good contrast with the greens.

| What | Change | Why |
|------|--------|-----|
| **Gradient** | Add a second radial glow at bottom (`rgba(60,100,200,0.15)`) for depth. Faint blue-white highlight at top edge. | Building should feel like potential energy. The blue is right — add depth. |
| **Head look-up** | `--head-tilt` oscillates 1.5deg → 4deg → 1.5deg on same timing as the bounce. | The character periodically looks up — toward the next tier. Forward-looking energy. |
| **Coin bounce** | Already has `coinBounceUp` at 1.7s. Keep it. Make the coin scale slightly larger during bounce peak (`transform: scale(1.1)` at apex). | Coins are more visible, emphasizing financial momentum. |
| **Cane confidence** | Cane angle holds steady at -2deg with a periodic confident shift to -5deg and back on 4s. | The cane is no longer for support — it's a tool of presence. |

---

### Tier 08: Thriving

**Current animation:** `swMotionThrive` — 6px bounce. Has aura pulse + halo ring.
**Current gradient:** Deep purple. Good distinctiveness.

| What | Change | Why |
|------|--------|-----|
| **Gradient** | Enhance the inner purple glow — increase radial opacity from 0.4 to 0.5. Add a faint warm highlight at top-right (`rgba(180,140,255,0.08)`). | Thriving should feel rich and rare. The purple is right — make it glow more. |
| **Stance widening** | On each bounce cycle, `--stance` oscillates 32px → 36px → 32px. | Wider stance = more confidence. The character takes up space. |
| **Hat flair** | Hat settle increases from 0.22deg to 1.5deg with a slight tip at the peak of the bounce. | The hat sits with swagger. First tier where the hat feels intentional, not just worn. |
| **Halo visibility** | Increase halo border opacity from 0.40 to 0.55. Halo pulse timing syncs with aura pulse (1.9s). | The halo is there but barely visible. Make it clearly noticeable. |
| **Sparkle drift** | Add lateral drift to sparkles: sparkleFloat gains ±3px translateX. | Sparkles feel alive, not just bobbing vertically. |

---

### Tier 09: Winning

**Current animation:** `swMotionWin` — 2.5px steady float. Has gold aura + halo.
**Current gradient:** Teal-aqua. Distinctive and premium.

| What | Change | Why |
|------|--------|-----|
| **Gradient** | Add a second radial glow at bottom-center (`rgba(20,80,100,0.3)`) for oceanic depth. Slightly more saturated teal at the edges. | Winning is nearly there — should feel expansive, like open water. |
| **Cane flourish** | New `swCaneFlourish` — cane angle oscillates -8deg → -14deg → -8deg on 5s cycle. Subtle outward gesture. | A gentleman's cane twirl. The first tier where the cane is for show, not function. |
| **Hat glint** | Increase `swHatGlint` frequency — fire every 3.5s instead of 5.2s. | The hat is polished. Light catches it more often. |
| **Gold aura breathing** | Aura pulse timing tightened: 1.65s → 1.4s. Scale oscillation 1.0 → 1.09 (up from 1.07). | The gold energy is building. Almost at the summit. |
| **Vest glow** | Vest already has `box-shadow` glow. Add a subtle pulse: glow radius oscillates 24px → 30px → 24px on 2s. | The gold vest catches light rhythmically. |

---

### Tier 10: Wealthy

**Current animation:** `swMotionLuxury` — 2px minimal float. Has full gold aura, halo, dog, mansion, Mercedes.
**Current gradient:** Gold layered — already the best card. Multiple radial gradients + gold outer glow.

| What | Change | Why |
|------|--------|-----|
| **Gradient** | Enhance the top highlight — increase the white-gold radial from 0.72 to 0.80 opacity. Add a subtle shimmer pseudo-element (a slow-moving linear gradient at 3% opacity, 12s cycle). | The wealthy card should feel like it's glowing from within. A living gradient. |
| **Regal sway** | New `swMotionLuxurySway` — add ±0.8px lateral translateX on an 8s cycle. Ultra-slow, barely perceptible. | Surveying the domain. The character doesn't bounce or bob — they drift. |
| **Dog sync** | Dog tail wag (0.5s) timing stays. Add a subtle body bob to the dog synced with the character's sway. | The dog responds to the character's presence. |
| **Mercedes glow** | Headlight flash animation already exists. Make it slightly more visible: increase glow radius from `8px 3px` to `10px 5px`. | The car is a trophy. Its lights should catch your eye. |
| **Mansion warmth** | Window flicker is good. Lantern glow amplitude increases: `8px` → `14px` base glow. | The mansion feels lived in. Warm. Earned. |
| **Crown shimmer** | The wealthy card has no crown animation. The hat-ding (hat glint) should fire on a slow 8s cycle. | At the top, even small details matter. The hat gleams rarely but memorably. |

---

## Card Gradient Summary

| Tier | Current Feel | Proposed Feel | Key Change |
|------|-------------|---------------|------------|
| 01 Rock Bottom | Dark maroon, flat | Gritty, textured | Grain texture + deeper shadows |
| 02 Broke | Grey, neutral | Cold, metallic | Blue-grey shift + edge vignette |
| 03 Struggling | Muted red-brown | Warm ember | Bottom heat glow + more saturation |
| 04 Surviving | Green (blurs with 05/06) | Amber-olive (warm, distinct) | Shift away from green toward gold |
| 05 Stabilizing | Medium green | Brighter green with light source | Top-left radial highlight |
| 06 Stable | Deeper green (blurs with 05) | Forest green with teal edge | Cooler, deeper, more distinct |
| 07 Building | Navy blue | Deeper navy with blue-white edge | Bottom glow + top highlight |
| 08 Thriving | Purple | Richer purple with warm highlight | Enhanced inner glow |
| 09 Winning | Teal-aqua | Deeper teal with oceanic depth | Bottom radial + edge saturation |
| 10 Wealthy | Gold layered (best card) | Gold with inner shimmer | Moving shimmer + brighter top highlight |

---

## Animation Summary

| Tier | Current Motion | Proposed Motion | Emotional Read |
|------|---------------|----------------|----------------|
| 01 | Fast tremble | Tremble + stagger + sign sway + hat wobble | Broken, barely standing |
| 02 | Medium tremble | Weary sway + head drop + slow sign sway | Exhausted, not jittery |
| 03 | Slow tremble | Posture correction cycle + sign fade pulse | Trying to stand, fighting |
| 04 | 0.8px lift | Weight shift + breathing + cane grip | Finding footing |
| 05 | 1.1px lift | Cane tap + steady breathing + monocle glint | Asserting control |
| 06 | 1.3px lift | Proud breathing + solid head + ground pulse | Comfortable, settled |
| 07 | 4px bounce | Bounce + head look-up + coin emphasis + confident cane | Forward energy |
| 08 | 6px bounce | Bounce + wider stance + hat flair + visible halo | Taking up space |
| 09 | 2.5px float | Float + cane flourish + hat glint + gold pulse | Gentleman's ease |
| 10 | 2px micro-float | Regal sway + dog sync + car glow + mansion warmth | Surveying the domain |

---

## Constraints

- No changes to tier logic, math, thresholds, or copy
- No changes to the character's fundamental pose or visual identity
- No new HTML elements (animation only via CSS keyframes and existing CSS variables)
- No changes to the backend
- All changes in `style.css` (gradients) and `character.js` (animations)
- The character should still be immediately recognizable as the same character at every tier

---

## Risk

**Medium.** Animation timing is subjective — some changes might feel too busy or too subtle until tuned in the browser. Mitigation: I'll implement, screenshot all 10 cards, and send a before/after comparison before creating a PR. If any card feels wrong, we adjust before committing.

---

## Effort Estimate

~3-4 hours for all 10 cards (gradients + animations + testing + screenshots).
