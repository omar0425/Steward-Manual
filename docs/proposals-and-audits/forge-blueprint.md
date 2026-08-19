# Steward Blueprint Analysis → Forge: New App Proposal

---

## Part 1: Steward as a Blueprint

### 1.1 Core Product Mechanics

**Staged progression / tier system**

Steward maps a single numeric axis — `debt_remaining` — to 10 ordered tiers. The tiers are defined server-side (`services/tiers.js`) with fixed dollar thresholds:

| Badge | ID | Label | Threshold |
|-------|----|-------|-----------|
| 01 | rock_bottom | Rock Bottom | > $79,000 |
| 02 | broke | Broke | > $70,000 |
| 03 | struggling | Struggling | > $60,000 |
| 04 | surviving | Surviving | > $50,000 |
| 05 | stabilizing | Stabilizing | > $40,000 |
| 06 | stable | Stable | > $30,000 |
| 07 | building | Building | > $20,000 |
| 08 | thriving | Thriving | > $10,000 |
| 09 | winning | Winning | > $0 |
| 10 | wealthy | Wealthy | $0 (debt-free) |

Key design decisions:
- Thresholds are absolute dollar values, not percentages. This makes the gap to the next tier a concrete dollar figure ("free up $3,200 to escape this stage"), not an abstract ratio.
- `getTier(debtRemaining)` scans highest-to-lowest; first match wins.
- The client gets tier data from `/api/status`, not by recomputing locally. Server is the single source of truth.
- Each tier carries: `id`, `label`, `badge`, `copy` (current stage description), `nextCopy` (what crossing the threshold means).

**"Next move" framing**

`nextTierInfo()` computes:
- `gapDollars`: exact dollars needed to cross into the next tier
- `monthsEstimate`: average monthly paydown from last 3 snapshots projected forward
- `avgMonthlyPaydown`: the rate

The hero card headline IS the gap dollars. The entire UI is oriented around "here's how much you need to move to escape this stage" — not "here's how much debt you have total." This reframes a demoralizing number (total debt) into an actionable one (stage gap).

**Dual-axis model: debt tier + stability**

Steward has two independent axes:
1. **Primary (debt):** which tier you're in → determined by `debt_remaining`
2. **Secondary (stability/liquidity):** how safe your cash position is → determined by `computeStability()`

Stability uses a 0–100 scoring system combining:
- Runway points: months of expenses your cushion covers (capped at 5.5 months = 62 points)
- Buffer points: cushion-to-debt ratio with sqrt diminishing returns (capped at 37 points)
- Guard clamps: if runway < 0.95 months, force "Exposed"; if runway ≥ 5.15 months, floor at "Fortified"

Three stability bands:
- **Exposed** (score < 36): high urgency
- **Steady** (36 ≤ score < 68): moderate — uses id `stabilizing` internally, label "Steady" in UI
- **Fortified** (score ≥ 68): low urgency

This dual-axis creates compound pressure: you can be in a decent debt tier but still "Exposed" on cash, or in a bad debt tier but "Fortified" on cash. The narrative copy (from `stabilityNarrative()`) varies across all 12 combinations (4 debt-pressure groups × 3 liquidity bands).

**Commitment / first-run gate**

Play shell has a unique `#commitment-screen` that fires before anything else on first visit. The flow:
1. `initDashboardBoot()` checks for `#commitment-screen` DOM element
2. If present and user hasn't committed (`readPromiseMadeFlag()` checks localStorage), shows the commitment gate
3. Gate fetches current debt amount from `/api/status` and displays it
4. User can type a custom commitment and clicks confirm
5. `persistPromiseAck()` saves to localStorage with timestamp
6. Gate dismisses → `initStartGameGate()` runs

This is behavioral design: making the user acknowledge their number before seeing the dashboard creates psychological investment.

**Start flow / play mode**

After commitment (or if skipped):
1. `initStartGameGate()` shows `#start-game-screen` with a live clock and "Start Game" button
2. If `sessionStorage` has a ready flag (tab refresh), skips gate and goes straight to loading
3. On "Start Game" click: animation delay → `setAppMode(APP_MODE.LOADING)` → `load()` → fetch `/api/status`, `/api/snapshots`, `/api/brokerage` → `render()` → `setAppMode(APP_MODE.READY)`

The "start game" framing is deliberate — it primes the user to view this as an active engagement, not passive observation.

**Session/playtime tracking**

Play mode tracks foreground time via `startPlaytimeTracking()`:
- Uses `visibilitychange`, `blur`, `focus` events to only count time when the tab is focused
- Saves to localStorage with periodic accrual intervals
- Displays cumulative focused time in the data strip

**Pressure + runway concepts**

Three stage groups (from `debt-tier-narrative.json`):
- **Pressure** (tiers 01–03): early climb, tension, proving the trend
- **Momentum** (tiers 04–07): rhythm, control, compounding proof
- **Reward** (tiers 08–10): rare air, finish lines, life after debt

Each group has different narrative tone. The copy never congratulates early — it warns. "Most people never get here" at tier 08 creates pressure to protect what you've earned. "Don't get casual" reinforces that reaching a tier isn't permission to relax.

**Stable play shell vs preview/dev shells**

Three HTML shells, one shared `app.js`:
- `/play` → `play.html` — stable product. Uses `#dashboard-play`. Has commitment gate, start game flow, session tracking, reset button. No onboarding tour. No "How it works" button.
- `/classic` → `index.html` — legacy shell. Uses `#dashboard`. Has full financial board visible (not hidden in sentinels). Has onboarding tour.
- `/` → `steward-vnext.html` — preview/vNext. Uses `#dashboard-vnext`. Loads `steward-vnext.js` and `steward-vnext.css` for extra features (journey visualization, turn accounts, checkpoint copy). Most experimental.

Shell detection is DOM-based:
```js
function isPlayDashboardDoc() {
  return !!document.getElementById('dashboard-play');
}
function isClassicDashboardDoc() {
  return !!document.getElementById('dashboard');
}
function isClassicLayoutDashboardDoc() {
  return isClassicDashboardDoc() || isPlayDashboardDoc();
}
```

`getDashboardRoot()` returns whichever dashboard element exists (`#dashboard` || `#dashboard-vnext` || `#dashboard-play`).

### 1.2 Core UX Principles

**What the user sees first**

On `/play`, the user sees (in order):
1. Commitment screen — "Your debt: $X. Commit." (first visit only)
2. Start Game screen — live clock, "Start Game" button
3. Loading screen — "Pulling your financial data…"
4. Hero card — the character, their tier, the GAP DOLLARS headline

The gap dollars is the first real number they see after loading. Not total debt. Not net worth. The distance to the next stage. This is the core reframe.

**What creates urgency**

- The gap headline: a concrete dollar amount you need to move
- Stage group labels: "Pressure phase" for early tiers
- Behavioral cues: "Cut the balance. Guard cash." / "Hold the line. No backsliding."
- Freshness indicators: "Stale" / "X hours ago" badges create urgency to refresh data
- Stability warnings: "Exposed" pill with high-urgency narrative
- Tier rail: visual ladder showing 10 stages, your position, and how far you've come

**What creates clarity**

- Single headline metric: gap dollars to next tier
- Two-axis status visible at a glance: tier badge + stability pill
- "Next move" framing: every tier has a specific behavioral directive
- Board sentinels in play.html: all financial stats exist in the DOM (for data sync and refresh) but are visually hidden — you only see the hero card and data strip
- Progress bar: in-band percentage through current stage (NOT overall debt percentage)

**What stays hidden**

Play deliberately hides:
- The full financial board (present in DOM as hidden sentinels, but not visible)
- Onboarding tour (suppressed via `if (!isPlayDashboardDoc())` checks)
- "How it works" button (suppressed: `if (getDashboardRoot() && !isPlayDashboardDoc())`)
- vNext features (journey visualization, turn accounts, checkpoint copy)
- Debug overlays (only in vNext via `steward-vnext.js`)

This is intentional information architecture: play shows you WHAT TO DO, not EVERYTHING ABOUT YOUR FINANCES.

**What makes it feel like a guide instead of a dashboard**

1. **Character:** Steward the mascot changes pose/animation per tier. Monocle glows at higher tiers. Sparkles appear. A race car shows up for wealthy tier. The character IS the guide — it reacts to your state.
2. **Narrative copy varies by stage × stability:** Not generic advice. "Debt is still very large — and cash safety is not yet matching the risk" is specific to high-debt + exposed stability.
3. **Behavioral directives, not data labels:** "Cut the balance. Guard cash." vs "Tier 1: Rock Bottom."
4. **Commitment gate:** Makes you own the journey before showing data.
5. **"Game" framing:** Start Game, playtime tracking, reset button — it's a session, not a tab you leave open.
6. **No social features, no gamification points:** No streaks, no badges beyond tier badges, no leaderboards. The pressure comes from your real financial data, not artificial incentives.

### 1.3 Architecture Principles Worth Reusing

**Single backend source of truth**

- All tier calculations happen server-side (`services/tiers.js`, `services/stability.js`)
- Client receives computed state from `/api/status` — it never recomputes tiers locally
- SQLite database (`db.js`) stores snapshots, config, climb metrics
- External data source (YNAB API) pulled on schedule or manual refresh

**Shared render/data pipeline**

- One `app.js` (3,463 lines) serves all three shells
- Shell detection via DOM element presence — no URL parsing, no config flags
- `render(status, snapshots, brokerage)` is shell-agnostic: it writes to DOM IDs that exist in all shells
- Missing elements handled via null checks (mostly) — if a DOM ID doesn't exist, that piece is silently skipped
- `upgradeDashboardLayout()` dynamically creates missing elements if needed

**Separate product shell vs sandbox**

- `/play` is the stable product: minimal surface, commitment-gated, no experimental features
- `/` (vNext) is the sandbox: extra JS/CSS, journey visualization, experimental copy
- `/classic` is the legacy: full financial board visible, onboarding tour

This separation means you can experiment on vNext without risking the stable play shell. The shared `app.js` handles both, gated by shell detection.

**Minimal duplication of logic**

- Tier definitions: `services/tiers.js` (server) + `TIER_FLOW` array in `app.js` (client). Not a 1:1 copy — server has thresholds, client has colors/phases/cues.
- Stability: computed server-only, sent as part of `/api/status`
- Climb metrics: tracked server-side in `services/climbMetrics.js`, surfaced in API
- No client-side data persistence beyond localStorage for UI state (commitment flag, session meta, onboarding progress)

---

## Part 2: New App Concept

### App: **Forge**

**Body recomposition as staged progression.**

Forge applies Steward's product philosophy — staged progression, behavioral pressure, progress clarity, guide over dashboard — to body composition transformation (weight management, fat loss, muscle gain).

### Why this domain

1. **Structural parallel is nearly perfect:** "debt remaining" → "weight remaining to goal." Both are single numeric axes the user wants to move. Both have real psychological stages that change how the user feels and what behavior matters.

2. **Existing apps fail where Steward succeeds:** Fitness apps are either too gamified (streaks, badges, social comparison) or too clinical (spreadsheets of macros). None frame the journey as staged psychological progression with behavioral pressure. None tell you "here's what stage you're at, here's what typically breaks people here, here's your one move."

3. **The dual-axis model translates directly:** Debt tier → Weight stage. Stability/breathing room → Consistency/adherence. You can be losing weight but with spotty adherence (fragile progress), or stuck on weight but with strong consistency (plateau that will break).

4. **The "guide not dashboard" philosophy is genuinely missing** in fitness. MyFitnessPal is a calorie spreadsheet. Noom is a psychology course. Neither frames the journey as "you are HERE on a 10-stage climb, and here is your next move."

### Target User

Someone who needs to lose a meaningful amount of weight (20–100+ lbs) and wants:
- Clarity on where they are in the process
- Direct guidance on what matters at their stage (not generic advice)
- Honest framing — no celebration for showing up, no punishment for slipping
- A system that acknowledges the psychological reality of each phase

NOT for: people tracking macros for bodybuilding, casual fitness trackers, people with eating disorders (explicit disclaimer needed).

### Core Loop

1. **Weigh in** (manual entry or smart scale sync) — like YNAB pull
2. **See your stage** — which of 10 cards you're on, based on % of goal remaining
3. **Read your directive** — what behavior matters at THIS stage
4. **See your gap** — pounds to next stage (like gap dollars)
5. **Check your consistency** — secondary axis: how reliably you're logging/showing up
6. **Do the thing** — the app tells you what to do, you go do it
7. **Come back and weigh in again** — the loop restarts

### Main Screens

**Commitment screen** (first visit only)
- Shows current weight (from first weigh-in or setup)
- "You weigh X. Your target is Y. That's Z pounds. Commit."
- User confirms. This is their stake.

**Start screen**
- Live clock, "Start Session" button
- Primes the user: this is active engagement, not passive checking

**Hero card** (main view after loading)
- Character/visual that changes per stage
- Stage badge and label (e.g., "03 — Resisting")
- Gap headline: "14 lbs to next stage"
- Behavioral directive: "Cravings are loudest now. Don't negotiate with them."
- Consistency pill: "Adherence: Steady" or "Adherence: Spotty"

**Hidden sentinels** (data present but not shown)
- Full stats: BMI, trend weight, weekly average, consistency metrics
- Available for data strip / refresh but not in the hero view
- Play shell shows only: hero card + weigh-in strip + consistency indicator

**Data strip**
- Last weigh-in date
- Next expected weigh-in
- Consistency score
- Manual refresh / new entry button

### State/Progression Model

**Primary axis: Weight stage** (10 stages based on % of goal weight remaining)
- Unlike Steward's fixed dollar thresholds, Forge uses percentage-of-goal because weight goals vary wildly between people
- Stage 1: 100–90% remaining → Stage 10: goal reached and held

**Secondary axis: Consistency band** (like stability)
- Tracks weigh-in frequency + trend direction
- Three bands:
  - **Spotty**: irregular check-ins, or no weigh-in in 5+ days
  - **Steady**: regular check-ins, weight trending in right direction
  - **Locked**: consistent check-ins for 2+ weeks, clear downward trend

**"Breathing room" equivalent**: Consistency buffer
- In Steward, breathing room = can you survive a financial shock?
- In Forge, consistency = can you survive a bad week without derailing?
- Users with high consistency can absorb a plateau or a slip-up; users with spotty consistency are fragile

### What the "Next Move" Mechanic Would Be

Each stage has a specific behavioral focus — not generic advice, but what MATTERS at that stage:

- **Early stages (Pressure):** "Don't try to optimize. Just show up and log." The move is consistency, not perfection.
- **Mid stages (Momentum):** "The scale will stall. Trust the process and adjust one thing." The move is adaptation, not more effort.
- **Late stages (Reward):** "You're closer than you think. Don't celebrate early." The move is discipline, not motivation.

The gap to next stage is displayed as pounds: "Lose 6 more lbs to reach Consistent." This is the "gap dollars" equivalent — a concrete, actionable number.

---

## Part 3: The 10-Card System

### Design Principles (mirroring Steward)

- Each card name describes a **state**, not a value judgment
- Copy is direct and behavioral, never motivational or fluffy
- Progression follows real psychological phases of sustained weight loss
- Three phase groups: **Pressure** (cards 01–03), **Momentum** (cards 04–07), **Reward** (cards 08–10)
- Each card has distinct risks and a specific behavioral directive

---

### Card 01 — Inert

**Directive:** Face the number. Start logging.

**What this stage means:**
You've acknowledged the gap between where you are and where you need to be. Nothing has moved yet. The full weight of the change is sitting on you. Most people stay here — they know the number but never start the process.

**What behavior moves the user forward:**
Begin weighing in consistently. Don't change anything else yet. The act of measuring is the first real commitment. You cannot manage what you refuse to track.

**Next move:**
Log your weight 3 times this week. That's it. No diet overhaul, no gym plan. Just step on the scale and record the number.

---

### Card 02 — Dropping

**Directive:** Early loss is real but misleading. Don't build on it.

**What this stage means:**
First measurable change. Water weight, glycogen depletion, and initial dietary adjustments produce a fast initial drop. It feels like proof the plan works. It is proof — but the rate won't hold, and mistaking this pace for normal will set you up for frustration in 2–3 weeks.

**What behavior moves the user forward:**
Maintain whatever change you made. Don't escalate. Don't add a second intervention. Let this phase run its course without building your expectations around it.

**Next move:**
Keep doing exactly what you started. No additions. Note your current routine — you'll need to remember what "baseline effort" looked like when the plateau hits.

---

### Card 03 — Resisting

**Directive:** Cravings peak here. Don't negotiate with them.

**What this stage means:**
The novelty of the new routine has worn off. Hunger signals are louder. Social situations feel harder. Old habits are pulling. This is the first real test — not of willpower, but of whether your environment and systems can hold against the pull of the old pattern.

**What behavior moves the user forward:**
Do not rely on motivation or discipline. Change your environment: remove triggers, pre-commit to meals, avoid decision fatigue. The people who survive this stage are the ones who made it hard to fail, not the ones who tried harder.

**Next move:**
Identify the top 2 situations where you slip (late-night eating, weekend meals out, stress snacking). Build a specific rule for each — not a goal, a rule. "I don't eat after 8 PM" beats "I'll try to eat less at night."

---

### Card 04 — Stalled

**Directive:** The scale will lie to you for weeks. Keep going.

**What this stage means:**
Weight loss has slowed or stopped despite continued effort. This is the most dangerous stage — not because something is wrong, but because it FEELS wrong. Plateaus are physiologically normal (metabolic adaptation, water retention, body recomposition). Most people quit here because they interpret a stall as failure.

**What behavior moves the user forward:**
Do not cut calories further. Do not add more exercise. Wait. Track trend weight (7-day average), not daily weight. If the trend is flat for 3+ weeks, make ONE small adjustment — not a dramatic change.

**Next move:**
Switch to watching your 7-day trend weight only. Ignore daily fluctuations. If the trend is flat for 21+ days, reduce portion size at one meal by ~15% or add one 20-minute walk per day. One change. Not two.

---

### Card 05 — Adapting

**Directive:** What worked before won't work forever. Adjust without overhauling.

**What this stage means:**
You've survived the plateau. Progress resumed because you made a calibrated adjustment — not because you panicked and did something drastic. This stage is about learning that the process requires periodic recalibration, and that recalibration is normal, not a sign of failure.

**What behavior moves the user forward:**
Build the habit of reviewing and adjusting every 2–3 weeks. Small adjustments compound. Dramatic overhauls don't stick. You're learning to be your own coach.

**Next move:**
Set a recurring check-in with yourself (every 2 weeks). At each check-in, answer: "Is the trend moving? If not, what ONE thing do I adjust?" Write it down.

---

### Card 06 — Pacing

**Directive:** It's becoming routine. Protect the routine.

**What this stage means:**
The process no longer requires constant willpower. You're eating differently without thinking about it as much. Exercise (if part of your plan) is habit, not heroism. The danger here is subtle: because it feels easy, you stop paying attention. Small creep — an extra snack, a skipped workout, a "just this once" — starts here.

**What behavior moves the user forward:**
Maintain your logging habit even when it feels unnecessary. The routine IS the progress. The moment you stop tracking because "you've got it" is the moment drift begins.

**Next move:**
Keep logging. If you haven't missed a weigh-in in 2+ weeks, you're on pace. Don't add complexity. Don't "optimize." The goal right now is to bore yourself with consistency.

---

### Card 07 — Showing

**Directive:** Progress is visible. Other people will notice. Don't let it derail you.

**What this stage means:**
Roughly halfway to goal. The mirror shows change. Clothes fit differently. Other people comment. This creates two risks: (1) premature celebration ("I look great, I can ease up") and (2) increased social pressure around food ("you've lost enough, have some cake"). Both are subtle permission to stop.

**What behavior moves the user forward:**
Acknowledge the progress internally, but don't change the process. External validation is not a signal to adjust your approach. The process that got you here is the process that finishes the job.

**Next move:**
When someone comments on your progress, say "thanks" and change the subject. Do not use compliments as data points. Your scale trend is your data. Keep logging.

---

### Card 08 — Recast

**Directive:** Your identity is shifting. Let it.

**What this stage means:**
You're no longer "someone trying to lose weight." Your habits, your food choices, your daily patterns — they're becoming who you are, not what you're doing temporarily. This is the most important psychological shift in the entire process, and it usually happens here, not at the finish line.

**What behavior moves the user forward:**
Stop thinking of this as a temporary project with an end date. The behaviors you've built are the ones you'll maintain. If something in your current routine feels unsustainable, adjust it NOW — before you reach goal and "go back to normal." There is no "back to normal." This IS normal.

**Next move:**
Audit your current routine. Is there anything you're doing that you couldn't do for 5 more years? If yes, swap it for something sustainable. The goal is to arrive at your target weight already living the life that maintains it.

---

### Card 09 — Closing

**Directive:** Last stretch. Don't over-correct and don't coast.

**What this stage means:**
You're close. The gap is small. Two risks emerge: (1) impatience — cutting too aggressively to "just get there" — which leads to rebound, and (2) complacency — "I'm basically there" — which leads to stalling a few pounds short for months. Both are the same mistake: treating the finish line as more important than the process.

**What behavior moves the user forward:**
Maintain exactly the same pace. Do not speed up. Do not slow down. The last few pounds are physiologically slower because your body has less excess to shed. This is normal. Impatience here is the most common reason people never actually reach their goal.

**Next move:**
Set your expectation: the last 10% takes disproportionately longer. Accept it. Keep logging at the same frequency. Do not adjust your routine unless your 2-week check-in shows a genuine 3-week stall.

---

### Card 10 — Held

**Directive:** Goal reached. Maintenance is the real discipline.

**What this stage means:**
You hit your target weight. This is not the end — it's a transition. Research shows the majority of people who reach their goal weight regain within 2 years. The reason: they treated the goal as a finish line and stopped the behaviors that got them there. Maintenance is a permanent stage, not a victory lap.

**What behavior moves the user forward:**
Continue weighing in at least weekly. Set a "ceiling" weight — a number 3–5 lbs above your goal. If you cross it, you don't panic, but you do immediately return to your active-phase routine until you're back under. This ceiling is your early warning system.

**Next move:**
Define your ceiling weight. Write it down. Continue logging weekly. If you cross the ceiling, treat it like a stage transition back to Card 09 — not a failure, just a signal to re-engage the process.

---

## Part 4: How the Cards Mirror Steward Without Copying

### Structural Parallels

| Steward Pattern | Forge Equivalent |
|-----------------|------------------|
| Debt remaining → tier | Weight remaining to goal → stage |
| 10 tiers, highest debt → debt-free | 10 stages, full gap → goal held |
| Gap dollars (to next tier) | Gap pounds (to next stage) |
| Stability score (Exposed/Steady/Fortified) | Consistency band (Spotty/Steady/Locked) |
| Breathing room (months of expenses) | Consistency buffer (streak + trend quality) |
| YNAB pull → snapshot | Weigh-in → snapshot |
| Commitment gate | Commitment gate |
| Start Game → session tracking | Start Session → session tracking |
| Three phase groups (Pressure/Momentum/Reward) | Three phase groups (Pressure/Momentum/Reward) |
| Behavioral cue per tier | Behavioral directive per stage |
| Character evolves per tier | Visual evolves per stage |
| Hero card with gap headline | Hero card with gap headline |

### What's Different

1. **Card names are entirely original.** Steward uses adjectives describing financial state (Rock Bottom, Broke, Struggling…). Forge uses words describing process state (Inert, Dropping, Resisting, Stalled…). None overlap.

2. **The psychological arc is domain-specific.** Steward's stages map to debt reduction psychology (shock → grind → visibility → freedom). Forge's stages map to weight loss psychology (inertia → false confidence → resistance → plateau → adaptation → identity shift → maintenance). These are genuinely different psychological journeys, not reskinned copies.

3. **The secondary axis measures a different thing.** Steward's stability = financial cushion vs expenses (a safety metric). Forge's consistency = behavioral adherence over time (a reliability metric). Both create pressure, but through different mechanisms: Steward asks "can you survive a shock?" while Forge asks "are you actually showing up?"

4. **Copy tone adapts to domain.** Steward: "Cut the balance. Guard cash." — financial directness. Forge: "Cravings peak here. Don't negotiate with them." — behavioral directness. Same energy, different vocabulary.

5. **The "next move" is always behavioral, not numerical.** Steward's next move is financial ("free up $X"). Forge's next move is behavioral ("log 3 times this week" / "identify your top 2 slip situations"). The gap POUNDS give you the distance; the directive tells you HOW.

6. **Maintenance is explicit.** Steward's final tier (Wealthy) is aspirational — debt at zero, build from here. Forge's final stage (Held) is defensive — goal reached, now DON'T GO BACK. This reflects the reality that weight regain is the norm, not the exception. The app doesn't end at the goal; it shifts into a permanent monitoring mode.

### What's Preserved (the blueprint)

- **The reframe:** Don't show the scary total number. Show the gap to the NEXT stage. Make the problem feel stageable.
- **The dual axis:** One axis for position (debt/weight), one for resilience (stability/consistency). Both matter; neither alone tells the full story.
- **The behavioral pressure model:** Three groups (Pressure → Momentum → Reward) with escalating stakes and shifting risks.
- **The guide posture:** Tell the user what stage they're in, what typically happens here, and what to do next. Don't dump data and let them figure it out.
- **The commitment gate:** Make the user own their number before they see the dashboard. No passive observation.
- **The session framing:** "Start Game" / "Start Session" — this is an active engagement, not a background tab.
- **The hidden complexity:** Full data exists in the DOM but isn't shown. The user sees the hero card and their next move. Everything else is available but secondary.

---

## Part 5: Recommended Implementation Plan

### Phase 0: Project Setup
- Create `/home/ubuntu/repos/Forge` (completely separate from Steward)
- `npm init`, Express, SQLite (better-sqlite3), dotenv
- Folder structure mirroring Steward's conventions:
  ```
  Forge/
  ├── server.js          # Express entry point
  ├── db.js              # SQLite setup + helpers
  ├── package.json
  ├── .env.example
  ├── .gitignore
  ├── services/
  │   ├── stages.js      # 10-stage definitions + getStage()
  │   ├── consistency.js  # Secondary axis scoring
  │   └── metrics.js     # Weight trend, delta tracking
  ├── routes/
  │   └── api.js         # GET /api/status, POST /api/weigh-in, etc.
  ├── public/
  │   ├── play.html      # Stable product shell (only shell for v1)
  │   ├── app.js         # Client render + boot + shell logic
  │   ├── style.css
  │   └── stage-constants.json
  ├── docs/
  └── test/
  ```

### Phase 1: Backend
- `services/stages.js`: 10 stages with percentage-of-goal thresholds, copy, directives
- `services/consistency.js`: Spotty / Steady / Locked scoring based on weigh-in frequency + trend
- `services/metrics.js`: 7-day trend weight, weekly averages, delta tracking
- `routes/api.js`: `GET /api/status` (stage, gap, consistency, narrative), `POST /api/weigh-in`, `GET /api/history`
- `db.js`: SQLite tables for weigh-ins, user config (goal weight, start weight), consistency snapshots

### Phase 2: Product Shell
- `play.html`: commitment screen → start screen → loading → hero card → data strip
- `app.js`: `render()`, `getStageRoot()`, `setAppMode()`, commitment gate, session tracking
- `style.css`: tier-colored theme system, stage card styling, responsive layout
- Single shell only (no classic/vNext split in v1 — start with the stable product)

### Phase 3: Polish
- Stage-specific narrative copy (all 10 stages × 3 consistency bands = 30 narrative variants)
- Visual per stage (simple CSS-only — character or abstract visual that evolves)
- Trend weight display (7-day moving average, not raw daily)
- Consistency pill in hero section
- Gap pounds headline
- Data strip: last weigh-in, next expected, consistency score

### Phase 4: Optional Extensions
- Smart scale API integration (Withings, Fitbit, etc.)
- Second shell (preview/vNext) for experimental features
- Projection: "At current rate, you'll reach next stage in X weeks"
- Weekly digest / check-in prompt

### What to Build First
Start with the smallest loop that creates value:
1. `POST /api/weigh-in` + `GET /api/status` (backend)
2. `play.html` with commitment gate + hero card (frontend)
3. 10 stages in `services/stages.js` (the card system)

This gives you a working product in a single sprint: enter weight → see your stage → see your gap → see your directive. Everything else is layered on top.
