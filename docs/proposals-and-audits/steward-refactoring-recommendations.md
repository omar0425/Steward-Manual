# Steward Refactoring Recommendations

## What makes it confusing right now

The app works, but the architecture fights you. Here's where the confusion actually lives, ranked by how much damage each issue causes.

---

## 1. Four HTML files doing the same job (HIGH)

**The problem:**
- `index.html` — 577 lines (classic)
- `steward-vnext.html` — 756 lines (vNext)
- `showcase.html` — 1,657 lines (gallery)
- `play.html` — 20 lines (remake)

The first three contain copy-pasted Start Game screens, loading screens, character templates, and sentinel divs. Only `/play` was modernized to use JS-built DOM. When you change something in the Start Game screen, you have to remember to change it in 2-3 other HTML files. When you don't, they drift.

The `<template id="steward-template">` (303-line character SVG) is duplicated in `index.html`, `steward-vnext.html`, and `showcase.html`. `play.html` loads it dynamically via `template-loader.js` — proving the dynamic approach works.

**Fix:** Extend the `/play` pattern to all shells. One minimal HTML shell per route (like `play.html`'s 20 lines), with JS building the DOM. Character template always loaded dynamically. Start Game / Loading / Error screens built once in shared JS, not pasted into each HTML file.

**Effort:** Medium-high. This is the biggest single improvement.

---

## 2. `steward-vnext.js` is a non-module script talking through `window` globals (HIGH)

**The problem:**
`steward-vnext.html` loads two scripts:
```html
<script type="module" src="/js/main.js"></script>
<script src="/steward-vnext.js"></script>  <!-- classic script, NOT a module -->
```

`steward-vnext.js` (831 lines) communicates with the module system through `typeof window.stewardApiUrl === 'function'` checks. `main.js` has to manually export 12+ functions to `window` so that `steward-vnext.js` and `showcase.html`'s inline script can use them. This pattern has already caused **4 bugs** — every time a function was missed in the window exports, a feature silently broke.

**Fix:** Convert `steward-vnext.js` to an ES module. Import what it needs directly instead of fishing through `window`. This eliminates the entire class of "forgot to export to window" bugs.

**Effort:** Medium. The file is self-contained — it just needs `import` statements at the top and the calling HTML needs `type="module"`.

---

## 3. `showcase.html` has a 381-line inline script with duplicate tier data (MEDIUM)

**The problem:**
The showcase inline script defines its own `ALL_TIERS` array with all 10 tiers — IDs, labels, thresholds, flavor text, accent colors. This duplicates `TIER_META` and `TIER_FLOW` from `public/js/tiers.js`, and also partially duplicates `services/tiers.js` on the server.

Three sources of truth for the same tier data:
- `public/js/tiers.js` (client modules)
- `public/showcase.html` inline script (client inline)
- `services/tiers.js` (server)

**Fix:** Extract the showcase script to `public/js/showcase.js` as a module. Import `TIER_META` and `TIER_FLOW` from `tiers.js` directly. For server-client shared tier data, consider a single `shared/tiers.json` that both sides read.

**Effort:** Low-medium.

---

## 4. Shell detection is confusing (MEDIUM)

**The problem:**
Five functions in `shell.js`, with misleading names:
- `currentShell()` — URL-based, returns `'play'`, `'classic'`, `'showcase'`, or `'vnext'`
- `getDashboardRoot()` — DOM-based, returns whichever of `#dashboard-play`, `#dashboard`, `#dashboard-vnext` exists
- `isClassicDashboardDoc()` — returns true for classic only
- `isPlayDashboardDoc()` — returns true for play only
- `isClassicLayoutDashboardDoc()` — returns true for **both** classic AND play (confusing name)

The mix of URL-based and DOM-based detection exists because classic/vNext have their DOM IDs in static HTML, while play builds its DOM via JS. `isClassicLayoutDashboardDoc()` is the most confusing — it sounds like "is this the classic layout?" but it actually means "is this a shell that uses the classic/play hero + sentinel pattern?"

**Fix:** Use `currentShell()` everywhere. Replace the boolean functions with explicit checks: `if (shell === 'play' || shell === 'classic')` is clearer than `isClassicLayoutDashboardDoc()`. Remove DOM-based detection once all shells use JS-built DOM.

**Effort:** Low. Mostly renaming and find-replace.

---

## 5. `render.js` is a 733-line function with 76 DOM lookups (MEDIUM)

**The problem:**
`render()` is one function that does everything — updates tier label, gap headline, stability pills, progress bars, climb stats, brokerage accounts, and more. It does this via 76 `getElementById` / `querySelector` calls, each assuming a specific DOM ID exists. No null checks on most of them. If an ID is missing, it throws `TypeError: null.textContent`.

The function branches based on `isClassicLayoutDashboardDoc()` to determine which copy to show — but since play and classic share this flag, the branching is hard to follow.

**Fix:** Split `render()` into focused functions: `renderHeroCard(data)`, `renderClimbProgress(data)`, `renderStabilityAxis(data)`, `renderDataStrip(data)`. Each function receives a data object and a container reference — no global DOM fishing. Null-check the container once at the top of each function.

**Effort:** Medium. This is a careful refactor — the function works, it's just hard to maintain.

---

## 6. 5,356 lines of CSS in 2 files (LOW-MEDIUM)

**The problem:**
- `style.css` — 3,423 lines (shared across all shells)
- `steward-vnext.css` — 1,933 lines (vNext-only)

No organization by feature. Finding the CSS for a specific component means searching through thousands of lines. Styles for the commitment screen, start game, hero card, tier rail, data strip, character, onboarding — all in one file.

**Fix:** Split by feature:
- `base.css` — resets, variables, typography
- `commitment.css` — commitment gate
- `start-game.css` — start game screen
- `hero-card.css` — hero card and state cards
- `data-strip.css` — data sync strip
- `character.css` — character mount and animations
- `onboarding.css` — guided tour
- `tier-rail.css` — tier progression rail
- `vnext.css` — vNext-specific layouts

**Effort:** Low risk (CSS split doesn't change behavior) but tedious.

---

## 7. Server-side is actually fine (NO ACTION)

`server.js` (146 lines), `db.js` (175 lines), `routes/api.js` (343 lines), and the `services/` directory (2,307 lines across 9 files) are well-organized. Each service has a clear responsibility. The API routes are clean. Don't touch this.

---

## Recommended order

| Priority | What | Why first |
|----------|------|-----------|
| 1 | Convert `steward-vnext.js` to ES module | Eliminates the #1 bug source (window globals). Unblocks #2. |
| 2 | Extend `/play` pattern to `/classic` and `/` | Eliminates HTML duplication. Makes shell detection simple. |
| 3 | Extract showcase inline script to module | Removes duplicate tier data. Last remaining inline script. |
| 4 | Clean up shell detection | Simple rename/replace after shells are unified. |
| 5 | Split `render.js` into focused functions | Maintainability improvement. Lower risk once HTML is unified. |
| 6 | Split CSS by feature | Nice to have. Do last or skip for now. |

## What NOT to do

- **Don't add a build step.** Steward's zero-build, ES modules + Express approach is a feature. It keeps the app simple to run (`node server.js` and you're done).
- **Don't add a framework.** React/Vue/Svelte would be overkill for this app. The declarative `el()` helper in `views/play.js` is the right level of abstraction.
- **Don't change the server.** It's already clean.
- **Don't change tier logic, math, or copy.** This is a structural refactor, not a redesign.
