# Steward Dashboard — Hybrid Proposal

## Concept

**Top = Pressure. Middle = Proof. Bottom = Action.**

Keep the urgency-styled new layout as the top half. Restore the substance sections from the old dashboard below — but styled with the urgency treatment (tighter, sharper, darker). The page should feel like a real financial product, not a stripped-down prototype.

---

## Layout Order (top to bottom)

| # | Section | Source | Status |
|---|---------|--------|--------|
| 1 | **Unified Hero** (character + gap + CTA) | NEW (PR #8) | Keep as-is with urgency pass |
| 2 | **Metrics Row** (net worth, change, cash flow, breathing room) | NEW (PR #8) | Keep as-is |
| 3 | **Tier Cards** (current + next, 2 cards only) | NEW (PR #8) | Keep as-is with glow/dimming |
| 4 | **Stage Progress** ← RESTORE | OLD (main) | Bring back with urgency styling |
| 5 | **Net Worth Chart** | NEW (PR #8) | Keep as-is |
| 6 | **Financial Position** ← RESTORE | OLD (main) | Bring back with urgency styling |
| 7 | **Debt List** | NEW (PR #8) | Keep as-is |
| 8 | **Next Move** | NEW (PR #8) | Keep as-is |
| 9 | **Sync Strip** | NEW (PR #8) | Keep as-is |

---

## Section Details

### 1–3: PRESSURE ZONE (keep from new)

Already implemented with urgency pass:
- Hero: "ESCAPE STRUGGLING" + "$2,500 LEFT" at 3.6rem
- Metrics: compressed 14px padding
- Tier cards: current glow, locked dimming (no blur)

No changes needed here.

### 4: STAGE PROGRESS (restore from old)

**What it was in the old version:**
- "Pace inside this payoff stage" header
- Tier lane: `[Struggling] → [Surviving]` pill badges
- Stage gap: "$2,500" with label
- Progress bar showing % through current stage
- Pace stats: lead line, lifetime climb, delta, pace, projection
- "This turn" summary: per-account paydown/new-debt breakdown
- Paid down display with feedback badge

**Why restore it:**
This section is the *substance* — it proves the app is actually tracking your pace, projecting your payoff timeline, and analyzing each turn. Without it, the dashboard feels like a scoreboard with no game tape.

**Urgency styling adjustments:**
- Tighter padding (match new dashboard density)
- Sharper borders (1.5px solid)
- Stage gap headline: bold, high contrast
- Progress bar: use new urgency accent colors
- Projection line: make it feel like a countdown, not a forecast

**Cost: ~$8-12** (HTML already exists, CSS needs urgency pass, render.js hooks still work)

### 5: NET WORTH CHART (keep)

Already has urgency pass (thicker line, bolder grid, header with border-bottom). No changes.

### 6: FINANCIAL POSITION (restore from old)

**What it was in the old version:**
- "Financial position" header with payoff stage + breathing room pills
- Debt remaining vs Net worth (side by side, big numbers)
- Breathing room progress bar (toward 2.0 month goal)
- Health grid: income, expenses, cash/assets, asset runway
- Investments line with brokerage sub-note

**Why restore it:**
This is the "proof" section — it makes the app feel like a real financial tool. Without it, users don't see their full picture. This is what separates a $2.99/mo product from a free widget.

**Urgency styling adjustments:**
- Tighter health grid (less padding)
- Debt remaining number: red-tinted, high contrast
- Net worth number: green if positive, red if negative
- Breathing room bar: accent-colored, clearer goal marker
- Remove "Proof — Full ledger follows" bridge separator (unnecessary fluff)

**Cost: ~$8-12** (HTML exists, CSS needs urgency pass, render.js hooks still work)

### 7–9: ACTION ZONE (keep from new)

Debt list, next move, sync strip — already implemented. No changes.

---

## What stays removed (intentionally)

| Section | Why it stays removed |
|---------|---------------------|
| **10-tier explore rail** | Replaced by 2 focused tier cards — cleaner, less overwhelming |
| **Journey Panel** (full payoff path bar) | Redundant with hero progress bar + stage progress |
| **Financial Bridge** ("Proof — Full ledger follows") | Decorative separator, adds no value |
| **Checkpoints** (sync cadence detail) | Replaced by compact sync strip — same info, less space |

---

## Summary

| What | Cost |
|------|------|
| Restore Stage Progress section + urgency styling | ~$8-12 |
| Restore Financial Position section + urgency styling | ~$8-12 |
| **Total** | **~$16-24** |
| Time | ~1-2 hours |

The result: a dashboard that hits hard at the top (urgency), proves its value in the middle (substance), and drives action at the bottom. That's a product someone pays $2.99/mo for.

---

## Before/After Feel

**Current new version:**
> Open app → see gap number → see 4 metrics → see chart → see debt list → done.
> Reaction: "Ok, I owe money. Now what?"

**Hybrid version:**
> Open app → see "ESCAPE STRUGGLING — $2,500 LEFT" (pressure) → metrics row → tier cards (identity) → pace inside this stage with projections (proof you're being tracked) → chart (visual progress) → financial position with health grid (the app knows everything) → debt list + next move (action).
> Reaction: "This app is tracking everything. I need to move $84 today."
