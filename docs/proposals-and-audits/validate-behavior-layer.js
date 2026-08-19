'use strict';

/**
 * Steward Behavior Layer Validation
 * Tests tiers, stability, and climb metrics with simulated snapshot data and edge cases.
 * Run: source ~/.nvm/nvm.sh && nvm use 24 && node validate-behavior-layer.js
 */

const { getTier, nextTierInfo, debtTierBandProgress, debtTierJourneyProgress, TIERS, ROCK_BOTTOM_BAND_BUFFER } = require('./repos/Steward/services/tiers');
const { computeStability, stabilityNarrative, breathingRoomGoalFields, BAND_STABILIZING_MIN, BAND_FORTIFIED_MIN, GUARD_EXPOSED_MAX_RUNWAY_MONTHS, GUARD_FORTIFIED_MIN_RUNWAY_MONTHS, BREATHING_ROOM_GOAL_MONTHS } = require('./repos/Steward/services/stability');
const { applyDeltaToTotals, analyzePerAccountDebtDiff, applyClimbMetricsOnPull, getClimbStatsFromConfig, roundMoney } = require('./repos/Steward/services/climbMetrics');

let passed = 0;
let failed = 0;
let warnings = 0;
const findings = [];

function assert(condition, label, detail) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}${detail ? ' — ' + detail : ''}`;
    console.log(msg);
    findings.push({ type: 'FAIL', label, detail });
  }
}

function warn(label, detail) {
  warnings++;
  console.log(`  ⚠ ${label}${detail ? ' — ' + detail : ''}`);
  findings.push({ type: 'WARN', label, detail });
}

function section(name) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${'═'.repeat(60)}`);
}

// ══════════════════════════════════════════════════════════════
//  1. TIER BOUNDARIES
// ══════════════════════════════════════════════════════════════
section('1. TIER BOUNDARY VALIDATION');

// Tier thresholds descending: 79000, 70000, 60000, 50000, 40000, 30000, 20000, 10000, 0, -Infinity
const tierTests = [
  // [debtRemaining, expectedTierId, description]
  [100000, 'rock_bottom', 'Debt $100K → Rock Bottom'],
  [79001, 'rock_bottom', 'Debt $79,001 → Rock Bottom (just above threshold)'],
  [79000.01, 'rock_bottom', 'Debt $79,000.01 → Rock Bottom (fractional cent above)'],
  [79000, 'broke', 'Debt $79,000 exactly → Broke (threshold is >, not >=)'],
  [70001, 'broke', 'Debt $70,001 → Broke'],
  [70000, 'struggling', 'Debt $70,000 → Struggling'],
  [60000, 'surviving', 'Debt $60,000 → Surviving'],
  [50000, 'stabilizing', 'Debt $50,000 → Stabilizing'],
  [40000, 'stable', 'Debt $40,000 → Stable'],
  [30000, 'building', 'Debt $30,000 → Building'],
  [20000, 'thriving', 'Debt $20,000 → Thriving'],
  [10000, 'winning', 'Debt $10,000 → Winning'],
  [0.01, 'winning', 'Debt $0.01 → Winning (> 0)'],
  [0, 'wealthy', 'Debt $0.00 → Wealthy'],
  [-1, 'wealthy', 'Debt -$1 (overpaid) → Wealthy'],
  [-100000, 'wealthy', 'Debt -$100K → Wealthy'],
];

for (const [debt, expectedId, desc] of tierTests) {
  const tier = getTier(debt);
  assert(tier.id === expectedId, desc, `got ${tier.id} (expected ${expectedId})`);
}

// Edge: NaN, undefined, null, Infinity
section('1b. TIER EDGE CASES — Invalid inputs');

const edgeTierTests = [
  [NaN, 'Expected behavior for NaN debt'],
  [undefined, 'Expected behavior for undefined debt'],
  [null, 'Expected behavior for null debt'],
  [Infinity, 'Expected behavior for Infinity debt'],
  [-Infinity, 'Expected behavior for -Infinity debt'],
];

for (const [debt, desc] of edgeTierTests) {
  try {
    const tier = getTier(debt);
    // NaN > 79000 is false, so it falls through all tiers to wealthy
    // undefined > 79000 is false, same
    // Infinity > 79000 is true → rock_bottom
    // -Infinity > 79000 is false → wealthy
    console.log(`  ℹ ${desc}: getTier(${debt}) → ${tier.id}`);
    if (debt === Infinity) {
      assert(tier.id === 'rock_bottom', `Infinity → rock_bottom`, `got ${tier.id}`);
    } else if (Number.isNaN(debt) || debt === undefined || debt === null) {
      // NaN/undefined/null: NaN > 79000 = false → falls through to wealthy
      assert(tier.id === 'wealthy', `${debt} → wealthy (NaN comparison)`, `got ${tier.id}`);
      warn(`getTier(${debt}) returns wealthy`, 'No input validation — NaN/null treated as $0 debt. If a YNAB pull returns invalid data, user would see Wealthy tier.');
    }
  } catch (e) {
    console.log(`  ℹ ${desc}: THREW ${e.message}`);
    warn(`getTier(${debt}) throws`, e.message);
  }
}

// ══════════════════════════════════════════════════════════════
//  2. NEXT TIER INFO — Gap calculation & months estimate
// ══════════════════════════════════════════════════════════════
section('2. NEXT TIER INFO');

// At $85K debt (rock_bottom, threshold=79000), gap should be $6K
const nextInfo85K = nextTierInfo(85000);
assert(nextInfo85K.currentTier.id === 'rock_bottom', 'At $85K: current tier = rock_bottom');
assert(nextInfo85K.nextTier.id === 'broke', 'At $85K: next tier = broke');
assert(nextInfo85K.gapDollars === 6000, 'At $85K: gap = $6,000', `got $${nextInfo85K.gapDollars}`);
assert(nextInfo85K.monthsEstimate === null, 'At $85K with no snapshots: monthsEstimate = null');

// At exactly threshold: gap should be $0
const nextInfoExact = nextTierInfo(79000);
assert(nextInfoExact.currentTier.id === 'broke', 'At $79K exactly: current = broke');
assert(nextInfoExact.gapDollars === 9000, 'At $79K exactly: gap to struggling = $9,000', `got $${nextInfoExact.gapDollars}`);

// At $0 (wealthy): no next tier
const nextInfoZero = nextTierInfo(0);
assert(nextInfoZero.currentTier.id === 'wealthy', 'At $0: current = wealthy');
assert(nextInfoZero.nextTier === null, 'At $0: no next tier');
assert(nextInfoZero.gapDollars === 0, 'At $0: gap = $0');

// Months estimate with snapshot data
const now = new Date();
const twoMonthsAgo = new Date(now - 60 * 24 * 60 * 60 * 1000);
const snapshotsForEstimate = [
  { debt_remaining: 75000, pulled_at: now.toISOString() },
  { debt_remaining: 78000, pulled_at: twoMonthsAgo.toISOString() },
];
const nextInfoWithSnaps = nextTierInfo(75000, snapshotsForEstimate);
assert(nextInfoWithSnaps.monthsEstimate !== null, 'With snapshots: monthsEstimate is computed');
assert(nextInfoWithSnaps.monthsEstimate > 0, `Months estimate = ${nextInfoWithSnaps.monthsEstimate}`);
// $3K paid over ~2 months = ~$1.5K/month. Gap from $75K to $70K threshold = $5K. Should be ~4 months.
assert(nextInfoWithSnaps.monthsEstimate >= 3 && nextInfoWithSnaps.monthsEstimate <= 5,
  `Months estimate reasonable (3-5)`, `got ${nextInfoWithSnaps.monthsEstimate}`);

// Edge: debt INCREASED over time → negative paydown → monthsEstimate should be null
const snapshotsDebtIncreased = [
  { debt_remaining: 80000, pulled_at: now.toISOString() },
  { debt_remaining: 75000, pulled_at: twoMonthsAgo.toISOString() },
];
const nextInfoDebtUp = nextTierInfo(80000, snapshotsDebtIncreased);
assert(nextInfoDebtUp.monthsEstimate === null, 'Debt increased → monthsEstimate null',
  `got ${nextInfoDebtUp.monthsEstimate}`);

// ══════════════════════════════════════════════════════════════
//  3. BAND PROGRESS
// ══════════════════════════════════════════════════════════════
section('3. DEBT TIER BAND PROGRESS');

// Rock Bottom band: threshold=79000, upper=79000+10000=89000, span=10000
const rbTier = getTier(85000);
const rbBand = debtTierBandProgress(85000, rbTier);
assert(rbBand.bandLower === 79000, 'Rock Bottom bandLower = 79000', `got ${rbBand.bandLower}`);
assert(rbBand.bandUpper === 89000, 'Rock Bottom bandUpper = 89000 (threshold + buffer)', `got ${rbBand.bandUpper}`);
assert(rbBand.span === 10000, 'Rock Bottom span = 10000', `got ${rbBand.span}`);
// At $85K: (89000-85000)/10000 * 100 = 40%
assert(rbBand.pctInBand === 40, 'At $85K: 40% through Rock Bottom band', `got ${rbBand.pctInBand}%`);

// Broke band: threshold=70000, upper=previous tier threshold=79000, span=9000
const brokeTier = getTier(75000);
const brokeBand = debtTierBandProgress(75000, brokeTier);
assert(brokeBand.bandLower === 70000, 'Broke bandLower = 70000', `got ${brokeBand.bandLower}`);
assert(brokeBand.bandUpper === 79000, 'Broke bandUpper = 79000', `got ${brokeBand.bandUpper}`);
assert(brokeBand.span === 9000, 'Broke span = 9000', `got ${brokeBand.span}`);
// At $75K: (79000-75000)/9000 * 100 = 44.4%
assert(Math.abs(brokeBand.pctInBand - 44.4) < 0.2, 'At $75K: ~44.4% through Broke', `got ${brokeBand.pctInBand}%`);

// At exact tier boundary: debt=$79000 → broke, progress should be 0% (just entered band)
const brokeBandEntry = debtTierBandProgress(79000, getTier(79000));
assert(brokeBandEntry.pctInBand === 0, 'At $79K exactly (entering Broke): 0%', `got ${brokeBandEntry.pctInBand}%`);

// At band lower (about to exit): debt=$70001 → broke, should be ~99.99%
const brokeBandExit = debtTierBandProgress(70001, getTier(70001));
assert(brokeBandExit.pctInBand > 99, 'At $70,001 (almost exiting Broke): >99%', `got ${brokeBandExit.pctInBand}%`);

// Wealthy band: always 100%
const wealthyBand = debtTierBandProgress(0, getTier(0));
assert(wealthyBand.pctInBand === 100, 'Wealthy: pctInBand = 100%', `got ${wealthyBand.pctInBand}%`);

// Edge: debt above Rock Bottom ceiling (above $89K)
const overCeiling = debtTierBandProgress(95000, getTier(95000));
assert(overCeiling.pctInBand === 0, 'At $95K (above RB ceiling): 0%', `got ${overCeiling.pctInBand}%`);
warn('Debt above Rock Bottom ceiling ($89K)', `User at $95K sees 0% progress in band — the bar is empty even though they could be paying down. ROCK_BOTTOM_BAND_BUFFER=${ROCK_BOTTOM_BAND_BUFFER} may need to be larger for users starting above $89K.`);

// ══════════════════════════════════════════════════════════════
//  4. STABILITY SCORING
// ══════════════════════════════════════════════════════════════
section('4. STABILITY SCORING');

// Case 1: High debt, no savings → Exposed
const stab1 = computeStability({
  ynabSafetyLiquid: 500,
  ynabTotalAssets: 500,
  monthlyExpenses: 3000,
  debtRemaining: 80000,
  monthsAheadYnab: 0.17,
  brokerageEnabled: false,
  brokerageCash: 0,
  brokerageHoldings: 0,
});
assert(stab1.id === 'exposed', 'High debt, $500 savings → Exposed', `got ${stab1.id} (score=${stab1.score})`);
assert(stab1.urgency === 'high', 'Exposed urgency = high');
assert(stab1.effectiveRunwayMonths < 1, `Runway < 1 month (${stab1.effectiveRunwayMonths})`);

// Case 2: Mid debt, moderate savings → Steady
const stab2 = computeStability({
  ynabSafetyLiquid: 8000,
  ynabTotalAssets: 12000,
  monthlyExpenses: 3000,
  debtRemaining: 40000,
  monthsAheadYnab: 2.67,
  brokerageEnabled: false,
  brokerageCash: 0,
  brokerageHoldings: 0,
});
assert(stab2.id === 'stabilizing', 'Mid debt, $8K savings → Steady', `got ${stab2.id} (score=${stab2.score})`);
assert(stab2.label === 'Steady', 'Label is "Steady" (not "Stabilizing")');
assert(stab2.urgency === 'moderate', 'Steady urgency = moderate');

// Case 3: Low debt, strong savings → Fortified
const stab3 = computeStability({
  ynabSafetyLiquid: 25000,
  ynabTotalAssets: 50000,
  monthlyExpenses: 3500,
  debtRemaining: 5000,
  monthsAheadYnab: 7.14,
  brokerageEnabled: false,
  brokerageCash: 0,
  brokerageHoldings: 0,
});
assert(stab3.id === 'fortified', 'Low debt, $25K savings → Fortified', `got ${stab3.id} (score=${stab3.score})`);
assert(stab3.urgency === 'low', 'Fortified urgency = low');

// Case 4: Debt-free, no savings → should STILL be Exposed (runway guard)
const stab4 = computeStability({
  ynabSafetyLiquid: 200,
  ynabTotalAssets: 200,
  monthlyExpenses: 3000,
  debtRemaining: 0,
  monthsAheadYnab: 0.07,
  brokerageEnabled: false,
  brokerageCash: 0,
  brokerageHoldings: 0,
});
// Debt-free gives full buffer points (37), but runway is 200/3000 = 0.067 months < 0.95 guard
assert(stab4.id === 'exposed', 'Debt-free but $200 savings → Exposed (runway guard)', `got ${stab4.id} (score=${stab4.score})`);
warn('Debt-free + Exposed is counterintuitive', 'User who just paid off all debt but has $200 cash sees "Exposed" label. The narrative handles this well ("No debt is one milestone; months of spendable cushion is another") but the visual label may confuse users.');

// Case 5: Debt-free with good savings → Fortified
const stab5 = computeStability({
  ynabSafetyLiquid: 20000,
  ynabTotalAssets: 50000,
  monthlyExpenses: 3000,
  debtRemaining: 0,
  monthsAheadYnab: 6.67,
  brokerageEnabled: false,
  brokerageCash: 0,
  brokerageHoldings: 0,
});
assert(stab5.id === 'fortified', 'Debt-free + $20K savings → Fortified', `got ${stab5.id} (score=${stab5.score})`);

// Case 6: Brokerage contribution
const stab6 = computeStability({
  ynabSafetyLiquid: 3000,
  ynabTotalAssets: 5000,
  monthlyExpenses: 3000,
  debtRemaining: 50000,
  monthsAheadYnab: 1.0,
  brokerageEnabled: true,
  brokerageCash: 5000,
  brokerageHoldings: 20000,
});
// effectiveCushion = 3000 + 5000 + 0.35*20000 = 15000
// runway = 15000/3000 = 5 months
assert(stab6.effectiveRunwayMonths > 4.5, `Brokerage boosts runway to ${stab6.effectiveRunwayMonths} months`);
assert(stab6.components.investedCredit === 7000, 'Invested credit = 35% of $20K = $7K', `got ${stab6.components.investedCredit}`);

// Case 7: Zero monthly expenses → runway null
const stab7 = computeStability({
  ynabSafetyLiquid: 10000,
  ynabTotalAssets: 10000,
  monthlyExpenses: 0,
  debtRemaining: 30000,
  monthsAheadYnab: null,
  brokerageEnabled: false,
  brokerageCash: 0,
  brokerageHoldings: 0,
});
assert(stab7.effectiveRunwayMonths === null, 'Zero expenses → runway null', `got ${stab7.effectiveRunwayMonths}`);
// With null runway, runway points use fallback: min(35, (liquidLike/15000)*35)
// liquidLike = 10000, so runwayPoints = 35 * (10000/15000) = 23.3
// buffer: cushion=10000, debt=30000 → rawRatio=10000/30000=0.333, sqrt(0.333/0.3)=1.054→capped at 1 → 37 points
// total = 23.3 + 37 = 60.3 → stabilizing (Steady)
assert(stab7.id === 'stabilizing', 'Zero expenses + $10K savings → Steady', `got ${stab7.id} (score=${stab7.score})`);

// Case 8: Legacy fallback (no safety_liquid)
const stab8 = computeStability({
  ynabSafetyLiquid: null,
  ynabTotalAssets: 15000,
  monthlyExpenses: 3000,
  debtRemaining: 40000,
  monthsAheadYnab: 2.0,
  brokerageEnabled: false,
  brokerageCash: 0,
  brokerageHoldings: 0,
});
assert(stab8.scoring.legacyFallback === true, 'Null safety_liquid → legacy fallback active');
// ynabLiquidForStability = 15000 * 0.88 = 13200
assert(stab8.components.ynabSafetyLiquid === 13200, 'Legacy: 88% of total_assets', `got ${stab8.components.ynabSafetyLiquid}`);

// ══════════════════════════════════════════════════════════════
//  5. STABILITY GUARD BOUNDARIES
// ══════════════════════════════════════════════════════════════
section('5. STABILITY GUARD EDGE CASES');

// Right at exposed guard boundary (0.95 months)
const guardEdge1 = computeStability({
  ynabSafetyLiquid: 2850, // 2850/3000 = 0.95 exactly
  ynabTotalAssets: 2850,
  monthlyExpenses: 3000,
  debtRemaining: 5000,
  monthsAheadYnab: 0.95,
  brokerageEnabled: false,
  brokerageCash: 0,
  brokerageHoldings: 0,
});
console.log(`  ℹ At exactly 0.95mo runway: score=${guardEdge1.score}, id=${guardEdge1.id}, guard=${guardEdge1.scoring.guard}`);
// 0.95 is NOT < 0.95, so exposed guard should NOT fire
assert(guardEdge1.scoring.guard !== 'exposed_floor', 'At exactly 0.95mo: exposed guard does NOT fire',
  `guard=${guardEdge1.scoring.guard}`);

// Just below exposed guard (0.94 months)
const guardEdge2 = computeStability({
  ynabSafetyLiquid: 2820,
  ynabTotalAssets: 2820,
  monthlyExpenses: 3000,
  debtRemaining: 5000,
  monthsAheadYnab: 0.94,
  brokerageEnabled: false,
  brokerageCash: 0,
  brokerageHoldings: 0,
});
assert(guardEdge2.scoring.guard === 'exposed_floor', 'At 0.94mo: exposed guard fires',
  `guard=${guardEdge2.scoring.guard}`);
assert(guardEdge2.id === 'exposed', 'Forced to Exposed by guard');

// Fortified guard boundary (5.15 months)
const guardEdge3 = computeStability({
  ynabSafetyLiquid: 15450, // 15450/3000 = 5.15 exactly
  ynabTotalAssets: 15450,
  monthlyExpenses: 3000,
  debtRemaining: 50000,
  monthsAheadYnab: 5.15,
  brokerageEnabled: false,
  brokerageCash: 0,
  brokerageHoldings: 0,
});
console.log(`  ℹ At exactly 5.15mo runway: score=${guardEdge3.score}, id=${guardEdge3.id}, guard=${guardEdge3.scoring.guard}`);
assert(guardEdge3.scoring.guard === 'fortified_floor', 'At 5.15mo: fortified guard fires',
  `guard=${guardEdge3.scoring.guard}`);

// ══════════════════════════════════════════════════════════════
//  6. BREATHING ROOM
// ══════════════════════════════════════════════════════════════
section('6. BREATHING ROOM GOAL');

const br1 = breathingRoomGoalFields(1.5);
assert(br1.breathingRoomGoalMonths === 2.0, 'Goal = 2 months');
assert(br1.breathingRoomReached === false, '1.5mo → not reached');
assert(br1.breathingRoomGapMonths === 0.5, 'Gap = 0.5mo', `got ${br1.breathingRoomGapMonths}`);

const br2 = breathingRoomGoalFields(2.0);
assert(br2.breathingRoomReached === true, '2.0mo → reached');
assert(br2.breathingRoomGapMonths === 0, 'Gap = 0');

const br3 = breathingRoomGoalFields(null);
assert(br3.breathingRoomReached === false, 'Null runway → not reached');
assert(br3.breathingRoomGapMonths === null, 'Null runway → gap null');

const br4 = breathingRoomGoalFields(5.0);
assert(br4.breathingRoomReached === true, '5.0mo → reached');
assert(br4.breathingRoomGapMonths === 0, 'Gap = 0 (above goal)');

// ══════════════════════════════════════════════════════════════
//  7. STABILITY NARRATIVES
// ══════════════════════════════════════════════════════════════
section('7. STABILITY NARRATIVES');

// All 12 combinations: 4 debt groups × 3 stability bands
const debtGroups = [
  { tierId: 'wealthy', group: 'debt_free' },
  { tierId: 'rock_bottom', group: 'high' },
  { tierId: 'surviving', group: 'mid' },
  { tierId: 'building', group: 'low' },
];
const stabIds = ['exposed', 'stabilizing', 'fortified'];

for (const { tierId, group } of debtGroups) {
  for (const sid of stabIds) {
    const narr = stabilityNarrative(tierId, { id: sid });
    assert(narr.lead && narr.lead.length > 10, `Narrative ${group}×${sid}: has lead text`);
    assert(narr.mood && narr.mood.length > 10, `Narrative ${group}×${sid}: has mood text`);
    assert(narr.recommend && narr.recommend.length > 10, `Narrative ${group}×${sid}: has recommend text`);
  }
}

// Edge: unknown tier id → should fall back to 'mid' group
const narrUnknown = stabilityNarrative('nonexistent_tier', { id: 'exposed' });
assert(narrUnknown.lead.length > 0, 'Unknown tier → falls back to mid group narrative');

// ══════════════════════════════════════════════════════════════
//  8. CLIMB METRICS — Delta calculations
// ══════════════════════════════════════════════════════════════
section('8. CLIMB METRICS — applyDeltaToTotals');

// Normal paydown: debt decreases
const d1 = applyDeltaToTotals(50000, 48000, 0, 0);
assert(d1.cumulativePaidDown === 2000, 'Paydown $50K→$48K: paid = $2,000', `got ${d1.cumulativePaidDown}`);
assert(d1.cumulativeNewDebtAdded === 0, 'No new debt');

// New debt added
const d2 = applyDeltaToTotals(50000, 52000, 0, 0);
assert(d2.cumulativePaidDown === 0, 'Debt increase: no paydown');
assert(d2.cumulativeNewDebtAdded === 2000, 'New debt = $2,000', `got ${d2.cumulativeNewDebtAdded}`);

// Cumulative: multiple deltas
const d3 = applyDeltaToTotals(50000, 48000, 5000, 1000); // already paid $5K, $1K new
assert(d3.cumulativePaidDown === 7000, 'Cumulative: 5000+2000 = $7,000', `got ${d3.cumulativePaidDown}`);
assert(d3.cumulativeNewDebtAdded === 1000, 'Cumulative new debt unchanged');

// Zero delta
const d4 = applyDeltaToTotals(50000, 50000, 5000, 1000);
assert(d4.cumulativePaidDown === 5000, 'No change: paid stays $5,000');
assert(d4.cumulativeNewDebtAdded === 1000, 'No change: new stays $1,000');

// Edge: negative debt (shouldn't happen but test)
const d5 = applyDeltaToTotals(5000, -100, 10000, 0);
assert(d5.cumulativePaidDown === 10000, 'Negative debt input: paid unchanged (guard)', `got ${d5.cumulativePaidDown}`);

// Edge: NaN last aggregate
const d6 = applyDeltaToTotals(NaN, 50000, 0, 0);
assert(d6.last === 50000, 'NaN last → re-seeded to current debt', `got ${d6.last}`);
assert(d6.cumulativePaidDown === 0, 'NaN last → no delta applied');

// ══════════════════════════════════════════════════════════════
//  9. PER-ACCOUNT DEBT DIFF
// ══════════════════════════════════════════════════════════════
section('9. PER-ACCOUNT DEBT DIFF');

// Normal: one account paid down, one increased
const prev1 = new Map([['acct-1', 10000], ['acct-2', 5000]]);
const curr1 = new Map([['acct-1', 8000], ['acct-2', 6000]]);
const diff1 = analyzePerAccountDebtDiff(prev1, curr1);
assert(diff1.paydownSum === 2000, 'Account 1 paydown $2K', `got ${diff1.paydownSum}`);
assert(diff1.newDebtSum === 1000, 'Account 2 new debt $1K', `got ${diff1.newDebtSum}`);
assert(diff1.accountsDecreasedCount === 1, '1 account decreased');
assert(diff1.accountsIncreasedCount === 1, '1 account increased');

// Account removed (not counted as paydown)
const prev2 = new Map([['acct-1', 10000], ['acct-2', 5000]]);
const curr2 = new Map([['acct-1', 8000]]);
const diff2 = analyzePerAccountDebtDiff(prev2, curr2);
assert(diff2.paydownSum === 2000, 'Removed account NOT counted as paydown', `got ${diff2.paydownSum}`);
assert(diff2.accountsRemovedCount === 1, '1 account removed');
assert(diff2.newDebtSum === 0, 'No new debt from removal');

// New account added (full balance = new debt)
const prev3 = new Map([['acct-1', 10000]]);
const curr3 = new Map([['acct-1', 10000], ['acct-new', 15000]]);
const diff3 = analyzePerAccountDebtDiff(prev3, curr3);
assert(diff3.newDebtSum === 15000, 'New account: full balance = new debt', `got ${diff3.newDebtSum}`);
assert(diff3.accountsAddedCount === 1, '1 account added');

// Empty maps
const diff4 = analyzePerAccountDebtDiff(new Map(), new Map());
assert(diff4.paydownSum === 0, 'Empty → empty: no changes');
assert(diff4.newDebtSum === 0, 'Empty → empty: no new debt');

// Edge: non-Map inputs
const diff5 = analyzePerAccountDebtDiff(null, undefined);
assert(diff5.paydownSum === 0, 'Null inputs handled gracefully');

// Restructure detection scenario: account removed + new account added with similar balance
const prevR = new Map([['old-loan', 30000], ['cc-1', 5000]]);
const currR = new Map([['new-consolidation-loan', 29000], ['cc-1', 5000]]);
const diffR = analyzePerAccountDebtDiff(prevR, currR);
assert(diffR.accountsRemovedCount === 1, 'Restructure: 1 removed');
assert(diffR.accountsAddedCount === 1, 'Restructure: 1 added');
assert(diffR.newDebtSum === 29000, 'Restructure: new account full balance counted as new debt', `got ${diffR.newDebtSum}`);
warn('Debt restructure inflates newDebtSum', 'When a user consolidates debt (removes old loan, adds new one), the full balance of the new loan is counted as new debt even though total debt barely changed. The suspectedRestructure flag in the API attempts to catch this, but the cumulative counters are still affected.');

// ══════════════════════════════════════════════════════════════
// 10. JOURNEY PROGRESS (full-path visualization)
// ══════════════════════════════════════════════════════════════
section('10. JOURNEY PROGRESS');

const jp1 = debtTierJourneyProgress(50000, getTier(50000), 10000, getTier(40000));
assert(jp1.journeyHighDebt === 89000, 'Journey high = 79000 + 10000 buffer = 89000', `got ${jp1.journeyHighDebt}`);
assert(jp1.pctAlongJourney > 0 && jp1.pctAlongJourney < 100, `At $50K: ${jp1.pctAlongJourney}% along journey`);
assert(jp1.ticks.length === 9, '9 ticks (excludes wealthy)', `got ${jp1.ticks.length}`);

// At $0 (wealthy): 100%
const jp2 = debtTierJourneyProgress(0, getTier(0), 0, null);
assert(jp2.pctAlongJourney === 100, 'At $0: 100% journey', `got ${jp2.pctAlongJourney}`);
assert(jp2.dollarsToFinalGoal === 0, 'At $0: $0 to goal');

// Above journey ceiling
const jp3 = debtTierJourneyProgress(100000, getTier(100000), 21000, getTier(79000));
assert(jp3.pctAlongJourney === 0, 'At $100K (above ceiling): 0%', `got ${jp3.pctAlongJourney}`);
warn('Debt above journey ceiling shows 0%', 'A user starting above $89K sees 0% on the full journey bar. They have to pay down to $89K before the bar starts moving. This is the same issue as the Rock Bottom band.');

// ══════════════════════════════════════════════════════════════
// 11. CROSS-LAYER CONSISTENCY
// ══════════════════════════════════════════════════════════════
section('11. CROSS-LAYER CONSISTENCY');

// Verify tier thresholds are strictly descending
for (let i = 0; i < TIERS.length - 1; i++) {
  assert(TIERS[i].threshold > TIERS[i+1].threshold,
    `Tier ${TIERS[i].id} threshold (${TIERS[i].threshold}) > ${TIERS[i+1].id} (${TIERS[i+1].threshold})`);
}

// Verify every tier has required fields
for (const t of TIERS) {
  assert(typeof t.id === 'string' && t.id.length > 0, `Tier ${t.badge} has id`);
  assert(typeof t.label === 'string' && t.label.length > 0, `Tier ${t.badge} has label`);
  assert(typeof t.badge === 'string' && t.badge.length === 2, `Tier ${t.badge} has 2-char badge`);
  assert(typeof t.copy === 'string' && t.copy.length > 0, `Tier ${t.badge} has copy`);
  if (t.id !== 'wealthy') {
    assert(typeof t.nextCopy === 'string' && t.nextCopy.length > 0, `Tier ${t.badge} has nextCopy`);
  }
}

// Verify stability band boundaries are consistent
assert(BAND_STABILIZING_MIN < BAND_FORTIFIED_MIN, 'Stabilizing min < Fortified min');
assert(GUARD_EXPOSED_MAX_RUNWAY_MONTHS < GUARD_FORTIFIED_MIN_RUNWAY_MONTHS, 'Exposed guard < Fortified guard');

// Verify band gap coverage: every debt amount maps to exactly one tier
const testDebts = [100000, 89000, 79001, 79000, 70001, 70000, 60000, 50000, 40000, 30000, 20000, 10000, 1, 0.01, 0, -1];
const seenTiers = new Set();
for (const d of testDebts) {
  const t = getTier(d);
  seenTiers.add(t.id);
}
assert(seenTiers.size === 10, 'All 10 tiers are reachable via test debts', `only reached ${seenTiers.size}: ${[...seenTiers].join(', ')}`);

// ══════════════════════════════════════════════════════════════
// 12. FLOATING POINT EDGE CASES
// ══════════════════════════════════════════════════════════════
section('12. FLOATING POINT EDGE CASES');

// Test roundMoney precision
assert(roundMoney(0.1 + 0.2) === 0.3, 'roundMoney(0.1+0.2) = 0.3', `got ${roundMoney(0.1 + 0.2)}`);
assert(roundMoney(79000.005) === 79000.01, 'roundMoney rounds to cents', `got ${roundMoney(79000.005)}`);
assert(roundMoney(NaN) === 0, 'roundMoney(NaN) = 0', `got ${roundMoney(NaN)}`);

// Tier at floating point boundary
const tierFP = getTier(79000.000000001);
assert(tierFP.id === 'rock_bottom', '$79000.000000001 → rock_bottom (FP above threshold)', `got ${tierFP.id}`);

// Band progress at fractional amounts
const bandFP = debtTierBandProgress(79000.50, getTier(79000.50));
assert(bandFP.pctInBand >= 0 && bandFP.pctInBand <= 100, 'Fractional debt: band % in range');

// ══════════════════════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════════════════════
section('SUMMARY');

console.log(`\n  Passed:   ${passed}`);
console.log(`  Failed:   ${failed}`);
console.log(`  Warnings: ${warnings}`);
console.log();

if (findings.length > 0) {
  console.log('  Findings:');
  for (const f of findings) {
    console.log(`    [${f.type}] ${f.label}${f.detail ? ' — ' + f.detail : ''}`);
  }
}

console.log(`\n${'═'.repeat(60)}`);
if (failed === 0) {
  console.log('  ALL ASSERTIONS PASSED');
} else {
  console.log(`  ${failed} ASSERTION(S) FAILED`);
}
console.log(`${'═'.repeat(60)}\n`);

process.exit(failed > 0 ? 1 : 0);
