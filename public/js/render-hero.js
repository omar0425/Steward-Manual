'use strict';

import { tierBehaviorLine } from './tiers.js';
import { isClassicLayoutDashboardDoc, isPlayDashboardDoc } from './shell.js';
import {
  fmtDollar,
  formatNextTierGapHeadline,
  formatNextTierGapMoneyPrefix,
  TOOLTIP_LIQUID_CUSHION_RUNWAY,
  WEALTHY_EXPOSED_HERO_PRIMARY,
  formatHeroBreathingRoomLine,
  liquidityGuardExplanation, buildLiquidityPillTooltip,
  cumulativePaidDownFromStats, formatClimbNetChangeDollars,
  fmtSignedDebtDelta,
} from './format.js';
import { renderTierRail } from './layout.js';
import { mountHeroCharacter } from './character.js';

/**
 * Renders the upper hero region: badge/copy/stats, tier card with bar fill,
 * locked next-tier card (next-tier-current/target), tier-card gap headline,
 * and the character mount + tier rail.
 */
export function renderHeroBlock({
  status, tier, theme, stab, nextTier, classicDoc, meta,
  paidDisplay, runwayText, gapHeadline, inBandBarDisplayPct, stats,
}) {
  renderTierRail(tier.id, nextTier?.id);
  mountHeroCharacter(tier.id);

  const heroBadge = document.getElementById('hero-badge');
  const heroPhase = document.getElementById('hero-phase-pill');
  const heroLive = document.getElementById('hero-live-pill');
  const heroStabPill = document.getElementById('hero-stability-pill');
  const showcaseLink = document.querySelector('.showcase-link');

  if (heroBadge) {
    if (isPlayDashboardDoc()) {
      heroBadge.textContent = '';
      heroBadge.hidden = true;
    } else {
      heroBadge.textContent = classicDoc
        ? `Stage ${tier.badge} — ${tier.label}`
        : `Payoff stage: ${tier.badge} · ${tier.label}`;
    }
  }
  const heroStageTitleEl = document.getElementById('hero-stage-title');
  if (heroStageTitleEl) heroStageTitleEl.textContent = tier.label;
  /* Breathing room: visible wording from stab.label (Steady when stab.id is stabilizing); theme class uses id → .is-stabilizing. */
  if (heroStabPill) {
    heroStabPill.textContent = classicDoc ? `Runway: ${stab.label}` : `Breathing room: ${stab.label}`;
    heroStabPill.className = 'hero-stability-pill';
    heroStabPill.classList.add(`is-${stab.id}`);
    heroStabPill.title = buildLiquidityPillTooltip(stab);
  }

  const heroAxesHint = document.getElementById('hero-axes-hint');
  if (heroAxesHint) {
    heroAxesHint.textContent = classicDoc
      ? 'This card tracks what it takes to clear this stage.'
      : 'The headline on the card is your escape gap. The thin bar is only your position inside this stage—not breathing room or total debt paid down.';
  }
  const heroLiqRunwayEl = document.getElementById('hero-liquidity-runway');
  if (heroLiqRunwayEl) {
    const rw = formatHeroBreathingRoomLine(stab, classicDoc);
    heroLiqRunwayEl.textContent = rw || '';
    heroLiqRunwayEl.hidden = !rw;
    heroLiqRunwayEl.title = TOOLTIP_LIQUID_CUSHION_RUNWAY;
  }
  const heroGuardEl = document.getElementById('hero-guard-hint');
  if (heroGuardEl) {
    const gMsg = liquidityGuardExplanation(stab.scoring && stab.scoring.guard);
    heroGuardEl.textContent = gMsg || '';
    heroGuardEl.hidden = !gMsg;
  }
  if (heroPhase) heroPhase.textContent = `${theme.phase} phase`;
  if (heroLive) {
    heroLive.textContent = meta.freshness;
    heroLive.className = 'hero-live-pill';
    if (meta.freshness.startsWith('Stale')) heroLive.classList.add('is-stale');
    else if (meta.freshness.includes('h ago')) heroLive.classList.add('is-aged');
  }
  if (showcaseLink && classicDoc) showcaseLink.textContent = 'View all 10 stages';
  else if (showcaseLink) showcaseLink.textContent = 'Explore all 10 debt tiers';

  const heroTierLabelEl = document.getElementById('hero-tier-label');
  if (heroTierLabelEl) heroTierLabelEl.textContent = tier.label;
  const heroBehaviorEl = document.getElementById('hero-tier-behavior');
  if (heroBehaviorEl) {
    let behaviorLine = tierBehaviorLine(tier.id);
    if (classicDoc && tier.id === 'rock_bottom') {
      behaviorLine = 'Cut the balance. Protect cash.';
    }
    heroBehaviorEl.textContent = behaviorLine;
    heroBehaviorEl.hidden = !behaviorLine;
  }

  const heroNextActionEl = document.getElementById('hero-next-action');
  if (heroNextActionEl) {
    if (!classicDoc) {
      heroNextActionEl.textContent = '';
      heroNextActionEl.hidden = true;
    } else if (nextTier) {
      const g = Number(nextTier.gapDollars);
      if (Number.isFinite(g) && g > 0) {
        const money = formatNextTierGapMoneyPrefix(g);
        heroNextActionEl.textContent = `Next move: free up ${money}`;
        heroNextActionEl.hidden = false;
      } else {
        heroNextActionEl.textContent = '';
        heroNextActionEl.hidden = true;
      }
    } else {
      heroNextActionEl.textContent = '';
      heroNextActionEl.hidden = true;
    }
  }

  const narr = stab.narrative || {};
  const isWealthyExposed = tier.id === 'wealthy' && stab.id === 'exposed';
  const heroTierCopyEl = document.getElementById('hero-tier-copy');
  if (heroTierCopyEl) {
    if (isWealthyExposed) {
      heroTierCopyEl.textContent = WEALTHY_EXPOSED_HERO_PRIMARY;
    } else if (classicDoc && tier.id === 'rock_bottom') {
      heroTierCopyEl.textContent = "You're in the hole. The meter is running.";
    } else {
      heroTierCopyEl.textContent = tier.copy;
    }
  }
  const stabilityLeadEl = document.getElementById('hero-stability-lead');
  if (stabilityLeadEl) {
    let lead = narr.lead || '';
    if (
      classicDoc &&
      lead === 'Debt is still very large — and cash safety is not yet matching the risk.'
    ) {
      lead = "Debt is still high, and cash safety isn't there yet.";
    }
    stabilityLeadEl.textContent = lead;
  }
  const moodEl = document.getElementById('hero-mood-copy');
  if (moodEl) {
    if (isWealthyExposed) {
      moodEl.textContent = narr.mood;
    } else if (classicDoc && tier.id === 'rock_bottom') {
      moodEl.textContent =
        'Prioritize cash and minimums. Every dollar freed up moves you forward. Breathing room has to rise alongside payoff.';
    } else {
      moodEl.textContent = [theme.cue, narr.mood].filter(Boolean).join(' ');
    }
  }
  const heroPaid = document.getElementById('hero-stat-paid');
  if (heroPaid) {
    heroPaid.textContent = paidDisplay.text;
    heroPaid.title = paidDisplay.title;
  }
  const heroClimbSummary = document.getElementById('hero-climb-summary');
  const heroLineNew = document.getElementById('hero-climb-line-new-debt');
  const heroLinePd = document.getElementById('hero-climb-line-paydown');
  const heroLineNet = document.getElementById('hero-climb-line-net');
  if (heroClimbSummary && heroLineNew && heroLinePd && heroLineNet) {
    const addedRaw = Number(stats.cumulativeNewDebtAdded);
    if (Number.isFinite(addedRaw) && addedRaw > 0) {
      const paid = cumulativePaidDownFromStats(stats);
      const netDelta = addedRaw - paid;
      if (classicDoc) {
        heroLineNew.textContent = `Added this turn: ${fmtDollar(Math.round(addedRaw))}`;
        heroLinePd.textContent = `Paid down: ${fmtDollar(paid)}`;
        heroLineNet.textContent = `Net: ${fmtSignedDebtDelta(netDelta)} debt`;
      } else {
        heroLineNew.textContent = `New debt tracked: ${fmtDollar(Math.round(addedRaw))}`;
        heroLinePd.textContent = `Paydown (cumulative): ${fmtDollar(paid)}`;
        heroLineNet.textContent = `Net change: ${formatClimbNetChangeDollars(addedRaw, paid)}`;
      }
      heroClimbSummary.hidden = false;
    } else {
      heroLineNew.textContent = '';
      heroLinePd.textContent = '';
      heroLineNet.textContent = '';
      heroClimbSummary.hidden = true;
    }
  }
  const heroPaidLabel = document.querySelector('.hero-context-strip .hero-context-cell:first-child .hero-context-label');
  if (heroPaidLabel) {
    heroPaidLabel.textContent = 'Your climb';
  }
  const heroRunway = document.getElementById('hero-stat-runway');
  if (heroRunway) {
    heroRunway.textContent = runwayText;
    heroRunway.title = '';
  }

  // ── Tier card region (badge chip, name, gap headline, bar fill, footer) ──
  const cardBadgeChipEl = document.getElementById('card-badge-chip');
  if (cardBadgeChipEl) cardBadgeChipEl.textContent = tier.badge;
  const cardTierNameEl = document.getElementById('card-tier-name');
  if (cardTierNameEl) cardTierNameEl.textContent = tier.label;
  const cardTierGapHeadlineEl = document.getElementById('card-tier-gap-headline');
  if (cardTierGapHeadlineEl) cardTierGapHeadlineEl.textContent = gapHeadline;
  const heroEscapeEl = document.getElementById('hero-escape-primary');
  if (heroEscapeEl) heroEscapeEl.textContent = gapHeadline;

  const cardBarTrack = document.querySelector('.card-bar-track');
  if (cardBarTrack) {
    cardBarTrack.title =
      'Thin bar: position inside this payoff stage only. The prominent line above states your dollar gap to escape this stage.';
  }
  const cardBarFillEl = document.getElementById('card-bar-fill');
  if (cardBarFillEl) cardBarFillEl.style.width = `${inBandBarDisplayPct}%`;
  const cardBarInbandPct = document.getElementById('card-bar-inband-pct');
  if (cardBarInbandPct) {
    cardBarInbandPct.textContent = '';
    cardBarInbandPct.hidden = true;
    cardBarInbandPct.setAttribute('aria-hidden', 'true');
  }
  const cardFooterDebtEl = document.getElementById('card-footer-debt');
  if (cardFooterDebtEl) cardFooterDebtEl.textContent = `${fmtDollar(stats.debtRemaining)} debt remaining`;

  // ── Locked next-tier card + secondary board gap label ──
  const boardGapLabelEl = document.getElementById('board-tier-gap-label');
  if (boardGapLabelEl) boardGapLabelEl.textContent = 'Stage gap';

  const tierCurrent = document.getElementById('next-tier-current');
  const tierTarget = document.getElementById('next-tier-target');
  if (tierCurrent) tierCurrent.textContent = `${tier.badge} · ${tier.label}`;
  if (tierTarget) {
    tierTarget.textContent = nextTier ? `${nextTier.badge} · ${nextTier.label}` : 'Final payoff stage';
  }
}
