'use strict';

/**
 * stewardVnextEnhance — populates new UI elements without modifying render.js.
 * Called by the hook at render.js lines 781-783 after each render pass.
 */

import { renderNetWorthChart } from './networth-chart.js';
import { tierQuote } from '../tiers.js';

const TIER_IDS = [
  'rock_bottom', 'broke', 'struggling', 'surviving', 'stabilizing',
  'stable', 'building', 'thriving', 'winning', 'wealthy',
];

function fmtMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '\u2014';
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.round(Math.abs(n)).toLocaleString();
}

function fmtShortDateTime(value) {
  if (!value) return '\u2014';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '\u2014';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

window.stewardVnextEnhance = function stewardVnextEnhance({ tier, stats, nextTier, meta, stability: stab, snapshots, streak }) {
  const quoteLabel = document.getElementById('tier-quote-label');
  const quoteText = document.getElementById('tier-quote-text');
  if (tier && quoteLabel && quoteText) {
    quoteLabel.textContent = tier.label || 'Stage';
    quoteText.textContent = tierQuote(tier.id) || 'Keep the number moving in the right direction.';
  }

  /* ── Streak badge ── */
  const streakBadge = document.getElementById('streak-badge');
  const streakCount = document.getElementById('streak-count');
  if (streakBadge && streakCount && streak && streak.current > 0) {
    streakCount.textContent = streak.current;
    streakBadge.hidden = false;
  } else if (streakBadge) {
    streakBadge.hidden = true;
  }

  /* ── Months to next tier ── */
  const monthsNext = document.getElementById('stat-months-to-next');
  if (monthsNext) {
    const moVal = nextTier && nextTier.monthsEstimate ? Math.ceil(nextTier.monthsEstimate) : null;
    monthsNext.textContent = moVal != null ? moVal : '\u2014';
  }

  /* ── Daily target ── */
  const dailyTarget = document.getElementById('stat-daily-target');
  if (dailyTarget) {
    if (nextTier && nextTier.gapDollars > 0) {
      dailyTarget.textContent = '$' + Math.ceil(Number(nextTier.gapDollars) / 30).toLocaleString();
    } else {
      dailyTarget.textContent = '\u2014';
    }
  }

  /* ── Journey bar (10-stage overview) ── */
  const journeyFill = document.querySelector('#journey-bar .jb-fill');
  if (journeyFill && tier) {
    const idx = TIER_IDS.indexOf(tier.id);
    if (idx >= 0) {
      const pb = document.getElementById('command-progress-bar-fill');
      const inBandPct = pb ? parseFloat(pb.style.width) || 0 : 0;
      const overallPct = ((idx + inBandPct / 100) / 10) * 100;
      journeyFill.style.width = overallPct.toFixed(1) + '%';
      /* Update the journey label text */
      const journeySection = document.querySelector('.journey-section');
      if (journeySection) {
        const labelSpans = journeySection.querySelectorAll('.journey-label span');
        if (labelSpans.length >= 2) {
          labelSpans[1].textContent = `Stage ${String(idx + 1).padStart(2, '0')} of 10`;
        }
      }
    }
  }

  /* ── Milestone banner ── */
  const banner      = document.getElementById('milestone-banner');
  const milestoneEl = document.getElementById('milestone-text');
  if (banner && milestoneEl && !sessionStorage.getItem('steward-milestone-dismissed')) {
    const copy = nextTier && typeof nextTier.nextCopy === 'string' ? nextTier.nextCopy.trim() : '';
    if (copy) { milestoneEl.textContent = copy; banner.hidden = false; }
    else { banner.hidden = true; }
  }

  /* ── Milestone dismiss button ── */
  const dismissBtn = document.getElementById('milestone-dismiss');
  if (dismissBtn && !dismissBtn._bound) {
    dismissBtn._bound = true;
    dismissBtn.addEventListener('click', () => {
      if (banner) banner.hidden = true;
      sessionStorage.setItem('steward-milestone-dismissed', '1');
    });
  }

  /* ── Cumulative paydown trophy ── */
  const cupEl  = document.getElementById('stat-cumulative-paydown');
  const pctEl  = document.getElementById('cumulative-pct');
  if (cupEl && stats && stats.cumulativePaidDown != null) {
    const paid     = Number(stats.cumulativePaidDown);
    const baseline = Number(stats.climbBaselineDebt) || 0;
    cupEl.textContent = '$' + Math.round(paid).toLocaleString();
    if (pctEl && baseline > 0) {
      pctEl.innerHTML = ((paid / baseline) * 100).toFixed(1) + '% paid down<br><span style="color:var(--text-3)">\$' + Math.round(baseline).toLocaleString() + ' baseline</span>';
    }
  }

  /* ── Locked next-tier card ── */
  const lockedCard = document.getElementById('locked-next-card');
  if (lockedCard) {
    if (nextTier && nextTier.id && nextTier.gapDollars > 0) {
      lockedCard.dataset.state = nextTier.id;
      const lockedBadge = document.getElementById('locked-badge-chip');
      const lockedName  = document.getElementById('locked-tier-name');
      const lockedGap   = document.getElementById('locked-gap-amount');
      if (lockedBadge) lockedBadge.textContent = nextTier.badge || '';
      if (lockedName)  lockedName.textContent  = nextTier.label || '';
      if (lockedGap)   lockedGap.textContent   = '$' + Math.round(Number(nextTier.gapDollars)).toLocaleString();
      lockedCard.hidden = false;
    } else {
      lockedCard.hidden = true;
    }
  }

  /* ── Nav stage tag ── */
  const navTag = document.getElementById('nav-stage-tag');
  if (navTag && tier) {
    navTag.textContent = tier.badge + ' — ' + tier.label;
    navTag.hidden = false;
  }

  /* ── NEXT MILESTONE label in Situation Read ── */
  const stabilityMilestone = document.getElementById('hero-stability-milestone');
  if (stabilityMilestone && nextTier) {
    const copy = typeof nextTier.nextCopy === 'string' ? nextTier.nextCopy.trim() : '';
    stabilityMilestone.textContent = copy || '\u2014';
  }

  /* ── Net worth chart (new SVG-based chart) ── */
  const chartWrap = document.querySelector('.chart-wrap');
  if (snapshots && snapshots.length >= 1) {
    renderNetWorthChart(snapshots);
    const ph = document.getElementById('nw-empty-state');
    if (ph) ph.hidden = true;
    const svg = document.getElementById('networth-chart-svg');
    if (svg) svg.hidden = false;
  } else if (chartWrap) {
    let ph = document.getElementById('nw-empty-state');
    if (!ph) {
      ph = document.createElement('p');
      ph.id = 'nw-empty-state';
      ph.className = 'panel-empty-state';
      chartWrap.appendChild(ph);
    }
    ph.textContent = 'No data yet — add your debts to begin.';
    ph.hidden = false;
    const svg = document.getElementById('networth-chart-svg');
    if (svg) svg.hidden = true;
  }

  /* ── Debt accounts empty state ── */
  const debtList = document.getElementById('debt-accounts-list');
  if (debtList && !debtList.children.length) {
    let ph = document.getElementById('debt-list-empty');
    if (!ph) {
      ph = document.createElement('p');
      ph.id = 'debt-list-empty';
      ph.className = 'panel-empty-state';
      ph.textContent = 'Add your debts to see account balances here.';
      debtList.appendChild(ph);
    }
  } else {
    const ph = document.getElementById('debt-list-empty');
    if (ph) ph.remove();
  }

  /* ── This turn empty state ── */
  const turnList = document.getElementById('this-turn-list');
  if (turnList && !turnList.children.length) {
    let ph = document.getElementById('turn-list-empty');
    if (!ph) {
      ph = document.createElement('p');
      ph.id = 'turn-list-empty';
      ph.className = 'panel-empty-state';
      ph.textContent = 'No changes recorded this session yet.';
      turnList.appendChild(ph);
    }
  } else {
    const ph = document.getElementById('turn-list-empty');
    if (ph) ph.remove();
  }
};
