'use strict';

/**
 * Inactivity nudge — one email per lapse when a user's latest snapshot goes
 * stale. "Per lapse" means: nudge once, then stay quiet until the user
 * snapshots again and goes stale a second time (last_inactivity_nudge_at is
 * compared against their latest snapshot, not against the previous nudge).
 *
 * The sweep runs cross-user, so it queries the DB directly instead of going
 * through the per-request withUser() scope.
 */

const { db } = require('../db');
const { sendEmail, buildInactivityNudgeEmail, isConfigured, APP_BASE_URL } = require('./email');

const NUDGE_KEY = 'last_inactivity_nudge_at';
const DEFAULT_STALE_DAYS = 10;

function staleDaysSetting() {
  const n = Number(process.env.STEWARD_NUDGE_DAYS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_STALE_DAYS;
}

/**
 * Users whose latest snapshot is older than `staleDays` and who have not been
 * nudged since that snapshot. Returns [{ id, username, email, lastSnapshotAt, daysSince }].
 */
function selectUsersNeedingNudge({ now = Date.now(), staleDays = staleDaysSetting() } = {}) {
  if (staleDays <= 0) return []; // 0 disables the feature
  const cutoff = new Date(now - staleDays * 86400000).toISOString();
  const rows = db.prepare(`
    SELECT u.id, u.username, u.email, MAX(s.pulled_at) AS lastSnapshotAt
    FROM users u
    JOIN snapshots s ON s.user_id = u.id
    WHERE u.email IS NOT NULL AND u.email != ''
    GROUP BY u.id
    HAVING MAX(s.pulled_at) < ?
  `).all(cutoff);

  const getNudge = db.prepare(`SELECT value FROM config WHERE user_id = ? AND key = ?`);
  return rows
    .filter((r) => {
      const nudge = getNudge.get(r.id, NUDGE_KEY);
      // Already nudged for THIS lapse (nudge newer than their last activity)?
      // Compare as timestamps, not strings: a restored backup can carry
      // pulled_at values without milliseconds, and mixed precision breaks
      // lexicographic ISO comparison ("…56.456Z" > "…57Z" is true as strings).
      if (!nudge) return true;
      const nudgedAt = Date.parse(nudge.value);
      const lastAt = Date.parse(r.lastSnapshotAt);
      if (!Number.isFinite(nudgedAt) || !Number.isFinite(lastAt)) return true;
      return nudgedAt <= lastAt;
    })
    .map((r) => ({
      ...r,
      daysSince: Math.floor((now - new Date(r.lastSnapshotAt).getTime()) / 86400000),
    }));
}

function markNudged(userId, at = new Date().toISOString()) {
  db.prepare(`
    INSERT INTO config (user_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
  `).run(userId, NUDGE_KEY, at);
}

/** One sweep: select, email, mark. Returns the number of nudges sent. */
async function runInactivityNudgeSweep() {
  if (!isConfigured()) return 0; // no provider → reset links already console-only; don't spam logs
  const candidates = selectUsersNeedingNudge();
  let sent = 0;
  for (const u of candidates) {
    const built = buildInactivityNudgeEmail({
      username: u.username,
      daysSince: u.daysSince,
      appBaseUrl: APP_BASE_URL,
    });
    const result = await sendEmail({ to: u.email, subject: built.subject, text: built.text, html: built.html });
    if (result.ok) {
      markNudged(u.id);
      sent += 1;
      console.log(`[nudge] sent to user=${u.username} id=${u.id} (${u.daysSince}d stale)`);
    } else {
      console.error(`[nudge] failed for user=${u.username} id=${u.id}:`, result.error);
    }
  }
  return sent;
}

module.exports = {
  selectUsersNeedingNudge,
  markNudged,
  runInactivityNudgeSweep,
  NUDGE_KEY,
  DEFAULT_STALE_DAYS,
};
