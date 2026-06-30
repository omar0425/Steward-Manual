# Steward — Backup & Recovery Runbook

The whole app is one SQLite file. Lose it and you lose every user, snapshot, and
climb. This runbook is the proof that you can get it back — not just that backups
*exist*, but that they *restore*, and that the steps are written down before you
need them at 2 a.m.

> **Production runs on Railway.** The DB lives on a mounted volume at the path in
> `STEWARD_DB_PATH` (e.g. `/data/steward.db`). There is no Railway CLI on the
> local machine — recovery is done through the Railway dashboard plus the
> off-box copies on your PC and the admin/restore endpoints.

---

## 1. The threat model (what actually kills you)

| Failure | Protected by | Notes |
|---|---|---|
| **Volume lost / deleted** (Railway incident, fat-finger) | **Off-box pull** (`pull-backup.ps1` → `~\StewardBackups`) | The on-volume rotation dies *with* the volume. The off-box copy is the only thing that survives this. **This is the one that matters most.** |
| **DB corruption / bad migration** | On-volume daily rotation (`<db-dir>/backups/`, keeps 7) + off-box | Restore the most recent *good* daily copy. |
| **Bad deploy wipes/changes data** | Same as above | Roll back the deploy *and* restore the pre-deploy backup. |
| **Ephemeral FS (no volume configured)** | `server.js` refuses to boot in prod without `STEWARD_DB_PATH` | Prevents the silent "every redeploy wipes users" disaster. |
| **One user's data mangled** (bad import, wrong-amount spiral) | `POST /admin/api/users/:id/restore` + `…/recompute` | Per-user repair without touching anyone else. |
| **A user nukes their own data** | `GET /api/export` they downloaded → `POST /api/restore` | Per-user, self-service. |

**RPO (most data you can lose):** ≤ 24h with the daily off-box pull. Drop the
schtasks interval to hourly if you want tighter.
**RTO (time to recover):** minutes — copy a verified `.db` onto the volume and
restart.

---

## 2. Backup inventory — where copies live

1. **On-volume daily rotation** (production, automatic).
   `server.js` runs `VACUUM INTO <db-dir>/backups/steward-YYYY-MM-DD.db` at boot
   and every 12h, keeping the last **7**. Survives corruption and bad deploys,
   **not** volume loss.

2. **Off-box pull** (your PC, scheduled — **the critical layer**).
   `scripts/pull-backup.ps1` downloads `GET /admin/backup` (a consistent
   `VACUUM INTO` stream, token-guarded) to `~\StewardBackups\steward-<stamp>.db`,
   keeps 30 days, **and verifies each download with the restore drill** (§4).
   This is the copy that survives Railway losing the volume.

3. **Per-user exports.** `GET /api/export` (JSON, the complete backup; also
   `?format=csv`) lets any signed-in user pull their own data. The admin
   equivalent is `GET /admin/api/users/:id/export`.

4. **Manual / pre-deploy snapshot.** Before any risky migration, pull one on
   demand:
   ```powershell
   powershell -File scripts\pull-backup.ps1 -BaseUrl https://<app>.up.railway.app -Token <STEWARD_BACKUP_TOKEN>
   ```

---

## 3. One-time setup (do this now if not already done)

1. **Set the tokens on Railway** (service variables):
   - `STEWARD_BACKUP_TOKEN` — guards `GET /admin/backup` (the off-box pull).
   - `ADMIN_TOKEN` — guards the `/admin/api/*` repair endpoints.
   Without `STEWARD_BACKUP_TOKEN`, `/admin/backup` returns 501 and the pull can't run.

2. **Schedule the off-box pull on your PC** (runs as your user, daily 09:00).
   Set `STEWARD_BASE_URL` and `STEWARD_BACKUP_TOKEN` as user env vars first, then:
   ```
   schtasks /Create /SC DAILY /ST 09:00 /TN "Steward DB Backup" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:\Users\Omar\Steward-Manual\scripts\pull-backup.ps1\""
   ```
   Confirm it's registered, then run it once by hand to confirm it pulls **and the
   drill passes**:
   ```
   schtasks /Query /TN "Steward DB Backup"
   schtasks /Run   /TN "Steward DB Backup"
   ```

3. **Point an uptime monitor at `/health`** (e.g. UptimeRobot) so you hear about
   an outage before a user does.

---

## 4. Verify a backup restores (the restore drill)

A backup you've never restored is a hope, not a backup. `scripts/restore-drill.js`
loads a backup into a **throwaway copy** and checks it actually opens and is
internally consistent:

- `PRAGMA integrity_check` + `foreign_key_check` (not corrupt)
- every table + index the live schema expects is present
- row counts per table (catches a 0-row "backup")
- money invariants on the data (no negative debt; `paid`/`new`/`interest` ≥ 0;
  sane `pctPaid`)

```bash
# newest copy in ~\StewardBackups (or the on-volume backups dir):
npm run backup:drill
# a specific file:
node scripts/restore-drill.js "C:\Users\Omar\StewardBackups\steward-2026-06-29-0900.db"
# compare against the live DB and flag suspicious shrinkage (truncation/wrong file):
node scripts/restore-drill.js latest --compare live
```

Exit code is **0 only if every check passes**, so it's safe to schedule and
alert on. The off-box pull runs it automatically and fails loudly if a download
won't restore.

**Drill cadence:** the daily pull verifies every download. Once a month, also run
`node scripts/restore-drill.js latest --compare live` and eyeball the row counts
— that's the "load yesterday's backup and diff it" check that proves recovery
end-to-end.

---

## 5. Recovery procedures

### A. Volume lost / DB gone (full restore from off-box copy)

1. **Pick a verified backup** on your PC:
   ```
   node scripts/restore-drill.js "C:\Users\Omar\StewardBackups\steward-<newest>.db"
   ```
   Use the newest one that prints `✅ RESTORE DRILL PASSED`.
2. In the Railway dashboard, ensure the service has a **volume** mounted and
   `STEWARD_DB_PATH` pointing into it (e.g. `/data/steward.db`).
3. **Stop the service** (or scale to 0) so nothing writes mid-restore.
4. **Place the backup onto the volume** as the live DB file (`$STEWARD_DB_PATH`).
   With no Railway CLI, attach the volume to a maintenance container (or use a
   temporary start command) and copy `steward-<newest>.db` → `$STEWARD_DB_PATH`.
   Delete any stale `-wal` / `-shm` siblings next to it — a `VACUUM INTO` backup
   needs neither.
5. **Start the service.** Watch logs for `Steward (Manual) v… running`.
6. **Verify** (§6).

### B. Corruption or bad migration (restore a recent good daily)

1. The on-volume dailies are in `<db-dir>/backups/steward-YYYY-MM-DD.db`. If you
   can reach a shell on the volume, copy the most recent pre-incident one over
   `$STEWARD_DB_PATH` (stop the service first; clear `-wal`/`-shm`).
2. If you can't reach the volume's shell, treat it as procedure **A** using the
   matching-date off-box copy.
3. If a *migration* caused it, also revert the deploy to the prior image so the
   restored DB isn't re-migrated by the same bad code.

### C. Roll back a bad deploy

1. In Railway, redeploy the previous good image/commit.
2. If that deploy also changed data, restore the pre-deploy backup (A or B).
   Always pull a manual backup *before* a risky deploy so this copy exists.

### D. One user's data (no full restore needed)

The DB is fine but a single user's numbers are wrong (bad import, a spiral, a
mistyped pull they can't undo):

- **Rebuild their totals from history** (non-destructive dry-run first):
  ```
  curl -H "Authorization: Bearer $ADMIN_TOKEN" -X POST https://<app>/admin/api/users/<id>/recompute
  curl -H "Authorization: Bearer $ADMIN_TOKEN" -X POST "https://<app>/admin/api/users/<id>/recompute?apply=1"
  ```
  (`recompute` refuses to apply if it would zero real totals with no usable
  history — see `recomputeClimbTotalsFromHistory`.)
- **Restore them from an export** (theirs or `…/export`):
  ```
  curl -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
       --data @user-<id>-export.json https://<app>/admin/api/users/<id>/restore
  ```
  Restore refuses an empty-but-valid payload over existing data unless forced —
  it won't silently wipe a user.

---

## 6. Post-restore verification (always do this)

1. `GET /health` returns `ok:true` with the expected `version`.
2. Run the drill against the **now-live** file to confirm what you restored:
   ```
   node scripts/restore-drill.js latest --compare live
   ```
3. Sign in as a known account; confirm the dashboard shows the expected debt,
   climb stage, and snapshot history.
4. Post one snapshot and confirm it writes (proves the volume is writable, not
   read-only).
5. Confirm the daily rotation kicks back in (a fresh file appears in
   `<db-dir>/backups/` within 12h).

---

## 7. Quick reference

```bash
# Verify newest off-box backup restores cleanly
npm run backup:drill

# Verify a specific file
node scripts/restore-drill.js <path-to.db>

# Verify + compare row counts to the live DB (catch truncation)
node scripts/restore-drill.js latest --compare live

# Pull a fresh off-box backup now (also verifies)
powershell -File scripts\pull-backup.ps1 -BaseUrl https://<app>.up.railway.app -Token <token>

# Confirm the scheduled pull exists / run it once
schtasks /Query /TN "Steward DB Backup"
schtasks /Run   /TN "Steward DB Backup"
```

Env vars that matter: `STEWARD_DB_PATH` (volume path, prod), `STEWARD_BACKUP_TOKEN`
(guards `/admin/backup`), `ADMIN_TOKEN` (guards `/admin/api/*`), `STEWARD_BASE_URL`
(for the pull script).
