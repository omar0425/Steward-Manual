# Steward — Metrics Sanity Audit

A standing "do these numbers make sense?" check. It catches two classes of
problem:

1. **Absurd-in-one-snapshot** — a value technically correct but contextually
   nonsense (the "CLEAR $7,189 THIS MONTH" class): a monthly ask larger than the
   balance, a forecast band out of order, a negative interest figure, a
   probability outside 0–100.
2. **Drift over time** — a figure that quietly goes wrong: a monotonic counter
   (`cumulativePaidDown`, `cumulativeInterestAccrued`) that *fell*, `pctPaid`
   sliding backward, or a headline number swinging wildly in one period.

## The pieces

- **`scripts/audit-metrics.js`** — the auditor. Feed it a `/api/status` payload.
  - `npm run audit:metrics path/to/status.json`
  - `curl -s --cookie "steward_sid=…" https://APP/api/status | npm run audit:metrics`
  - `node scripts/audit-metrics.js today.json --baseline yesterday.json` — adds the drift check.
  - `--strict-drift` promotes drift WARNs to FAILs (non-zero exit) for hard alerts.
  - `--ai` adds an AI sense-check (`services/stewardAi.generateMetricsAudit`, needs an API key).
  - Exit code is **1** on any FAIL, so it gates CI or a scheduled run.

- **`scripts/audit-cron.ps1`** — the schedule. Captures `/api/status` daily into
  `~\StewardAudits\steward-status-<stamp>.json`, runs the auditor against it with
  the previous capture as the drift baseline, prunes old captures, and exits
  non-zero on FAIL.

## Scheduling it (one-time setup)

`/api/status` is session-gated, so the capture needs a logged-in cookie:

1. Sign in to the app in your browser.
2. DevTools → Application → Cookies → copy the value of `steward_sid`.
3. Set env vars (sessions last ~30 days — refresh the cookie ~monthly):
   ```
   setx STEWARD_BASE_URL "https://your-app.up.railway.app"
   setx STEWARD_SESSION_COOKIE "<the steward_sid value>"
   ```
4. Register the daily task (09:05, just after the backup pull):
   ```
   schtasks /Create /SC DAILY /ST 09:05 /TN "Steward Metrics Audit" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:\Users\Omar\Steward-Manual\scripts\audit-cron.ps1\""
   ```
5. Run it once to confirm: `schtasks /Run /TN "Steward Metrics Audit"`.

For hard alerting (treat any drift as a failure the scheduler surfaces), schedule
with `-StrictDrift`. For the AI sense-check too, add `-Ai` (needs the API key on
that machine).

## In CI

The auditor also runs against a captured payload as a gate — pipe a known-good
`/api/status` JSON into `node scripts/audit-metrics.js` and let a non-zero exit
fail the job.
