'use strict';

import { TIER_FLOW, TIER_META } from './tiers.js';
import {
  formatRunway, formatNextTierGapHeadline,
  formatPaidDownDisplay, cumulativePaidDownFromStats,
  paidDownDetailTooltip,
  debtTierBandBarDisplay, syncDebtTierBandDebugOverlay,
} from './format.js';
import { upgradeDashboardLayout, applyDashboardTheme, setupHeroInteraction } from './layout.js';
import { renderHeroBlock } from './render-hero.js';
import {
  fillVnextHeroTurnAccounts, fillThisTurnPanel, renderStatsBlock,
} from './render-stats.js';
import { fillProgressNarrative } from './render-progress.js';
import {
  refreshDebtPanelData, setDebtSortMode, toggleAprForm, fillDebtAccountsList, renderPayThisNext,
} from './render-debts.js';
import { maybePlayCutscene } from './cutscene.js';
import { renderCalculator } from './render-calculator.js';
import { renderStrategyLab } from './strategy-lab.js';
import { setWhatIfBasis } from './views/networth-chart.js';
import { maybeCelebrateCleared } from './celebration.js';

export { refreshDebtPanelData, setDebtSortMode, toggleAprForm };

let lastRenderedCumulativePaidDown = null;

export function render(status, snapshots) {
  if (!status.ready) return;

  upgradeDashboardLayout();

  const { tier, stats, nextTier, meta, stability } = status;
  const theme = TIER_META[tier.id] || TIER_FLOW[0];
  /* If API omits stability, assume middle liquidity band (id stabilizing, label Steady). */
  const stab = stability || { id: 'stabilizing', label: 'Steady', narrative: {} };
  const runwayText = formatRunway(stats.monthsAhead);
  const paidShown = cumulativePaidDownFromStats(stats);
  const paidTooltip = paidDownDetailTooltip(stats);
  const paidDisplay = formatPaidDownDisplay(paidShown, paidTooltip);
  /* Dollars headline = primary product signal; in-band bar width uses inBandBarDisplayPct only (secondary). */
  const { rawPct: tierBarRawInBandPct, displayPct: inBandBarDisplayPct } = debtTierBandBarDisplay(stats);
  syncDebtTierBandDebugOverlay(stats, tierBarRawInBandPct, inBandBarDisplayPct);
  const gapHeadline = formatNextTierGapHeadline(nextTier);

  applyDashboardTheme(tier.id, stab.id);
  setupHeroInteraction();

  renderHeroBlock({
    status, tier, theme, stab, nextTier, meta,
    paidDisplay, runwayText, gapHeadline, inBandBarDisplayPct, stats,
  });

  fillProgressNarrative({
    nextTier,
    snapshots,
    theme,
    stability: stab,
    meta,
    stats,
    recentMilestones: status.recentMilestones,
  });

  fillVnextHeroTurnAccounts(stats);

  renderStatsBlock({
    status, stats, stab, meta, tier, nextTier,
    paidDisplay, paidShown,
    prevPaidDown: lastRenderedCumulativePaidDown,
    runwayText, inBandBarDisplayPct,
  });

  fillDebtAccountsList(stats);
  renderPayThisNext(stats);
  fillThisTurnPanel(stats);
  renderCalculator(stats);
  renderStrategyLab(stats);
  // Exact-amortization basis for the chart panel's what-if slider — lets it
  // work from the user's average payment even when no chart projection is up.
  setWhatIfBasis(stats);

  // "Account CLEARED" — one-shot celebration armed by the snapshot route.
  maybeCelebrateCleared(status);

  // Personal easter egg (cutscene user only): the server arms it when one
  // balance update clears $500+ of debt; plays once, then cutscene-seen.
  // (An old comment here said "every 75th login" — that trigger never shipped.)
  maybePlayCutscene(status);

  if (typeof window.stewardVnextEnhance === 'function') {
    window.stewardVnextEnhance({
      tier, stats, nextTier, meta, stability: stab, snapshots,
      streak: status.streak, correctedDebtSeries: status.correctedDebtSeries,
      aiEnabled: status.aiEnabled,
    });
  }

  lastRenderedCumulativePaidDown = paidShown;
}
