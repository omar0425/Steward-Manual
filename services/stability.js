'use strict';

/**
 * Secondary "stability" layer: savings / liquidity / runway on top of debt tier.
 * Debt tier remains the primary axis (see services/tiers.js).
 *
 * Terminology: the liquidity middle band uses stability.id "stabilizing" (API, narratives,
 * CSS .is-stabilizing). The user-facing label for that id is "Steady" — not the debt tier
 * name "Stabilizing" (badge 05 in services/tiers.js).
 *
 * ── Inputs (real data only) ─────────────────────────────────────────
 * - ynabSafetyLiquid: on-budget cash-like YNAB balances (+ small partial credit for
 *   select on-budget other types). See ynab.safetyRelevantLiquidFromAccounts().
 *   Older snapshots may omit this; see legacy fallback below.
 * - ynabTotalAssets: full positive balance sum (net worth / UI); used only when
 *   safety_liquid is missing, with scoring.legacyFallback flagged and a slight
 *   under-weight so illiquid net worth does not over-credit stability.
 * - monthly_expenses: last full month from YNAB.
 * - Brokerage cash + 35% of holdings (volatile) when linked.
 * - debt_remaining: YNAB liability sum.
 *
 * ── Score (0–100) ─────────────────────────────────────────────────
 *   scoreRaw = min(100, runwayPoints + bufferPoints)
 *   Then optional runway guards clamp scoreRaw so label matches survival reality
 *   (see GUARD_*); clamps are score-level only, not a separate architecture.
 *
 *   runwayPoints = min(RUNWAY_POINTS_CAP,
 *     (effectiveRunwayMonths / RUNWAY_MONTHS_AT_CAP) * RUNWAY_POINTS_CAP)
 *   effectiveRunwayMonths = effectiveCushion / monthlyExpenses  (null if no expenses)
 *
 *   Buffer (debt > 0): diminishing return on cushion vs debt so buffer informs
 *   stability without dominating across tiny debt or huge debt ranges.
 *   debtDenom = max(debtRemaining, MIN_DEBT_FOR_BUFFER_RATIO)
 *   rawRatio = effectiveCushion / debtDenom
 *   bufferPoints = BUFFER_POINTS_CAP * min(1, sqrt(rawRatio / BUFFER_RATIO_REFERENCE))
 *   Debt-free: bufferPoints = BUFFER_POINTS_CAP (modifier saturated).
 *
 *   effectiveCushion = ynabLiquidForStability + brokerageCash + INVESTED_WEIGHT * brokerageHoldings
 *   ynabLiquidForStability = safety_liquid OR (legacyFallback: total_assets * LEGACY_FALLBACK_LIQUID_WEIGHT)
 *
 * ── Label bands (applied to final `score`; inclusive boundaries) ────
 *   Exposed:      score < 36
 *   Steady:       36 <= score < 68  (id remains `stabilizing` for API/state)
 *   Fortified:    score >= 68
 *
 * ── Runway guards (score clamps; align label with liquidity runway) ─
 *   Exposed floor:   very low months of cover → score capped just below the Steady band.
 *   Fortified floor: strong months of cover → score floored to Fortified band.
 *   Exposed wins if both could apply. Tuned to sit on top of the same runway signal
 *   already in runwayPoints (avoids large jumps in normal cases).
 *
 * ── Legacy snapshots ───────────────────────────────────────────────
 *   If ynabSafetyLiquid is null/undefined/non-finite, ynabTotalAssets (weighted)
 *   fills the YNAB slice and scoring.legacyFallback is true.
 */

const INVESTED_WEIGHT = 0.35;

/** When safety_liquid is missing, only this fraction of total_assets counts (illiquid bias). */
const LEGACY_FALLBACK_LIQUID_WEIGHT = 0.88;

const RUNWAY_POINTS_CAP = 62;
const RUNWAY_MONTHS_AT_CAP = 5.5;
/** Set slightly below legacy 38 so debt-free + ~3mo EF lands Steady (id stabilizing), not marginal Fortified. */
const BUFFER_POINTS_CAP = 37;

/**
 * Buffer curve: ratio at which sqrt(rawRatio / BUFFER_RATIO_REFERENCE) reaches 1
 * (buffer points hit cap). ~0.30 means ~30% cushion/debt (on denom) yields full buffer contribution.
 */
const BUFFER_RATIO_REFERENCE = 0.3;

/**
 * Floor on debt when computing cushion/debt ratio: limits extreme sensitivity when
 * debt is very small; very large debt is handled by sqrt diminishing returns.
 */
const MIN_DEBT_FOR_BUFFER_RATIO = 2500;

/**
 * Inclusive lower bound for the middle liquidity band (scores in [36, 68) map to id stabilizing,
 * label Steady in computeStability). Constant name is historical; do not rename without a broad refactor.
 */
const BAND_STABILIZING_MIN = 36;
/** Inclusive lower bound for Fortified. */
const BAND_FORTIFIED_MIN = 68;

/** Below this runway (months of spend covered), force score into Exposed band. */
const GUARD_EXPOSED_MAX_RUNWAY_MONTHS = 0.95;

/** At or above this runway, allow score into Fortified band (floor if needed). */
const GUARD_FORTIFIED_MIN_RUNWAY_MONTHS = 5.15;

/**
 * Product goal: months of spendable cushion (effectiveRunwayMonths) to count as "Breathing Room"
 * for goal distance / reached UI. Independent of score bands (Exposed / Steady / Fortified).
 */
const BREATHING_ROOM_GOAL_MONTHS = 2.0;

/**
 * @param {number|null|undefined} effectiveRunwayMonths same basis as computeStability (cushion ÷ monthly expenses)
 * @returns {{ breathingRoomGoalMonths: number, breathingRoomReached: boolean, breathingRoomGapMonths: number|null }}
 */
function breathingRoomGoalFields(effectiveRunwayMonths) {
  const goal = BREATHING_ROOM_GOAL_MONTHS;
  if (effectiveRunwayMonths == null || !Number.isFinite(Number(effectiveRunwayMonths))) {
    return {
      breathingRoomGoalMonths: goal,
      breathingRoomReached: false,
      breathingRoomGapMonths: null,
    };
  }
  const m = Number(effectiveRunwayMonths);
  const reached = m >= goal;
  return {
    breathingRoomGoalMonths: goal,
    breathingRoomReached: reached,
    breathingRoomGapMonths: reached ? 0 : Math.round((goal - m) * 100) / 100,
  };
}

const GUARD_EXPOSED_SCORE_CEILING = BAND_STABILIZING_MIN - 0.1;
const GUARD_FORTIFIED_SCORE_FLOOR = BAND_FORTIFIED_MIN;

/** Liquidity band ids for API/state. STABILIZING → UI label "Steady" (see computeStability label map). */
const STABILITY_IDS = {
  EXPOSED: 'exposed',
  STABILIZING: 'stabilizing',
  FORTIFIED: 'fortified',
};

function n(num) {
  const x = Number(num);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Map cushion vs debt to buffer points using a sqrt curve (capped).
 * @param {number} effectiveCushion
 * @param {number} debtRemaining strictly > 0
 */
function bufferPointsFromCushionDebt(effectiveCushion, debtRemaining) {
  const debtDenom = Math.max(debtRemaining, MIN_DEBT_FOR_BUFFER_RATIO);
  const rawRatio = Math.max(0, effectiveCushion) / debtDenom;
  const u = rawRatio / BUFFER_RATIO_REFERENCE;
  return BUFFER_POINTS_CAP * Math.min(1, Math.sqrt(u));
}

/**
 * @param {object} input
 * @param {number|null|undefined} input.ynabSafetyLiquid  narrow liquid from YNAB pull
 * @param {number} input.ynabTotalAssets  all positive balances (fallback + net worth)
 * @param {number} input.monthlyExpenses
 * @param {number} input.debtRemaining
 * @param {number|null} input.monthsAheadYnab
 * @param {boolean} input.brokerageEnabled
 * @param {number} input.brokerageCash
 * @param {number} input.brokerageHoldings
 * @returns {{ id: string, label: string, ... }} id is always exposed | stabilizing | fortified;
 *   middle band id stabilizing is shown to users as label Steady.
 */
function computeStability(input) {
  const totalAssetsAll = Math.max(0, n(input.ynabTotalAssets));
  const safetyRaw = input.ynabSafetyLiquid;
  const legacyFallback = safetyRaw == null || !Number.isFinite(Number(safetyRaw));
  const ynabLiquidForStability = legacyFallback
    ? totalAssetsAll * LEGACY_FALLBACK_LIQUID_WEIGHT
    : Math.max(0, n(safetyRaw));

  const monthlyExpenses = Math.max(0, n(input.monthlyExpenses));
  const debtRemaining = Math.max(0, n(input.debtRemaining));
  const brokerageOn = Boolean(input.brokerageEnabled);
  const brCash = brokerageOn ? Math.max(0, n(input.brokerageCash)) : 0;
  const brHold = brokerageOn ? Math.max(0, n(input.brokerageHoldings)) : 0;

  const liquidLike = ynabLiquidForStability + brCash;
  const investedCredit = INVESTED_WEIGHT * brHold;
  const effectiveCushion = liquidLike + investedCredit;

  let effectiveRunwayMonths = null;
  if (monthlyExpenses > 0) {
    effectiveRunwayMonths = effectiveCushion / monthlyExpenses;
  }

  const bufferVsDebt = debtRemaining > 0 ? effectiveCushion / debtRemaining : null;

  let runwayPoints = 0;
  if (effectiveRunwayMonths != null) {
    runwayPoints = Math.min(
      RUNWAY_POINTS_CAP,
      (effectiveRunwayMonths / RUNWAY_MONTHS_AT_CAP) * RUNWAY_POINTS_CAP,
    );
  } else {
    runwayPoints = Math.min(35, (liquidLike / 15000) * 35);
  }

  let bufferPoints = 0;
  if (debtRemaining > 0) {
    bufferPoints = bufferPointsFromCushionDebt(effectiveCushion, debtRemaining);
  } else {
    bufferPoints = BUFFER_POINTS_CAP;
  }

  let scorePreGuard = Math.min(100, runwayPoints + bufferPoints);

  let guardKind = null;
  if (
    monthlyExpenses > 0 &&
    effectiveRunwayMonths != null &&
    effectiveRunwayMonths < GUARD_EXPOSED_MAX_RUNWAY_MONTHS
  ) {
    scorePreGuard = Math.min(scorePreGuard, GUARD_EXPOSED_SCORE_CEILING);
    guardKind = 'exposed_floor';
  } else if (
    monthlyExpenses > 0 &&
    effectiveRunwayMonths != null &&
    effectiveRunwayMonths >= GUARD_FORTIFIED_MIN_RUNWAY_MONTHS
  ) {
    scorePreGuard = Math.max(scorePreGuard, GUARD_FORTIFIED_SCORE_FLOOR);
    guardKind = 'fortified_floor';
  }

  const score = Math.round(Math.min(100, scorePreGuard) * 10) / 10;

  let id = STABILITY_IDS.STABILIZING;
  if (score < BAND_STABILIZING_MIN) {
    id = STABILITY_IDS.EXPOSED;
  } else if (score >= BAND_FORTIFIED_MIN) {
    id = STABILITY_IDS.FORTIFIED;
  }

  const label =
    id === STABILITY_IDS.EXPOSED
      ? 'Exposed'
      : id === STABILITY_IDS.FORTIFIED
        ? 'Fortified'
        : 'Steady';

  const urgency =
    id === STABILITY_IDS.EXPOSED ? 'high' : id === STABILITY_IDS.FORTIFIED ? 'low' : 'moderate';

  const debtDenomForBuffer =
    debtRemaining > 0 ? Math.max(debtRemaining, MIN_DEBT_FOR_BUFFER_RATIO) : null;
  const bufferRawRatioForModel =
    debtRemaining > 0 && debtDenomForBuffer != null
      ? Math.max(0, effectiveCushion) / debtDenomForBuffer
      : null;

  return {
    id,
    label,
    score,
    urgency,
    scoring: {
      bands: {
        exposed: `score < ${BAND_STABILIZING_MIN}`,
        /* key = liquidity id stabilizing; user-facing band name Steady */
        stabilizing: `${BAND_STABILIZING_MIN} <= score < ${BAND_FORTIFIED_MIN}`,
        fortified: `score >= ${BAND_FORTIFIED_MIN}`,
      },
      runwayPoints: Math.round(runwayPoints * 10) / 10,
      bufferPoints: Math.round(bufferPoints * 10) / 10,
      runwayCap: RUNWAY_POINTS_CAP,
      bufferCap: BUFFER_POINTS_CAP,
      runwayMonthsAtCap: RUNWAY_MONTHS_AT_CAP,
      legacyFallback,
      legacyFallbackLiquidWeight: legacyFallback ? LEGACY_FALLBACK_LIQUID_WEIGHT : null,
      guard: guardKind,
      /** Pre-guard sum of runway + buffer points (capped at 100 before rounding). */
      scoreBeforeGuards: Math.round(Math.min(100, runwayPoints + bufferPoints) * 10) / 10,
      debug: {
        runwayContribution: Math.round(runwayPoints * 10) / 10,
        bufferContribution: Math.round(bufferPoints * 10) / 10,
        bufferRawRatio: bufferRawRatioForModel == null ? null : Math.round(bufferRawRatioForModel * 10000) / 10000,
        scoreAfterComponents: Math.round(Math.min(100, runwayPoints + bufferPoints) * 10) / 10,
        guardApplied: guardKind,
      },
    },
    effectiveRunwayMonths:
      effectiveRunwayMonths == null ? null : Math.round(effectiveRunwayMonths * 100) / 100,
    monthsAheadYnab:
      input.monthsAheadYnab == null || !Number.isFinite(n(input.monthsAheadYnab))
        ? null
        : Math.round(n(input.monthsAheadYnab) * 100) / 100,
    components: {
      ynabSafetyLiquid: Math.round(ynabLiquidForStability * 100) / 100,
      ynabTotalAssets: Math.round(totalAssetsAll * 100) / 100,
      brokerageCash: Math.round(brCash * 100) / 100,
      brokerageHoldings: Math.round(brHold * 100) / 100,
      investedCredit: Math.round(investedCredit * 100) / 100,
      effectiveCushion: Math.round(effectiveCushion * 100) / 100,
      bufferVsDebt: bufferVsDebt == null ? null : Math.round(bufferVsDebt * 10000) / 10000,
      monthlyExpenses: Math.round(monthlyExpenses * 100) / 100,
      investedWeightUsed: INVESTED_WEIGHT,
    },
  };
}

/** Maps debt tier id to narrative pressure group. "stabilizing" here is the debt tier (badge 05), not liquidity id. */
function debtPressureGroup(tierId) {
  const t = tierId || '';
  if (t === 'wealthy') return 'debt_free';
  if (['rock_bottom', 'broke', 'struggling'].includes(t)) return 'high';
  if (['surviving', 'stabilizing', 'stable'].includes(t)) return 'mid';
  if (['building', 'thriving', 'winning'].includes(t)) return 'low';
  return 'mid';
}

/**
 * Narrative lines: debt tier stays primary; copy varies by debt-pressure group × liquidity band.
 * @param {string} debtTierId debt tier id (e.g. tier "stabilizing" = badge 05 is unrelated to liquidity label Steady)
 * @param {{ id: string }} stability liquidity result; id is exposed | stabilizing (→ Steady in UI) | fortified
 */
function stabilityNarrative(debtTierId, stability) {
  const { id } = stability;
  const group = debtPressureGroup(debtTierId);

  /**
   * Each inner key is liquidity stability.id (stabilizing = middle band, UI label Steady).
   * @type {Record<string, Record<string, { lead: string, mood: string, recommend: string }>>}
   */
  const byGroup = {
    debt_free: {
      exposed: {
        lead:
          'No debt is one milestone; months of spendable cushion is another — Steward keeps those on separate lines on purpose.',
        mood:
          'You can owe nothing and still have thin cash savings when wealth is mostly invested or not spendable yet. That is two different questions, not a mistake in the numbers.',
        recommend:
          'Grow breathing room until it is off Exposed; that is when stretching lifestyle or taking new risk gets safer.',
      },
      stabilizing: {
        lead: 'Debt behind you. Now build the floor.',
        mood: 'Escape mode is over. Intentional is what comes next.',
        recommend: 'Define a minimum cushion target so surplus does not quietly drift away.',
      },
      fortified: {
        lead: 'Debt is behind you — cushion is now about optionality, not survival.',
        mood: 'Breathing room supports choices instead of only absorbing shocks.',
        recommend: 'Keep a deliberate cash policy as you deploy capital elsewhere.',
      },
    },
    high: {
      exposed: {
        lead: 'Debt is still very large — and cash safety is not yet matching the risk.',
        mood: 'Every month is still a tightrope; breathing room has to rise alongside paydown.',
        recommend: '~$94/mo closes this stage in a year. Keep a cash floor \u2014 don\u2019t strip it to look good on paper.',
      },
      stabilizing: {
        lead:
          'Heavy debt is still the main story. Breathing room is separate from the payoff bar — and it is starting to soften the month-to-month edge.',
        mood: 'You are still deep in it — yet cash is buying a little room to think.',
        recommend: 'Let the cushion grow slowly; do not zero it out for speed without a plan.',
      },
      fortified: {
        lead: 'The debt leads. Cash is starting to follow.',
        mood: 'Heavy balances remain — still, you have maneuvering room other households do not.',
        recommend: 'Use the cushion to avoid new debt while you keep the payoff rhythm.',
      },
    },
    mid: {
      exposed: {
        lead: 'You have moved the debt — but the safety net is still catching up.',
        mood: 'Momentum on the balance can hide how thin cash still is month to month.',
        recommend: 'Steer a rising share of freed cash into liquid savings, not only the next payment.',
      },
      stabilizing: {
        lead: 'Debt is still material, but savings are changing how each month feels.',
        mood: 'Pressure is real, yet the floor is firmer than the debt total alone suggests.',
        recommend: 'Pair steady paydown with a growing guardrail you do not raid casually.',
      },
      fortified: {
        lead: 'Debt is still on the board, but your cushion is doing real defensive work.',
        mood: 'You can weather a surprise without instantly reaching for plastic.',
        recommend: 'Keep liquidity intentional; only drain it for paydown when the trade is obvious.',
      },
    },
    low: {
      exposed: {
        lead: 'You are in the home stretch on debt — do not let cash run that close to empty.',
        mood: 'The end is visible; a thin cushion here is mostly about avoiding a dumb finish.',
        recommend: 'Hold enough liquidity to finish clean without a last-minute scramble.',
      },
      stabilizing: {
        lead: 'The last stretch of debt meets a cushion that is finally cooperating.',
        mood: 'Small balance left, and savings are making the exit calmer than it looks on paper.',
        recommend: 'Finish the payoff without starving the account that prevents relapse.',
      },
      fortified: {
        lead: 'Near-zero debt with real liquidity — that is the hand you wanted to be dealt.',
        mood: 'The remaining balance is a detail; the floor underneath is what makes it sustainable.',
        recommend: 'Plan the month after payoff so cash does not wander without a job.',
      },
    },
  };

  const block = byGroup[group] || byGroup.mid;
  const row = block[id] || byGroup.mid[id];

  return {
    lead: row.lead,
    mood: row.mood,
    recommend: row.recommend,
  };
}

module.exports = {
  computeStability,
  stabilityNarrative,
  debtPressureGroup,
  bufferPointsFromCushionDebt,
  breathingRoomGoalFields,
  STABILITY_IDS,
  INVESTED_WEIGHT,
  LEGACY_FALLBACK_LIQUID_WEIGHT,
  RUNWAY_POINTS_CAP,
  RUNWAY_MONTHS_AT_CAP,
  BUFFER_POINTS_CAP,
  BAND_STABILIZING_MIN,
  BAND_FORTIFIED_MIN,
  BUFFER_RATIO_REFERENCE,
  MIN_DEBT_FOR_BUFFER_RATIO,
  GUARD_EXPOSED_MAX_RUNWAY_MONTHS,
  GUARD_FORTIFIED_MIN_RUNWAY_MONTHS,
  BREATHING_ROOM_GOAL_MONTHS,
};
