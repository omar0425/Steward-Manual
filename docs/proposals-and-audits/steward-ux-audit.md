# Steward — UX, Layout & Logic Audit + Roadmap to a 10/10 Fintech App

_Account-agnostic audit. All findings describe app behavior, layout, semantics, and calculation logic — verified via live DOM/CSS inspection — and apply to any user, not a specific account. App version observed: v1.22.0 (3e703bc)._

---

## How to read this document

This audit is written so any developer on the team can act on it without access to a specific user account. Where a number is referenced, treat it as an illustrative placeholder (e.g. "net" vs "gross" paydown), not a real balance. The core message: the calculation engine and responsive foundations are sound. The gap to a 10/10 is largely **clarity, semantics, and polish**, plus a small number of genuine code-level bugs.

---

## 1. Verified-correct (do not "fix" these)

Validated against the calculation logic and data model. Listed so the team does not spend cycles "fixing" correct behavior.

- **Per-account "% paid"** is computed against each account's own starting balance and is accurate to rounding.
- **The climb baseline** is internally consistent: it equals the sum of each account's starting balance, and correctly increases when a user adds new accounts during onboarding. A rising total after adding accounts is expected, not a bug.
- **Gross vs. net paydown are both individually correct.** "Total payments made" (gross) minus interest accrued equals "principal cleared / net since start." The difference is exactly the logged interest.
- **Monthly interest cost** (per-account and total) matches balance x APR / 12.
- **Strategy recommendations** are correct: avalanche surfaces the highest-APR account; snowball ("quick win") surfaces the smallest balance.
- **0% APR accounts are valid input** (promo balance transfers, BNPL plans, family loans). The app is right to accept them.
- **Accessibility baseline is better than typical:** icon-only buttons carry aria-labels, the theme toggle uses aria-pressed, images have alt text, lang is set, the data-sync strip has aria-label + descriptive title tooltips, and muted text meets WCAG AA contrast (~5.4-6.6:1).

---

## 2. Real bugs (genuine defects, account-agnostic)

### 2.1 — Nickname generator collapses to one value
The AI nickname map assigns **the same nickname to every account**. Each account should receive a distinct nickname, or none. This is a generation/assignment bug, not a display issue.
**Fix:** ensure the nickname function keys off a per-account property and de-duplicates; add a test asserting uniqueness across N accounts.

### 2.2 — Live "interest accruing" counter shows 4 decimal places
The real-time interest ticker renders values like `$0.0514`, which reads as a glitch for a currency value.
**Fix:** format to 2 decimals, or reframe as "≈ $X.XX accrued today" with whole-cent display and a smooth animation.

### 2.3 — Unreconciled interest figure
The dashboard shows a verified monthly interest cost ("~$/mo right now") **and** a separate "est. from APRs" figure that does not tie out to it.
**Fix:** display one canonical monthly-interest number, or clearly label the second as a different metric (e.g. annualized estimate) with its formula in a tooltip.

---

## 3. Clarity issues (numbers are correct, presentation misleads)

Highest-value fixes for a fintech product — they directly affect trust. The math is right; the labeling makes correct numbers look contradictory.

### 3.1 — Gross vs. net "paid down" are not visually distinguished
The app surfaces two legitimate but different figures:
- **Net cleared vs. start** = baseline − current balance.
- **Total payments made (gross)** = cumulative sum of all payments logged.

The difference is the interest that grew balances back. The logic is even documented in a hover title tooltip ("payments reduced your balances, minus interest that grew them = net"), **but that explanation is hidden on hover** while both numbers appear in separate cards labeled simply "paid." A user (or auditor) sees two different "paid" numbers and assumes a bug.
**Fix:** label them distinctly and persistently inline, e.g. **"Net cleared vs. start"** and **"Total payments made (before interest)."** Surface the existing tooltip text as visible helper copy. Apply the same wording to the conversational "Ask the Steward" answers, which currently quote the gross figure while the hero cards show net.

### 3.2 — "Average APR across your debts" excludes 0% accounts without saying so
The displayed average is a balance-weighted average of **interest-bearing accounts only**, silently excluding 0%-APR accounts — which can be a large share of total balance. This inflates the apparent blended rate.
**Fix:** either (a) relabel to **"Average APR on interest-bearing debt,"** or (b) show the true all-in blended rate across every account. Do not exclude 0% accounts silently.

### 3.3 — Forecast date can swing widely between sessions
Because the projected debt-free date is derived from recent pace, it can jump dramatically as inputs change.
**Fix:** present a **range with a confidence band** ("debt-free between X and Y at your recent pace") rather than a single hard date. More honest, and less anxiety-inducing for a debt context.

---

## 4. Accessibility & semantics

### 4.1 — Heading structure is too flat and has multiple H1s
The dashboard renders **two h1 elements** and very few headings overall; card titles are styled paragraphs/spans (e.g. class "tc-section-label") rather than semantic headings.
**Fix:** exactly one h1 per view; promote card titles ("Pay this next," "Debt accounts," "Ask the Steward," "Stage progress," etc.) to h2/h3. Dense financial dashboards are far easier to navigate by screen reader with a correct heading outline.

### 4.2 — Announce dynamic updates
The live interest counter and the asynchronous "Ask the Steward" answers update without being announced.
**Fix:** add aria-live="polite" to those regions so assistive tech announces changes.

### 4.3 — Confirm visible focus states
Verify every interactive control (chips, toggles, table controls, FAB, CSV/JSON/Restore) has a clearly visible keyboard focus ring in both themes.

### 4.4 — Small type
Some table sub-text (the APR line) renders at ~10px. It passes contrast but is small.
**Fix:** raise to >=12px, or expose a density/text-size preference.

---

## 5. Layout & responsiveness

**Verdict: well-built.** Verified directly from the CSS, not assumed.

- Breakpoint system exists at **1200 / 900 / 700 / 600 / 560 / 480px**, plus prefers-reduced-motion.
- The two-column dashboard is a **progressive enhancement gated at >=1200px**; below that the layout falls back to a single stacked column (base is flex-column). Clean degradation.
- At <=900px the hero collapses and tier cards center at min(240px, 90vw).
- At <=600px the nav simplifies (brand text/badge hidden), the floating action button collapses to an icon, panel padding tightens, and **tap targets increase to 44px** (meets platform minimums); confirm buttons reach 48px at <=480px.
- At <=560px the debt table drops its trend/sparkline column and rescales fonts.
- At <=480px the question chips and inputs reflow to full width.

### Responsive items to tighten
- **Stat-card grid stays 2-up at very small widths** (~320px), which can feel cramped. Consider collapsing to a single column under ~360px.
- **Large display numerals** in the hero should be checked for overflow/wrapping at 320px; consider clamp() font sizing.
- **APR sub-text at ~10px** — see 4.4.

> Testing note: automated viewport resizing was constrained in this environment, so responsiveness was audited by reading the actual media-query rules rather than by rendering each width. A quick manual pass in device emulation at 320/375/390/768px is recommended to confirm the hero-numeral and stat-card edge cases.

---

## 6. UX polish (quick wins)

- **"Show all accounts" toggle** required two activations to expand in testing — make it a single reliable toggle with clear expanded/collapsed state.
- **Theme button visible label** reads as the current state ("Dark") even though the aria-label ("Switch to light mode") is correct. Align the visible label with the action, or make the toggle visually unambiguous.
- **"What-if extra payment" control defaults to $0**, so it doesn't demonstrate its own value — default to a small positive amount.
- **Data freshness/staleness** indicator lives mainly in the footer strip; surface a staleness flag near the headline numbers when data is old.
- **Hide empty metadata fields** (e.g. a "Session" field showing a dash) when they have no value.

---

## 7. Roadmap to a 10/10 fintech app

Prioritized themes that move the product from "polished tracker" to "best-in-class." For fintech the differentiators are **trust, clarity, decision support, and healthy momentum.**

### Phase 1 — Trust & correctness clarity (ship first)
1. Implement gross-vs-net labeling (3.1) and the APR-average relabel (3.2) everywhere the numbers appear, including conversational answers.
2. Fix the real bugs: nickname uniqueness (2.1), currency formatting on the live counter (2.2), and the unreconciled interest figure (2.3).
3. Add a persistent **"How is this calculated?"** affordance on every derived value (blended APR, projected payoff date, monthly interest, net vs gross). Promote existing hover tooltips into tappable, always-available explanations. Opaque math is the single biggest trust-killer in fintech.

### Phase 2 — Decision support
4. Turn "Pay this next" into an interactive planner: let the user set a real monthly payment and see a **side-by-side comparison** of avalanche vs. snowball — payoff date, total interest paid, and dollars saved — then commit to a plan.
5. Show forecasts as **ranges with confidence bands** (3.3) instead of single dates.

### Phase 3 — Momentum & behavior (handled sensitively)
6. Reinforce the stage/streak system with milestone celebrations (first account fully paid, first major principal milestone) and a gentle weekly "one move that helps most" nudge — never pressure, given the emotional weight of debt.
7. Provide a clear, single **"next best action"** CTA on load.

### Phase 4 — Onboarding & data entry
8. Reduce manual-entry friction: smart APR defaults by account type/name, inline validation, and a prominently surfaced **undo** for every edit (the undo capability already exists in state — make it visible).
9. Add a "data as of" timestamp with one-tap recalculate, reinforcing freshness and trust.

### Phase 5 — Accessibility & platform polish
10. Fix heading structure (4.1), add aria-live regions (4.2), verify focus states (4.3), and address small type / responsive edge cases (Section 5).

---

## Appendix — Verification methods used
- Live DOM inspection of component markup (stat grid, debt table, data-sync strip, nav, theme toggle) to confirm semantics and labels.
- CSS inspection of all max-width media-query rule bodies to confirm responsive behavior at each breakpoint.
- Computed-style contrast and font-size sampling on muted/label text.
- Calculation reconciliation of gross vs. net paydown, blended APR, and monthly interest against the underlying data model (generalized; no account-specific values retained in this document).

_End of audit._
