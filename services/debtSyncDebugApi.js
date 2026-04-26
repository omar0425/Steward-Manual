'use strict';

/**
 * Projects stored last-pull debt sync debug into GET /api/status?debugDebtSync=1 fields.
 *
 * @param {object | null | undefined} lastDebtSync  From getLastDebtSyncDebug(); null before any successful pull in this process.
 * @returns {{ sync_valid: boolean | null, sync_errors: string[] }}
 *   - sync_valid: true passed, false failed, null unknown / no result yet
 *   - sync_errors: always a string array; non-empty only when last run failed validation
 */
function projectedDebugDebtSync(lastDebtSync) {
  const sync_valid =
    lastDebtSync == null ? null : (lastDebtSync.sync_valid ?? null);
  const raw = lastDebtSync != null ? lastDebtSync.sync_errors : undefined;
  const sync_errors = Array.isArray(raw) ? raw : [];
  return { sync_valid, sync_errors };
}

module.exports = { projectedDebugDebtSync };
