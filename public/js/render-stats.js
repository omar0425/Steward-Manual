'use strict';

import { isPlayDashboardDoc } from './shell.js';
import {
  fmtDollar, fmtSignedDollar, fmtDate,
  formatNetWorthValue, nextMoveGuidance,
  formatBoardRunwayHelperLine, liquidityGuardExplanation, buildLiquidityPillTooltip,
  formatLastPullAccountRow, formatNetThisTurnLine, lastPullAccountRowsFromStats,
} from './format.js';
const VNEXT_HERO_TURN_ACCOUNTS_TOP = 3;

/** Top account deltas under "Your climb" — vNext only. */
export function fillVnextHeroTurnAccounts(stats) {
  const root = document.getElementById('dashboard-vnext') || document.getElementById('dashboard');
  const wrap = document.getElementById('vnext-hero-turn-accounts');
  const listEl = document.getElementById('vnext-hero-turn-accounts-list');
  const netEl = document.getElementById('vnext-hero-turn-accounts-net');
  if (!root || !wrap || !listEl || !netEl) return;

  const story = root.querySelector('.hero-story-column');
  const strip = story?.querySelector('.hero-context-strip');
  if (strip) {
    strip.insertAdjacentElement('afterend', wrap);
  }

  const { accountLines, ndVal, pdVal } = lastPullAccountRowsFromStats(stats);
  const show = accountLines.length > 0 || ndVal > 0 || pdVal > 0;
  if (!show) {
    listEl.textContent = '';
    netEl.textContent = '';
    wrap.hidden = true;
    return;
  }

  const netThisTurn =
    accountLines.length > 0
      ? accountLines.reduce((s, r) => s + Number(r.delta), 0)
      : ndVal - pdVal;

  listEl.textContent = '';
  if (accountLines.length > 0) {
    const top = accountLines
      .slice()
      .sort((a, b) => Math.abs(Number(b.delta)) - Math.abs(Number(a.delta)))
      .slice(0, VNEXT_HERO_TURN_ACCOUNTS_TOP);
    for (const r of top) {
      const li = document.createElement('li');
      li.textContent = formatLastPullAccountRow(r);
      listEl.appendChild(li);
    }
  }

  netEl.textContent = formatNetThisTurnLine(netThisTurn);
  wrap.hidden = false;
}

export function fillThisTurnPanel(stats) {
  const listEl = document.getElementById('this-turn-list');
  const netEl = document.getElementById('this-turn-net');
  const sinceEl = document.getElementById('turn-since-label');
  if (!listEl) return;

  if (sinceEl) {
    const ts = stats && stats.turnStartAt;
    if (ts) {
      const d = new Date(ts);
      const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      sinceEl.textContent = `since ${label}`;
    } else {
      sinceEl.textContent = '';
    }
  }

  listEl.textContent = '';
  const { accountLines, ndVal, pdVal } = lastPullAccountRowsFromStats(stats);
  if (accountLines.length === 0 && ndVal === 0 && pdVal === 0) {
    // Nothing countable this turn (e.g. the only change was removing an account,
    // which is not a paydown). Reset to neutral rather than leaving a stale
    // number from a previous turn.
    if (netEl) { netEl.textContent = '—'; netEl.classList.remove('neg', 'pos'); }
    const labelEl = document.getElementById('this-turn-net-label');
    if (labelEl) labelEl.textContent = 'Net this turn';
    const sessionCard = listEl.closest('.section-panel') || document.getElementById('session-card');
    if (sessionCard) sessionCard.classList.remove('session-card--good', 'session-card--bad');
    return;
  }

  if (accountLines.length > 0) {
    for (const r of accountLines) {
      const row = document.createElement('div');
      row.className = 'turn-row';

      const name = document.createElement('span');
      name.className = 'turn-row-name';
      name.textContent = r.name || 'Account';

      const delta = document.createElement('span');
      const d = Number(r.delta) || 0;
      delta.className = 'turn-row-delta ' + (d < 0 ? 'neg' : d > 0 ? 'pos' : '');
      delta.textContent = fmtSignedDollar(d);

      row.appendChild(name);
      row.appendChild(delta);
      listEl.appendChild(row);
    }
  } else {
    const rollups = [];
    if (pdVal > 0) rollups.push({ name: 'Paydown recorded', delta: -pdVal });
    if (ndVal > 0) rollups.push({ name: 'New debt recorded', delta: ndVal });

    for (const r of rollups) {
      const row = document.createElement('div');
      row.className = 'turn-row';

      const name = document.createElement('span');
      name.className = 'turn-row-name';
      name.textContent = r.name;

      const delta = document.createElement('span');
      const d = Number(r.delta) || 0;
      delta.className = 'turn-row-delta ' + (d < 0 ? 'neg' : d > 0 ? 'pos' : '');
      delta.textContent = fmtSignedDollar(d);

      row.appendChild(name);
      row.appendChild(delta);
      listEl.appendChild(row);
    }
  }

  if (netEl) {
    const netThisTurn = accountLines.length > 0
      ? accountLines.reduce((s, r) => s + Number(r.delta), 0)
      : ndVal - pdVal;

    // The big number is just the number — clean and scannable. The caption
    // below it carries the meaning, so we don't repeat "Net this turn" twice.
    netEl.textContent = fmtSignedDollar(netThisTurn);
    netEl.classList.toggle('neg', netThisTurn < 0);
    netEl.classList.toggle('pos', netThisTurn > 0);

    const labelEl = document.getElementById('this-turn-net-label');
    if (labelEl) {
      labelEl.textContent = netThisTurn < 0
        ? 'paid down this turn'
        : netThisTurn > 0
          ? 'balances grew this turn'
          : 'no change this turn';
    }

    const sessionCard = listEl.closest('.section-panel') || document.getElementById('session-card');
    if (sessionCard) {
      sessionCard.classList.toggle('session-card--good', netThisTurn < 0);
      sessionCard.classList.toggle('session-card--bad', netThisTurn > 0);
    }
  }
}

/**
 * Renders the streak badge, milestone/progress widget area, and the data strip
 * (board pills, freshness chips). Called by the orchestrator after the hero
 * block so the inputs are already computed.
 */
export function renderStatsBlock({
  status, stats, stab, meta, tier, nextTier, paidDisplay, paidShown,
  prevPaidDown, runwayText, inBandBarDisplayPct,
}) {
  const netWorthText = formatNetWorthValue(stats.netWorth);

  const statDebtRemainingEl = document.getElementById('stat-debt-remaining');
  if (statDebtRemainingEl) statDebtRemainingEl.textContent = fmtDollar(stats.debtRemaining);

  const statDebtPaid = document.getElementById('stat-debt-paid');
  if (statDebtPaid) {
    statDebtPaid.textContent = paidDisplay.text;
    statDebtPaid.title = paidDisplay.title;
  }
  const statPaidLabel = document.querySelector('.board-block.board-progress .paid-label');
  if (statPaidLabel) {
    statPaidLabel.textContent = '';
  }
  const paidFeedbackEl = document.getElementById('paid-down-feedback');
  if (paidFeedbackEl) {
    if (prevPaidDown != null && Number.isFinite(prevPaidDown) && paidShown > prevPaidDown) {
      paidFeedbackEl.textContent = `+${fmtDollar(paidShown - prevPaidDown)} since last refresh`;
      paidFeedbackEl.hidden = false;
    } else {
      paidFeedbackEl.textContent = '';
      paidFeedbackEl.hidden = true;
    }
  }

  const milestoneNextEl = document.getElementById('progress-milestone-next');
  if (milestoneNextEl) {
    if (isPlayDashboardDoc()) {
      milestoneNextEl.textContent = '';
      milestoneNextEl.hidden = true;
    } else {
      const milestoneCopy =
        nextTier && typeof nextTier.nextCopy === 'string' ? nextTier.nextCopy.trim() : '';
      if (milestoneCopy) {
        milestoneNextEl.textContent = milestoneCopy;
        milestoneNextEl.hidden = false;
      } else {
        milestoneNextEl.textContent = '';
        milestoneNextEl.hidden = true;
      }
    }
  }
  const progressFill = document.getElementById('command-progress-bar-fill');
  const progressWidget = document.getElementById('command-progress-widget');
  if (progressFill) {
    progressFill.style.width = `${inBandBarDisplayPct}%`;
  }
  if (progressWidget) {
    progressWidget.setAttribute('aria-valuenow', inBandBarDisplayPct.toFixed(1));
    progressWidget.setAttribute(
      'aria-valuetext',
      `Bar ${inBandBarDisplayPct.toFixed(1)}% through this payoff stage toward the next payoff stage—not share of total debt paid off.`,
    );
    progressWidget.title =
      'The full escape line is on the hero card. Here, "Stage gap" repeats the dollar figure only. This bar is in-stage position—not breathing room or full payoff.';
  }
  const progressPctLabel = document.getElementById('progress-pct-label');
  if (progressPctLabel) {
    const v = inBandBarDisplayPct;
    progressPctLabel.textContent = Number.isFinite(v) && v > 0 ? `${v.toFixed(1)}% in this stage` : '';
  }

  const nextMoveEl = document.getElementById('progress-next-move');
  if (nextMoveEl) {
    if (isPlayDashboardDoc()) {
      nextMoveEl.textContent = '';
      nextMoveEl.hidden = true;
    } else {
      const cue = nextMoveGuidance(nextTier);
      nextMoveEl.textContent = cue;
      nextMoveEl.hidden = !cue;
    }
  }

  const netWorthStat = document.getElementById('stat-net-worth');
  if (netWorthStat) {
    netWorthStat.textContent = netWorthText;
    netWorthStat.classList.toggle('is-negative', stats.netWorth < 0);
  }

  const statAssetsEl = document.getElementById('stat-assets');
  if (statAssetsEl) statAssetsEl.textContent = fmtDollar(stats.totalAssets);
  const invEl = document.getElementById('stat-investments');
  if (invEl) {
    invEl.textContent = '—';
    invEl.classList.add('is-muted');
  }
  const statMonthsAhead = document.getElementById('stat-months-ahead');
  if (statMonthsAhead) {
    statMonthsAhead.textContent = runwayText;
    statMonthsAhead.title = '';
  }

  const boardDebtAxis = document.getElementById('board-debt-axis');
  const boardLiqPill = document.getElementById('board-liquidity-pill');
  if (boardDebtAxis) {
    boardDebtAxis.textContent = `Payoff stage: ${tier.badge} · ${tier.label}`;
    boardDebtAxis.className = 'board-stability-pill board-axis-debt';
  }
  if (boardLiqPill) {
    boardLiqPill.textContent = isPlayDashboardDoc() ? stab.label : `Breathing room: ${stab.label}`;
    boardLiqPill.className = 'stability-pill';
    boardLiqPill.classList.add(`is-${stab.id}`);
    boardLiqPill.title = buildLiquidityPillTooltip(stab);
  }

  const boardAxesHint = document.getElementById('board-axes-hint');
  if (boardAxesHint) {
    boardAxesHint.textContent =
      'The escape goal is the hero headline. Below, the bar is only your position inside this stage.';
  }

  const boardRunwayLine = document.getElementById('board-runway-line');
  if (boardRunwayLine) {
    boardRunwayLine.textContent = formatBoardRunwayHelperLine(stats.monthsAhead, stab);
    boardRunwayLine.title = '';
  }

  const boardGuardNote = document.getElementById('board-guard-note');
  if (boardGuardNote) {
    const gMsg = liquidityGuardExplanation(stab.scoring && stab.scoring.guard);
    if (gMsg) {
      boardGuardNote.hidden = false;
      boardGuardNote.textContent = gMsg;
    } else {
      boardGuardNote.hidden = true;
      boardGuardNote.textContent = '';
    }
  }

  const boardStabNote = document.getElementById('board-stability-note');
  if (boardStabNote) {
    const parts = [];
    if (stab.scoring && stab.scoring.legacyFallback) {
      parts.push('Using a broader asset estimate until the next pull; refresh when you can.');
    }
    boardStabNote.textContent = parts.join(' ');
  }

  const lastSnapEl = document.getElementById('data-last-snapshot');
  if (lastSnapEl) lastSnapEl.textContent = fmtDate(meta.lastSnapshotAt || meta.ynabPulledAt);
  const brokPulledEl = document.getElementById('data-brok-pulled');
  if (brokPulledEl) brokPulledEl.textContent = '--';
  const nextPullEl = document.getElementById('data-next-pull');
  if (nextPullEl) nextPullEl.textContent = fmtDate(meta.nextScheduled);

  const freshnessBadge = document.getElementById('freshness-badge');
  if (freshnessBadge) {
    freshnessBadge.textContent = meta.freshness;
    freshnessBadge.className = 'data-chip-v fresh freshness-dot';
    if (meta.freshness.startsWith('Stale')) { freshnessBadge.classList.remove('fresh'); freshnessBadge.classList.add('stale'); }
    else if (meta.freshness.includes('h ago')) { freshnessBadge.classList.remove('fresh'); freshnessBadge.classList.add('aged'); }
  }

  const streakEl = document.getElementById('streak-line');
  if (streakEl) {
    const streak = status.streak;
    if (streak && streak.current > 0) {
      streakEl.textContent = `🔥 ${streak.current}-period streak`;
      streakEl.hidden = false;
    } else if (streak && streak.current === 0 && (streak.previousStreakLength || streak.lastBroken) > 0) {
      const len = streak.previousStreakLength || streak.lastBroken;
      streakEl.textContent = `You broke a ${len}-period streak. Start a new one.`;
      streakEl.hidden = false;
    } else {
      streakEl.textContent = '';
      streakEl.hidden = true;
    }
  }
}
