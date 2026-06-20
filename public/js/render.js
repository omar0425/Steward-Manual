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
import { fillProgressNarrative, renderNetWorthClimb } from './render-progress.js';
import {
  refreshDebtPanelData, setDebtSortMode, toggleAprForm, fillDebtAccountsList, renderPayThisNext,
} from './render-debts.js';

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
  const gapHeadline = formatNextTierGapHeadline(nextTier, tier);

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

  renderNetWorthClimb(status.netWorthHistory);

  fillDebtAccountsList(stats);
  renderPayThisNext(stats);
  fillThisTurnPanel(stats);

  if (typeof window.stewardVnextEnhance === 'function') {
    window.stewardVnextEnhance({ tier, stats, nextTier, meta, stability: stab, snapshots, streak: status.streak });
  }

  lastRenderedCumulativePaidDown = paidShown;
}
