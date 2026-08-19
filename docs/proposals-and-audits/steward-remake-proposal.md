# Steward Remake — Phase 1 Proposal

## 1. What the remake keeps (conceptually identical)

These are the product decisions that make Steward work. Changing any of them would make this a different product, not a remake.

### Tier system — same data, same thresholds, same names
- 10 tiers: Rock Bottom → Broke → Struggling → Surviving → Stabilizing → Stable → Building → Thriving → Winning → Wealthy
- Same debt_remaining thresholds: >$79K, >$70K, >$60K, >$50K, >$40K, >$30K, >$20K, >$10K, >$0, ≤$0
- Same tier copy, same behavioral directives, same phase grouping (Pressure / Momentum / Reward)

### Gap-to-next-tier as the primary headline
- The main number the user sees is "how much debt to remove to escape this stage" — not debt remaining, not net worth
- This framing is the product. It turns a balance sheet into a game objective.

### Secondary stability axis
- Exposed / Steady / Fortified based on liquidity runway
- Same scoring model: runway points + buffer points, guard clamps
- Same dual-axis framing: debt tier (payoff progress) × stability band (cash safety)

### Commitment gate (first-run)
- "Make this real." → confrontational tone → pledge → custom input → "I'm in"
- Appears once on first visit to /play. Persists in localStorage.
- Same copy: "This doesn't fix itself. No one is coming to save you."

### Start Game flow
- Session gate with character, live clock, "Start Game" button
- Balloon float-up animation on click → loading → dashboard
- Session tracking (playtime, session count) in localStorage

### Hero-card-first experience
- The first thing visible after boot is the hero card: character + tier name + gap headline + in-band bar
- The card IS the dashboard. Everything else is secondary context.

### Guide-not-dashboard philosophy
- Minimal visible data. No tables, no charts, no export buttons.
- Every piece of text exists to create pressure or give clarity about the next move.
- Behavioral directives per tier, not generic advice.

### Tone
- Direct, grounded, serious. No motivational fluff. No emoji. No celebration for expected behavior.
- "Cut the balance. Guard cash." not "Great job! Keep going!"

### Backend + API contract
- Same Express server, same SQLite schema, same YNAB integration
- Same `/api/status` response shape (tier, nextTier, stats, stability, meta)
- Same `/api/snapshots`, `/api/brokerage`, `/api/refresh/:source` endpoints
- The remake's frontend consumes the exact same API as current Steward — same server, no backend changes

### Routes
- `/play` = stable product shell
- `/classic` = reference/classic shell
- `/` = preview (optional — may skip in v1 of remake)
- `/showcase` = tier gallery

---

## 2. What the remake changes

Every change below targets a specific weakness in the current implementation. Nothing is changed for novelty.

### A. Single HTML shell instead of four

**Current problem**: Four separate HTML files (play.html, index.html, steward-vnext.html, showcase.html) duplicate large amounts of structure. play.html alone is 607 lines of HTML. The sentinel div pattern (151 hidden DOM elements that render() writes into) is fragile — removing any ID crashes the app with no error message. Shell detection happens via DOM ID presence (`#dashboard-play` vs `#dashboard` vs `#dashboard-vnext`), which couples JS behavior to HTML structure.

**Remake approach**: One `index.html` (~80 lines) that loads a single JS entry point. The shell (play, classic, showcase) is determined by URL path, not DOM sniffing. Each route mounts its own view using a lightweight render function — no hidden sentinel divs. Showcase is a separate view within the same shell, not a different HTML file.

**Why this matters**: Eliminates the class of bugs where "someone edits one HTML file and forgets the others." Removes the entire sentinel pattern that the stability audit flagged as the #1 risk.

### B. Declarative rendering instead of imperative DOM mutation

**Current problem**: render() in render.js (733 lines) is a single function that does ~90 `document.getElementById()` calls and sets `.textContent` / `.hidden` / `.style.width` on each element directly. This means:
- Every DOM element must exist before render() runs (hence the sentinel div hack)
- Adding a new data field requires editing HTML + JS in lockstep
- No way to diff what changed between renders — everything is rewritten every time

**Remake approach**: A thin reactive layer. Not React, not a framework — just a pattern where:
1. State is a plain object (`{ tier, stats, nextTier, stability, meta }`)
2. View functions take state and return DOM (or modify a container)
3. State changes trigger re-render of only the affected view

This is ~200 lines of vanilla JS, not a framework. It's closer to how `showcase.html` already works (its inline script builds cards from data) than to how `render()` works.

**Why this matters**: Removes the sentinel div pattern entirely. Makes it possible to add/remove UI sections without touching HTML. Makes the render flow testable in isolation.

### C. CSS organized by concern, not one 3,423-line file

**Current problem**: style.css is a single file covering commitment screen, start game, loading, error, dashboard layout, hero card, state card backgrounds (10 tiers), financial board, onboarding spotlight, progress widget, tier rail, stability pills, data strip, session info, brokerage, tooltips, debug overlays, responsive breakpoints, and animations. Finding the styles for a specific feature requires searching through thousands of lines.

**Remake approach**: CSS split by feature, loaded via `@import` or concatenated at build:
- `base.css` — tokens, reset, typography (~80 lines)
- `commitment.css` — commitment gate (~80 lines)
- `start.css` — start game screen + animations (~120 lines)
- `hero.css` — hero card, state card backgrounds, character mount (~300 lines)
- `board.css` — financial board, progress, tier rail (~200 lines)
- `onboarding.css` — spotlight, guided tour (~100 lines)
- `responsive.css` — breakpoints (~150 lines)

Same CSS, same visual output — just organized so you can find things.

**Important**: This is file organization only. The user's original constraint was "do NOT split CSS" for the refactor PR — but this is a separate remake project, not the Steward refactor. The visual output is identical; only file boundaries change.

### D. Character system as structured data, not 542 lines of inline CSS

**Current problem**: character.js is a 542-line file where a self-executing IIFE injects an enormous `<style>` tag into the document head. The character is built entirely from CSS (divs with absolute positioning, pseudo-elements, transforms). This is an impressive technical achievement — but it means:
- The entire character definition (hat, coat, monocle, cane, dog, racecar, mansion, Mercedes) lives in a single string template
- Per-tier visual states are CSS attribute selectors (`[data-state="wealthy"] .sw-vest`)
- Modifying any character detail requires editing raw CSS strings inside JS

**Remake approach**: Same CSS-only character technique (no SVG, no canvas, no images), but structured as:
1. `character.css` — the base character styles as a normal stylesheet (not injected via JS)
2. `character-states.js` — a data object mapping tier IDs to CSS custom property overrides (scene-scale, money-opacity, sparkle-opacity, car-opacity, etc.)
3. `mountCharacter(tierId, container)` — applies the tier-specific custom properties to the container

The character looks identical. The rendering technique is identical. But the tier-specific customization becomes a readable data table instead of scattered CSS selectors.

### E. State machine for boot flow

**Current problem**: Boot flow is controlled by `data-app-mode` on `<body>` with CSS rules that hide/show layers (`display: none !important`). The state transitions are spread across boot.js (setAppMode), commitment.js (openCommitmentGate), and CSS (body[data-app-mode="start"]). It works, but the flow is:
```
commitment? → start game → loading → ready/error
      ↓ (already committed)
start game → loading → ready/error
      ↓ (no start gate)
loading → ready/error
      ↓ (session resume)
loading → ready/error
```
This logic is implicit in nested if/else blocks with callbacks.

**Remake approach**: An explicit state machine object:
```js
const STATES = {
  COMMITMENT: { next: 'START', skip: () => readPromiseMadeFlag() },
  START:      { next: 'LOADING' },
  LOADING:    { next: 'READY', error: 'ERROR' },
  READY:      { next: null },
  ERROR:      { next: 'LOADING' },
};
```
Each state has an `enter()` function that mounts its view. Transitions are explicit. The same flow, but readable and debuggable.

### F. Unified layout — no "classic vs play vs vNext" branching in render

**Current problem**: render() contains ~20 `if (classicDoc)` branches that change copy, visibility, and formatting between classic/play and vNext shells. This means:
- Adding new copy requires checking which shell it applies to
- Bugs can hide in one branch while the other works
- The "classic" vs "play" distinction is actually "isClassicLayoutDashboardDoc()" which returns true for BOTH classic and play

**Remake approach**: One render path. Shell-specific differences (like the "Play" badge in the nav) are handled at the shell/route level, not inside the render function. The hero card, financial board, and progress narrative render identically regardless of which route loaded them.

If specific copy differences are needed later, they're expressed as a configuration object passed to render, not as inline conditionals.

---

## 3. Proposed visual direction

### What stays visually identical
- **Color palette**: Same warm sand/forest green base (`--bg-top: #e8dcc4`, `--forest-950: #10261c`, etc.)
- **Typography**: Playfair Display for headings, Inter for body. Same weights, same letter-spacing.
- **State card backgrounds**: Same 10 tier-specific gradient backgrounds (dark crimson → gray → earth → greens → blue → purple → teal → gold)
- **Character**: Same CSS-only gentleman. Same hat, coat, monocle, cane, accessories per tier.
- **Frosted glass panels**: Same `backdrop-filter: blur(12px)`, same `--panel` semi-transparent backgrounds
- **Commitment gate**: Same dark overlay, same gold accent border-left on the pledge block
- **Start Game**: Same centered card, same balloon float animation, same breathing character idle

### What changes visually
1. **Tighter hero section**: Current hero is a two-column layout (stage column + story column) that can feel spacious on wide screens. Remake centers the card with context below it in a single-column flow. The card is the anchor; everything else supports it downward.

2. **Progress bar integrated into the card footer**: Current card has a thin bar + percentage text. Remake keeps the bar but removes the percentage label (which the current code already hides — `cardBarInbandPct.hidden = true`). The bar speaks for itself.

3. **Data strip simplified**: Current has separate sections for financial board, progress narrative, brokerage footnote, session timer, debug overlay. Remake collapses these into a single scrollable detail panel below the hero that expands on tap/click — "Show details" → reveals debt remaining, net worth, climb summary, runway, pull freshness. Defaults to collapsed on mobile.

4. **Showcase grid tightened**: Same 10-card grid, but cards are slightly smaller with more breathing room. The tier label and behavioral cue appear on hover/tap rather than always visible — keeps the grid clean and focused on the characters.

5. **No tier rail on the side**: Current classic shell has a vertical tier rail showing all 10 stages. The remake drops this — the card badge number (01–10) is sufficient for position context, and the showcase exists for the full view. This simplifies the layout without losing information.

### Visual tone
Same as current: serious, understated, premium. Not a fintech dashboard. Not a game. A financial guide that happens to track progress like a game.

---

## 4. Proposed architecture

```
steward-remake/
├── server.js              # Express server (identical to current, or imports from Steward)
├── package.json
├── public/
│   ├── index.html          # Single HTML shell (~80 lines)
│   ├── css/
│   │   ├── base.css        # Tokens, reset, typography
│   │   ├── commitment.css  # Commitment gate
│   │   ├── start.css       # Start game screen + animations
│   │   ├── hero.css        # Hero card, state card backgrounds
│   │   ├── board.css       # Financial data panel
│   │   ├── character.css   # Character styles (currently injected via JS)
│   │   ├── onboarding.css  # Spotlight + guided tour
│   │   ├── showcase.css    # Showcase grid
│   │   └── responsive.css  # Breakpoints
│   └── js/
│       ├── main.js         # Entry point, router, window exports
│       ├── state.js        # App state machine (COMMITMENT → START → LOADING → READY)
│       ├── router.js       # URL → view mapping (/play, /classic, /showcase)
│       ├── tiers.js        # Same tier data (copied from Steward)
│       ├── api.js          # Fetch wrappers (same endpoints)
│       ├── format.js       # All formatters (same logic)
│       ├── character.js    # Character mount + tier state data
│       ├── render.js       # Declarative view builders (hero, board, progress)
│       ├── commitment.js   # First-run gate
│       ├── session.js      # Session tracking (localStorage)
│       ├── onboarding.js   # Guided tour
│       └── views/
│           ├── play.js     # Play shell view
│           ├── classic.js  # Classic shell view (optional, v2)
│           └── showcase.js # Showcase grid view
```

### Key architectural decisions

**No build step**: Same as current Steward. ES6 modules loaded natively. No bundler, no transpiler, no Node tooling for the frontend. `<script type="module" src="js/main.js">` and that's it.

**Same backend**: The remake's `server.js` either:
- (a) Imports and re-uses Steward's `db.js`, `services/`, `routes/api.js` directly (symlink or relative require), or
- (b) Copies them verbatim into the remake project

Option (a) is cleaner for comparison — both apps share one backend, one database. The remake is purely a frontend re-skin. This means running both side-by-side on different ports with the same YNAB data.

**Router is ~30 lines**: Not a framework router. Just reads `window.location.pathname`, maps to a view function, calls it. History API for navigation without reload.

**State machine is ~60 lines**: Object mapping state names to enter/exit functions. Transitions are `machine.goto('LOADING')`. CSS uses `[data-state]` on a root element for visibility, same pattern as current `data-app-mode`.

**Render functions return DOM elements**: Not strings, not virtual DOM. Just `document.createElement` calls wrapped in helper functions. Each view function takes state, returns an element (or updates an existing container). This is the same technique `showcase.html` already uses for building cards.

---

## 5. Risks of the remake vs current Steward

### Risk 1: Visual fidelity loss (MEDIUM)
**What could go wrong**: The character system, state card gradients, and animation timings are precision-tuned in the current CSS. Rebuilding them in a different file structure risks subtle visual differences — a color slightly off, an animation not quite matching, a responsive breakpoint catching at the wrong width.

**Mitigation**: I'll copy CSS values verbatim, not rewrite them. The state card background gradients (`radial-gradient(ellipse at 50% 45%, rgba(100, 26, 44, 0.4)...`) are copied character-for-character. Visual comparison screenshots at every stage.

### Risk 2: Worse than a refactor (MEDIUM)
**What could go wrong**: If the remake doesn't look and feel meaningfully better than current Steward, it's just a rewrite with no value — and rewrites carry risk. The user explicitly said this is for comparison, which means the remake needs to justify its existence.

**Mitigation**: The remake's value is in architecture (single shell, no sentinel divs, declarative rendering, organized CSS) and maintainability, not in visible features. The comparison should highlight "time to make a change" and "number of files touched to add a field" — not just screenshots.

### Risk 3: Shared backend coupling (LOW)
**What could go wrong**: If the remake shares Steward's backend via symlinks/imports, changes to Steward's API contract could break the remake. If it copies the backend, they can drift apart.

**Mitigation**: Start with option (a) — shared backend. The API contract is stable and well-defined. If drift becomes an issue, we can snapshot the backend at the time of the remake.

### Risk 4: Missing edge cases from render() (MEDIUM)
**What could go wrong**: Current render() handles ~30 edge cases: wealthy-exposed special copy, rock_bottom classic-only overrides, brokerage footnote visibility, stale data warnings, restructure flags, sub-$1 gap formatting, noisy pace detection. The remake's declarative approach might miss some of these.

**Mitigation**: I'll build a checklist from the current render() function, line by line, and verify each case is handled. The test plan from the previous session provides the assertion framework.

### Risk 5: "Guide not dashboard" erosion (LOW)
**What could go wrong**: The remake's collapsible detail panel could feel like a dashboard trying to hide behind a toggle. If the default state shows too much data, the guide philosophy is undermined.

**Mitigation**: Default state shows ONLY the hero card + gap headline + behavioral directive. Everything else is one tap away but not visible. The card is the product; the detail panel is the evidence.

---

## Summary: Current vs Remake at a glance

| Dimension | Current Steward | Remake |
|-----------|----------------|--------|
| HTML files | 4 (play, index, vnext, showcase) | 1 |
| CSS files | 1 (3,423 lines) | 9 (~1,030 lines total, same CSS) |
| JS modules | 12 under public/js/ | 14 under public/js/ (+ views/) |
| Rendering | Imperative (90+ getElementById calls) | Declarative (view functions return DOM) |
| Shell detection | DOM ID sniffing | URL path routing |
| Boot state | data-app-mode on body + CSS selectors | Explicit state machine |
| Character CSS | Injected via JS IIFE (542 lines) | Static stylesheet + data-driven state |
| Hidden sentinel divs | Yes (fragile, stability risk #1) | No |
| Build step | None | None |
| Backend | Express + SQLite + YNAB | Same (shared or copied) |
| Visual output | — | Identical (same palette, type, card backgrounds, character) |
| Tone | Direct, grounded | Same |
| Tier system | 10 tiers, same thresholds | Same |
| Product philosophy | Guide, not dashboard | Same |

---

## Next steps (pending your approval)

1. **You approve or revise this proposal**
2. I create `/home/ubuntu/steward-remake/` as a separate project
3. I build it — starting with the boot flow (commitment → start → loading → hero card), then rendering, then showcase
4. I run both side-by-side on different ports for direct comparison
5. I deliver the Phase 3 comparison document
