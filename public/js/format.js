'use strict';

import { TIER_FLOW, TIER_META } from './tiers.js';

/* ── Dollar / number / date formatters ──────────────────────────── */

export function formatRunway(monthsAhead) {
  if (monthsAhead == null) return '--';
  if (monthsAhead < 1) {
    return '< 1 month of expenses';
  }
  return `${monthsAhead.toFixed(1)} months of expenses`;
}

export function fmt(n) {
  if (n == null) return '--';
  return Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function fmtDollar(n, opts = {}) {
  if (n == null) return '--';
  const abs = Math.abs(n);
  const str = '$' + abs.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return n < 0 && !opts.absOnly ? '-' + str : str;
}

export function fmtSignedDollar(n) {
  if (n == null || !Number.isFinite(n)) return '--';
  if (n > 0) return '+' + fmtDollar(n);
  return fmtDollar(n);
}

export function fmtDate(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeAgo(iso) {
  if (!iso) return '--';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(ms / 3600000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatNetWorthValue(value) {
  return (value < 0 ? '-' : '') + '$' + Math.abs(value).toLocaleString('en-US', {
    maximumFractionDigits: 0,
  });
}

/* ── Tier gap / headline formatters ─────────────────────────────── */

/**
 * Whole-dollar UI amounts: if a positive value would display as $0 via fmtDollar, show "< $1" instead.
 */
export function formatNextTierGapMoneyPrefix(gapDollars) {
  const g = Number(gapDollars);
  if (!Number.isFinite(g) || g <= 0) return fmtDollar(0);
  const rounded = fmtDollar(g);
  if (rounded === '$0') return '< $1';
  return rounded;
}

export function resolveTierLabelForEscapeHeadline(currentTier) {
  if (!currentTier) return 'this stage';
  if (typeof currentTier === 'string') {
    const meta = TIER_META[currentTier];
    if (meta && meta.label) return meta.label;
    const fromFlow = TIER_FLOW.find(t => t.id === currentTier);
    if (fromFlow && fromFlow.label) return fromFlow.label;
    return 'this stage';
  }
  if (typeof currentTier === 'object' && currentTier.label) return currentTier.label;
  return 'this stage';
}

/** Primary payoff line for UI: dollars to escape the current payoff stage (bar fill is secondary). */
export function formatNextTierGapHeadline(nextTier, currentTier) {
  if (!nextTier) return 'Final payoff stage — no dollars left to the next threshold';
  const g = Number(nextTier.gapDollars);
  if (!Number.isFinite(g) || g < 0) return 'Final payoff stage — no dollars left to the next threshold';
  const tierLabel = resolveTierLabelForEscapeHeadline(currentTier);
  const money = formatNextTierGapMoneyPrefix(g);
  if (g === 0) {
    return money === '$0' ? `At the threshold — next: ${nextTier.label}` : `${money} to escape ${tierLabel}`;
  }
  return `${money} to escape ${tierLabel}`;
}


/** Coach line under the in-stage progress bar (no new server math). */
export function nextMoveGuidance(nextTier) {
  if (!nextTier) return '';
  const g = Number(nextTier.gapDollars);
  if (!Number.isFinite(g) || g <= 0) return '';
  const money = formatNextTierGapMoneyPrefix(g);
  if (money === '$0' || money === '< $1') {
    return 'A small payment today moves you forward.';
  }
  return 'Even $25 today reduces the gap.';
}

/* ── Breathing room / liquidity ─────────────────────────────────── */

export const TOOLTIP_ASSET_RUNWAY = '';

/** Spendable-style cushion ÷ expenses; same signal as the Breathing room chip (Exposed / Steady / Fortified). */
export const TOOLTIP_LIQUID_CUSHION_RUNWAY =
  'Breathing-room runway: spendable-style cushion ÷ monthly expenses. Same basis as the chip—not asset runway in the grid. Breathing Room product goal: 2.0 mo on this same runway.';

/**
 * Breathing Room goal: same formula as `breathingRoomGoalFields` in services/stability.js.
 * Uses `breathingRoomGoalMonths` from API when present; `effectiveRunwayMonths` is the runway signal.
 * @returns {{ goalMonths: number, reached: boolean, gapMonths: number|null, runwayMonths: number|null }}
 */
export function resolveBreathingRoomGoalState(stab) {
  const goalDefault = 2.0;
  const goal =
    stab && Number.isFinite(Number(stab.breathingRoomGoalMonths))
      ? Number(stab.breathingRoomGoalMonths)
      : goalDefault;
  const rawM = stab && stab.effectiveRunwayMonths;
  if (rawM == null || !Number.isFinite(Number(rawM))) {
    return { goalMonths: goal, reached: false, gapMonths: null, runwayMonths: null };
  }
  const runwayMonths = Number(rawM);
  const reached = runwayMonths >= goal;
  return {
    goalMonths: goal,
    reached,
    gapMonths: reached ? 0 : Math.round((goal - runwayMonths) * 100) / 100,
    runwayMonths,
  };
}

export function formatHeroBreathingRoomLine(stab) {
  const br = resolveBreathingRoomGoalState(stab);
  if (br.runwayMonths == null) {
    return `Target: ${br.goalMonths.toFixed(1)} mo Breathing Room.`;
  }
  if (br.reached) {
    return `${br.runwayMonths.toFixed(1)} mo spendable cushion — Breathing Room goal reached (${br.goalMonths.toFixed(1)} mo).`;
  }
  const gapStr =
    br.gapMonths != null && Number.isFinite(br.gapMonths) ? br.gapMonths.toFixed(1) : (br.goalMonths - br.runwayMonths).toFixed(1);
  return `${br.runwayMonths.toFixed(1)} mo cushion · ${gapStr} mo to Breathing Room (${br.goalMonths.toFixed(1)} mo).`;
}

export function formatBoardRunwayHelperLine(monthsAheadYnab, stab) {
  const ynab = formatRunway(monthsAheadYnab);
  const br = resolveBreathingRoomGoalState(stab);
  let primary;
  if (br.runwayMonths == null) {
    primary = `Breathing Room goal is ${br.goalMonths.toFixed(1)} mo spendable cushion.`;
  } else if (br.reached) {
    primary = `Breathing room runway: ${br.runwayMonths.toFixed(1)} mo spendable cushion — Breathing Room goal reached (${br.goalMonths.toFixed(1)} mo target).`;
  } else {
    const gapStr =
      br.gapMonths != null && Number.isFinite(br.gapMonths) ? br.gapMonths.toFixed(1) : (br.goalMonths - br.runwayMonths).toFixed(1);
    primary = `Breathing room runway: ${br.runwayMonths.toFixed(1)} mo spendable cushion · ${gapStr} mo to goal (${br.goalMonths.toFixed(1)} mo).`;
  }
  return primary;
}

/** Hero primary line when payoff stage is max (Debt Free) but breathing room is Exposed. */
export const WEALTHY_EXPOSED_HERO_PRIMARY =
  'No debt. Thin cushion — protect the win.';

export function liquidityGuardExplanation(guard) {
  if (guard === 'exposed_floor') {
    return 'Breathing room covers less than about one month of expenses, so Steward keeps this in Exposed.';
  }
  if (guard === 'fortified_floor') {
    return 'Breathing room covers several months of expenses, so Steward places this in Fortified.';
  }
  return '';
}

export function buildLiquidityPillTooltip(stab) {
  const br = resolveBreathingRoomGoalState(stab);
  const goalLine = `Breathing Room product goal: ${br.goalMonths.toFixed(1)} mo on this same spendable-cushion runway.`;
  const bits = [
    'Payoff stage shows debt progress; this chip is breathing room (liquidity) only.',
    'Breathing room is spendable-style cushion ÷ monthly expenses.',
    goalLine,
    stab.score != null
      ? `Liquidity score ${stab.score}/100 combines months of cover with cushion versus debt.`
      : null,
    liquidityGuardExplanation(stab.scoring && stab.scoring.guard),
    stab.scoring && stab.scoring.legacyFallback
      ? 'Using a broader asset estimate until the next pull; refresh when you can.'
      : null,
  ];
  return bits.filter(Boolean).join(' ');
}

/* ── Paid-down / cumulative progress ────────────────────────────── */

/** Shared cumulative-paydown line for tooltips (hero + financial board). */
export const CUMULATIVE_PROGRESS_SUBTEXT = 'Total debt reduced since tracking began.';

/**
 * Paid-down headline: avoid a bare "$0" that reads like failure; real dollars stay in the tooltip.
 * Hero label stays "Your climb"; financial board omits the repeat label (value + tooltip unchanged).
 */
export function formatPaidDownDisplay(paidShown, paidTooltip) {
  const n = Number(paidShown);
  if (!Number.isFinite(n) || n <= 0) {
    return {
      text: 'Start your climb',
      title: `${CUMULATIVE_PROGRESS_SUBTEXT}\n\n${paidTooltip}\n\nTracked so far: $0 — your first balance reduction will show here.`,
    };
  }
  return { text: `You've reduced ${fmtDollar(n)}`, title: `${CUMULATIVE_PROGRESS_SUBTEXT}\n\n${paidTooltip}` };
}

/* ── Debt tier band % ───────────────────────────────────────────── */

/** Match `DEBT_TIER_BAND_PCT_DECIMALS` in services/tiers.js (band bar + labels). */
export function roundDebtTierBandPctClient(pct) {
  if (pct === null || pct === undefined || pct === '') return NaN;
  const n = Number(pct);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;
}

/**
 * Debt band completion % for bars: `stats.debtTierBandPct` from `/api/status` is the source of truth.
 * Same as server: 0% at band upper, 100% at next-tier threshold — `(bandUpper - debtRemaining) / span`
 * in the interior band (`debtTierBandProgress` in tiers.js).
 * Fallback (older responses / bad scalar): recompute from `stats.debtTierBand` + `debtRemaining`,
 * then `debtTierBand.pctInBand`, else 0.
 */
export function debtTierBandDisplayPct(stats) {
  const fromApi = roundDebtTierBandPctClient(stats.debtTierBandPct);
  if (Number.isFinite(fromApi)) return fromApi;

  const remN = Number(stats.debtRemaining);
  const debtRemaining = Number.isFinite(remN) ? remN : 0;
  const band = stats.debtTierBand;
  if (band) {
    const bl = band.bandLower;
    const bu = band.bandUpper;
    if (bl != null && bu != null && Number.isFinite(bl) && Number.isFinite(bu)) {
      const span = Math.max(bu - bl, 1);
      let raw;
      if (debtRemaining >= bu) raw = 0;
      else if (debtRemaining <= bl) raw = 100;
      else raw = ((bu - debtRemaining) / span) * 100;
      const pct = roundDebtTierBandPctClient(raw);
      if (Number.isFinite(pct)) return pct;
    }
    const fb = roundDebtTierBandPctClient(band.pctInBand);
    if (Number.isFinite(fb)) return fb;
  }
   return 0;
}

/**
 * In-band bar width only (secondary visual); dollars headline is separate. Applies a minimum visible floor so tiny in-band % is not shown as 0.0%.
 * `rawPct` matches `debtTierBandDisplayPct` (API / fallback). `trueRaw` is completion % (same as server).
 *
 * Rules: if debtRemaining < bandUpper and (true raw > 0 or rawPct > 0), displayPct = max(rawPct, 1.0);
 * if debtRemaining >= bandUpper, displayPct = rawPct (typically 0).
 */
export function debtTierBandBarDisplay(stats) {
  const rawPct = debtTierBandDisplayPct(stats);
  const remN = Number(stats.debtRemaining);
  const debtRemaining = Number.isFinite(remN) ? remN : 0;
  const band = stats.debtTierBand;

  let bandUpper = null;
  let trueRaw = NaN;
  if (band && Number.isFinite(band.bandLower) && Number.isFinite(band.bandUpper)) {
    bandUpper = band.bandUpper;
    const bl = band.bandLower;
    const span = Math.max(bandUpper - bl, 1);
    if (debtRemaining >= bandUpper) trueRaw = 0;
    else if (debtRemaining <= bl) trueRaw = 100;
    else trueRaw = ((bandUpper - debtRemaining) / span) * 100;
  } else if (band?.pctInBandRaw != null && Number.isFinite(band.pctInBandRaw)) {
    trueRaw = band.pctInBandRaw;
    bandUpper = Number.isFinite(band.bandUpper) ? band.bandUpper : null;
  }

  let displayPct = rawPct;
  if (Number.isFinite(bandUpper)) {
    if (debtRemaining < bandUpper) {
      const hasProgress =
        (Number.isFinite(trueRaw) && trueRaw > 0) || (Number.isFinite(rawPct) && rawPct > 0);
      if (hasProgress) {
        displayPct = Math.min(100, Math.max(rawPct, 1.0));
        displayPct = Math.round(displayPct * 10) / 10;
      }
    }
  }

  return { rawPct, displayPct };
}

/** Temporary: fixed overlay when `?debugDebtTier=1` — remove when team is done validating. */
export function syncDebtTierBandDebugOverlay(stats, rawPct, displayPct) {
  let enabled = false;
  try {
    enabled = new URLSearchParams(window.location.search).get('debugDebtTier') === '1';
  } catch {
    enabled = false;
  }
  const id = 'steward-debt-tier-debug-overlay';
  let el = document.getElementById(id);
  if (!enabled) {
    if (el) el.remove();
    document.getElementById('hero-band-debug')?.remove();
    return;
  }
  const band = stats.debtTierBand || {};
  const rem = Number(stats.debtRemaining);
  const debtRemaining = Number.isFinite(rem) ? rem : stats.debtRemaining;
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.setAttribute('role', 'status');
    el.style.cssText = [
      'position:fixed',
      'bottom:12px',
      'right:12px',
      'z-index:99999',
      'max-width:min(92vw,320px)',
      'padding:10px 12px',
      'border-radius:8px',
      'font:12px/1.4 ui-monospace,monospace',
      'color:#e8eaed',
      'background:rgba(18,22,28,0.92)',
      'border:1px solid rgba(255,255,255,0.12)',
      'box-shadow:0 8px 24px rgba(0,0,0,0.35)',
      'white-space:pre-wrap',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(el);
  }
  const rawN = Number(rawPct);
  const dispN = Number(displayPct);
  el.textContent = [
    '[debt band fill · debug only · dollars-to-next-payoff-stage headline]',
    `bandLower: ${band.bandLower ?? '—'}`,
    `bandUpper: ${band.bandUpper ?? '—'}`,
    `debtRemaining: ${debtRemaining}`,
    `rawPct: ${Number.isFinite(rawN) ? rawN.toFixed(1) : '—'}`,
    `displayPct: ${Number.isFinite(dispN) ? dispN.toFixed(1) : '—'}`,
    `API stats.debtTierBandPct: ${stats.debtTierBandPct ?? '—'}`,
  ].join('\n');
}

/* ── Snapshot analysis ──────────────────────────────────────────── */

/** Mirrors server tier logic: up to 4 newest snapshots, oldest vs newest. */
export function snapshotPaydownWindow(snapshots) {
  if (!snapshots || snapshots.length < 2) {
    return { avgMonthly: null, windowMonths: 0, oldest: null, newest: snapshots?.[0] || null };
  }
  const usable = snapshots.slice(0, Math.min(4, snapshots.length));
  const newest = usable[0];
  const oldest = usable[usable.length - 1];
  const ms = new Date(newest.pulled_at).getTime() - new Date(oldest.pulled_at).getTime();
  const windowMonths = ms / (1000 * 60 * 60 * 24 * 30.44);
  const delta = oldest.debt_remaining - newest.debt_remaining;
  const avgMonthly = windowMonths > 0 ? delta / windowMonths : null;
  return { avgMonthly, windowMonths, oldest, newest, delta };
}

/**
 * Adjacent snapshot segments disagree materially (mixed paydown/add-borrow, huge CV, or bad timestamps).
 * Needs ≥3 snapshots (2 segments); with only two pulls we do not flag noise.
 */
export function snapshotPaceIsNoisy(snapshots) {
  if (!snapshots || snapshots.length < 3) return false;
  const usable = snapshots.slice(0, Math.min(4, snapshots.length));
  const rates = [];
  for (let i = 0; i < usable.length - 1; i++) {
    const newer = usable[i];
    const older = usable[i + 1];
    const ms = new Date(newer.pulled_at).getTime() - new Date(older.pulled_at).getTime();
    if (ms <= 0) return true;
    const monthsBetween = ms / (1000 * 60 * 60 * 24 * 30.44);
    const paydown = older.debt_remaining - newer.debt_remaining;
    rates.push(paydown / monthsBetween);
  }
  if (rates.length < 2) return false;
  const anyPos = rates.some(r => r > 0);
  const anyNonPos = rates.some(r => r <= 0);
  if (anyPos && anyNonPos) return true;
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  if (mean <= 0) return false;
  const variance = rates.reduce((acc, r) => acc + (r - mean) ** 2, 0) / rates.length;
  const std = Math.sqrt(variance);
  const cv = std / mean;
  return cv > 0.85;
}

/** User-facing ~duration from a fractional month count (no calendar dates). */
export function formatApproxDurationFromMonths(months) {
  if (!Number.isFinite(months) || months <= 0) return null;
  const weeksPerMonth = 365.25 / 12 / 7;
  if (months < 1.5) {
    const w = Math.max(1, Math.round(months * weeksPerMonth));
    return w === 1 ? '~1 week' : `~${w} weeks`;
  }
  if (months < 24) {
    const m = Math.max(1, Math.round(months));
    return m === 1 ? '~1 month' : `~${m} months`;
  }
  const y = Math.round((months / 12) * 10) / 10;
  return y === 1 ? '~1 year' : `~${y} years`;
}

export function snapshotDeltaSinceOldest(snapshots) {
  if (!snapshots || snapshots.length < 2) {
    return { delta: null, oldest: snapshots?.[snapshots.length - 1] || null };
  }
  const newest = snapshots[0];
  const oldest = snapshots[snapshots.length - 1];
  return { delta: oldest.debt_remaining - newest.debt_remaining, oldest, newest };
}

export function paceQualitative(avgMonthly) {
  if (avgMonthly == null || Number.isNaN(avgMonthly)) return '';
  if (avgMonthly <= 0) return 'Recent pace: flat or backward — check categories and pull timing.';
  if (avgMonthly < 150) return 'Pace is slow but net down.';
  if (avgMonthly < 600) return 'Pace is solid.';
  return 'Pace is strong.';
}

/* ── Cumulative climb ───────────────────────────────────────────── */

/**
 * Cumulative paydown from GET /api/status (`cumulativePaidDown`). Server persists monotonic
 * totals on each snapshot — do not merge with snapshots here.
 */
export function cumulativePaidDownFromStats(stats) {
  const raw = stats.cumulativePaidDown ?? stats.debtPaid;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/**
 * Lifetime progress % for display only: cumulativePaidDown / climbBaselineDebt.
 * Does not use current debt remaining or (baseline − current), so adding new debt does not reduce this %.
 */
export function lifetimeProgressPctFromCumulative(stats) {
  const paid = cumulativePaidDownFromStats(stats);
  const baseline = Number(stats && stats.climbBaselineDebt);
  if (!Number.isFinite(baseline) || baseline <= 0) return 0;
  return Math.min(100, parseFloat(((paid / baseline) * 100).toFixed(1)));
}

/**
 * Presentation-only: net flow as new debt minus paydown (same sign convention for cumulative and last-pull lines).
 */
export function formatClimbNetChangeDollars(newDebt, paydown) {
  const nd = Number(newDebt);
  const pd = Number(paydown);
  const n = (Number.isFinite(nd) ? nd : 0) - (Number.isFinite(pd) ? pd : 0);
  return fmtDollar(n);
}

/** Signed change in debt magnitude for one account (+ more debt, − paydown). */
export function fmtSignedDebtDelta(n) {
  if (n == null || !Number.isFinite(n)) return '--';
  const abs = Math.abs(Math.round(n));
  const str = '$' + abs.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n > 0) return '+' + str;
  if (n < 0) return '-' + str;
  return '$0';
}

/** One line under "This turn" — uses `kind` when present so new vs bumped reads clearly. */
export function formatLastPullAccountRow(r) {
  const deltaStr = fmtSignedDebtDelta(Number(r && r.delta));
  const name = r && typeof r.name === 'string' ? r.name.trim() : '';
  const base = name ? `${name}: ${deltaStr}` : deltaStr;
  const k = r && r.kind;
  if (k === 'new') return `${name} (new): ${deltaStr}`;
  if (k === 'removed') return `${name} (off the map): ${deltaStr}`;
  return base;
}

export function formatNetThisTurnLine(netThisTurn) {
  const n = Number(netThisTurn);
  if (!Number.isFinite(n)) return 'Net this turn: —';
  if (n > 0) return `Net this turn: +${fmtDollar(n)} debt`;
  if (n < 0) return `Net this turn: ${fmtDollar(n)} toward paydown`;
  return 'Net this turn: $0';
}

/** Shared parse for last-pull account lines + rollups (hero + progress "This turn"). */
export function lastPullAccountRowsFromStats(stats) {
  if (!stats) {
    return { accountLines: [], ndVal: 0, pdVal: 0 };
  }
  const nd = Number(stats.lastPullNewDebtSum);
  const pd = Number(stats.lastPullPaydownSum);
  const ndVal = Number.isFinite(nd) && nd >= 0 ? nd : 0;
  const pdVal = Number.isFinite(pd) && pd >= 0 ? pd : 0;
  const rawLines = stats.lastPullAccountChanges ?? stats.lastPullAccountLines;
  const accountLines = Array.isArray(rawLines)
    ? rawLines.filter(
        (r) => r && typeof r.name === 'string' && r.name.length > 0 && Number.isFinite(Number(r.delta))
          // A removed account is not a payment — exclude it from "This Turn" so it
          // isn't shown (and summed) as green progress. Matches cumulative
          // paid-down, which also ignores removals.
          && r.kind !== 'removed',
      )
    : [];
  return { accountLines, ndVal, pdVal };
}

/** Tooltip for hero + stat: explains paydown vs new debt vs net. */
export function paidDownDetailTooltip(stats) {
  const pct = lifetimeProgressPctFromCumulative(stats);
  const baseline = Number(stats.climbBaselineDebt);
  const lines = [
    `Lifetime progress: ${pct}% of baseline — computed only from cumulative paydown ÷ climb baseline (not from current debt or baseline − remaining).`,
  ];
  if (Number.isFinite(baseline) && baseline > 0) {
    lines.push(`Baseline (peak anchor): ${fmtDollar(baseline)}.`);
  }
  lines.push(
    'Cumulative paydown: sum of decreases in total tracked debt between snapshots (never decreases). ' +
    'Interest is already reflected — the balance fell by this much after it was added — so it is not subtracted again.',
  );
  const nd = Number(stats.cumulativeNewDebtAdded);
  const net = Number(stats.netImprovement);
  if (Number.isFinite(nd) && nd > 0) {
    lines.push(`New debt tracked (running total when total debt rises between pulls): ${fmtDollar(nd)}.`);
  }
  if (Number.isFinite(net)) {
    lines.push(`Net vs new (paydown minus new debt total): ${fmtDollar(net)} — informational; does not change lifetime % above.`);
  }
  return lines.join('\n\n');
}
