'use strict';

/**
 * stewardVnextEnhance — populates new UI elements without modifying render.js.
 * Called by the hook at render.js lines 781-783 after each render pass.
 */

import { renderNetWorthChart } from './networth-chart.js';
import { tierQuote, tierBehaviorLine, TIER_META } from '../tiers.js';

const TIER_IDS = [
  'rock_bottom', 'broke', 'struggling', 'surviving', 'stabilizing',
  'stable', 'building', 'thriving', 'winning', 'wealthy',
];

window.stewardVnextEnhance = function stewardVnextEnhance({ tier, stats, nextTier, meta, stability: stab, snapshots, streak }) {
  const quoteLabel = document.getElementById('tier-quote-label');
  const quoteText = document.getElementById('tier-quote-text');
  if (tier && quoteLabel && quoteText) {
    quoteLabel.textContent = tier.label || 'Stage';
    quoteText.textContent = tierQuote(tier.id) || 'Keep the number moving in the right direction.';
  }

  /* ── Mascot click interaction: cycle quote ↔ behavior ↔ cue, gentle pulse ──
     The character itself has no react animation; this gives the user feedback
     that the mascot is alive without requiring a new SVG state. Bound once. */
  const mount = document.getElementById('hero-steward-mount');
  if (tier && quoteText && mount && mount.dataset.clickBound !== '1') {
    mount.dataset.clickBound = '1';
    mount.style.cursor = 'pointer';
    mount.setAttribute('role', 'button');
    mount.setAttribute('tabindex', '0');
    mount.setAttribute('aria-label', 'Steward — click to hear another line');
    mount.title = 'Click for another line from Steward';
    const cycleQuote = () => {
      const meta = TIER_META[mount.dataset.tierId] || tier;
      const id = (meta && meta.id) || tier.id;
      /* Dedupe so back-to-back identical lines (the data sometimes overlaps)
         don't make a click feel like nothing happened. */
      const lines = Array.from(new Set([
        tierQuote(id),
        tierBehaviorLine(id),
        meta && meta.cue ? meta.cue : '',
      ].filter(Boolean)));
      if (!lines.length) return;
      const i = Number(mount.dataset.quoteIdx || '0');
      const next = (i + 1) % lines.length;
      mount.dataset.quoteIdx = String(next);
      quoteText.textContent = lines[next];
      quoteText.classList.remove('tier-quote-pulse');
      void quoteText.offsetWidth;
      quoteText.classList.add('tier-quote-pulse');
    };
    mount.addEventListener('click', cycleQuote);
    mount.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); cycleQuote(); }
    });
  }
  if (mount && tier) mount.dataset.tierId = tier.id;

  /* ── Streak badge ──
     At zero, the badge becomes a real interactive button that scrolls to the
     manual-entry panel and focuses the first balance input — clicking it is
     how you "start" a streak (by logging a paydown). At >0 it's purely
     informational and not interactive. */
  const streakBadge = document.getElementById('streak-badge');
  if (streakBadge) {
    const cur = streak && Number.isFinite(Number(streak.current)) ? Number(streak.current) : 0;
    if (cur > 0) {
      streakBadge.innerHTML = `🔥 <span id="streak-count">${cur}</span> day streak`;
      streakBadge.dataset.zero = '';
      streakBadge.title = `${cur} consecutive sessions trimming debt.`;
      streakBadge.removeAttribute('role');
      streakBadge.removeAttribute('tabindex');
      streakBadge.style.cursor = '';
    } else {
      streakBadge.innerHTML = '🌱 <span id="streak-count" hidden>0</span>Start a streak';
      streakBadge.dataset.zero = '1';
      streakBadge.title = 'Log a paydown to start your streak — opens the update form.';
      streakBadge.setAttribute('role', 'button');
      streakBadge.setAttribute('tabindex', '0');
      streakBadge.style.cursor = 'pointer';
    }
    streakBadge.hidden = false;

    /* Bind once. Re-renders only re-run when streak.current changes, but the
       handler reads the live dataset.zero flag, so a single binding handles
       both states. */
    if (streakBadge.dataset.clickBound !== '1') {
      streakBadge.dataset.clickBound = '1';
      const trigger = () => {
        if (streakBadge.dataset.zero !== '1') return;
        const panel = document.getElementById('manual-entry-panel');
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.setTimeout(() => {
          const focusTarget = (panel && panel.querySelector('.saved-debt-balance-input, .debt-acct-balance, .debt-acct-name'))
            || document.getElementById('update-balances-btn')
            || document.getElementById('save-snapshot-btn');
          if (focusTarget && typeof focusTarget.focus === 'function') {
            try { focusTarget.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
          }
        }, 420);
      };
      streakBadge.addEventListener('click', trigger);
      streakBadge.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); trigger(); }
      });
    }
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

  /* ── Net worth chart (new SVG-based chart) ──
   * Needs at least 2 snapshots to plot a trend. With 0 or 1 we hide the SVG
   * and show inline empty-state copy in the same panel; the panel's title and
   * frame stay visible so the layout doesn't jump when data arrives.
   *
   * Filter to post-climb snapshots. Every "Save" during setup writes a
   * snapshot, so iterative inventory entry produces a ramp-up line that isn't
   * real debt growth. The climb's baseline is the snapshot stamped at
   * start-game, so anything strictly earlier is pre-climb noise. */
  const gameStartAt = stats && stats.gameStartAt;
  const chartSnaps = (snapshots || []).filter(
    (s) => !gameStartAt || (s.pulled_at || s.date) >= gameStartAt,
  );
  const chartWrap = document.querySelector('.chart-wrap');
  if (chartSnaps.length >= 2) {
    renderNetWorthChart(chartSnaps);
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
    ph.textContent = chartSnaps.length === 1
      ? 'Update your balances at least once to see your trend.'
      : 'No data yet — add your debts to begin.';
    ph.hidden = false;
    const svg = document.getElementById('networth-chart-svg');
    if (svg) svg.hidden = true;
    // Clear any stale trend delta so the panel header doesn't show a stale number.
    const deltaEl = document.getElementById('chart-trend-delta');
    if (deltaEl) { deltaEl.textContent = ''; deltaEl.className = 'chart-trend'; }
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
