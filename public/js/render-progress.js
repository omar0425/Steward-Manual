'use strict';

import {
  fmtDollar, fmtSignedDollar,
  cumulativePaidDownFromStats, lifetimeProgressPctFromCumulative,
  formatLastPullAccountRow, formatNetThisTurnLine, lastPullAccountRowsFromStats,
  snapshotPaydownWindow, snapshotPaceIsNoisy, snapshotDeltaSinceOldest,
  paceQualitative, formatApproxDurationFromMonths, timeAgo,
} from './format.js';
import { TIER_FLOW, TIER_META } from './tiers.js';
import { queuePaidOffCelebration } from './render-debts.js';
import { stewardApiUrl } from './api.js';
import { createInfoDot } from './info-popover.js';

/* Full-viewport confetti burst for a climbed stage. Dependency-free: ~90
   absolutely-positioned pieces, randomized drift/spin/delay via CSS custom
   properties, removed after the longest piece lands. Skipped entirely under
   prefers-reduced-motion. */
// Fixed brand palette as literals — NOT CSS vars. The theme tokens (--gold
// etc.) are scoped to body[data-theme]; building the colors inline keeps the
// burst self-contained no matter where/when it mounts.
const CONFETTI_COLORS = ['#c8a84c', '#14a469', '#f4efe4', '#d94f6e'];

function buildConfettiWrap() {
  const wrap = document.createElement('div');
  wrap.id = 'stageup-confetti';
  wrap.className = 'stageup-confetti';
  wrap.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 90; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.left = `${(Math.random() * 100).toFixed(2)}%`;
    piece.style.animationDelay = `${(Math.random() * 0.7).toFixed(2)}s`;
    piece.style.animationDuration = `${(1.6 + Math.random() * 1.4).toFixed(2)}s`;
    const w = 5 + Math.random() * 6;
    piece.style.width = `${w.toFixed(1)}px`;
    piece.style.height = `${(w * (0.4 + Math.random() * 0.8)).toFixed(1)}px`;
    piece.style.setProperty('--confetti-drift', `${((Math.random() - 0.5) * 160).toFixed(0)}px`);
    piece.style.setProperty('--confetti-spin', `${(360 + Math.random() * 540).toFixed(0)}deg`);
    wrap.appendChild(piece);
  }
  return wrap;
}

function fireStageUpConfetti() {
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  } catch (_) { /* matchMedia missing → proceed */ }
  // The milestone renders mid-boot, during which the boot sequence rebuilds the
  // shell (and tears out anything freshly attached to the document). Rather
  // than guess exactly what removes it and when, the burst is self-healing:
  // re-assert it onto the CURRENT document.body each animation frame for a
  // ~3.5s window, then stop. Whatever swaps out the DOM, the next frame
  // re-mounts. A single shared wrap id keeps it idempotent.
  const startedAt = (() => { try { return performance.now(); } catch (_) { return 0; } })();
  const KEEPALIVE_MS = 3500;
  let removeTimer = null;
  function ensureMounted() {
    try {
      const now = (() => { try { return performance.now(); } catch (_) { return startedAt + KEEPALIVE_MS + 1; } })();
      if (now - startedAt > KEEPALIVE_MS) {
        // Stop re-asserting; let the existing burst finish, then clean up.
        if (!removeTimer) {
          const existing = document.getElementById('stageup-confetti');
          removeTimer = window.setTimeout(() => { const w = document.getElementById('stageup-confetti'); if (w) w.remove(); }, existing ? 3000 : 0);
        }
        return;
      }
      if (document.body && !document.getElementById('stageup-confetti')) {
        document.body.appendChild(buildConfettiWrap());
      }
      requestAnimationFrame(ensureMounted);
    } catch (_) { /* celebration must never break anything */ }
  }
  // Kick off after the first paint so we're not racing the synchronous render.
  requestAnimationFrame(ensureMounted);
}

function escapeText(s) {
  const d = document.createElement('span');
  d.textContent = String(s == null ? '' : s);
  return d.innerHTML;
}


function fillPlayProgressDetailBullets({ stats, debtDirEl }) {
  if (debtDirEl) {
    debtDirEl.hidden = true;
    debtDirEl.textContent = '';
  }
  const paid = cumulativePaidDownFromStats(stats);
  const elPaid = document.getElementById('progress-bullet-paid');
  const elTurn = document.getElementById('progress-bullet-turn');
  const elNew = document.getElementById('progress-bullet-newdebt');
  const elDir = document.getElementById('progress-bullet-direction');
  const playMs = document.getElementById('progress-milestone-next');
  const playNm = document.getElementById('progress-next-move');
  if (playMs) {
    playMs.textContent = '';
    playMs.hidden = true;
  }
  if (playNm) {
    playNm.textContent = '';
    playNm.hidden = true;
  }
  // The balance drop IS the progress: cumulativePaidDown already reflects
  // interest (the balance fell by this much *after* interest was added), so it is
  // NOT netted again. This matches the hero's "you've reduced" figure and the
  // Steward AI's money rules — one consistent paydown number across the app.
  const paidVal = Number.isFinite(paid) ? fmtDollar(Math.round(paid)) : '—';
  if (elPaid) {
    elPaid.innerHTML = `<span class="sp-label">Principal paid down</span><span class="sp-val sp-val--good">${paidVal}</span>`;
    const lbl = elPaid.querySelector('.sp-label');
    if (lbl) lbl.appendChild(createInfoDot(
      'How much your total tracked balance has dropped since you started — your real progress against the debt. Interest is already reflected: the balance fell by this much after interest was added, so it is not subtracted again.'));
    elPaid.title = 'How much your total tracked balance has dropped since you started. Interest is already reflected — the balance fell by this much after it was added.';
  }
  const { accountLines, ndVal, pdVal } = lastPullAccountRowsFromStats(stats);
  const netThisTurn = accountLines.length > 0
    ? accountLines.reduce((s, r) => s + Number(r.delta), 0)
    : ndVal - pdVal;
  if (elTurn) {
    const hasTurn = accountLines.length > 0 || ndVal > 0 || pdVal > 0;
    const netRounded = Math.round(netThisTurn);
    const turnValStr = hasTurn ? fmtSignedDollar(netRounded) : '—';
    const turnClass = hasTurn && netRounded < 0 ? 'sp-val--good' : hasTurn && netRounded > 0 ? 'sp-val--bad' : '';
    elTurn.innerHTML = `<span class="sp-label">This turn</span><span class="sp-val ${turnClass}">${turnValStr}</span>`;
  }
  const nd = Number(stats && stats.cumulativeNewDebtAdded);
  if (elNew) {
    const ndStr = Number.isFinite(nd) && nd > 0 ? '+' + fmtDollar(Math.round(nd)) : '$0';
    const ndClass = nd > 0 ? 'sp-val--bad' : '';
    elNew.innerHTML = `<span class="sp-label">New debt added</span><span class="sp-val ${ndClass}">${ndStr}</span>`;
  }
  const elInterest = document.getElementById('progress-bullet-interest');
  if (elInterest) {
    const ia = Number(stats && stats.cumulativeInterestAccrued);
    // Interest is the cost of carrying the debt — shown in a neutral tone, not
    // the red of "new debt", since it doesn't count against the user's effort.
    const iaStr = Number.isFinite(ia) && ia > 0 ? '+' + fmtDollar(Math.round(ia)) : '$0';
    // Bug #1 — alongside the logged figure, show an APR-computed estimate of
    // interest accrued since start (server-computed). It's approximate and may be
    // understated while any APR is missing, so it's labeled "est." with a caret.
    const est = Number(stats && stats.estimatedInterestAccrued);
    const hasEst = Number.isFinite(est) && est > 0;
    const understated = stats && stats.estimatedInterestUnderstated;
    // Say "accrued since start" explicitly: this is a cumulative total, and
    // without that word it reads as a rival to the "~$/mo right now" monthly
    // cost shown on the debts panel — two interest numbers that look like they
    // should tie out but measure different things.
    const estLine = hasEst
      ? `<span class="sp-sub">≈ ${fmtDollar(Math.round(est))}${understated ? '+' : ''} accrued since start (est.)</span>`
      : '';
    elInterest.innerHTML = `<span class="sp-label">Interest logged</span><span class="sp-val">${iaStr}</span>${estLine}`;
    elInterest.title = 'Two views of interest. "Interest logged" is only what you’ve tagged as interest/fees. The "est. from APRs" line below estimates the real interest accrued since you started, from your APRs and balances'
      + (understated ? ' — understated, because some accounts have no APR set.' : '.');
  }
  const elAvg = document.getElementById('progress-bullet-avgmonth');
  if (elAvg) {
    const avg = Number(stats && stats.avgMonthlyPayment);
    // Lifetime average paid down per month. Neutral tone — it's pace, not a win
    // or a setback. "—" until there's enough history to average honestly.
    const avgStr = Number.isFinite(avg) && avg > 0 ? fmtDollar(Math.round(avg)) : '—';
    elAvg.innerHTML = `<span class="sp-label">Avg / month</span><span class="sp-val">${avgStr}</span>`;
    elAvg.title = 'Average amount you’ve paid down per month since you started (Total Cleared ÷ months).';
  }
  // Offer the retroactive correction only when there's new debt to move.
  const reclassifyBtn = document.getElementById('reclassify-debt-btn');
  if (reclassifyBtn) reclassifyBtn.hidden = !(Number.isFinite(nd) && nd > 0);
  // Offer undo only when there's a captured action to reverse; label it for
  // whichever action is on top (a balance update or a reclassification).
  const undoBtn = document.getElementById('undo-last-btn');
  if (undoBtn) {
    undoBtn.hidden = !(stats && stats.canUndo === true);
    const label = stats && stats.undoLabel === 'correction' ? 'correction' : 'update';
    undoBtn.dataset.undoLabel = label;
    undoBtn.textContent = label === 'correction'
      ? '↶ Undo last correction'
      : '↶ Undo last update (entered the wrong amount?)';
  }

  fillDebtFreeBanner(stats);
  if (elDir) {
    let d = 'flat'; let dirClass = ''; let arrow = '→';
    if (stats && stats.debtDirection === 'increasing') { d = 'backward'; dirClass = 'sp-val--bad'; arrow = '↘'; }
    else if (netThisTurn > 0) { d = 'backward'; dirClass = 'sp-val--bad'; arrow = '↘'; }
    else if (netThisTurn < 0) { d = 'forward'; dirClass = 'sp-val--good'; arrow = '↗'; }
    elDir.innerHTML = `<span class="sp-label">Net direction</span><span class="sp-val sp-val--word ${dirClass}">${arrow} ${d}</span>`;
  }
}

/* "YYYY-MM-DD" → "March 2027" (parsed as local midnight to avoid TZ slips). */
function formatMonthYear(iso) {
  if (typeof iso !== 'string') return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/* Projected debt-free finish line + this-month progress. Shown only when the
   pace is solid enough to project an honest date (server decides via onTrack);
   otherwise we surface "this month" if we have it, or hide entirely. */
function fillDebtFreeBanner(stats) {
  const banner = document.getElementById('debt-free-banner');
  if (!banner) return;
  const dateEl = document.getElementById('debt-free-date');
  const subEl = document.getElementById('debt-free-sub');
  const df = stats && stats.debtFree;
  const ptm = stats ? Number(stats.paidThisMonth) : NaN;

  const thisMonthBit = Number.isFinite(ptm) && Math.abs(ptm) >= 1
    ? `This month: ${ptm > 0 ? '+' : '−'}${fmtDollar(Math.abs(Math.round(ptm)))}`
    : '';

  if (df && df.alreadyFree) {
    if (dateEl) dateEl.textContent = 'Debt-free 🎉';
    if (subEl) subEl.textContent = 'You made it. The climb is complete.';
    const pf = document.getElementById('payoff-forecast');
    if (pf) pf.hidden = true;
    banner.hidden = false;
    return;
  }
  if (df && df.onTrack && df.debtFreeDate) {
    const pace = Number(df.monthlyPace);
    const paceBit = Number.isFinite(pace) && pace > 0 ? `at ~${fmtDollar(Math.round(pace))}/mo` : '';
    const pf = stats && stats.payoffForecast;
    const hasBand = pf && pf.ready && !pf.alreadyFree && pf.medianDate && pf.optimisticDate && pf.conservativeDate;
    if (hasBand) {
      // Lead with the Monte Carlo most-likely date and an honest range. The
      // single pace-derived date (df.debtFreeDate) swings session to session;
      // the band reframes that as expected variation rather than a moving goal.
      if (dateEl) dateEl.textContent = formatMonthYear(pf.medianDate);
      const range = `likely ${formatMonthYear(pf.optimisticDate)} – ${formatMonthYear(pf.conservativeDate)}`;
      if (subEl) subEl.textContent = [range, paceBit, thisMonthBit].filter(Boolean).join(' · ');
    } else {
      // Not enough history for a band yet — fall back to the single pace date.
      if (dateEl) dateEl.textContent = formatMonthYear(df.debtFreeDate);
      if (subEl) subEl.textContent = [paceBit, thisMonthBit].filter(Boolean).join(' · ');
    }
    banner.hidden = false;
    fillPayoffForecast(stats);
    return;
  }
  // No honest date yet. Still show the month's progress if there is any.
  if (thisMonthBit) {
    if (dateEl) dateEl.textContent = 'Building your forecast…';
    if (subEl) subEl.textContent = `${thisMonthBit} · keep logging to set a finish line.`;
    banner.hidden = false;
    fillPayoffForecast(stats);
    return;
  }
  banner.hidden = true;
}

/* Probabilistic payoff band (Monte Carlo over the user's own paydown history).
   Shown under the deterministic date as an honest range + odds. Hidden until the
   simulation has enough positive-trending history. */
function fillPayoffForecast(stats) {
  const el = document.getElementById('payoff-forecast');
  if (!el) return;
  const f = stats && stats.payoffForecast;
  const savedToDate = Number(stats && stats.interestSavedToDate);
  const parts = [];

  if (f && f.ready && !f.alreadyFree && f.medianDate) {
    // The most-likely date + range now headline the banner above; this box adds
    // the odds and the remaining-interest band so the two don't restate it.
    let odds = '';
    if (Number.isFinite(f.prob1yr) && f.prob1yr >= 50) odds = `${f.prob1yr}% chance within 1 year`;
    else if (Number.isFinite(f.prob2yr) && f.prob2yr >= 40) odds = `${f.prob2yr}% chance within 2 years`;
    else if (Number.isFinite(f.prob3yr)) odds = `${f.prob3yr}% chance within 3 years`;

    if (odds) parts.push(`<span class="pf-odds">${odds}</span>`);

    // Remaining-interest band — interest you'll still pay before you're free.
    const ri = f.remainingInterest;
    if (ri && Number.isFinite(ri.median)) {
      parts.push(`<span class="pf-odds">~${fmtDollar(ri.median)} more in interest to clear (range ${fmtDollar(ri.low)}–${fmtDollar(ri.high)})</span>`);
    }
  }

  // Interest already kept from the bank (deterministic, vs starting balances).
  if (Number.isFinite(savedToDate) && savedToDate > 0) {
    parts.push(`<span class="pf-odds pf-saved">💰 Interest kept from the bank so far: ~${fmtDollar(savedToDate)}</span>`);
  }

  if (!parts.length) { el.hidden = true; return; }
  el.innerHTML = `<span class="pf-label">Forecast</span>` + parts.join('');
  const pfLbl = el.querySelector('.pf-label');
  if (pfLbl) pfLbl.appendChild(createInfoDot(
    'A Monte Carlo simulation replays your own recent paydown history thousands of times to project a range of payoff dates — a most-likely date plus an optimistic-to-conservative band — instead of one fragile guess. The range widens when your pace is uneven.'));
  el.title = f && f.ready
    ? `Monte Carlo: ${f.runs.toLocaleString()} runs resampled from your ${f.samples} logged paydown periods. Range = 10th–90th percentile; interest is accrued on the running balance along each simulated path.`
    : '';
  el.hidden = false;
}

export function fillProgressNarrative({
  nextTier,
  snapshots,
  theme,
  stability,
  meta,
  stats,
  recentMilestones,
}) {
  const milestoneEl = document.getElementById('progress-milestone-recent');
  if (milestoneEl) {
    milestoneEl.textContent = '';
    const milestones = Array.isArray(recentMilestones) ? recentMilestones : [];
    if (milestones.length === 0) {
      milestoneEl.hidden = true;
    } else {
      const idsToMark = [];
      for (const m of milestones) {
        const row = document.createElement('div');
        row.className = 'milestone-recent-banner__row';
        let rendered = true;
        if (m.type === 'tier-change') {
          // Determine direction by comparing tier indices in TIER_FLOW.
          // Climb mode runs rock_bottom → wealthy as you pay down; "up" means
          // higher in the climb (less debt). If we can't tell, fall back to neutral.
          const fromIdx = TIER_FLOW.findIndex((t) => t.id === m.from);
          const toIdx = TIER_FLOW.findIndex((t) => t.id === m.to);
          const climbed = fromIdx >= 0 && toIdx >= 0 && toIdx > fromIdx;
          const slipped = fromIdx >= 0 && toIdx >= 0 && toIdx < fromIdx;
          const toMeta = TIER_META[m.to] || {};
          const fromMeta = TIER_META[m.from] || {};
          // Labels fall back to the raw server-supplied tier ids, so escape them
          // before they hit innerHTML — keeps this sink consistent with the rest
          // of the renderer even though tier ids are server constants today.
          const toLabel = escapeText(toMeta.label || m.to);
          const fromLabel = escapeText(fromMeta.label || m.from);
          if (climbed) {
            row.innerHTML = `🎯 <strong>Stage up</strong> — ${fromLabel} → ${toLabel}.`;
            fireStageUpConfetti();
          } else if (slipped) {
            row.innerHTML = `⚠️ Stage slipped — ${fromLabel} → ${toLabel}. Tomorrow's a new pull.`;
          } else {
            row.innerHTML = `<strong>Stage change</strong>: ${fromLabel} → ${toLabel}.`;
          }
        } else if (m.type === 'account-paid-off') {
          row.innerHTML = `🎉 <strong>Paid off:</strong> ${escapeText(m.accountName || 'an account')}.`;
          queuePaidOffCelebration(m.accountName);
          fireStageUpConfetti(); // a card hitting $0 deserves the gold rain too
        } else if (m.type === 'paydown-milestone') {
          const amt = '$' + Number(m.amount || 0).toLocaleString();
          row.innerHTML = `🏆 <strong>${amt} cleared!</strong> That much out of the bank's hands for good.`;
          fireStageUpConfetti();
        } else {
          rendered = false;
        }
        if (rendered) {
          milestoneEl.appendChild(row);
          if (m.id) idsToMark.push(m.id);
        }
      }
      milestoneEl.hidden = milestoneEl.children.length === 0;
      // Mark displayed milestones seen so refreshing doesn't keep showing them.
      // Fire-and-forget; failure just means the banner reappears on next load,
      // which is better than blocking the render.
      for (const id of idsToMark) {
        fetch(stewardApiUrl('/api/config/notifications-sent'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ milestone: id }),
        }).catch(() => {});
      }
    }
  }

  const staleEl = document.getElementById('progress-stale-note');
  if (staleEl) {
    const fr = meta && meta.freshness;
    const stale = typeof fr === 'string' && fr.startsWith('Stale');
    if (stale) {
      staleEl.textContent =
        'Data may be outdated — refresh before making decisions.';
      staleEl.hidden = false;
    } else {
      staleEl.textContent = '';
      staleEl.hidden = true;
    }
  }

  const debtDirEl = document.getElementById('progress-debt-direction');
  if (debtDirEl) {
    if (stats && stats.debtDirection === 'increasing') {
      debtDirEl.textContent = 'Debt moved up this period.';
      debtDirEl.hidden = false;
    } else {
      debtDirEl.textContent = '';
      debtDirEl.hidden = true;
    }
  }

  const playBullets = document.getElementById('progress-detail-bullets');
  if (playBullets) {
    fillPlayProgressDetailBullets({ stats, debtDirEl });
    return;
  }

  const lead = document.getElementById('progress-story-lead');
  const deltaEl = document.getElementById('progress-story-delta');
  const paceEl = document.getElementById('progress-story-pace');
  const hintEl = document.getElementById('progress-story-hint');
  const projEl = document.getElementById('progress-story-projection');
  const projDebtFreeEl = document.getElementById('progress-story-projection-debtfree');
  if (!lead || !deltaEl || !paceEl || !hintEl) return;

  const lifetimeEl = document.getElementById('progress-lifetime-climb');
  const lastPullWrap = document.getElementById('climb-last-pull-summary');
  const lastPullAccountsEl = document.getElementById('progress-last-pull-accounts');
  const lastPullNetEl = document.getElementById('progress-last-pull-net-line');
  const lastPullLifetimeEl = document.getElementById('progress-last-pull-lifetime-line');

  if (nextTier) {
    lead.textContent =
      'Recent movement from snapshot history (below) and pace — not the same as lifetime % (see lifetime line when present).';
  } else {
    lead.textContent =
      'Final payoff stage — no dollars left to the next threshold. Protect the floor you fought for.';
  }

  if (lifetimeEl && stats) {
    const baseline = Number(stats.climbBaselineDebt);
    const paid = cumulativePaidDownFromStats(stats);
    const pct = lifetimeProgressPctFromCumulative(stats);
    if (Number.isFinite(baseline) && baseline > 0) {
      lifetimeEl.textContent = `Lifetime: ${pct}% of baseline (${fmtDollar(baseline)}) — ${fmtDollar(
        paid,
      )} cumulative paydown since tracking. New debt does not reduce this.`;
      lifetimeEl.hidden = false;
    } else {
      lifetimeEl.textContent = '';
      lifetimeEl.hidden = true;
    }
  } else if (lifetimeEl) {
    lifetimeEl.textContent = '';
    lifetimeEl.hidden = true;
  }

  if (lastPullWrap && lastPullAccountsEl && lastPullNetEl && lastPullLifetimeEl && stats) {
    const { accountLines, ndVal, pdVal } = lastPullAccountRowsFromStats(stats);
    const show = accountLines.length > 0 || ndVal > 0 || pdVal > 0;
    if (show) {
      lastPullAccountsEl.textContent = '';
      if (accountLines.length > 0) {
        for (const r of accountLines) {
          const row = document.createElement('p');
          row.className = 'progress-hint climb-last-pull-line climb-last-pull-account-line';
          row.textContent = formatLastPullAccountRow(r);
          lastPullAccountsEl.appendChild(row);
        }
      } else {
        const rowPd = document.createElement('p');
        rowPd.className = 'progress-hint climb-last-pull-line climb-last-pull-account-line';
        rowPd.textContent = `Paydown: ${fmtDollar(pdVal)}`;
        const rowNd = document.createElement('p');
        rowNd.className = 'progress-hint climb-last-pull-line climb-last-pull-account-line';
        rowNd.textContent = `New debt: ${fmtDollar(ndVal)}`;
        lastPullAccountsEl.appendChild(rowPd);
        lastPullAccountsEl.appendChild(rowNd);
      }
      const netThisTurn =
        accountLines.length > 0
          ? accountLines.reduce((s, r) => s + Number(r.delta), 0)
          : ndVal - pdVal;
      lastPullNetEl.textContent = formatNetThisTurnLine(netThisTurn);
      lastPullLifetimeEl.textContent = `Lifetime paid down: ${fmtDollar(
        cumulativePaidDownFromStats(stats),
      )}`;
      lastPullWrap.hidden = false;
    } else {
      lastPullAccountsEl.textContent = '';
      lastPullNetEl.textContent = '';
      lastPullLifetimeEl.textContent = '';
      lastPullWrap.hidden = true;
    }
  } else if (lastPullWrap) {
    lastPullWrap.hidden = true;
  }

  const { delta, oldest } = snapshotDeltaSinceOldest(snapshots);
  if (!snapshots || snapshots.length < 2) {
    deltaEl.textContent = 'Need at least two snapshots on file to measure change over time.';
  } else if (delta > 0) {
    deltaEl.textContent = `Snapshot window: aggregate debt down about ${fmtDollar(delta)} since your earliest snapshot (${timeAgo(
      oldest.pulled_at,
    )}). This is total debt, not your cumulative paydown line.`;
  } else if (delta < 0) {
    deltaEl.textContent = `Snapshot window: aggregate debt up ${fmtDollar(-delta)} since your earliest snapshot (often borrowing or new accounts). Cumulative paydown does not decrease from this.`;
  } else {
    deltaEl.textContent =
      'Flat since your earliest snapshot — the next pull should show direction. (Snapshot aggregate, not cumulative paydown.)';
  }

  const { avgMonthly, windowMonths } = snapshotPaydownWindow(snapshots);
  let paceText = '';
  if (!snapshots || snapshots.length < 2) {
    paceText = 'Not enough snapshots to judge monthly pace.';
  } else if (windowMonths < 0.08) {
    paceText = 'Pulls are very close in time — more calendar span is needed to judge pace.';
  } else {
    paceText = paceQualitative(avgMonthly);
  }
  paceEl.textContent = paceText;

  const noisy = snapshotPaceIsNoisy(snapshots);
  const fr = meta && meta.freshness;
  const stale = typeof fr === 'string' && fr.startsWith('Stale');
  const shortHistory = !snapshots || snapshots.length < 2 || windowMonths < 0.08;
  if (projEl && projDebtFreeEl) {
    projEl.hidden = false;
    projDebtFreeEl.hidden = true;
    projDebtFreeEl.textContent = '';
    if (stale) {
      projEl.textContent = 'Data is outdated — refresh to see a payoff estimate.';
    } else if (shortHistory) {
      projEl.textContent = 'Need more history to estimate payoff timing.';
    } else if (avgMonthly == null || avgMonthly <= 0) {
      projEl.textContent = "Debt isn't decreasing yet — no payoff estimate.";
    } else if (noisy) {
      projEl.textContent = 'Recent progress is uneven — payoff timing is unclear.';
    } else {
      const debtRem = Number(stats && stats.debtRemaining);
      const hasDebt = Number.isFinite(debtRem) && debtRem > 0;
      const gapN = nextTier ? Number(nextTier.gapDollars) : NaN;
      let line1 = '';
      if (nextTier && Number.isFinite(gapN) && gapN > 0) {
        const mNext = gapN / avgMonthly;
        const d1 = formatApproxDurationFromMonths(mNext);
        if (d1) line1 = `At this pace: ${d1} to next stage.`;
      }
      let line2 = '';
      if (hasDebt) {
        const mFree = debtRem / avgMonthly;
        const d2 = formatApproxDurationFromMonths(mFree);
        const gapCloseToDebt = Number.isFinite(gapN) && Math.abs(debtRem - gapN) < 2;
        const monthsClose =
          Number.isFinite(gapN) && gapN > 0 && Math.abs(mFree - gapN / avgMonthly) < 0.15;
        const redundant = line1 && gapCloseToDebt && monthsClose;
        if (d2 && !redundant) line2 = `Debt-free at this pace: ${d2}.`;
      }
      if (line1 || line2) {
        projEl.textContent = line1;
        projEl.hidden = !line1;
        projDebtFreeEl.textContent = line2;
        projDebtFreeEl.hidden = !line2;
      } else {
        projEl.textContent = '';
        projEl.hidden = true;
      }
    }
  }

  if (nextTier && nextTier.gapDollars > 0) {
    const g = Number(nextTier.gapDollars);
    if (Number.isFinite(g) && fmtDollar(g) === '$0') {
      hintEl.textContent =
        'Less than $1 of paydown reaches the next payoff-stage threshold (illustrative).';
    } else {
      hintEl.textContent =
        `Roughly ${fmtDollar(g / 12)}/mo for twelve months would close the gap to the next payoff stage (illustrative).`;
    }
  } else {
    const skipWealthyExpansionCue =
      !nextTier && theme.id === 'wealthy' && stability?.id === 'exposed';
    hintEl.textContent = nextTier ? '' : (skipWealthyExpansionCue ? '' : (theme.cue || ''));
  }

  const rec = stability?.narrative?.recommend;
  if (rec) {
    hintEl.textContent = hintEl.textContent ? `${hintEl.textContent} ${rec}` : rec;
  }
}

export function renderNetWorthClimb(history) {
  const wrap = document.getElementById('vnext-nw-climb-chart-wrap');
  const emptyMsg = document.getElementById('vnext-nw-climb-empty');
  const legend = document.getElementById('vnext-nw-climb-legend');
  const latestEl = document.getElementById('vnext-nw-climb-latest');
  const changeEl = document.getElementById('vnext-nw-climb-change');
  if (!wrap) return;

  if (!history || history.length < 2) {
    if (emptyMsg) emptyMsg.hidden = false;
    if (legend) legend.hidden = true;
    const oldSvg = wrap.querySelector('svg');
    if (oldSvg) oldSvg.remove();
    return;
  }
  if (emptyMsg) emptyMsg.hidden = true;

  const W = 560, H = 200, PAD_X = 52, PAD_Y = 24;
  const plotW = W - PAD_X * 2;
  const plotH = H - PAD_Y * 2;

  const values = history.map(p => p.netWorth);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  function x(i) { return PAD_X + (i / (history.length - 1)) * plotW; }
  function y(v) { return PAD_Y + plotH - ((v - minV) / range) * plotH; }

  const points = history.map((p, i) => `${x(i).toFixed(1)},${y(p.netWorth).toFixed(1)}`);
  const polyline = points.join(' ');

  const areaPoints = [
    `${x(0).toFixed(1)},${(PAD_Y + plotH).toFixed(1)}`,
    ...points,
    `${x(history.length - 1).toFixed(1)},${(PAD_Y + plotH).toFixed(1)}`,
  ].join(' ');

  const zeroInRange = minV <= 0 && maxV >= 0;
  const zeroY = zeroInRange ? y(0).toFixed(1) : null;

  const midV = (minV + maxV) / 2;
  function fmtAxis(v) {
    const abs = Math.abs(v);
    if (abs >= 1000) return (v < 0 ? '-' : '') + '$' + (abs / 1000).toFixed(0) + 'k';
    return (v < 0 ? '-' : '') + '$' + abs.toFixed(0);
  }

  function fmtShortDate(iso) {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  const oldSvg = wrap.querySelector('svg');
  if (oldSvg) oldSvg.remove();

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'vnext-nw-climb-svg');
  svg.setAttribute('aria-label', 'Net worth over time');
  svg.setAttribute('role', 'img');

  const gridLines = [PAD_Y, PAD_Y + plotH / 2, PAD_Y + plotH];
  for (const gy of gridLines) {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', PAD_X); line.setAttribute('x2', W - PAD_X);
    line.setAttribute('y1', gy.toFixed(1)); line.setAttribute('y2', gy.toFixed(1));
    line.setAttribute('class', 'vnext-nw-grid');
    svg.appendChild(line);
  }

  if (zeroY) {
    const zLine = document.createElementNS(NS, 'line');
    zLine.setAttribute('x1', PAD_X); zLine.setAttribute('x2', W - PAD_X);
    zLine.setAttribute('y1', zeroY); zLine.setAttribute('y2', zeroY);
    zLine.setAttribute('class', 'vnext-nw-zero');
    svg.appendChild(zLine);
  }

  const defs = document.createElementNS(NS, 'defs');
  const grad = document.createElementNS(NS, 'linearGradient');
  grad.id = 'nw-fill-grad';
  grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
  grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
  const stop1 = document.createElementNS(NS, 'stop');
  stop1.setAttribute('offset', '0%'); stop1.setAttribute('class', 'vnext-nw-grad-top');
  const stop2 = document.createElementNS(NS, 'stop');
  stop2.setAttribute('offset', '100%'); stop2.setAttribute('class', 'vnext-nw-grad-bot');
  grad.appendChild(stop1); grad.appendChild(stop2);
  defs.appendChild(grad);
  svg.appendChild(defs);

  const area = document.createElementNS(NS, 'polygon');
  area.setAttribute('points', areaPoints);
  area.setAttribute('class', 'vnext-nw-area');
  svg.appendChild(area);

  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('points', polyline);
  line.setAttribute('class', 'vnext-nw-line');
  svg.appendChild(line);

  for (let i = 0; i < history.length; i++) {
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', x(i).toFixed(1));
    dot.setAttribute('cy', y(history[i].netWorth).toFixed(1));
    dot.setAttribute('r', '4');
    dot.setAttribute('class', 'vnext-nw-dot');
    svg.appendChild(dot);
  }

  const yLabels = [
    { v: maxV, py: PAD_Y + 4 },
    { v: midV, py: PAD_Y + plotH / 2 + 4 },
    { v: minV, py: PAD_Y + plotH + 4 },
  ];
  for (const lb of yLabels) {
    const txt = document.createElementNS(NS, 'text');
    txt.setAttribute('x', (PAD_X - 6).toString());
    txt.setAttribute('y', lb.py.toFixed(1));
    txt.setAttribute('class', 'vnext-nw-label vnext-nw-label-y');
    txt.textContent = fmtAxis(lb.v);
    svg.appendChild(txt);
  }

  const xFirst = document.createElementNS(NS, 'text');
  xFirst.setAttribute('x', PAD_X.toString());
  xFirst.setAttribute('y', (H - 4).toString());
  xFirst.setAttribute('class', 'vnext-nw-label vnext-nw-label-x');
  xFirst.textContent = fmtShortDate(history[0].date);
  svg.appendChild(xFirst);

  const xLast = document.createElementNS(NS, 'text');
  xLast.setAttribute('x', (W - PAD_X).toString());
  xLast.setAttribute('y', (H - 4).toString());
  xLast.setAttribute('class', 'vnext-nw-label vnext-nw-label-x vnext-nw-label-x-end');
  xLast.textContent = fmtShortDate(history[history.length - 1].date);
  svg.appendChild(xLast);

  wrap.appendChild(svg);

  if (legend && latestEl && changeEl) {
    const latest = history[history.length - 1].netWorth;
    const first = history[0].netWorth;
    const diff = latest - first;
    latestEl.textContent = `Current: ${fmtDollar(Math.abs(latest))}${latest < 0 ? ' (negative)' : ''}`;
    const sign = diff > 0 ? '+' : '';
    changeEl.textContent = `Change: ${sign}${fmtDollar(diff)}`;
    changeEl.className = 'vnext-nw-climb-change' + (diff > 0 ? ' is-up' : diff < 0 ? ' is-down' : '');
    legend.hidden = false;
  }
}
