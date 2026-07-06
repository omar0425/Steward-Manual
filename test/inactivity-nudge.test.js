'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../db');
const { createLocalUser } = require('../db-auth');
const { selectUsersNeedingNudge, markNudged, NUDGE_KEY } = require('../services/nudge');

const DAY = 86400000;
const NOW = Date.now();

let _n = 0;
function makeUser({ email, snapshotAgoDays }) {
  _n += 1;
  const username = `nudge_${NOW.toString(36)}_${_n}`;
  const user = createLocalUser(username, 'nudge-test-password', email);
  if (snapshotAgoDays != null) {
    db.prepare(`
      INSERT INTO snapshots (user_id, source, pulled_at) VALUES (?, 'manual', ?)
    `).run(user.id, new Date(NOW - snapshotAgoDays * DAY).toISOString());
  }
  return user;
}

function cleanup(userIds) {
  for (const id of userIds) {
    db.prepare(`DELETE FROM snapshots WHERE user_id = ?`).run(id);
    db.prepare(`DELETE FROM config WHERE user_id = ?`).run(id);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  }
}

test('nudge selector: stale + email → selected; fresh or email-less → not', () => {
  const stale = makeUser({ email: `${NOW}-stale@x.test`, snapshotAgoDays: 15 });
  const fresh = makeUser({ email: `${NOW}-fresh@x.test`, snapshotAgoDays: 2 });
  const noEmail = makeUser({ email: null, snapshotAgoDays: 15 });
  const noSnaps = makeUser({ email: `${NOW}-nosnap@x.test`, snapshotAgoDays: null });
  try {
    const picked = selectUsersNeedingNudge({ now: NOW, staleDays: 10 });
    const ids = picked.map((p) => p.id);
    assert.ok(ids.includes(stale.id), 'stale user with email selected');
    assert.ok(!ids.includes(fresh.id), 'fresh user not selected');
    assert.ok(!ids.includes(noEmail.id), 'user without email not selected');
    assert.ok(!ids.includes(noSnaps.id), 'user without snapshots not selected');
    const row = picked.find((p) => p.id === stale.id);
    assert.equal(row.daysSince, 15);
  } finally {
    cleanup([stale.id, fresh.id, noEmail.id, noSnaps.id]);
  }
});

test('nudge selector: one nudge per lapse, re-arms after a new snapshot', () => {
  const u = makeUser({ email: `${NOW}-lapse@x.test`, snapshotAgoDays: 20 });
  try {
    // First lapse → selected
    let ids = selectUsersNeedingNudge({ now: NOW, staleDays: 10 }).map((p) => p.id);
    assert.ok(ids.includes(u.id), 'selected before any nudge');

    // Nudged → no longer selected for the same lapse
    markNudged(u.id, new Date(NOW - 5 * DAY).toISOString());
    ids = selectUsersNeedingNudge({ now: NOW, staleDays: 10 }).map((p) => p.id);
    assert.ok(!ids.includes(u.id), 'not re-selected after nudge');

    // User updates again AFTER the nudge (re-arms it), then lapses again:
    // snapshot at NOW-2d, evaluated 9 days later → 11 days stale, nudge is
    // older than the snapshot → selected again.
    db.prepare(`INSERT INTO snapshots (user_id, source, pulled_at) VALUES (?, 'manual', ?)`)
      .run(u.id, new Date(NOW - 2 * DAY).toISOString());
    ids = selectUsersNeedingNudge({ now: NOW + 9 * DAY, staleDays: 10 }).map((p) => p.id);
    assert.ok(ids.includes(u.id), 're-selected after a fresh snapshot goes stale');
  } finally {
    cleanup([u.id]);
  }
});

test('nudge selector: staleDays 0 disables the feature', () => {
  const u = makeUser({ email: `${NOW}-off@x.test`, snapshotAgoDays: 100 });
  try {
    assert.deepEqual(selectUsersNeedingNudge({ now: NOW, staleDays: 0 }), []);
  } finally {
    cleanup([u.id]);
  }
});

test('markNudged: upserts the config row', () => {
  const u = makeUser({ email: `${NOW}-mark@x.test`, snapshotAgoDays: 20 });
  try {
    markNudged(u.id, '2026-01-01T00:00:00.000Z');
    markNudged(u.id, '2026-02-02T00:00:00.000Z');
    const row = db.prepare(`SELECT value FROM config WHERE user_id = ? AND key = ?`).get(u.id, NUDGE_KEY);
    assert.equal(row.value, '2026-02-02T00:00:00.000Z');
  } finally {
    cleanup([u.id]);
  }
});

test('nudge selector: mixed-precision timestamps compare as time, not strings', () => {
  // A restored backup can carry pulled_at without milliseconds. As STRINGS,
  // "…56.456Z" > "…57Z" (because "4" < "5" digit-by-digit fails the other way):
  // lexicographic comparison misordered these and re-nudged users mid-lapse.
  const u = makeUser({ email: `${NOW}-precision@x.test`, snapshotAgoDays: null });
  try {
    // Snapshot WITHOUT milliseconds, 20 days ago — the string ends "…00Z".
    const snapAt = new Date(NOW - 20 * DAY).toISOString().replace(/\.\d{3}Z$/, 'Z');
    db.prepare(`INSERT INTO snapshots (user_id, source, pulled_at) VALUES (?, 'manual', ?)`)
      .run(u.id, snapAt);
    // Nudged AFTER that snapshot (5 days ago), WITH milliseconds.
    markNudged(u.id, new Date(NOW - 5 * DAY).toISOString());
    // The nudge is newer than the snapshot → same lapse → must NOT re-select,
    // regardless of the precision mismatch between the two strings.
    const ids = selectUsersNeedingNudge({ now: NOW, staleDays: 10 }).map((p) => p.id);
    assert.ok(!ids.includes(u.id), 'nudge newer than snapshot must suppress re-nudge');
  } finally {
    cleanup([u.id]);
  }
});
