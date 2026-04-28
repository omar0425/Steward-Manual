# Testing Steward Manual Edition

## Overview
Steward Manual Edition is a debt-only financial tracking app (Node.js + Express + SQLite). Testing involves running the server locally and exercising the UI through the browser.

## Environment Setup

1. **Node version**: 24+ (use `nvm use` if needed)
2. **Install dependencies**: `npm install` from the project root
3. **Fresh DB**: Delete `steward.db` and any WAL/SHM files before testing: `rm -f steward.db*`
4. **Start server**: `npm start` — runs on `http://localhost:3000`
5. **Clear browser state**: Open DevTools → Application → Local Storage → Clear, then reload

## Key User Flows to Test

### 1. Commitment Gate → Dashboard
- Navigate to localhost:3000
- Click "Start Session" on the start screen
- Type a reason on the commitment gate, click "I'm in. Start the game."
- Click "Add Your Debts" on the loading screen
- **Note**: The commitment reason persists in localStorage and shows as a quote on the start screen

### 2. First-Time Hint
- The golden dashed hint box ("Start by adding your debts") appears when the latest snapshot has no debt account lines
- It does NOT appear on the very first load before any snapshot exists — the `/api/status` endpoint returns `noData: true` which triggers an early return
- After saving the first snapshot, the hint appears if no debts were saved

### 3. Add Debts + Save
- Click "+ Add Account" to add rows
- Enter account name and balance for each
- Click "Save Debts"
- **After save**: Page reloads to the start screen. Click "Start Session" again to return to the dashboard with saved debts pre-populated
- Verify: saved debt list shows with × buttons, correct balances, total, and "Update Balances" button

### 4. Paydown Confirmation Dialog
- Change a saved debt's balance input to a lower value
- The live total updates as you type
- Click "Update Balances"
- A confirmation overlay appears showing: account name, old → new balance, amount paid, and total paid down
- **Cancel**: Dialog closes, no save, page stays as-is, input retains the typed value
- **Save**: Snapshot saved, page reloads with updated balances

### 5. Delete Debt (× Button)
- Click × on any saved debt row
- Row disappears immediately (client-side removal)
- Total updates
- The deletion is persisted on the next "Update Balances" or "Save Debts" action

### 6. Mobile Layout
- Resize browser to 375px width (or use `xdotool getactivewindow windowsize 375 700`)
- Verify debt rows render without horizontal overflow
- The 480px CSS breakpoint stacks debt entry rows vertically

## Testing Tips

- The app uses `window.location.reload()` after saving snapshots, so the page returns to the start screen each time. This is by design.
- The tier system and paydown tracking work automatically — after saving a snapshot with reduced balances, the dashboard shows streak badges, stage progress updates, and "Total Cleared" amounts.
- To test paydown detection specifically, save two snapshots with different balances for the same account.
- The SQLite database file is `steward.db` in the project root. Delete it for a completely fresh state.
- Tests pass at 48/49 — the 1 failure is a pre-existing issue from the original Steward repo.

## Devin Secrets Needed
None — this is a local-only app with no API keys or external auth required.
