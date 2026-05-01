'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const constants = require('../public/debt-tier-constants.json');
const {
  TIERS,
  ROCK_BOTTOM_BAND_BUFFER,
  getTier,
  getClimbTier,
  nextClimbTierInfo,
  climbTierBandProgress,
  debtTierBandProgress,
  explainDebtTierBandProgress,
  roundDebtTierBandPct,
} = require('../services/tiers');

test('debt-tier-constants.json matches tiers ROCK_BOTTOM_BAND_BUFFER', () => {
  assert.equal(constants.ROCK_BOTTOM_BAND_BUFFER, ROCK_BOTTOM_BAND_BUFFER);
  assert.equal(ROCK_BOTTOM_BAND_BUFFER, 10000);
});

test('Rock Bottom: bandLower is tier threshold; bandUpper is threshold + buffer', () => {
  const tier = getTier(85000);
  assert.equal(tier.id, 'rock_bottom');
  const p = debtTierBandProgress(85000, tier, [], 0);
  assert.equal(p.bandLower, 79000);
  assert.equal(p.bandUpper, 79000 + ROCK_BOTTOM_BAND_BUFFER);
});

test('Rock Bottom: just above threshold shows high completion % (toward next tier)', () => {
  const tier = getTier(79836);
  assert.equal(tier.id, 'rock_bottom');
  const p = debtTierBandProgress(79836, tier, [], 0);
  assert.equal(p.bandLower, 79000);
  assert.equal(p.bandUpper, 89000);
  assert.equal(p.span, 10000);
  assert.ok(Math.abs(p.pctInBandRaw - 91.64) < 0.001);
  assert.equal(p.pctInBand, 91.6);
});

test('Rock Bottom: debt above fixed ceiling clamps to 0%', () => {
  const tier = getTier(120000);
  assert.equal(tier.id, 'rock_bottom');
  const p = debtTierBandProgress(120000, tier, [], 0);
  assert.equal(p.pctInBand, 0);
});

test('Rock Bottom: small paydown increases completion %', () => {
  const tier = getTier(85000);
  const before = debtTierBandProgress(85000, tier, [], 0);
  const after = debtTierBandProgress(85000 - 494, tier, [], 0);
  assert.equal(before.pctInBand, 40);
  assert.ok(after.pctInBand > before.pctInBand);
  assert.equal(after.pctInBand, 44.9);
});

test('Rock Bottom: debt at top of fixed display window (still rock) is ~0%', () => {
  const tier = getTier(88999);
  assert.equal(tier.id, 'rock_bottom');
  const p = debtTierBandProgress(88999, tier, [], 0);
  assert.ok(p.pctInBand >= 0 && p.pctInBand <= 0.1);
});

test('Rock Bottom: debt equal to display ceiling (89000) is still Rock tier, bar 0%', () => {
  assert.equal(getTier(89000).id, 'rock_bottom');
  const p = debtTierBandProgress(89000, getTier(89000), [], 0);
  assert.equal(p.pctInBand, 0);
});

test('Broke: boundary band uses previous tier threshold as upper', () => {
  const tier = getTier(75000);
  assert.equal(tier.id, 'broke');
  const p = debtTierBandProgress(75000, tier, [], 0);
  assert.equal(p.bandLower, 70000);
  assert.equal(p.bandUpper, 79000);
  assert.equal(p.gapToNext, 5000);
  assert.equal(p.pctInBand, 44.4);
});

test('exact tier transition: 79000 is Broke not Rock Bottom', () => {
  assert.equal(getTier(79001).id, 'rock_bottom');
  assert.equal(getTier(79000).id, 'broke');
});

test('Struggling at lower boundary 60001', () => {
  const tier = getTier(60001);
  assert.equal(tier.id, 'struggling');
  const p = debtTierBandProgress(60001, tier, [], 0);
  assert.equal(p.bandLower, 60000);
  assert.equal(p.bandUpper, 70000);
  assert.equal(p.gapToNext, 1);
});

test('debt increase within tier lowers completion %', () => {
  const tier = getTier(75000);
  const lowerDebt = debtTierBandProgress(74000, tier, [], 0);
  const higherDebt = debtTierBandProgress(76000, tier, [], 0);
  assert.ok(lowerDebt.pctInBand > higherDebt.pctInBand);
});

test('Winning tier band', () => {
  const tier = getTier(5000);
  assert.equal(tier.id, 'winning');
  const p = debtTierBandProgress(5000, tier, [], 0);
  assert.equal(p.bandLower, 0);
  assert.equal(p.bandUpper, 10000);
  assert.equal(p.pctInBand, 50);
});

test('Wealthy max tier: 100%', () => {
  const tier = getTier(0);
  assert.equal(tier.id, 'wealthy');
  const p = debtTierBandProgress(0, tier, [], 0);
  assert.equal(p.pctInBand, 100);
});

test('climb tiers start at Buried regardless of absolute starting debt', () => {
  const tier = getClimbTier(4300, 4300);
  assert.equal(tier.id, 'rock_bottom');
  assert.equal(tier.label, 'Buried');
  const p = climbTierBandProgress(4300, tier, 4300);
  assert.equal(p.pctInBand, 0);
  assert.equal(p.bandUpper, 4300);
  assert.equal(p.bandLower, 3822.22);
});

test('climb tiers advance from user baseline paydown percent', () => {
  assert.equal(getClimbTier(4300, 4300).id, 'rock_bottom');
  assert.equal(getClimbTier(3822.22, 4300).id, 'broke');
  assert.equal(getClimbTier(0, 4300).id, 'wealthy');

  const next = nextClimbTierInfo(4300, 4300);
  assert.equal(next.currentTier.id, 'rock_bottom');
  assert.equal(next.nextTier.id, 'broke');
  assert.equal(next.gapDollars, 477.78);
});

test('roundDebtTierBandPct rounds to one decimal', () => {
  assert.equal(roundDebtTierBandPct(44.94), 44.9);
  assert.equal(roundDebtTierBandPct(99.99), 100);
});

test('explainDebtTierBandProgress includes debug fields', () => {
  const tier = getTier(85000);
  const ex = explainDebtTierBandProgress(85000, tier, [], 0);
  assert.equal(ex.currentTier.id, 'rock_bottom');
  assert.equal(ex.debtRemaining, 85000);
  assert.equal(ex.gapToNext, 6000);
  assert.equal(ex.debtTierBandPct, 40);
  assert.equal(ex.isRockBottomBand, true);
  assert.equal(ex.rockBottomBandBuffer, ROCK_BOTTOM_BAND_BUFFER);
  assert.ok(typeof ex.pctInBandRaw === 'number');
});

test('unknown tier object yields safe zeros', () => {
  const p = debtTierBandProgress(5000, { id: 'nope', threshold: 0 }, [], 0);
  assert.equal(p.pctInBand, 0);
  assert.equal(p.gapToNext, 0);
});
