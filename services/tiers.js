'use strict';

const path = require('path');
// Single source of truth (also served to the browser as /debt-tier-constants.json).
const { ROCK_BOTTOM_BAND_BUFFER } = require(path.join(__dirname, '../public/debt-tier-constants.json'));

/** Display / API precision for debt tier band % (bar, labels, debug). */
const DEBT_TIER_BAND_PCT_DECIMALS = 1;

/**
 * Rock Bottom has no previous tier, so debt can exceed any historical “ceiling” in the data.
 * A fixed band above `rock_bottom.threshold` gives a stable progress width: paydown always moves
 * the bar until you exit the tier. Using moving peaks tied current debt made the fill stick near 0%.
 *
 * Buffer value lives in `public/debt-tier-constants.json` so server, showcase, and docs stay aligned.
 */

// ── Tier definitions (ordered highest debt → lowest) ─────────────────────────
// Tier id "stabilizing" (below) is debt payoff stage (badge 05). Liquidity also uses id "stabilizing"
// for the middle cushion band with UI label "Steady" — same string, different subsystem.

const TIERS = [
  {
    id: 'rock_bottom', label: 'Buried', badge: '01',
    copy: 'In the hole. The meter is running.',
    nextCopy: 'The first real reduction.',
    threshold: 79000,   // debt_remaining > 79000
  },
  {
    id: 'broke', label: 'Pushing', badge: '02',
    copy: 'First dent made. Keep swinging.',
    nextCopy: 'Double-digit thousands paid.',
    threshold: 70000,
  },
  {
    id: 'struggling', label: 'Struggling', badge: '03',
    copy: 'Down $10K+. Momentum exists.',
    nextCopy: 'Past the midpoint. The second half is faster.',
    threshold: 60000,
  },
  {
    id: 'surviving', label: 'Surviving', badge: '04',
    copy: 'Past the midpoint. Real progress.',
    nextCopy: 'Under $50K. The number shrinks.',
    threshold: 50000,
  },
  {
    id: 'stabilizing', label: 'Stabilizing', badge: '05',
    copy: 'Under $50K. The number feels smaller now.',
    nextCopy: 'Under $40K. The end becomes visible.',
    threshold: 40000,
  },
  {
    id: 'stable', label: 'Stable', badge: '06',
    copy: 'Under $40K. You can see the other side.',
    nextCopy: 'Final third begins.',
    threshold: 30000,
  },
  {
    id: 'building', label: 'Breaking', badge: '07',
    copy: 'Final third. This is where it gets real.',
    nextCopy: 'Under $20K. Most never reach this.',
    threshold: 20000,
  },
  {
    id: 'thriving', label: 'Closing', badge: '08',
    copy: 'Under $20K. Most people never get here.',
    nextCopy: 'Last $10K. Almost free.',
    threshold: 10000,
  },
  {
    id: 'winning', label: 'Finish', badge: '09',
    copy: 'Last $10K. Almost free.',
    nextCopy: 'The climb is done.',
    threshold: 0,
  },
  {
    id: 'wealthy', label: 'Debt Free', badge: '10',
    copy: 'Debt zero. Now build the life after it.',
    nextCopy: null,
    threshold: -Infinity,
  },
];

/**
 * Map debt_remaining → tier object.
 * Non-finite inputs (NaN, null, undefined) fall back to rock_bottom
 * rather than silently falling through to wealthy.
 */
function getTier(debtRemaining) {
  const d = Number(debtRemaining);
  if (!Number.isFinite(d)) return TIERS[0]; // rock_bottom — safe fallback for bad data
  for (const tier of TIERS) {
    if (d > tier.threshold) return tier;
  }
  return TIERS[TIERS.length - 1]; // wealthy
}

/**
 * Calculate next-tier info.
 *
 * @param {number} debtRemaining  Current debt in dollars
 * @param {Array}  snapshots      Recent YNAB snapshots, newest first
 * @returns {object}
 */
function nextTierInfo(debtRemaining, snapshots = []) {
  const currentTier = getTier(debtRemaining);
  const currentIdx  = TIERS.findIndex(t => t.id === currentTier.id);
  const nextTier    = TIERS[currentIdx + 1] || null;

  if (!nextTier) {
    return { currentTier, nextTier: null, gapDollars: 0, monthsEstimate: null };
  }

  // Pay down to currentTier.threshold to cross into the next tier (see getTier()).
  const gapDollars = Math.max(0, debtRemaining - currentTier.threshold);

  // avg monthly paydown from last 3 snapshots (newest first)
  let avgMonthlyPaydown = null;
  if (snapshots.length >= 2) {
    const usable = snapshots.slice(0, Math.min(snapshots.length, 4));
    const oldest = usable[usable.length - 1];
    const newest = usable[0];

    const msElapsed = new Date(newest.pulled_at) - new Date(oldest.pulled_at);
    const monthsElapsed = msElapsed / (1000 * 60 * 60 * 24 * 30.44);

    if (monthsElapsed > 0) {
      const totalPaydown = oldest.debt_remaining - newest.debt_remaining;
      avgMonthlyPaydown = totalPaydown / monthsElapsed;
    }
  }

  const monthsEstimate =
    avgMonthlyPaydown && avgMonthlyPaydown > 0
      ? Math.ceil(gapDollars / avgMonthlyPaydown)
      : null;

  return { currentTier, nextTier, gapDollars, monthsEstimate, avgMonthlyPaydown };
}

/**
 * Cumulative payoff journey along a single debt axis: fixed high anchor (Rock Bottom ceiling)
 * to $0. Tier boundary positions use the same thresholds as `getTier` / `nextTierInfo`.
 * Does not alter climb metrics — display-only for full-path UI.
 *
 * @param {number} debtRemaining
 * @param {{ id: string, threshold: number }} currentTier
 * @param {number} gapDollarsFromNextTierInfo  Same cents-rounded value as `/api/status` nextTier.gapDollars
 * @param {{ id: string, label: string } | null} nextTier
 * @param {number} [climbBaselineDebt=0]  User's climb baseline; widens journey ceiling when above default
 */
function debtTierJourneyProgress(debtRemaining, currentTier, gapDollarsFromNextTierInfo, nextTier, climbBaselineDebt = 0) {
  const remRaw = Number(debtRemaining);
  const rem = Number.isFinite(remRaw) ? remRaw : 0;
  const defaultHigh = TIERS[0].threshold + ROCK_BOTTOM_BAND_BUFFER;
  const baselineN = Number(climbBaselineDebt);
  const journeyHighDebt = Number.isFinite(baselineN) && baselineN > defaultHigh
    ? baselineN
    : defaultHigh;
  const span = Math.max(journeyHighDebt, 1);

  const roundMoney = (x) => {
    const n = Number(x);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  };

  const gapSrc = Number(gapDollarsFromNextTierInfo);
  const gapRounded = Number.isFinite(gapSrc) ? roundMoney(gapSrc) : 0;

  if (currentTier.id === 'wealthy' || rem <= 0) {
    return {
      journeyHighDebt,
      debtRemaining: Math.max(0, roundMoney(rem)),
      pctAlongJourney: 100,
      dollarsToFinalGoal: 0,
      dollarsToNextTier: 0,
      nextTierBoundaryPct: 100,
      ticks: [],
    };
  }

  const cappedRem = Math.min(rem, journeyHighDebt);
  const pctAlongJourney = roundDebtTierBandPct(((journeyHighDebt - cappedRem) / span) * 100);

  const dollarsToFinalGoal = roundMoney(Math.max(0, rem));
  const dollarsToNextTier = nextTier ? Math.max(0, gapRounded) : 0;

  const thr = currentTier.threshold;
  const nextTierBoundaryPct = roundDebtTierBandPct(
    Math.min(100, Math.max(0, ((journeyHighDebt - thr) / span) * 100)),
  );

  const ticks = TIERS.filter(
    (t) => t.id !== 'wealthy' && Number.isFinite(t.threshold) && t.threshold >= 0,
  ).map((t) => ({
    tierId: t.id,
    badge: t.badge,
    threshold: t.threshold,
    tickPct: roundDebtTierBandPct(
      Math.min(100, Math.max(0, ((journeyHighDebt - t.threshold) / span) * 100)),
    ),
    isNextStageLine: t.id === currentTier.id,
  }));

  return {
    journeyHighDebt,
    debtRemaining: roundMoney(rem),
    pctAlongJourney,
    dollarsToFinalGoal,
    dollarsToNextTier,
    nextTierBoundaryPct,
    ticks,
  };
}

function roundDebtTierBandPct(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** DEBT_TIER_BAND_PCT_DECIMALS;
  return Math.round(Math.min(100, Math.max(0, n)) * f) / f;
}

/**
 * Completion within the current debt tier band toward the next tier threshold: 0% at `bandUpper`,
 * 100% at `bandLower` (fill rises as debt falls). Same as
 * `((bandUpper - debtRemaining) / (bandUpper - bandLower)) * 100` in the interior band.
 *
 * Upper bound: previous tier's threshold, except Rock Bottom (fixed ceiling:
 * currentTier.threshold + ROCK_BOTTOM_BAND_BUFFER).
 *
 * @param {number} debtRemaining
 * @param {{ id: string, threshold: number }} currentTier
 * @param {Array<{ debt_remaining: number, pulled_at: string }>} snapshots  reserved
 * @param {number} climbBaselineDebt  User's climb baseline; widens Rock Bottom ceiling when above default buffer
 * @returns {{ pctInBand: number, pctInBandRaw: number, bandLower: number, bandUpper: number, span: number, gapToNext: number }}
 */
function debtTierBandProgress(debtRemaining, currentTier, snapshots = [], climbBaselineDebt = 0) {
  const remRaw = Number(debtRemaining);
  const rem = Number.isFinite(remRaw) ? remRaw : 0;
  const idx = TIERS.findIndex(t => t.id === currentTier.id);
  if (idx < 0) {
    const bandLower = 0;
    const bandUpper = rem;
    const span = Math.max(bandUpper - bandLower, 1);
    return { pctInBand: 0, pctInBandRaw: 0, bandLower, bandUpper, span, gapToNext: 0 };
  }

  const nextEntry = TIERS[idx + 1];
  if (!nextEntry) {
    const bandLower = currentTier.threshold;
    const bandUpper = rem;
    const span = 1;
    return {
      pctInBand: 100,
      pctInBandRaw: 100,
      bandLower,
      bandUpper,
      span,
      gapToNext: 0,
    };
  }

  const bandLower = currentTier.threshold;
  let bandUpper;
  if (idx === 0) {
    const defaultCeiling = bandLower + ROCK_BOTTOM_BAND_BUFFER;
    const baselineN = Number(climbBaselineDebt);
    bandUpper = Number.isFinite(baselineN) && baselineN > defaultCeiling
      ? baselineN
      : defaultCeiling;
  } else {
    bandUpper = TIERS[idx - 1].threshold;
  }

  const span = Math.max(bandUpper - bandLower, 1);
  const gapToNext = Math.max(0, rem - bandLower);
  let rawPct;
  if (rem >= bandUpper) {
    rawPct = 0;
  } else if (rem <= bandLower) {
    rawPct = 100;
  } else {
    rawPct = ((bandUpper - rem) / span) * 100;
  }
  const pctInBand = roundDebtTierBandPct(rawPct);

  return { pctInBand, pctInBandRaw: rawPct, bandLower, bandUpper, span, gapToNext };
}

/**
 * Debug / support: full band breakdown (query `debugDebtTier=1` on `/api/status`).
 */
function explainDebtTierBandProgress(debtRemaining, currentTier, snapshots = [], debtStart = 0) {
  const inner = debtTierBandProgress(debtRemaining, currentTier, snapshots, debtStart);
  const remRaw = Number(debtRemaining);
  const rem = Number.isFinite(remRaw) ? remRaw : 0;
  const idx = TIERS.findIndex(t => t.id === currentTier.id);
  return {
    currentTier: {
      id: currentTier.id,
      label: currentTier.label,
      threshold: currentTier.threshold,
    },
    debtRemaining: rem,
    bandLower: inner.bandLower,
    bandUpper: inner.bandUpper,
    span: inner.span,
    gapToNext: inner.gapToNext,
    pctInBandRaw: inner.pctInBandRaw,
    debtTierBandPct: inner.pctInBand,
    isRockBottomBand: idx === 0,
    rockBottomBandBuffer: idx === 0 ? ROCK_BOTTOM_BAND_BUFFER : null,
    formula:
      'pctInBand = roundDebtTierBandPct(clamp: in-band (bandUpper-debtRemaining)/span*100; debt>=bandUpper→0; debt<=bandLower→100); DEBT_TIER_BAND_PCT_DECIMALS=1',
  };
}

/**
 * Calculate debt progress stats.
 */
function debtProgress(debtRemaining, debtStart) {
  if (!debtStart || debtStart <= 0) {
    return { debtStart: 0, debtPaid: 0, pctPaid: 0 };
  }
  const debtPaid = Math.max(0, debtStart - debtRemaining);
  const pctPaid  = Math.min(100, (debtPaid / debtStart) * 100);
  return { debtStart, debtPaid, pctPaid };
}

/**
 * Legacy merged paydown (snapshot peak / window). **Not used for primary “Paid down”** — see
 * `services/climbMetrics.js` + GET `/api/status` `cumulativePaidDown`.
 *
 * @param {number} debtRemaining
 * @param {number} debtStart
 * @param {Array<{ debt_remaining: number, pulled_at: string }>} snapshots  newest first
 */
function debtProgressWithHistory(debtRemaining, debtStart, snapshots = []) {
  const rem = Number(debtRemaining);
  const startRaw = Number(debtStart);
  const remN = Number.isFinite(rem) ? rem : 0;
  const startN = Number.isFinite(startRaw) && startRaw > 0 ? startRaw : 0;

  const base = debtProgress(remN, startN);

  let maxSeen = remN;
  if (startN > 0) maxSeen = Math.max(maxSeen, startN);
  if (snapshots && snapshots.length) {
    for (const s of snapshots) {
      const d = Number(s.debt_remaining);
      if (Number.isFinite(d)) maxSeen = Math.max(maxSeen, d);
    }
  }

  const fromPeak = Math.max(0, maxSeen - remN);

  let observedWindow = 0;
  if (snapshots && snapshots.length >= 2) {
    const newest = Number(snapshots[0].debt_remaining);
    const oldest = Number(snapshots[snapshots.length - 1].debt_remaining);
    if (Number.isFinite(newest) && Number.isFinite(oldest)) {
      observedWindow = Math.max(0, oldest - newest);
    }
  }

  const mergedPaid = Math.max(base.debtPaid, fromPeak, observedWindow);

  if (mergedPaid === base.debtPaid) {
    return base;
  }

  const denom =
    base.debtStart > 0
      ? base.debtStart
      : maxSeen > 0
        ? maxSeen
        : null;

  const pctPaid =
    denom && denom > 0
      ? Math.min(100, (mergedPaid / denom) * 100)
      : base.pctPaid;

  return {
    debtStart: base.debtStart > 0 ? base.debtStart : maxSeen || base.debtStart,
    debtPaid: mergedPaid,
    pctPaid,
  };
}

module.exports = {
  TIERS,
  ROCK_BOTTOM_BAND_BUFFER,
  DEBT_TIER_BAND_PCT_DECIMALS,
  getTier,
  nextTierInfo,
  debtTierBandProgress,
  debtTierJourneyProgress,
  explainDebtTierBandProgress,
  roundDebtTierBandPct,
  debtProgress,
  debtProgressWithHistory,
};
