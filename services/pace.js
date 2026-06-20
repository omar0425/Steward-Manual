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

/**
 * Project the calendar date the debt reaches $0 at the user's recent monthly
 * pace. Uses the same span-gated pace as the tier forecasts so the dashboard
 * "debt-free by" and the Steward never disagree.
 *
 * Returns { onTrack, monthlyPace, monthsToZero, debtFreeDate } — onTrack is
 * false (with a reason) when there isn't enough positive progress to project,
 * or the horizon is absurd (> maxMonths). debtFreeDate is YYYY-MM-DD.
 *
 * @param {Array} snapshots newest-first snapshots
 * @param {number} currentDebt current debt_remaining
 */
function projectDebtFree(snapshots, currentDebt, { monthlyPace, now = Date.now(), maxMonths = 360 } = {}) {
  const debt = Number(currentDebt);
  if (Number.isFinite(debt) && debt <= 0) {
    return { onTrack: true, alreadyFree: true, monthlyPace: 0, monthsToZero: 0, debtFreeDate: new Date(now).toISOString().slice(0, 10) };
  }
  const pace = Number.isFinite(monthlyPace) ? monthlyPace : monthlyPaceFromSnapshots(snapshots);
  if (!Number.isFinite(pace) || pace <= 0) {
    return { onTrack: false, reason: 'no_pace', monthlyPace: 0 };
  }
  if (!Number.isFinite(debt) || debt <= 0) {
    return { onTrack: false, reason: 'no_debt', monthlyPace: pace };
  }
  const monthsToZero = debt / pace;
  if (monthsToZero > maxMonths) {
    return { onTrack: false, reason: 'too_far', monthlyPace: pace };
  }
  const date = new Date(now + monthsToZero * DAYS_PER_MONTH * 86400000);
  return {
    onTrack: true,
    monthlyPace: pace,
    monthsToZero: Math.ceil(monthsToZero),
    debtFreeDate: date.toISOString().slice(0, 10),
  };
}

/**
 * Net debt reduction during the current calendar month — the user's "what have
 * I done lately" signal. Positive = paid down this month, negative = added.
 * Opening balance is the last snapshot before the 1st (or the earliest in-month
 * reading if the climb began this month). Returns null without usable data.
 *
 * @param {Array} snapshots newest-first snapshots
 */
function paidThisMonth(snapshots, { now = Date.now() } = {}) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return null;
  const d = new Date(now);
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const newestDebt = Number(snapshots[0].debt_remaining);
  if (!Number.isFinite(newestDebt)) return null;

  let openingDebt = null;
  for (const s of snapshots) { // newest-first → first one before the 1st is the opener
    const t = new Date(s.pulled_at).getTime();
    if (Number.isFinite(t) && t < monthStart) { openingDebt = Number(s.debt_remaining); break; }
  }
  if (openingDebt == null) openingDebt = Number(snapshots[snapshots.length - 1].debt_remaining);
  if (!Number.isFinite(openingDebt)) return null;
  return Math.round((openingDebt - newestDebt) * 100) / 100;
}

module.exports = {
  monthlyPaceFromSnapshots,
  projectDebtFree,
  paidThisMonth,
  DAYS_PER_MONTH,
  MIN_SPAN_DAYS,
};
