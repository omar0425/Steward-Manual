'use strict';

const path = require('path');
// Single source of truth (also served to the browser as /debt-tier-constants.json).
const { ROCK_BOTTOM_BAND_BUFFER } = require(path.join(__dirname, '../public/debt-tier-constants.json'));
const { monthlyPaceFromSnapshots } = require('./pace');

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
// IDs are stable database keys; do not change. Labels are display-only and may be renamed freely.
// Tier id "stabilizing" (below) is debt payoff stage (badge 05). Liquidity also uses id "stabilizing"
// for the middle cushion band with UI label "Steady" — same string, different subsystem.
//
// ── TWO TIER SYSTEMS LIVE HERE ───────────────────────────────────────────────
// 1. RELATIVE (source of truth for active gameplay): tier is derived from
//    % of the user's starting baseline that's been paid off. Each user climbs
//    through 10 stages no matter their starting debt. Use `getClimbTier`,
//    `nextClimbTierInfo`, `climbTierBandProgress`, `climbTierJourneyProgress`.
//    The `threshold` numbers below are NOT used in this mode — climb functions
//    recompute thresholds dynamically from the user's `climbBaselineDebt`.
//
// 2. ABSOLUTE (fallback only): tier is derived from raw debt dollars against
//    the fixed `threshold` values below (e.g. > $79K = Buried). Used when no
//    climb baseline exists yet, and exposed for legacy / debug paths. Use
//    `getTier`, `nextTierInfo`, `debtTierBandProgress`, `debtTierJourneyProgress`.
//
// The absolute thresholds remain because (a) climb functions fall back to the
// absolute system when `climbBaselineDebt` is missing/invalid, and (b) the
// labels/copy/badges below are shared between both systems. Don't delete them.

const TIERS = [
  {
    id: 'rock_bottom', label: 'Buried', badge: '01',
    copy: 'In the hole. The meter is running.',
    nextCopy: 'The first real reduction.',
    threshold: 79000,   // debt_remaining > 79000
  },
  {
    id: 'broke', label: 'Digging', badge: '02',
    copy: 'First dent made. Keep swinging.',
    nextCopy: 'Double-digit thousands paid.',
    threshold: 70000,
  },
  {
    id: 'struggling', label: 'Pushing', badge: '03',
    copy: 'Down $10K+. Momentum exists.',
    nextCopy: 'Past the midpoint. The second half is faster.',
    threshold: 60000,
  },
  {
    id: 'surviving', label: 'Climbing', badge: '04',
    copy: 'Past the midpoint. Real progress.',
    nextCopy: 'Under $50K. The number shrinks.',
    threshold: 50000,
  },
  {
    id: 'stabilizing', label: 'Steady', badge: '05',
    copy: 'Under $50K. The number feels smaller now.',
    nextCopy: 'Under $40K. The end becomes visible.',
    threshold: 40000,
  },
  {
    id: 'stable', label: 'Building', badge: '06',
    copy: 'Under $40K. You can see the other side.',
    nextCopy: 'Final third begins.',
    threshold: 30000,
  },
  {
    id: 'building', label: 'Lifting', badge: '07',
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
    id: 'winning', label: 'Finishing', badge: '09',
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

function roundMoney(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function validClimbBaseline(climbBaselineDebt) {
  const baseline = Number(climbBaselineDebt);
  return Number.isFinite(baseline) && baseline > 0 ? baseline : null;
}

function climbTierIndex(debtRemaining, climbBaselineDebt) {
  const baseline = validClimbBaseline(climbBaselineDebt);
  if (!baseline) return null;
  const remRaw = Number(debtRemaining);
  const rem = Number.isFinite(remRaw) ? remRaw : baseline;
  if (rem <= 0) return TIERS.length - 1;
  const nonDebtFreeStages = TIERS.length - 1;
  const pctPaid = Math.min(1, Math.max(0, (baseline - rem) / baseline));
  return Math.min(nonDebtFreeStages - 1, Math.floor(pctPaid * nonDebtFreeStages));
}

function cloneTierWithClimbThreshold(index, climbBaselineDebt) {
  const tier = TIERS[index] || TIERS[0];
  const baseline = validClimbBaseline(climbBaselineDebt);
  if (!baseline) return { ...tier };
  // Substitute climb-aware copy whenever we have a baseline. The absolute
  // TIERS copy talks in dollar thresholds ("Under $50K") which is wrong for
  // anyone whose baseline isn't ~$80K. Climb copy is keyed to % paid.
  const climbCopy = climbCopyForIndex(index);
  if (index >= TIERS.length - 1) {
    return { ...tier, copy: climbCopy.copy, nextCopy: climbCopy.nextCopy };
  }
  const nonDebtFreeStages = TIERS.length - 1;
  const exitPct = (index + 1) / nonDebtFreeStages;
  return {
    ...tier,
    copy: climbCopy.copy,
    nextCopy: climbCopy.nextCopy,
    threshold: roundMoney(baseline * (1 - exitPct)),
    climbThresholdPct: roundDebtTierBandPct(exitPct * 100),
  };
}

// Climb-mode copy. The absolute TIERS copy (e.g. "Under $50K") is wrong when
// the user's baseline is $9K or $400K; phrase progress in stage terms instead.
// Indexed parallel to TIERS (0 = Stage 01 / Buried).
//
// `copy` = present state ("you are here"). Past-tense or descriptive.
// `nextCopy` = next goal. ALWAYS forward-looking AND anchored to stage names
//   or fractions that match the math, not approximate percentages. The 9
//   non-debt-free stages each span 1/9 (≈11.11%) of paydown; rounding to
//   clean integers ("11%", "20%", "50%") created label/math mismatches —
//   user paid $8,861 to escape Stage 01, but 11% × baseline was $88 short.
const CLIMB_COPY = [
  { copy: 'Climb started. The first stretch is the hardest.', nextCopy: 'Reach Stage 02 — Digging.' },
  { copy: 'First stage cleared. Pace established.',           nextCopy: 'Reach Stage 03 — Pushing.' },
  { copy: 'Two stages down. Pattern is forming.',             nextCopy: 'Close the first third.' },
  { copy: 'First third closed. Real progress now.',           nextCopy: 'Reach Stage 05 — Steady.' },
  { copy: 'Almost halfway. Momentum building.',               nextCopy: 'Cross the halfway mark.' },
  { copy: 'Over half paid. Compounding works for you now.',   nextCopy: 'Reach two-thirds paid.' },
  { copy: 'Two-thirds paid. The end is visible.',             nextCopy: 'Drop under a quarter remaining.' },
  { copy: 'Under a quarter left. Most never reach here.',     nextCopy: 'Enter the final stretch.' },
  { copy: 'Final stretch. Almost free.',                      nextCopy: 'Finish the climb.' },
  { copy: 'Debt zero. Now build the life after it.',          nextCopy: null },
];

function climbCopyForIndex(idx) {
  return CLIMB_COPY[Math.max(0, Math.min(CLIMB_COPY.length - 1, idx))];
}

function getClimbTier(debtRemaining, climbBaselineDebt) {
  const idx = climbTierIndex(debtRemaining, climbBaselineDebt);
  if (idx == null) return { ...TIERS[0] }; // no baseline yet → Stage 01 for everyone
  return cloneTierWithClimbThreshold(idx, climbBaselineDebt);
}

function nextClimbTierInfo(debtRemaining, climbBaselineDebt) {
  const baseline = validClimbBaseline(climbBaselineDebt);
  if (!baseline) return nextTierInfo(debtRemaining);

  const idx = climbTierIndex(debtRemaining, baseline);
  const currentTier = cloneTierWithClimbThreshold(idx, baseline);
  const nextTier = TIERS[idx + 1] ? cloneTierWithClimbThreshold(idx + 1, baseline) : null;
  if (!nextTier) return { currentTier, nextTier: null, gapDollars: 0, monthsEstimate: null };

  const remRaw = Number(debtRemaining);
  const rem = Number.isFinite(remRaw) ? remRaw : baseline;
  const gapDollars = Math.max(0, roundMoney(rem - currentTier.threshold));
  return { currentTier, nextTier, gapDollars, monthsEstimate: null, avgMonthlyPaydown: null };
}

function climbTierBandProgress(debtRemaining, currentTier, climbBaselineDebt) {
  const baseline = validClimbBaseline(climbBaselineDebt);
  if (!baseline) return debtTierBandProgress(debtRemaining, currentTier, [], climbBaselineDebt);

  const idx = TIERS.findIndex(t => t.id === currentTier.id);
  const remRaw = Number(debtRemaining);
  const rem = Number.isFinite(remRaw) ? remRaw : baseline;
  if (idx < 0) {
    return { pctInBand: 0, pctInBandRaw: 0, bandLower: 0, bandUpper: baseline, span: baseline, gapToNext: 0 };
  }
  if (idx >= TIERS.length - 1 || rem <= 0) {
    return { pctInBand: 100, pctInBandRaw: 100, bandLower: 0, bandUpper: 0, span: 1, gapToNext: 0 };
  }

  const nonDebtFreeStages = TIERS.length - 1;
  const bandUpper = roundMoney(baseline * (1 - (idx / nonDebtFreeStages)));
  const bandLower = roundMoney(baseline * (1 - ((idx + 1) / nonDebtFreeStages)));
  const span = Math.max(bandUpper - bandLower, 1);
  const gapToNext = Math.max(0, roundMoney(rem - bandLower));

  let rawPct;
  if (rem >= bandUpper) rawPct = 0;
  else if (rem <= bandLower) rawPct = 100;
  else rawPct = ((bandUpper - rem) / span) * 100;

  return {
    pctInBand: roundDebtTierBandPct(rawPct),
    pctInBandRaw: rawPct,
    bandLower,
    bandUpper,
    span,
    gapToNext,
  };
}

function climbTierJourneyProgress(debtRemaining, currentTier, gapDollarsFromNextTierInfo, nextTier, climbBaselineDebt) {
  const baseline = validClimbBaseline(climbBaselineDebt);
  if (!baseline) {
    return debtTierJourneyProgress(debtRemaining, currentTier, gapDollarsFromNextTierInfo, nextTier, climbBaselineDebt);
  }

  const remRaw = Number(debtRemaining);
  const rem = Number.isFinite(remRaw) ? remRaw : baseline;
  if (currentTier.id === 'wealthy' || rem <= 0) {
    return {
      journeyHighDebt: baseline,
      debtRemaining: 0,
      pctAlongJourney: 100,
      dollarsToFinalGoal: 0,
      dollarsToNextTier: 0,
      nextTierBoundaryPct: 100,
      ticks: [],
    };
  }

  const band = climbTierBandProgress(rem, currentTier, baseline);
  const pctAlongJourney = roundDebtTierBandPct(Math.min(100, Math.max(0, ((baseline - rem) / baseline) * 100)));
  const nextTierBoundaryPct = roundDebtTierBandPct(Math.min(100, Math.max(0, ((baseline - band.bandLower) / baseline) * 100)));
  const nonDebtFreeStages = TIERS.length - 1;
  const ticks = TIERS.filter(t => t.id !== 'wealthy').map((t, index) => ({
    tierId: t.id,
    badge: t.badge,
    threshold: roundMoney(baseline * (1 - ((index + 1) / nonDebtFreeStages))),
    tickPct: roundDebtTierBandPct(((index + 1) / nonDebtFreeStages) * 100),
    isNextStageLine: t.id === currentTier.id,
  }));

  return {
    journeyHighDebt: baseline,
    debtRemaining: Math.max(0, roundMoney(rem)),
    pctAlongJourney,
    dollarsToFinalGoal: roundMoney(Math.max(0, rem)),
    dollarsToNextTier: nextTier ? Math.max(0, roundMoney(gapDollarsFromNextTierInfo)) : 0,
    nextTierBoundaryPct,
    ticks,
  };
}

/**
 * Calculate next-tier info.
 *
 * @param {number} debtRemaining  Current debt in dollars
 * @param {Array}  snapshots      Recent snapshots, newest first
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

  // Span-gated monthly paydown — the SAME helper the climb forecasts use. The old
  // ad-hoc "totalPaydown / monthsElapsed over the last 4 snapshots" only guarded
  // monthsElapsed > 0, so a handful of same-week entries produced a tiny
  // denominator and a wildly inflated pace → an absurdly short months-estimate.
  // monthlyPaceFromSnapshots refuses to project until the window spans real
  // calendar time (MIN_SPAN_DAYS), returning null otherwise.
  const avgMonthlyPaydown = monthlyPaceFromSnapshots(snapshots);

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

module.exports = {
  TIERS,
  ROCK_BOTTOM_BAND_BUFFER,
  DEBT_TIER_BAND_PCT_DECIMALS,
  getTier,
  getClimbTier,
  nextTierInfo,
  nextClimbTierInfo,
  debtTierBandProgress,
  climbTierBandProgress,
  debtTierJourneyProgress,
  climbTierJourneyProgress,
  explainDebtTierBandProgress,
  roundDebtTierBandPct,
};
