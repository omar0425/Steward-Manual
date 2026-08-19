# Steward — Work Performed & Recommendations

## Total Work Performed

### 1. Repository Cleanup (PR #1 — merged)
- Moved 10 root-level screenshots → `docs/screenshots/`
- Moved `LOCAL-LINKS.md` → `docs/`
- Updated `.gitignore` with `*.db` exclusion
- Updated 2 doc files with corrected paths
- Kept `.bat`/`.vbs` Windows launchers at root (moving them would break `%~dp0` path resolution)

### 2. README Rewrite (PR #1 — second commit)
- Rewrote `README.md` from scratch with all requested sections: project summary, core idea (staged progression + behavioral pressure), local setup, routes table, tech stack, repo structure, and docs note
- Tone: simple, credible, not hypey

### 3. `/play` Stability Audit
- Traced every code path through `app.js`, `play.html`, `server.js`, and cross-shell references
- Identified 8 risk areas, rated by severity:
  - **Medium**: Hidden sentinel div is load-bearing for `render()` — removing any ID crashes the app
  - **Low** (5 items): `classicDoc` coupling, dynamic DOM mutation, unused `data-steward-shell`, SPA fallback serving vNext for unknown sub-paths, commitment screen removal fallback
  - **Safe** (2 items): vNext code isolation confirmed correct, route/launcher stability confirmed
- No high-severity risks found

### 4. Forge Blueprint (analysis only — no code)
- Analyzed Steward as a product blueprint: core mechanics, UX principles, architecture patterns
- Proposed "Forge" — body recomposition app using same philosophy (pressure + clarity + guide)
- Designed original 10-card progression system (Inert → Held)
- Delivered structural comparison showing how Forge maps to Steward without copying
- Implementation plan ready — awaiting approval before building

### 5. ES6 Module Split (PR #2 — open, CI green, tested)
- Split monolithic `public/app.js` (3,463 lines) into 12 focused ES6 modules under `public/js/`
- One commit per module extraction, in dependency order
- Updated all 4 HTML shells: `<script src="app.js">` → `<script type="module" src="js/main.js">`
- Deleted `app.js`
- Followed all 3 constraints: no CSS split, character-styles merged into character.js, no aggressive null checks
- Zero behavior changes — all tier definitions, math, copy, API shapes, CSS, server code identical

### 6. Bug Discovery & Fixes (during testing)
- **character.js**: Found duplicate `OPTICAL_OFFSETS` and `DEFAULT_VARS` const declarations (extraction artifact) — removed duplicates
- **tiers.js**: Found Unicode smart quotes (U+2019 `'`) lost during `sed` extraction, breaking single-quoted strings with apostrophes like `Don't` and `what's` — re-extracted with proper Unicode handling

### 7. End-to-End Testing
- Set up Node 24.15.0 (required for `node:sqlite`)
- Tested all 4 shells locally with 20 specific assertions:
  - `/play`: commitment gate, Start Game transition, character render, correct title
  - `/classic`: Start Game without commitment, correct title
  - `/` (vNext): preview title, shell detection
  - `/showcase`: 10-card grid, all characters rendered, window globals working
- Zero console errors across all shells
- Screen recording with annotations provided as evidence
- Test results posted as GitHub comment on PR #2

### 8. Environment & Skill Setup
- Suggested SKILL.md with testing procedures, routes, assertions, and common pitfalls
- Suggested environment config (Node 24 via nvm, npm install) for future sessions

---

## Recommendations

### Immediate (before merging PR #2)

1. **Merge PR #2** — CI is green, all 4 shells verified end-to-end, two extraction bugs found and fixed. The module split is complete and tested.

2. **Test with YNAB data** — Module loading is verified, but the full data pipeline (YNAB pull → render → hero card with live tier data) was not tested because no `YNAB_API_TOKEN` was available. Recommend testing with real credentials before or shortly after merge.

### Short-Term

3. **Add the sentinel comment to play.html** — The `/play` audit found that the hidden `dashboard-render-sentinels` div is load-bearing. A one-line HTML comment (`<!-- STABILITY-CRITICAL: render() depends on these IDs. Do not remove. -->`) would prevent accidental breakage during future edits.

4. **Remove dead code** — `currentTierTheme` in `layout.js` is write-only (set but never read). It was left in place to avoid behavior changes during the refactor, but can be safely removed now.

5. **Pin Node version** — The project requires Node 24+ for `node:sqlite`. Consider adding an `.nvmrc` file with `24` or a `"engines"` field in `package.json` so contributors don't hit the `node:sqlite` error on Node 22.

### Medium-Term

6. **Guard classic-only copy separately from play** — The `classicDoc` flag in `render()` applies to both `/classic` and `/play`. If classic-specific wording is ever needed that shouldn't appear in play, use `isClassicDashboardDoc()` directly instead of the shared `classicDoc` variable.

7. **Consider TypeScript or JSDoc types** — Now that the codebase is modular with explicit imports/exports, adding type annotations would catch import/export mismatches at build time instead of at runtime.

8. **Approve or shelve the Forge concept** — The full blueprint, 10-card system, and implementation plan are ready. If you want to proceed, the first phase is project setup + data model + single-card render loop.
