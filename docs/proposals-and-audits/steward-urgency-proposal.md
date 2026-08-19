# Steward — Urgency + Intensity Pass: Implementation Proposal

No architecture changes. Same layout. We're turning up the pressure dial.

---

## 1. Hero — Hit Hard

### Current → Proposed

| Element | Current | Proposed |
|---------|---------|----------|
| **Primary number** | `$2,500` at `2.8rem`, Playfair Display | `$2,500 LEFT` at `3.6rem`, heavier weight, tighter letter-spacing |
| **Label above number** | `"to next stage"` (lowercase, soft) | `"ESCAPE STRUGGLING"` (uppercase, bold, urgent) |
| **Tier transition line** | `"Struggling → Surviving"` at `1.05rem` | Same text, bumped to `0.85rem` — secondary to the number |
| **Hero padding** | `gap: 6px` between info elements, `padding-top: 4px` | `gap: 4px`, `padding-top: 0` — compress everything tighter |
| **Daily move line** | `"That's ~$84/day for 30 days"` (italic, passive) | `"$84/day × 30 days = freedom"` (direct, not italic) |

### CSS changes:
- `.hero-primary-number`: `font-size: 2.8rem` → `3.6rem`, add `text-shadow: 0 2px 8px rgba(0,0,0,0.08)`
- `.hero-primary-label`: Change from `"to next stage"` to dynamic `"ESCAPE [TIER]"` in render.js. `font-size: 0.82rem` → `0.72rem`, `font-weight: 600` → `800`, `letter-spacing: 0.08em` → `0.14em`
- `.unified-hero-info`: `gap: 6px` → `4px`, `padding-top: 4px` → `0`
- `.hero-daily-move`: Remove `font-style: italic`
- Progress bar: move closer to number by reducing margin

**Cost: ~$3-4**

---

## 2. Restore Tension (Reduce Softness)

### Current → Proposed

| Element | Current | Proposed |
|---------|---------|----------|
| **Panel backgrounds** | Soft gradients with 0.24 opacity white overlay | Reduce overlay to 0.12, let darker backgrounds show through |
| **Panel borders** | `var(--line)` (very subtle) | Sharpen to `var(--line-strong)` on key sections |
| **Hero card column gap** | `28px` | `20px` — compress |
| **Section spacing** | Default grid gap (generous) | Tighten dashboard grid gap from `28px` to `20px` |
| **Badge pills** | Soft rounded, light borders | Slightly smaller radius (`6px` not `99px`), slightly bolder borders |

### CSS changes:
- `.panel` background gradient: white overlay opacity `0.24` → `0.12`
- `.unified-hero-inner`: `gap: 28px` → `20px`
- Dashboard grid gap: `28px` → `20px`
- `.hero-badge-pill`: `border-radius: 99px` → `6px`, `border-width: 1px` → `1.5px`

**Cost: ~$2-3**

---

## 3. Tier Cards — Identity + Contrast

### Current → Proposed

| Element | Current | Proposed |
|---------|---------|----------|
| **Current tier card** | Normal gradient, "YOU ARE HERE" badge | Add subtle outer glow (`box-shadow: 0 0 16px rgba(...)`) to make it pop |
| **Next tier card** | `opacity: 0.55`, `saturate(0.4) brightness(0.85)` | `opacity: 0.4`, `saturate(0.25) brightness(0.75)`, add `filter: blur(0.5px)` — more clearly locked |
| **Lock badge** | `"🔒 UNLOCK AT $2,500 PAYDOWN"` | `"🔒 LOCKED — $2,500 TO UNLOCK"` — more aggressive phrasing |
| **Card padding** | `22px 20px 18px` | `18px 18px 14px` — tighter |

### CSS changes:
- `.tier-card-current`: Add `box-shadow: 0 0 20px rgba(var(--tc-glow), 0.25), 0 6px 24px rgba(0,0,0,0.15)`
- `.tier-card-locked`: `opacity: 0.55` → `0.4`, add `blur(0.5px)` to filter, darken more
- `.tier-card`: `padding: 22px 20px 18px` → `18px 18px 14px`

**Cost: ~$2-3**

---

## 4. CTA — Push, Not Suggestion

### Current → Proposed

| Element | Current | Proposed |
|---------|---------|----------|
| **CTA text** | `"Move $84 today"` | `"Move $84 now"` |
| **CTA size** | `padding: 10px 22px`, `font-size: 0.82rem` | `padding: 12px 28px`, `font-size: 0.88rem` |
| **CTA shadow** | `0 2px 8px rgba(0,0,0,0.12)` | `0 4px 16px rgba(0,0,0,0.2)` — heavier |
| **CTA background** | Gradient matching tier | Same but with slightly darker end stop |
| **Hover** | `scale(1.04)` | `scale(1.06)` — more responsive feel |

### JS change:
- render.js: `"Move ${fmtDollar(daily)} today"` → `"Move ${fmtDollar(daily)} now"`

**Cost: ~$1-2**

---

## 5. Chart — Increase Authority

### Current → Proposed

| Element | Current | Proposed |
|---------|---------|----------|
| **Line thickness** | `2px` stroke | `2.5px` stroke |
| **Grid lines** | Light opacity | Slightly bolder (opacity +0.1) |
| **Chart header** | `"The real climb"` at standard weight | Same text, bump weight to `900`, add bottom border separator |

### CSS changes:
- SVG stroke-width: `2` → `2.5`
- Grid line opacity: bump by 0.1
- `.nw-chart-header`: add `border-bottom: 1px solid var(--line)`, `padding-bottom: 10px`

**Cost: ~$1-2**

---

## 6. Density Over Air

### Current → Proposed

| Element | Current | Proposed |
|---------|---------|----------|
| **Dashboard section gap** | `28px` | `20px` |
| **Metric cell padding** | `18px 12px` | `14px 12px` |
| **Tier cards section padding** | `22px 24px` | `18px 20px` |
| **Debt list / Next move padding** | `22px 24px` | `18px 20px` |

**Cost: ~$1**

---

## 7. Restore Cumulative Paydown Stat

The old dashboard prominently showed **"You've reduced $12,500"** — a lifetime progress number. The new dashboard dropped this entirely. It needs to come back.

### Implementation:
- Add a **hero badge pill** next to streak and breathing room: `"↓ $12,500 paid down"`
- Pulls from `cumulativePaidDown` in climb metrics (already computed server-side)
- Styled as a green-tinted badge pill to signal positive progress

### Why it matters:
- On bad days, the user sees the gap and feels pressure (good)
- But they also need to see how far they've come — this is the "you're not starting from zero" signal
- It's the counterbalance to urgency: **pressure + proof = motivation**

**Cost: ~$2-3**

---

## 8. Onboarding Overlay (Phase 7 — Not This Pass)

The old dashboard had a 9-step walkthrough overlay ("Step 1 of 9: This is your main number..."). The new dashboard doesn't have this. New users would be lost without it.

**Not building now** — this is already in the roadmap (Phase 7, $15-20). Noting it here so we don't forget it was removed.

---

## 9. What We DON'T Touch

- Unified hero structure (stays)
- Current + next tier card system (stays)
- Simplified section layout (stays)
- Metrics row 4-item structure (stays)
- Dark mode support (stays, benefits from contrast increases)
- Mobile responsiveness (stays)

---

## Total Estimate

| Change | Cost |
|--------|------|
| Hero urgency (copy, sizing, spacing) | $3-4 |
| Tension restoration (contrast, borders, softness) | $2-3 |
| Tier card identity (glow, lock, contrast) | $2-3 |
| CTA push (copy, weight) | $1-2 |
| Chart authority (line weight, grid, header) | $1-2 |
| Density compression (spacing throughout) | $1 |
| Cumulative paydown stat (restore from old) | $2-3 |
| Onboarding overlay (Phase 7 — deferred) | $0 now |
| **Total** | **$12-18** |

---

## Before / After Summary

**Before (current):** Clean, calm, informational. The user sees data.
**After (proposed):** Compressed, sharp, pressure-focused. The user feels urgency.

The app opens and the first thing you see is:

```
ESCAPE STRUGGLING
$2,500 LEFT
███████████████░░░░░░░░ 50.0%
🔥 1-period streak  ≈2.7mo runway  ↓$12,500 paid down
Move $84 now
```

Not:

```
Struggling → Surviving
$2,500
to next stage
That's ~$84/day for 30 days
Move $84 today
```

The paydown badge gives you proof. The number gives you pressure. Together they drive action.

---

Want me to proceed with implementation?
