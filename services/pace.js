'use strict';

/**
 * Robust monthly paydown pace, shared by the Steward forecasts and the
 * dashboard "months to next stage" estimate so they never disagree.
 *
 * The old per-day pace (paydown ÷ elapsed-days) blew up when a user logged
 * several entries within a few days: a tiny denominator turned a normal
 * paydown into "$277/day". This helper instead:
 *   - measures across the WHOLE recent window (oldest → newest), and
 *   - refuses to project until that window spans real calendar time
 *     (`minSpanDays`), returning null rather than a fantasy rate.
 *
 * Returns dollars-paid-down per ~month (30.44 days), or null when there isn't
 * enough spread/positive progress to extrapolate honestly.
 *
 * @param {Array<{ pulled_at: string, debt_remaining: number }>} snapshots newest-first
 */
const DAYS_PER_MONTH = 30.44;
const MIN_SPAN_DAYS = 21; // ~three weeks before a monthly rate is trustworthy

function monthlyPaceFromSnapshots(snapshots, { minSpanDays = MIN_SPAN_DAYS } = {}) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) return null;
  const newest = snapshots[0];
  const oldest = snapshots[snapshots.length - 1];
  const newestT = new Date(newest.pulled_at).getTime();
  const oldestT = new Date(oldest.pulled_at).getTime();
  if (!Number.isFinite(newestT) || !Number.isFinite(oldestT)) return null;
  const days = (newestT - oldestT) / 86400000;
  if (!Number.isFinite(days) || days < minSpanDays) return null;
  const paydown = Number(oldest.debt_remaining) - Number(newest.debt_remaining);
  if (!Number.isFinite(paydown) || paydown <= 0) return null;
  return Math.round((paydown / (days / DAYS_PER_MONTH)) * 100) / 100;
}

module.exports = { monthlyPaceFromSnapshots, DAYS_PER_MONTH, MIN_SPAN_DAYS };
