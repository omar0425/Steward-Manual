# Steward — Manual Edition

A debt-only payoff dashboard with gamified progress tracking. No API keys needed — enter your balances manually and watch your tier climb.

## Quick Start

```bash
npm install
npm start
# Open http://localhost:3000
```

No `.env` required. SQLite database is created automatically on first run.

## How It Works

1. **Make your commitment** — Write your reason for climbing out of debt.
2. **Add your debts** — Enter each debt account (credit cards, loans, liabilities) with name + current balance.
3. **Save a snapshot** — Your data is stored locally. The dashboard shows your tier, progress, and paydown stats.
4. **Update balances** — Come back when you make payments. Update the numbers and save again. The app tracks your climb over time.

## Features

- **10-Stage Tier System** — Progress from "Buried" → "Wealthy" as debt drops.
- **Persistent Debt List** — Saved debts appear with editable balance fields and an "Update Balances" button.
- **Paydown Confirmation** — Before saving, see a summary of what changed (e.g. "Visa: $4,500 → $4,000, paid $500").
- **Delete Debts** — Remove paid-off accounts with the × button.
- **First-Time Hint** — Onboarding prompt guides new users to add their first debts.
- **Climb Metrics** — Tracks cumulative paydown, streaks, per-account deltas, milestones (25%, 50%, 75%, 90%).
- **Per-Account Tracking** — See which debts are shrinking and by how much.
- **Interest Rate Management** — Set APR per account for prioritization.
- **Mobile Responsive** — Optimized layout for small screens (480px breakpoint).
- **Commitment System** — Your reason for climbing stays with you throughout.
- **Dark UI** — Dark navy theme throughout.

## Data

All data is stored locally in `steward.db` (SQLite). Nothing is sent to any external service.

## Note on `node_modules/express`

If you see a stub copy of `node_modules/express/` checked into the repo, that is intentional — it exists so IDEs can resolve Express types without a full `npm install`. Do not delete it. Run `npm install` for the real dependencies before `npm start`.

## Development

```bash
npm run dev        # Start with auto-reload (--watch)
npm test           # Run test suite
npm run reset-local-data  # Clear all game state
```

## License

See [LICENSE](./LICENSE).
