# Steward — 10 Feature Specs

> Each spec describes what it does, what existing data it uses, how it integrates with the current architecture, estimated cost, and why it matters for the product.

---

## Feature 1: Momentum Streak

**What it does**
Tracks consecutive YNAB pull periods where `debt_remaining` decreased compared to the previous snapshot. Displays a streak counter on the hero card (e.g., "🔥 5-period streak"). Breaking a streak changes the commitment screen tone — instead of "Make this real." it could show "You broke a 7-period streak. Start a new one."

**Data source**
`snapshots` table — already stores `debt_remaining` and `pulled_at` per pull. Compare sequential rows: if `snapshots[n].debt_remaining < snapshots[n-1].debt_remaining`, the streak continues.

**Schema change**
None required. Streak is computed on-the-fly from existing snapshot history. Optionally add a `config` key (`streak_best`) to persist the all-time best streak.

**Where it lives**
- Backend: New function in `services/climbMetrics.js` → `computeStreak(snapshots)` returns `{ current, best, lastBrokenAt }`
- API: Add `streak` field to `/api/status` response payload (alongside existing `stats`)
- Frontend: Display in `views/play.js` hero card section, below the tier badge

**Effort:** $8-10
**Why it matters:** Loss aversion is the strongest behavioral lever. People will avoid breaking a streak harder than they'll chase a new tier. Duolingo's entire retention model is built on this.

---

## Feature 2: Net Worth Climb

**What it does**
A single headline number: `total_assets + investment_value - total_debt`. Plotted over time as a line chart showing the trajectory from negative to positive. The moment the line crosses zero is celebrated as a milestone.

**Data source**
Already computed in `routes/api.js:109` as `adjustedNetWorth`. Historical values exist in `snapshots` table (`total_assets`, `total_debt`, `investment_value` per row). Just needs to be surfaced as a time series.

**Schema change**
None. All data already exists.

**Where it lives**
- Backend: New endpoint `GET /api/net-worth-history` — queries `recentSnapshots(n)` and maps each to `{ date: pulled_at, netWorth: total_assets + investment_value - total_debt }`
- Frontend: New collapsible section below hero card in `views/play.js`. Use a lightweight SVG line chart (no dependency — hand-draw the `<polyline>` from the data points). Show current net worth as the headline, chart below.

**Effort:** $12-15
**Why it matters:** Most people have never seen their net worth trend. Seeing it go from -$80K to -$40K feels fundamentally different than seeing "debt: $40K". It reframes the entire experience from "how much do I owe" to "how much am I worth."

---

## Feature 3: Pressure Calendar

**What it does**
A monthly heatmap grid (like GitHub's contribution graph) showing which days had YNAB snapshots and how debt changed. Green = debt decreased. Red = debt increased. Grey = no data. Intensity scales with the dollar magnitude of the change.

**Data source**
`snapshots` table — `pulled_at` (date) and `debt_remaining` (delta between consecutive pulls). Already stored, just needs visualization.

**Schema change**
None.

**Where it lives**
- Backend: New endpoint `GET /api/calendar?months=3` — returns array of `{ date, debtDelta, tier }` from snapshots
- Frontend: New collapsible section in `views/play.js`. Render as a CSS grid of small squares (7 columns for days of week, rows for weeks). Color-coded by debt delta direction and magnitude.

**Effort:** $10-12
**Why it matters:** Visualizing *when* you spend vs. when you pay down creates self-awareness without lecturing. It answers the question "am I actually making progress?" with visual evidence, not a single number.

---

## Feature 4: Tier History Timeline

**What it does**
A vertical timeline showing when the user entered and exited each tier. Each entry shows: tier name, date entered, days spent, and debt range during that tier. Example: "Rock Bottom — Jan 3 to Feb 18 (46 days) — $84K → $79K"

**Data source**
`snapshots` table — each row has a `tier` column. Walk the history and detect transitions (where `snapshots[n].tier !== snapshots[n-1].tier`).

**Schema change**
Add a `tier_transitions` table for fast lookups:
```sql
CREATE TABLE tier_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_tier TEXT,
  to_tier TEXT NOT NULL,
  transitioned_at TEXT NOT NULL,
  debt_at_transition REAL NOT NULL
);
```
Populated by a migration that walks existing snapshots, then maintained by the YNAB pull handler.

**Where it lives**
- Backend: New endpoint `GET /api/tier-history` — returns array of transition records
- Frontend: New section in `views/play.js` below hero card. Rendered as a vertical list with tier badges, dates, and duration labels.

**Effort:** $10-12
**Why it matters:** Makes the progression feel earned. "You were Rock Bottom for 46 days" has emotional weight. It transforms abstract tier labels into a personal narrative.

---

## Feature 5: Breathing Room Alert

**What it does**
When the stability metric (`effectiveRunwayMonths`) drops below the user's breathing room goal (already tracked via `breathingRoomGoalFields`), surface a prominent alert on the hero card: "Your breathing room shrank this period. Runway: 1.2 months (goal: 3 months). Here's what changed." Links to the account-level deltas from `lastPullAccountChanges`.

**Data source**
Already fully computed:
- `stability.effectiveRunwayMonths` (current runway)
- `stability.breathingRoomGoalMonths` (target)
- `stability.breathingRoomPctOfGoal` (progress %)
- `stats.lastPullAccountChanges` (per-account deltas explaining what moved)

**Schema change**
None. All data already in `/api/status` response.

**Where it lives**
- Frontend only: Conditional render in `views/play.js`. If `breathingRoomPctOfGoal < 100` AND it decreased since last render, show alert banner above the hero card with the account changes that caused the drop.

**Effort:** $5-7
**Why it matters:** Proactive, not reactive. Most apps show you stability metrics buried in a settings page. This surfaces the warning where you'll actually see it — the moment you open the app. And it tells you *why* it dropped, not just that it did.

---

## Feature 6: What-If Calculator

**What it does**
A simple input: "What if you put $X extra per month toward debt?" Shows projected tier advancement timeline. Example: "At $500/month extra, you'd reach Stable in 8 months and Wealthy in 22 months."

**Data source**
- Current `debt_remaining` from `/api/status`
- Tier thresholds from `services/tiers.js` (already has `getTier()`, `nextTierInfo()`, threshold boundaries)
- Average monthly paydown from `climbMetrics.js` (`cumulativePaidDown` / months since baseline)

**Schema change**
None. Pure computation from existing data.

**Where it lives**
- Frontend: New modal or collapsible section in `views/play.js`. Input field for extra monthly payment. JavaScript computes the projection client-side using tier boundaries from `window.TIER_META` (already exported as a global).
- No backend changes needed — all tier thresholds and current debt are already available client-side.

**Effort:** $8-10
**Why it matters:** Converts abstract "pay more" advice into concrete timelines. "22 months to debt-free" is more motivating than "keep going." It also creates an internal negotiation: "Is the Stable tier worth $500/month to me?"

---

## Feature 7: Payoff Milestone Notifications

**What it does**
Browser notifications at 25%, 50%, 75%, and 90% of total debt paid off. Also triggers at each tier advancement. Notification text matches the app's tone: "50% paid. You're not the same person who started this."

**Data source**
- `stats.pctPaid` from `/api/status` (already computed as `cumulativePaidDown / climbBaselineDebt`)
- Tier transitions (detected when `tier.id` changes between pulls)

**Schema change**
Add a `notifications_sent` config key (JSON array of milestone IDs already fired) to prevent re-triggering.

**Where it lives**
- Frontend: Request `Notification.permission` on first Start Game click. After each `/api/status` fetch, check if `pctPaid` crossed a threshold not yet in `notifications_sent`. Fire browser notification and persist the milestone.
- Backend: Add `POST /api/config/notifications-sent` to persist which milestones were already fired (prevents re-triggering after browser clear).

**Effort:** $6-8
**Why it matters:** The app currently has no outbound touchpoints. You only see progress when you open it. Notifications turn passive tracking into active reinforcement. And the milestone text maintains the app's direct, no-fluff tone.

---

## Feature 8: Accountability Partner Mode

**What it does**
Generate a read-only shareable link that shows: current tier, tier badge/character, days in current tier, and streak count. No dollar amounts, no account details — just the tier and the effort. The partner sees a single card, not the full dashboard.

**Data source**
- Current tier from `/api/status`
- Streak from Feature 1
- Tier history from Feature 4 (for "days in current tier")

**Schema change**
```sql
CREATE TABLE share_tokens (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1
);
```

**Where it lives**
- Backend: `POST /api/share` generates a UUID token, stores it. `GET /api/shared/:token` returns sanitized tier data (no financials).
- Frontend: New static HTML page `public/shared.html` that fetches `/api/shared/:token` and renders a single tier card.
- Settings: Toggle in play shell to generate/revoke the share link.

**Effort:** $12-15
**Why it matters:** Social pressure without social media. One person who sees your tier creates more accountability than a thousand Instagram followers. The no-dollar-amounts constraint keeps it safe — your partner sees effort, not your bank balance.

---

## Feature 9: Weekly Email Digest

**What it does**
One email per week (configurable day): current tier, debt change this week, streak status, one-line directive from the tier's `nextCopy`. Example subject line: "Steward — Tier 04 Surviving · $812 paid this week · Streak: 3"

**Data source**
- Current tier + directive from `/api/status`
- Weekly debt delta from consecutive snapshots
- Streak from Feature 1

**Schema change**
```sql
CREATE TABLE email_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT,
  send_day INTEGER NOT NULL DEFAULT 1,  -- 0=Sun, 1=Mon...
  enabled INTEGER NOT NULL DEFAULT 0,
  last_sent_at TEXT
);
```

**Where it lives**
- Backend: New `services/email.js` using Nodemailer with a user-provided SMTP config (or a free service like Resend). Cron job in `services/scheduler.js` checks weekly.
- Frontend: Settings section in play shell — email input, day picker, enable/disable toggle.
- Env: New `.env` vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (or `RESEND_API_KEY`)

**Effort:** $15-18
**Why it matters:** Turns Steward from a "check when you remember" tool into a weekly accountability system. The email arrives whether you opened the app or not. It's the gentlest possible nudge — one line, once a week, with real numbers.

**Dependency:** Requires email service setup (SMTP or Resend API key).

---

## Feature 10: Export/Share Tier Card

**What it does**
Renders the user's current tier card as a downloadable PNG image. The card shows: tier number, tier name, character in current pose, phase badge (Pressure/Momentum/Reward), and a subtle "steward.app" watermark. No financial data on the image.

**Data source**
- Current tier from `/api/status`
- Character SVG from `character.js`
- Card gradient from `style.css` tier styles

**Schema change**
None.

**Where it lives**
- Frontend: "Share card" button in play shell hero section. Uses `html2canvas` (or native Canvas API drawing the SVG character + gradient background) to render the card element to a PNG. Triggers browser download.
- No backend needed — entirely client-side rendering.

**Effort:** $8-10
**Why it matters:** Word of mouth through vanity. People share Spotify Wrapped, Duolingo streaks, and fitness achievements. A Steward tier card is the same thing for debt payoff. "I'm Tier 07 Building" is something people would actually post — it's aspirational without being revealing.

---

## Summary Table

| # | Feature | Cost | Data exists? | Backend change? | Dependencies |
|---|---------|------|-------------|-----------------|-------------|
| 1 | Momentum Streak | $8-10 | Yes | Minor (new field in status) | None |
| 2 | Net Worth Climb | $12-15 | Yes | New endpoint | None |
| 3 | Pressure Calendar | $10-12 | Yes | New endpoint | None |
| 4 | Tier History Timeline | $10-12 | Yes | New table + endpoint | None |
| 5 | Breathing Room Alert | $5-7 | Yes | None (frontend only) | None |
| 6 | What-If Calculator | $8-10 | Yes | None (frontend only) | None |
| 7 | Payoff Milestone Notifications | $6-8 | Yes | Minor | None |
| 8 | Accountability Partner | $12-15 | Partial | New table + endpoints + page | Features 1, 4 |
| 9 | Weekly Email Digest | $15-18 | Partial | New service + cron | SMTP/Resend, Feature 1 |
| 10 | Export/Share Card | $8-10 | Yes | None | html2canvas (or Canvas API) |

**Total for all 10: $95-117**

## Recommended Build Order

**Phase A — "Engagement hooks" ($27-35)**
Features 1 (Streak), 5 (Breathing Alert), 7 (Notifications)
→ These add behavioral pressure with minimal code. All use existing data. Highest ROI per dollar.

**Phase B — "Depth" ($30-37)**
Features 2 (Net Worth), 3 (Calendar), 4 (Tier History)
→ These give the app depth and historical context. Turn "where am I" into "where have I been."

**Phase C — "Growth" ($35-43)**
Features 6 (What-If), 8 (Partner), 10 (Share Card)
→ These extend the product beyond solo use. What-If drives intent, Partner adds accountability, Share Card drives word of mouth.

**Phase D — "Retention" ($15-18)**
Feature 9 (Email Digest)
→ The only feature requiring external service setup. Save for last — it's highest value but highest friction.

---

*All estimates assume the consolidation (Phase 1) is merged and the play shell is the main route. Features are designed to slot into the existing `views/play.js` architecture as collapsible sections below the hero card.*
