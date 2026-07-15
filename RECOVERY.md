# Steward — Backup & Recovery Runbook

How your data is backed up, how to **verify** a backup actually works, and exactly how to **restore** when something goes wrong. Written so future-you can recover at 2 a.m. without reverse-engineering the code.

The whole database is a single SQLite file at `STEWARD_DB_PATH` (e.g. `/data/steward.db` on a mounted volume). Everything — accounts, snapshots, debts, config — lives in that one file.

---

## What backs you up (three layers)

1. **Daily on-volume rotation** (production only, automatic).
   - `server.js` writes a dated snapshot to `<db-dir>/backups/steward-YYYY-MM-DD.db` once a day via `VACUUM INTO` (a consistent copy even mid-write), keeping the last **7**.
   - Each snapshot is **self-verified** with an integrity check right after it's written; a failure logs `[backup] WARNING: daily snapshot FAILED integrity check`.
   - Protects against: corruption, a bad deploy, accidental data loss.
   - Does **NOT** protect against losing the volume itself — same disk as the live DB.

2. **Pre-destruction snapshots** (every environment, automatic).
   - Right before the two destructive operations — **game reset** and **restore-over-data** — a consistent whole-DB copy lands in `<db-dir>/backups/steward-pre-<reset|restore>-<stamp>.db` (newest **5** kept).
   - A wrong-file restore or a panic reset is recoverable the same way as any backup (Option A below). Snapshot failure never blocks the operation itself — it logs and proceeds.

3. **Off-box pull** (you run this — the real disaster protection).
   - `GET /admin/backup`, guarded by `STEWARD_BACKUP_TOKEN`, streams a fresh consistent copy.
   - `scripts/pull-backup.ps1` downloads it to `%USERPROFILE%\StewardBackups` (keeps 30 days). Schedule it daily:
     ```
     schtasks /Create /SC DAILY /ST 09:00 /TN "Steward DB Backup" \
       /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:\path\to\scripts\pull-backup.ps1\""
     ```
     with `STEWARD_BASE_URL` and `STEWARD_BACKUP_TOKEN` set.
   - Protects against: total loss of the host/volume.

> **Boot-time watchdogs:** every boot runs `PRAGMA quick_check` on the **live** DB and re-checks that the file sits on a persistent volume. Failures print loudly to the server log **and** land in the admin bug panel (signatures `live-db-integrity-failure` / `storage-durability-warning`) — a corrupt live DB running past the 7-day rotation would otherwise poison every remaining backup.

> **The one rule:** a backup you've never restored is a hope, not a backup. Run the drill (below) on a schedule.

---

## Verify a backup — the restore drill

`scripts/restore-drill.js` proves a backup can be recovered. It does NOT touch the live DB.

```bash
# FRESH: back up the live DB, restore the copy, verify it round-trips exactly.
STEWARD_DB_PATH=/data/steward.db npm run backup:drill

# FILE: drill a specific backup (e.g. an off-box copy).
node scripts/restore-drill.js ~/StewardBackups/steward-2026-06-29-0900.db
```

It checks: the copy opens, `PRAGMA integrity_check` is `ok`, `foreign_key_check` is clean, all 7 expected tables exist, and (fresh mode) every key table's row count matches live exactly. **Exit 0 = safe, exit 1 = do not rely on it.** Wire the fresh drill into a daily/weekly job and alert on non-zero exit.

---

## Restore — when the live DB is lost or corrupt

### Option A — swap the file (full, fastest; use after volume loss / corruption)

1. **Stop the app** (so nothing writes mid-swap).
2. Pick the newest **verified** backup. Confirm it first:
   ```bash
   node scripts/restore-drill.js /path/to/backup.db   # must print PASSED
   ```
3. Put it in place (back up the bad file first, just in case):
   ```bash
   mv /data/steward.db /data/steward.db.broken 2>/dev/null || true
   rm -f /data/steward.db-wal /data/steward.db-shm   # stale WAL would mask the restore
   cp /path/to/backup.db /data/steward.db
   ```
4. **Start the app.** Hit `/health`, then log in and confirm your latest snapshot is present.

### Option B — per-user restore via the app (recover one account / merge a JSON export)

Use this for a single user's data from a JSON export (from the in-app "Export my data"), not a raw `.db` file.

- In-app: the logged-in user POSTs their export to `/api/restore`.
- Operator: `POST /admin/api/users/:id/restore` with `ADMIN_TOKEN`.
- **Safety:** restore refuses to wipe existing data if the payload has no usable snapshots (HTTP `409 needsForce`); pass `force` only when an intentional wipe is meant. The response reports any `skipped` rows, so a truncated file can't look fully successful.

---

## If a backup FAILS the drill

- Don't restore from it. Try the next-newest verified backup.
- If the **live** DB is the one failing integrity, salvage what's readable before overwriting:
  ```bash
  sqlite3 /data/steward.db ".recover" | sqlite3 /data/steward-recovered.db
  node scripts/restore-drill.js /data/steward-recovered.db
  ```
- Check the logs for the `[backup] WARNING … FAILED integrity check` line to find when corruption first appeared, and prefer a backup from before that date.

---

## Recommended cadence

- **Daily:** off-box pull (`pull-backup.ps1`) + the fresh restore drill, alert on failure.
- **Monthly:** do a real Option-A restore into a throwaway environment end-to-end — the only way to know the *whole* path works, not just the file.
- Keep the off-box copies on different hardware/cloud than the live volume.

---

## Ongoing health checks (do these numbers make sense?)

Beyond "can I recover," catch a *figure* drifting into nonsense (the class of bug
that once produced "CLEAR $7,189 THIS MONTH"). `scripts/audit-metrics.js` runs
domain-sense checks on a `/status` payload — realistic monthly ask, ordered
forecast bands, monotonic payoff probabilities, non-negative interest, etc.

```bash
# Against a saved payload:
node scripts/audit-metrics.js status.json
# Against the live app (exit 1 if anything FAILs → alert on it):
curl -s --cookie "steward_sid=<your session>" https://APP/api/status | node scripts/audit-metrics.js
# Add --ai to also ask the model for a freeform sanity read (needs the AI key).
```

- **Weekly (or after any climb-math change):** run it against live `/status`; a
  non-zero exit means a metric is contextually wrong — investigate before trusting
  the dashboard. The `runChecks()` function is unit-tested (`test/audit-metrics.test.js`).
