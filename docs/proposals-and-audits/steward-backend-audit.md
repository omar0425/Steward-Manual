# Steward Backend Audit — Every Feature Available for UI

---

## API ENDPOINTS

### 1. `GET /api/status` — Main Dashboard Data (THE BIG ONE)

This is the primary endpoint your UI should call. It returns **everything** in one payload. Here's every field:

#### Top-Level Fields

| Field | Type | What It Is | UI Use |
|-------|------|-----------|--------|
| `ready` | boolean | `false` if no YNAB data yet | Show loading/error state |
| `suspectedRestructure` | boolean | Accounts were added AND removed in same pull — payoff projections unreliable | Show warning: "Debt accounts changed — projections paused" |
| `message` | string (only when `ready: false`) | Error or "initial pull in progress" text | Show on boot/error screen |
| `lastError` | string\|null (only when `ready: false`) | YNAB pull error detail | Show specific error to user |

#### `tier` — Current Debt Tier

| Field | Type | What It Is | UI Use |
|-------|------|-----------|--------|
| `tier.id` | string | `rock_bottom`, `broke`, `struggling`, `surviving`, `stabilizing`, `stable`, `building`, `thriving`, `winning`, `wealthy` | Tier card identity, CSS class |
| `tier.label` | string | "Rock Bottom", "Broke", etc. | Display name on tier card |
| `tier.badge` | string | "01" through "10" | Badge number display |
| `tier.pct` | number | Fraction of starting debt (0.9, 0.8, ...) | Progress math |
| `tier.copy` | string | Tier flavor text ("In the hole. The meter is running.") | Tier card description |
| `tier.nextCopy` | string | What the next tier means ("The first real reduction.") | Next tier card teaser |
| `tier.threshold` | number | Dollar amount for this tier boundary | Progress bar reference |

#### `nextTier` — Next Tier Info

| Field | Type | What It Is | UI Use |
|-------|------|-----------|--------|
| `nextTier.id` | string | Next tier id | Next tier card |
| `nextTier.label` | string | Next tier name | Display |
| `nextTier.badge` | string | Next tier badge number | Badge |
| `nextTier.gapDollars` | number | Dollars to pay down to reach next tier | **"$2,500 LEFT" — the hero number** |
| `nextTier.monthsEstimate` | number\|null | Estimated months to next tier (from avg paydown pace) | **"~12 months to escape"** |
| `nextTier.nextCopy` | string | Copy for what reaching next tier means | Motivation text |

#### `stability` — Liquidity/Safety Layer

| Field | Type | What It Is | UI Use |
|-------|------|-----------|--------|
| `stability.id` | string | `exposed`, `stabilizing`, `fortified` | Breathing room badge color |
| `stability.label` | string | "Exposed", "Steady", "Fortified" | Badge text |
| `stability.score` | number (0-100) | Stability score | Score display, progress bar |
| `stability.urgency` | string | `high`, `moderate`, `low` | Color coding |
| `stability.effectiveRunwayMonths` | number\|null | Months of expenses covered by liquid savings | **"2.7 months breathing room"** |
| `stability.monthsAheadYnab` | number\|null | Assets / monthly expenses | Alternative runway display |
| `stability.narrative.lead` | string | Primary narrative line | Dashboard text block |
| `stability.narrative.mood` | string | Emotional context line | Dashboard text block |
| `stability.narrative.recommend` | string | Action recommendation | Dashboard text block |
| `stability.breathingRoomGoalMonths` | number | Target months (always 2.0) | Goal indicator |
| `stability.breathingRoomReached` | boolean | Has user hit 2 months? | Achievement badge |
| `stability.breathingRoomGapMonths` | number\|null | Months still needed to reach goal | Gap display |
| `stability.scoring.runwayPoints` | number | Points from runway | Debug/detail view |
| `stability.scoring.bufferPoints` | number | Points from cushion vs debt | Debug/detail view |
| `stability.scoring.legacyFallback` | boolean | Using old total_assets instead of safety_liquid | Warning indicator |
| `stability.scoring.guard` | string\|null | `exposed_floor` or `fortified_floor` if guard was applied | Debug |
| `stability.components.ynabSafetyLiquid` | number | Liquid cash from YNAB | Financial detail |
| `stability.components.ynabTotalAssets` | number | All positive YNAB balances | Financial detail |
| `stability.components.brokerageCash` | number | Cash in brokerage | Financial detail |
| `stability.components.brokerageHoldings` | number | Investment holdings value | Financial detail |
| `stability.components.investedCredit` | number | 35% of holdings counted toward cushion | Financial detail |
| `stability.components.effectiveCushion` | number | Total liquid + invested credit | **Total safety cushion** |
| `stability.components.bufferVsDebt` | number\|null | Cushion/debt ratio | Financial health ratio |
| `stability.components.monthlyExpenses` | number | Last month expenses | Financial detail |

#### `streak` — Momentum Streak

| Field | Type | What It Is | UI Use |
|-------|------|-----------|--------|
| `streak.current` | number | Consecutive pulls where debt decreased | **"🔥 3 streak"** badge |
| `streak.best` | number | All-time best streak | "Best: 7" display |
| `streak.lastBroken` | number | Length of the streak that was most recently broken | "Lost a 5-streak" notification |
| `streak.lastBrokenAt` | string\|null | ISO timestamp when streak broke | Timing context |

#### `stats` — Core Financial Numbers

| Field | Type | What It Is | UI Use |
|-------|------|-----------|--------|
| `stats.debtRemaining` | number | Current total debt | **Hero number** |
| `stats.debtDirection` | string | `decreasing`, `increasing`, `stable`, `unknown` | Trend arrow ↓↑→ |
| `stats.climbBaselineDebt` | number | Starting debt (climb anchor) | Reference for % calculations |
| `stats.cumulativePaidDown` | number | Total ever paid down across all accounts | **"↓ $12,500 paid down"** |
| `stats.cumulativeNewDebtAdded` | number | Total new debt ever added | Warning/context stat |
| `stats.netImprovement` | number | paidDown - newDebt | Net progress display |
| `stats.pctPaid` | number (0-100) | Lifetime % of baseline paid | **Progress percentage** |
| `stats.debtTierBand` | object | Band progress within current tier | Progress bar in tier |
| `stats.debtTierBand.pctInBand` | number | % through current tier (0-100) | **Tier progress bar fill** |
| `stats.debtTierBand.bandLower` | number | Lower dollar boundary of tier | Tier range display |
| `stats.debtTierBand.bandUpper` | number | Upper dollar boundary of tier | Tier range display |
| `stats.debtTierBand.span` | number | Dollar width of tier band | Context |
| `stats.debtTierJourney` | object | Full journey progress (all tiers) | Journey progress bar |
| `stats.debtTierJourney.journeyHighDebt` | number | Top of the journey scale | Scale reference |
| `stats.debtTierJourney.pctAlongJourney` | number | % progress across entire journey | **Full journey bar** |
| `stats.debtTierJourney.dollarsToFinalGoal` | number | Dollars to $0 debt | "$$X to debt free" |
| `stats.debtTierJourney.dollarsToNextTier` | number | Dollars to next tier | Same as nextTier.gapDollars |
| `stats.debtTierJourney.nextTierBoundaryPct` | number | Where next tier boundary sits on journey bar | Tick mark position |
| `stats.debtTierJourney.ticks` | array | All tier boundaries with positions | Full journey bar tick marks |
| `stats.debtTierBandPct` | number | Shortcut to debtTierBand.pctInBand | Quick access |
| `stats.netWorth` | number | Assets - debt (brokerage-adjusted) | **Net worth display** |
| `stats.totalAssets` | number | All positive YNAB balances | Financial position |
| `stats.safetyLiquid` | number | Liquid cash (checking, savings, cash) | Safety display |
| `stats.totalDebt` | number | All YNAB liabilities | Financial position |
| `stats.investmentValue` | number | Brokerage portfolio value | Financial position |
| `stats.brokerageEnabled` | boolean | Is brokerage integration on? | Show/hide brokerage section |
| `stats.monthsAhead` | number\|null | Total assets / monthly expenses | Alternative runway |
| `stats.monthlyIncome` | number | Last month income from YNAB | **Income display** |
| `stats.monthlyExpenses` | number | Last month expenses from YNAB | **Expenses display** |
| `stats.lastPullNewDebtSum` | number\|null | New debt added in last pull | "This turn" card |
| `stats.lastPullPaydownSum` | number\|null | Debt paid in last pull | **"This turn" card** |
| `stats.lastPullAccountLines` | array\|null | Per-account changes from last pull | **Debt activity feed** |
| `stats.lastPullAccountChanges` | array\|null | Same as above (alias) | Same |

Each item in `lastPullAccountLines`:
| Field | Type | What It Is |
|-------|------|-----------|
| `name` | string | Account name ("Chase Sapphire") |
| `delta` | number | Signed change (negative = paydown) |
| `kind` | string | `decreased`, `increased`, `new`, `removed` |

#### `meta` — Freshness & Scheduling

| Field | Type | What It Is | UI Use |
|-------|------|-----------|--------|
| `meta.ynabPulledAt` | string | ISO timestamp of last YNAB pull | "Last synced: 2h ago" |
| `meta.brokeragePulledAt` | string\|null | ISO timestamp of last brokerage pull | Brokerage sync status |
| `meta.freshness` | string | "Live", "2h ago", "Stale >48h" | **Freshness badge** |
| `meta.nextScheduled` | string\|null | ISO of next scheduled pull | "Next sync: Apr 15" |

#### `netWorthHistory` — Chart Data

| Field | Type | What It Is | UI Use |
|-------|------|-----------|--------|
| Array of objects | `{date, netWorth, totalAssets, totalDebt}` | Time series (up to 24 points, oldest first) | **Net worth chart** |

#### `debtAccounts` — Named Debt List

| Field | Type | What It Is | UI Use |
|-------|------|-----------|--------|
| Array of objects | `{id, name, balance}` | All debt accounts with names, sorted by balance desc | **Debt list with names** |

#### Debug Fields (when `?debugDebtTier=1` or `?debugDebtSync=1`)

| Field | Type | What It Is |
|-------|------|-----------|
| `debug.debtTierBand` | object | Full band progress breakdown |
| `debug.debtSync` | object | Full debt sync debug payload |
| `sync_valid` | boolean\|null | Debt sync validation passed? |
| `sync_errors` | string[] | Validation error messages |

---

### 2. `GET /api/snapshots` — Raw Snapshot History

Returns last 24 YNAB snapshots (newest first). Each row:

| Field | Type | What It Is |
|-------|------|-----------|
| `id` | number | Row id |
| `source` | string | "ynab" |
| `pulled_at` | string | ISO timestamp |
| `net_worth` | number | Net worth at that pull |
| `total_assets` | number | Assets |
| `safety_liquid` | number\|null | Liquid cash |
| `total_debt` | number | Total debt |
| `investment_value` | number | Brokerage value |
| `debt_remaining` | number | Debt remaining |
| `months_ahead` | number\|null | Months of runway |
| `monthly_income` | number | Income that month |
| `monthly_expenses` | number | Expenses that month |
| `tier` | string | Tier id at that pull |

**UI uses:** Historical charts (debt over time, income/expenses over time, assets over time), trend analysis, "last 24 snapshots" data table.

---

### 3. `GET /api/brokerage` — Investment Portfolio

Returns Public.com portfolio data (if enabled):

| Field | Type | What It Is | UI Use |
|-------|------|-----------|--------|
| `connected` | boolean | Is brokerage linked? | Show/hide section |
| `portfolioValue` | number | Total portfolio value | Investment display |
| `cash` | number | Cash in brokerage | Cash display |
| `holdingsValue` | number | Stock/ETF holdings value | Holdings display |
| `dayChange` | number | Today's gain/loss ($) | **Daily P&L** |
| `dayChangePct` | number | Today's gain/loss (%) | **Daily P&L %** |
| `unrealizedGainLoss` | number | All-time unrealized gain/loss | Performance display |
| `positions` | array | Individual stock positions | **Holdings list** |
| `strategies` | array | Strategy positions (Public themes) | Strategy list |
| `buyingPower` | object | Available buying power | Buying power display |
| `byAccount` | array | Per-account breakdown | Multi-account view |
| `lastSuccessAt` | string\|null | Last successful sync | Sync status |
| `lastError` | object\|null | Last sync error | Error display |

Each position in `positions`:
| Field | Type | What It Is |
|-------|------|-----------|
| `symbol` | string | "AAPL" |
| `name` | string | "Apple Inc." |
| `instrumentType` | string | "EQUITY", etc. |
| `quantity` | number | Shares held |
| `currentValue` | number | Current dollar value |
| `dayChange` | number | Today's change ($) |
| `dayChangePct` | number | Today's change (%) |
| `unrealizedGain` | number | Unrealized gain ($) |
| `unrealizedGainPct` | number | Unrealized gain (%) |

---

### 4. `POST /api/refresh/ynab` — Manual YNAB Sync

- Rate limited: 3 per hour
- Returns `{ ok: true }` or `429` with wait time
- **UI use:** "Refresh" button with rate limit feedback

### 5. `POST /api/refresh/brokerage` — Manual Brokerage Sync

- Rate limited: 3 per hour
- Returns `{ ok: true }` or `429`/`400`
- **UI use:** "Refresh Brokerage" button

### 6. `POST /api/reset-game` — Full Game Reset

- Deletes all snapshots, kicks new YNAB pull
- Returns `{ ok: true, deletedSnapshots: N, ynabPullKicked: true }`
- **UI use:** "Reset" button (with confirmation dialog)

### 7. `GET /api/config/notifications-sent` — Notification Tracking

- Returns `{ sent: ["milestone_1", "milestone_2", ...] }`
- **UI use:** Know which milestones user has already seen so you don't show them again

### 8. `POST /api/config/notifications-sent` — Mark Milestone Seen

- Body: `{ milestone: "tier_broke_reached" }`
- Returns `{ ok: true, sent: [...] }`
- **UI use:** After showing a milestone notification, mark it as seen

### 9. `GET /health` — Health Check

- Returns `{ ok: true, uptime: 1234.56, app: "steward" }`
- **UI use:** Connection status indicator

---

## STATIC DATA FILES (fetchable from server)

### `/debt-tier-constants.json`
```json
{ "ROCK_BOTTOM_BAND_BUFFER": 10000 }
```
Used by showcase/gallery to match server tier math.

### `/debt-tier-narrative.json`
Stage group framing + taglines for each tier:
- `stageGroups`: "Pressure", "Momentum", "Reward" with blurbs
- `tiers`: Each tier has a `stageGroup` and `climbTagline`

**UI use:** Group tiers into story arcs in the tier gallery/showcase, display climb taglines on tier cards.

---

## COMPUTED DATA YOU CAN BUILD UI FEATURES FROM

### From `/api/status` — things you can calculate/display:

1. **Daily Move Target**
   - Formula: `nextTier.gapDollars / 30`
   - Display: "Move $84 now"

2. **Pace Required**
   - `nextTier.gapDollars` / `nextTier.monthsEstimate` = monthly pace needed
   - Or: `nextTier.gapDollars` and `stats.monthlyIncome - stats.monthlyExpenses` (cash flow) to show if user's current cash flow can close the gap

3. **Cash Flow**
   - `stats.monthlyIncome - stats.monthlyExpenses`
   - Display as surplus or deficit

4. **Debt-to-Income Ratio**
   - `stats.debtRemaining / (stats.monthlyIncome * 12)`
   - Standard financial health metric

5. **Time to Debt Free (not just next tier)**
   - `stats.debtTierJourney.dollarsToFinalGoal` / avg monthly paydown
   - Or use `nextTier.monthsEstimate` extrapolated across remaining tiers

6. **Breathing Room Gap**
   - `stability.breathingRoomGapMonths` — how far from 2-month goal
   - Display as "0.7 months to go" or "Goal reached"

7. **This Turn (Last Pull) Summary**
   - `stats.lastPullPaydownSum` — debt paid since last sync
   - `stats.lastPullNewDebtSum` — new debt since last sync
   - `stats.lastPullAccountLines` — per-account breakdown with names

8. **Restructure Warning**
   - `suspectedRestructure` — accounts added AND removed
   - Show: "Debt accounts changed — projections may be inaccurate"

9. **Freshness Warning**
   - `meta.freshness === 'Stale >48h'` → show warning
   - `meta.nextScheduled` → show next sync time

10. **Debt Direction Arrow**
    - `stats.debtDirection`: `decreasing` → ↓ green, `increasing` → ↑ red, `stable` → → yellow

11. **Lifetime Stats**
    - `stats.cumulativePaidDown` — total ever paid
    - `stats.cumulativeNewDebtAdded` — total ever added
    - `stats.netImprovement` — net (paid - added)
    - `stats.pctPaid` — % of baseline paid

12. **Stability Narrative Blocks**
    - `stability.narrative.lead` — headline
    - `stability.narrative.mood` — emotional context
    - `stability.narrative.recommend` — action step
    - These change dynamically based on debt tier + liquidity band combo

---

## FULL FEATURE LIST — WHAT YOU CAN BUILD

### TIER 1: Core Dashboard (must-haves)

| # | Feature | Data Source | Description |
|---|---------|------------|-------------|
| 1 | **Hero: Tier + Gap** | `tier`, `nextTier.gapDollars` | "ESCAPE STRUGGLING — $2,500 LEFT" |
| 2 | **Tier Progress Bar** | `stats.debtTierBandPct` | Fill bar within current tier |
| 3 | **Current + Next Tier Cards** | `tier`, `nextTier` | Identity cards with badge, copy, lock state |
| 4 | **Debt Remaining** | `stats.debtRemaining` | Main debt number |
| 5 | **Net Worth** | `stats.netWorth` | Assets minus all debt |
| 6 | **Monthly Income/Expenses** | `stats.monthlyIncome`, `stats.monthlyExpenses` | Financial vitals |
| 7 | **Cash Flow** | Computed: income - expenses | Surplus/deficit |
| 8 | **Breathing Room** | `stability.effectiveRunwayMonths` | "2.7 months" with badge |
| 9 | **Net Worth Chart** | `netWorthHistory` | Line chart over time |
| 10 | **Debt List** | `debtAccounts` | Named accounts with balances |
| 11 | **Sync Strip** | `meta.freshness`, `meta.ynabPulledAt` | Last synced, next scheduled |
| 12 | **CTA: Daily Move** | Computed: `gapDollars / 30` | "Move $84 now" |

### TIER 2: Engagement & Depth

| # | Feature | Data Source | Description |
|---|---------|------------|-------------|
| 13 | **Streak Badge** | `streak.current`, `streak.best` | "🔥 3" momentum indicator |
| 14 | **Cumulative Paydown** | `stats.cumulativePaidDown` | "↓ $12,500 paid down" |
| 15 | **Months to Next Tier** | `nextTier.monthsEstimate` | "~12 months to escape" |
| 16 | **Stability Score** | `stability.score` | 0-100 score with label |
| 17 | **Stability Narrative** | `stability.narrative` | Lead/mood/recommend text blocks |
| 18 | **Debt Direction** | `stats.debtDirection` | ↓↑→ trend arrow |
| 19 | **Lifetime % Paid** | `stats.pctPaid` | "31.2% of starting debt paid" |
| 20 | **Journey Progress Bar** | `stats.debtTierJourney` | Full journey with tier tick marks |
| 21 | **Total Assets** | `stats.totalAssets` | Asset display |
| 22 | **Safety Liquid** | `stats.safetyLiquid` | Liquid cash specifically |

### TIER 3: Power Features

| # | Feature | Data Source | Description |
|---|---------|------------|-------------|
| 23 | **This Turn Summary** | `stats.lastPullPaydownSum`, `lastPullAccountLines` | What changed since last sync — per-account breakdown |
| 24 | **New Debt Warning** | `stats.cumulativeNewDebtAdded`, `stats.lastPullNewDebtSum` | Alert when new debt is added |
| 25 | **Restructure Alert** | `suspectedRestructure` | Warning when accounts churned |
| 26 | **Breathing Room Goal** | `stability.breathingRoomReached`, `breathingRoomGapMonths` | "0.7 months to 2-month goal" |
| 27 | **Debt-to-Income Ratio** | Computed: `debtRemaining / (monthlyIncome * 12)` | Standard financial ratio |
| 28 | **Time to Debt Free** | Computed from `dollarsToFinalGoal` + pace | "~4 years to $0 debt" |
| 29 | **Net Improvement** | `stats.netImprovement` | Paid minus new debt added |
| 30 | **Freshness Warning** | `meta.freshness` | "Stale >48h" warning banner |
| 31 | **Next Sync Countdown** | `meta.nextScheduled` | "Next sync in 3 days" |
| 32 | **Dark Mode** | Client-side | Toggle stored in localStorage |

### TIER 4: Brokerage (when enabled)

| # | Feature | Data Source | Description |
|---|---------|------------|-------------|
| 33 | **Portfolio Value** | `/api/brokerage → portfolioValue` | Total investment value |
| 34 | **Daily P&L** | `dayChange`, `dayChangePct` | Today's market performance |
| 35 | **Holdings List** | `positions` array | Individual stock positions with gains |
| 36 | **Cash in Brokerage** | `cash` | Available cash |
| 37 | **Unrealized Gains** | `unrealizedGainLoss` | All-time unrealized P&L |
| 38 | **Buying Power** | `buyingPower` | Available to invest |
| 39 | **Strategy Performance** | `strategies` array | Theme/strategy positions |
| 40 | **Multi-Account View** | `byAccount` array | Per-account breakdown |
| 41 | **Brokerage Sync Status** | `lastSuccessAt`, `lastError` | Connection health |

### TIER 5: Actions & Controls

| # | Feature | Data Source | Description |
|---|---------|------------|-------------|
| 42 | **Manual YNAB Refresh** | `POST /api/refresh/ynab` | Button with 3/hr rate limit feedback |
| 43 | **Manual Brokerage Refresh** | `POST /api/refresh/brokerage` | Button with rate limit |
| 44 | **Game Reset** | `POST /api/reset-game` | Danger button with confirmation |
| 45 | **Milestone Notifications** | `GET/POST /api/config/notifications-sent` | Toast/modal when user hits a new tier, breaks a streak, etc. |

### TIER 6: Showcase / Gallery

| # | Feature | Data Source | Description |
|---|---------|------------|-------------|
| 46 | **Full 10-Tier Gallery** | `debt-tier-narrative.json` + tier definitions | Showcase page with all tiers |
| 47 | **Stage Groups** | `stageGroups` from narrative JSON | "Pressure → Momentum → Reward" grouping |
| 48 | **Climb Taglines** | `tiers[id].climbTagline` | Per-tier motivational text |

---

## MILESTONE NOTIFICATIONS YOU CAN TRIGGER

Using `stats` + `streak` + `tier`, fire one-time notifications:

| Milestone ID | Trigger Condition | Notification Copy |
|-------------|-------------------|-------------------|
| `tier_[id]_reached` | `tier.id` changes to new tier | "You reached [Tier Label]!" |
| `streak_3` | `streak.current >= 3` | "3 pulls in a row — momentum!" |
| `streak_5` | `streak.current >= 5` | "5-streak! You're consistent." |
| `streak_10` | `streak.current >= 10` | "10-streak — elite consistency." |
| `streak_broken` | `streak.lastBroken > 0 && streak.current === 0` | "Streak broken. Start again." |
| `breathing_room_reached` | `stability.breathingRoomReached === true` | "2 months breathing room!" |
| `debt_free` | `tier.id === 'wealthy'` | "DEBT FREE. You won." |
| `pct_25` | `stats.pctPaid >= 25` | "25% of your debt — gone." |
| `pct_50` | `stats.pctPaid >= 50` | "Halfway there." |
| `pct_75` | `stats.pctPaid >= 75` | "75% paid. The end is close." |
| `first_paydown` | `stats.cumulativePaidDown > 0` (first time) | "First paydown recorded." |

Check `GET /api/config/notifications-sent` before showing. Mark as seen with `POST /api/config/notifications-sent`.

---

## SCHEDULER (automatic syncs)

| Schedule | What | When |
|----------|------|------|
| YNAB pull | Sync debt, assets, income, expenses | 1st, 15th, last day of month at 6am |
| Brokerage pull | Sync portfolio from Public.com | Every Friday at 8pm (if enabled) |

The UI doesn't need to manage this — it happens automatically. The UI just reads the results via `/api/status`.

---

## DATABASE TABLES

| Table | What's Stored | UI Relevance |
|-------|--------------|--------------|
| `snapshots` | Time-series financial data (up to 24 YNAB + brokerage rows) | Chart data, history |
| `debt_account_balances` | Per-account debt with names | Debt list |
| `config` | Key-value store (debt_start, climb metrics, notification state, brokerage cache) | Internal state — exposed via API |

---

## ENV VARS THAT AFFECT BEHAVIOR

| Variable | Effect | UI Relevance |
|----------|--------|--------------|
| `YNAB_API_TOKEN` | Required — connects to YNAB | Error if missing |
| `YNAB_BUDGET_ID` | Which budget to pull (default: last-used) | — |
| `BROKERAGE_ENABLED` | Turns on Public.com integration | Show/hide brokerage section |
| `DEBT_START_OVERRIDE` | Override starting debt for tier math | Affects all % calculations |
| `STEWARD_SKIP_DUPLICATE_SNAPSHOTS` | Skip storing identical snapshots | Cleaner chart data |
| `STEWARD_DEBUG_DEBT_TIER` | Debug tier band math in API | Dev-only |
| `STEWARD_DEBUG_DEBT_SYNC` | Debug debt sync validation | Dev-only |

---

## SUMMARY: PRIORITY ORDER FOR UI IMPLEMENTATION

**Build first (core loop):**
1. `/api/status` call → parse the payload
2. Hero: `tier`, `nextTier.gapDollars`, tier progress bar
3. Metrics: net worth, debt remaining, cash flow, breathing room
4. Net worth chart from `netWorthHistory`
5. Debt list from `debtAccounts`
6. Sync strip from `meta`

**Build second (engagement):**
7. Streak badge
8. Cumulative paydown stat
9. Tier cards (current + next)
10. CTA with daily move target
11. Stability narrative blocks
12. Milestone notifications

**Build third (depth):**
13. Journey progress bar with tier tick marks
14. This-turn summary (per-account changes)
15. Breathing room goal tracker
16. Lifetime stats (pctPaid, netImprovement)
17. Manual refresh buttons with rate limit

**Build fourth (brokerage, if enabled):**
18. Portfolio value + daily P&L
19. Holdings list
20. Multi-account view

**Build last (settings/admin):**
21. Game reset
22. Showcase/gallery page
23. Debug panels (opt-in)
