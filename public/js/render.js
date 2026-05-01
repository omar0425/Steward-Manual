'use strict';

import { TIER_FLOW, TIER_META, tierBehaviorLine } from './tiers.js';
import { isClassicLayoutDashboardDoc, isPlayDashboardDoc } from './shell.js';
import {
  formatRunway, fmtDollar, fmtDate, fmtSignedDollar,
  formatNetWorthValue, formatNextTierGapHeadline, formatNextTierGapBoardAmount,
  formatNextTierGapMoneyPrefix, nextMoveGuidance,
  TOOLTIP_LIQUID_CUSHION_RUNWAY,
  WEALTHY_EXPOSED_HERO_PRIMARY,
  formatHeroBreathingRoomLine,
  formatBoardRunwayHelperLine, liquidityGuardExplanation, buildLiquidityPillTooltip,
  formatPaidDownDisplay, cumulativePaidDownFromStats, lifetimeProgressPctFromCumulative,
  paidDownDetailTooltip, formatClimbNetChangeDollars,
  fmtSignedDebtDelta, formatLastPullAccountRow, formatNetThisTurnLine,
  lastPullAccountRowsFromStats,
  debtTierBandBarDisplay, syncDebtTierBandDebugOverlay,
  snapshotPaydownWindow, snapshotPaceIsNoisy, snapshotDeltaSinceOldest,
  paceQualitative, formatApproxDurationFromMonths, timeAgo,
} from './format.js';
import { upgradeDashboardLayout, applyDashboardTheme, renderTierRail, setupHeroInteraction } from './layout.js';
import { mountHeroCharacter } from './character.js';
import { stewardApiUrl } from './api.js';

let lastRenderedCumulativePaidDown = null;
let lastRenderedBreathingRoomPct = null;

/* ── Interest rates + debt sort + spark line history ─────────────────────── */
let _aprRates = {};
let _debtHistory = {};
let _lastDebtStats = null;
let _debtSortMode = (() => {
  try { return localStorage.getItem('steward-debt-sort') || 'balance'; } catch { return 'balance'; }
})();

async function loadDebtPanelData(options = {}) {
  const rerender = options.rerender !== false;
  try {
    const [ratesRes, histRes] = await Promise.all([
      fetch(stewardApiUrl('/api/config/interest-rates')),
      fetch(stewardApiUrl(`/api/debt-history?t=${Date.now()}`)),
    ]);
    const ratesData = await ratesRes.json();
    const histData  = await histRes.json();
    _aprRates    = (ratesData && typeof ratesData.rates === 'object' && !Array.isArray(ratesData.rates)) ? ratesData.rates : {};
    _debtHistory = (histData && typeof histData.byAccount === 'object') ? histData.byAccount : {};
  } catch { _aprRates = {}; _debtHistory = {}; }
  if (rerender && _lastDebtStats) fillDebtAccountsList(_lastDebtStats);
}

loadDebtPanelData();

export async function refreshDebtPanelData() {
  await loadDebtPanelData({ rerender: false });
}

export function setDebtSortMode(mode) {
  _debtSortMode = mode;
  try { localStorage.setItem('steward-debt-sort', mode); } catch {}
  if (_lastDebtStats) fillDebtAccountsList(_lastDebtStats);
}

async function saveAprRates() {
  try {
    const res = await fetch(stewardApiUrl('/api/config/interest-rates'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rates: _aprRates }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function toggleAprForm() {
  const panel = document.getElementById('apr-form-panel');
  const btn = document.getElementById('apr-edit-btn');
  if (!panel) return;
  if (!panel.hidden) {
    panel.hidden = true;
    if (btn) btn.classList.remove('active');
    return;
  }
  buildAprForm(panel);
  panel.hidden = false;
  if (btn) btn.classList.add('active');
}

function buildAprForm(panel) {
  const accounts = (_lastDebtStats && _lastDebtStats.debtAccountLines) || [];
  panel.innerHTML = '';

  const form = document.createElement('form');
  form.className = 'apr-form';

  for (const acct of accounts) {
    const row = document.createElement('div');
    row.className = 'apr-form-row';

    const label = document.createElement('label');
    label.className = 'apr-form-label';
    label.textContent = acct.name || 'Account';
    label.htmlFor = `apr-input-${acct.id}`;

    const wrap = document.createElement('div');
    wrap.className = 'apr-form-input-wrap';

    const input = document.createElement('input');
    input.type = 'number';
    input.id = `apr-input-${acct.id}`;
    input.min = '0';
    input.max = '100';
    input.step = '0.01';
    input.className = 'apr-form-input';
    input.dataset.accountId = acct.id;
    input.placeholder = '—';
    const rateVal = _aprRates[acct.id];
    if (rateVal != null && Number.isFinite(rateVal)) input.value = rateVal;

    const suffix = document.createElement('span');
    suffix.className = 'apr-form-suffix';
    suffix.textContent = '%';

    wrap.appendChild(input);
    wrap.appendChild(suffix);
    row.appendChild(label);
    row.appendChild(wrap);
    form.appendChild(row);
  }

  const actions = document.createElement('div');
  actions.className = 'apr-form-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'apr-form-cancel';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    panel.hidden = true;
    const btn = document.getElementById('apr-edit-btn');
    if (btn) btn.classList.remove('active');
  });

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'apr-form-save';
  save.textContent = 'Save rates';
  save.addEventListener('click', async () => {
    const inputs = form.querySelectorAll('.apr-form-input');
    for (const inp of inputs) {
      const id = inp.dataset.accountId;
      const raw = inp.value.trim();
      if (raw === '') {
        delete _aprRates[id];
      } else {
        const val = parseFloat(raw);
        if (Number.isFinite(val) && val >= 0 && val <= 100) {
          _aprRates[id] = Math.round(val * 100) / 100;
        }
      }
    }
    save.disabled = true;
    save.textContent = 'Saving…';
    const ok = await saveAprRates();
    save.disabled = false;
    if (!ok) {
      save.textContent = 'Save failed — retry';
      save.style.color = 'var(--neg, #f87171)';
      return;
    }
    save.textContent = 'Save rates';
    save.style.color = '';
    panel.hidden = true;
    const btn = document.getElementById('apr-edit-btn');
    if (btn) btn.classList.remove('active');
    if (_lastDebtStats) fillDebtAccountsList(_lastDebtStats);
  });

  actions.appendChild(cancel);
  actions.appendChild(save);
  form.appendChild(actions);
  panel.appendChild(form);

  // Focus first empty input, or first input
  const firstEmpty = form.querySelector('.apr-form-input:not([value])') ||
                     [...form.querySelectorAll('.apr-form-input')].find(i => !i.value);
  const firstInput = form.querySelector('.apr-form-input');
  (firstEmpty || firstInput)?.focus();
}

function renderBrokerageFootnote() {
  const sub = document.getElementById('stat-brok-sub');
  if (!sub) return;
  sub.hidden = true;
  sub.textContent = '';
}

const VNEXT_HERO_TURN_ACCOUNTS_TOP = 3;

/** Brutal bullet list for the consolidated /play “Stage progress — detail” panel. */
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
  const paidVal = paid != null && Number.isFinite(paid) ? fmtDollar(Math.round(paid)) : '—';
  if (elPaid) elPaid.innerHTML = `<span class="sp-label">Total paid down</span><span class="sp-val sp-val--good">${paidVal}</span>`;
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
  if (elDir) {
    let d = 'flat'; let dirClass = '';
    if (stats && stats.debtDirection === 'increasing') { d = 'backward'; dirClass = 'sp-val--bad'; }
    else if (netThisTurn > 0) { d = 'backward'; dirClass = 'sp-val--bad'; }
    else if (netThisTurn < 0) { d = 'forward'; dirClass = 'sp-val--good'; }
    elDir.innerHTML = `<span class="sp-label">Net direction</span><span class="sp-val ${dirClass}">${d}</span>`;
  }
}

/**
 * vNext only: top account deltas under “Your climb” (same stats as progress module; no extra fetch).
 */
function fillVnextHeroTurnAccounts(stats) {
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

function fillProgressNarrative({
  nextTier,
  snapshots,
  theme,
  stability,
  debtSync,
  meta,
  stats,
  suspectedRestructure,
}) {
  const restructureFlag =
    suspectedRestructure === true || !!(debtSync && debtSync.suspected_restructure);
  const restructureEl = document.getElementById('progress-restructure-note');
  if (restructureEl) {
    if (restructureFlag) {
      restructureEl.textContent =
        'This may reflect a refinance or account change, not a true payoff.';
      restructureEl.hidden = false;
    } else {
      restructureEl.textContent = '';
      restructureEl.hidden = true;
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
    } else if (restructureFlag) {
      projEl.textContent = 'Recent account changes make the payoff estimate unreliable.';
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

export function render(status, snapshots) {
  if (!status.ready) return;

  upgradeDashboardLayout();

  const { tier, stats, nextTier, meta, stability } = status;
  const theme = TIER_META[tier.id] || TIER_FLOW[0];
  /* If API omits stability, assume middle liquidity band (id stabilizing, label Steady). */
  const stab = stability || { id: 'stabilizing', label: 'Steady', narrative: {} };
  const classicDoc = isClassicLayoutDashboardDoc();
  const runwayText = formatRunway(stats.monthsAhead);
  const netWorthText = formatNetWorthValue(stats.netWorth);
  const paidShown = cumulativePaidDownFromStats(stats);
  const paidTooltip = paidDownDetailTooltip(stats);
  const paidDisplay = formatPaidDownDisplay(paidShown, paidTooltip);
  /* Dollars headline = primary product signal; in-band bar width uses inBandBarDisplayPct only (secondary). */
  const { rawPct: tierBarRawInBandPct, displayPct: inBandBarDisplayPct } = debtTierBandBarDisplay(stats);
  syncDebtTierBandDebugOverlay(stats, tierBarRawInBandPct, inBandBarDisplayPct);

  applyDashboardTheme(tier.id, stab.id);
  setupHeroInteraction();
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

  document.getElementById('hero-tier-label').textContent = tier.label;
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

  // Momentum streak
  const streakEl = document.getElementById('streak-line');
  if (streakEl) {
    const streak = status.streak;
    if (streak && streak.current > 0) {
      streakEl.textContent = `\uD83D\uDD25 ${streak.current}-period streak`;
      streakEl.hidden = false;
    } else if (streak && streak.current === 0 && streak.lastBroken > 0) {
      streakEl.textContent = `You broke a ${streak.lastBroken}-period streak. Start a new one.`;
      streakEl.hidden = false;
    } else {
      streakEl.textContent = '';
      streakEl.hidden = true;
    }
  }

  document.getElementById('card-badge-chip').textContent = tier.badge;
  document.getElementById('card-tier-name').textContent = tier.label;
  const gapHeadline = formatNextTierGapHeadline(nextTier, tier);
  const boardGapAmount = formatNextTierGapBoardAmount(nextTier);
  document.getElementById('card-tier-gap-headline').textContent = gapHeadline;
  const heroEscapeEl = document.getElementById('hero-escape-primary');
  if (heroEscapeEl) heroEscapeEl.textContent = gapHeadline;

  const cardBarTrack = document.querySelector('.card-bar-track');
  if (cardBarTrack) {
    cardBarTrack.title =
      'Thin bar: position inside this payoff stage only. The prominent line above states your dollar gap to escape this stage.';
  }
  document.getElementById('card-bar-fill').style.width = `${inBandBarDisplayPct}%`;
  const cardBarInbandPct = document.getElementById('card-bar-inband-pct');
  if (cardBarInbandPct) {
    cardBarInbandPct.textContent = '';
    cardBarInbandPct.hidden = true;
    cardBarInbandPct.setAttribute('aria-hidden', 'true');
  }
  document.getElementById('card-footer-debt').textContent = `${fmtDollar(stats.debtRemaining)} debt remaining`;

  document.getElementById('stat-debt-remaining').textContent = fmtDollar(stats.debtRemaining);
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
    const prev = lastRenderedCumulativePaidDown;
    if (prev != null && Number.isFinite(prev) && paidShown > prev) {
      paidFeedbackEl.textContent = `+${fmtDollar(paidShown - prev)} since last refresh`;
      paidFeedbackEl.hidden = false;
    } else {
      paidFeedbackEl.textContent = '';
      paidFeedbackEl.hidden = true;
    }
  }
  const boardGapLabelEl = document.getElementById('board-tier-gap-label');
  if (boardGapLabelEl) boardGapLabelEl.textContent = 'Stage gap';
  document.getElementById('board-tier-gap-headline').textContent = boardGapAmount;
  /* nextTier.nextCopy (GET /api/status) — threshold meaning line; server sends current tier copy */
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
    /* Name = label + dollars headline (HTML aria-labelledby). valuetext = in-band bar only so SR does not treat % as overall payoff. */
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
  renderBrokerageFootnote();
  const statMonthsAhead = document.getElementById('stat-months-ahead');
  if (statMonthsAhead) {
    statMonthsAhead.textContent = runwayText;
    statMonthsAhead.title = '';
  }
  const tierCurrent = document.getElementById('next-tier-current');
  const tierTarget = document.getElementById('next-tier-target');
  if (tierCurrent) tierCurrent.textContent = `${tier.badge} · ${tier.label}`;
  if (tierTarget) {
    tierTarget.textContent = nextTier ? `${nextTier.badge} · ${nextTier.label}` : 'Final payoff stage';
  }

  fillProgressNarrative({
    nextTier,
    snapshots,
    theme,
    stability: stab,
    debtSync: status.debug && status.debug.debtSync,
    meta,
    stats,
    suspectedRestructure: status.suspectedRestructure,
  });

  fillVnextHeroTurnAccounts(stats);

  const boardDebtAxis = document.getElementById('board-debt-axis');
  const boardLiqPill = document.getElementById('board-liquidity-pill');
  if (boardDebtAxis) {
    boardDebtAxis.textContent = `Payoff stage: ${tier.badge} · ${tier.label}`;
    boardDebtAxis.className = 'board-stability-pill board-axis-debt';
  }
  /* Same breathing-room id/label rules as hero pill. */
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
    const invPct = Math.round(
      (stab.components && stab.components.investedWeightUsed != null ? stab.components.investedWeightUsed
        : 0.35) * 100,
    );
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
  freshnessBadge.textContent = meta.freshness;
  freshnessBadge.className = 'data-chip-v fresh freshness-dot';
  if (meta.freshness.startsWith('Stale')) { freshnessBadge.classList.remove('fresh'); freshnessBadge.classList.add('stale'); }
  else if (meta.freshness.includes('h ago')) { freshnessBadge.classList.remove('fresh'); freshnessBadge.classList.add('aged'); }

  // ── Net Worth Climb chart ──
  renderNetWorthClimb(status.netWorthHistory);

  // ── Debt accounts list (new layout) ──
  fillDebtAccountsList(stats);
  fillThisTurnPanel(stats);

  if (typeof window.stewardVnextEnhance === 'function') {
    window.stewardVnextEnhance({ tier, stats, nextTier, meta, stability: stab, snapshots, streak: status.streak });
  }

  lastRenderedCumulativePaidDown = paidShown;
}

/* ── Spark line SVG ───────────────────────────────────────────────────────── */

function buildSparklineSvg(points) {
  if (!points || points.length < 2) return null;
  const W = 60, H = 14;
  const min = Math.min(...points);
  const max = Math.max(...points);
  if (max === min) return null;
  const range = max - min || 1;
  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * W;
    const y = H - ((v - min) / range) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const trend = points[points.length - 1] - points[0];
  const color = trend < 0 ? 'var(--emerald)' : trend > 0 ? 'var(--rose)' : 'var(--text-3)';
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.style.cssText = 'display:block;overflow:visible';
  const poly = document.createElementNS(ns, 'polyline');
  poly.setAttribute('points', coords);
  poly.setAttribute('fill', 'none');
  poly.setAttribute('stroke', color);
  poly.setAttribute('stroke-width', '1.5');
  poly.setAttribute('stroke-linejoin', 'round');
  poly.setAttribute('stroke-linecap', 'round');
  svg.appendChild(poly);
  return svg;
}

function buildDebtBalanceBar(balance, maxBalance) {
  const b = Number(balance);
  const m = Number(maxBalance);
  if (!Number.isFinite(b) || !Number.isFinite(m) || b <= 0 || m <= 0) return null;

  const W = 60;
  const H = 14;
  const fillW = Math.max(4, Math.min(W, (b / m) * W));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('aria-label', 'Debt balance share');
  svg.style.cssText = 'display:block;overflow:visible';

  const track = document.createElementNS(ns, 'line');
  track.setAttribute('x1', '0');
  track.setAttribute('x2', String(W));
  track.setAttribute('y1', String(H / 2));
  track.setAttribute('y2', String(H / 2));
  track.setAttribute('stroke', 'rgba(108, 93, 72, 0.22)');
  track.setAttribute('stroke-width', '2.5');
  track.setAttribute('stroke-linecap', 'round');

  const fill = document.createElementNS(ns, 'line');
  fill.setAttribute('x1', '0');
  fill.setAttribute('x2', fillW.toFixed(1));
  fill.setAttribute('y1', String(H / 2));
  fill.setAttribute('y2', String(H / 2));
  fill.setAttribute('stroke', 'var(--gold)');
  fill.setAttribute('stroke-width', '2.5');
  fill.setAttribute('stroke-linecap', 'round');

  svg.appendChild(track);
  svg.appendChild(fill);
  return svg;
}

function latestDebtHistoryDelta(accountId) {
  const rows = _debtHistory[accountId];
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const latest = Number(rows[rows.length - 1] && rows[rows.length - 1].balance);
  if (!Number.isFinite(latest)) return null;
  for (let i = rows.length - 2; i >= 0; i--) {
    const prev = Number(rows[i] && rows[i].balance);
    if (!Number.isFinite(prev)) continue;
    const delta = Math.round((latest - prev) * 100) / 100;
    if (delta !== 0) return delta;
  }
  return 0;
}

/* ── Debt Accounts List (new layout panel) ────────────────────────────────── */

function fillDebtAccountsList(stats) {
  _lastDebtStats = stats;
  const listEl = document.getElementById('debt-accounts-list');
  const totalEl = document.getElementById('debt-total-val');
  if (!listEl) return;

  // Sync sort toggle active state
  document.querySelectorAll('.sort-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === _debtSortMode);
  });

  listEl.textContent = '';

  // ── Game-start row (always shown when game is active) ──
  const gsRow  = document.getElementById('game-start-row');
  const gsMeta = document.getElementById('game-start-meta');
  const gsVal  = document.getElementById('game-start-val');
  if (gsRow && gsMeta && gsVal) {
    const gd = stats && stats.gameStartDebt;
    const ga = stats && stats.gameStartAt;
    if (gd != null && Number.isFinite(gd)) {
      const dateLabel = ga
        ? new Date(ga).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        : '';
      const paidDown = gd - (stats.debtRemaining || 0);
      gsMeta.textContent = dateLabel;
      gsVal.textContent  = fmtDollar(gd);
      gsVal.title        = paidDown >= 0
        ? `${fmtDollar(paidDown)} paid down since game start`
        : '';
      gsRow.hidden = false;
    } else {
      gsRow.hidden = true;
    }
  }

  // ── Commitment reason (always shown when set) ──
  const reasonEl = document.getElementById('commitment-reason-display');
  if (reasonEl) {
    try {
      const reason = localStorage.getItem('steward_promise_text');
      if (reason && reason.trim()) {
        reasonEl.textContent = reason.trim();
        reasonEl.hidden = false;
      } else {
        reasonEl.hidden = true;
      }
    } catch (_) {
      reasonEl.hidden = true;
    }
  }

  let accounts = stats && stats.debtAccountLines;
  if (!accounts || !Array.isArray(accounts) || accounts.length === 0) return;

  accounts = [...accounts];
  if (_debtSortMode === 'apr') {
    accounts.sort((a, b) => {
      const ra = (_aprRates[a.id] != null) ? _aprRates[a.id] : -1;
      const rb = (_aprRates[b.id] != null) ? _aprRates[b.id] : -1;
      return rb - ra;
    });
  } else {
    accounts.sort((a, b) => Number(b.balance) - Number(a.balance));
  }
  const maxBalance = accounts.reduce((max, acct) => {
    const b = Number(acct && acct.balance);
    return Number.isFinite(b) && b > max ? b : max;
  }, 0);

  for (const acct of accounts) {
    const balance = Number(acct.balance);
    if (!Number.isFinite(balance)) continue;

    const row = document.createElement('div');
    row.className = 'debt-row';

    const name = document.createElement('span');
    name.className = 'dr-name debt-row-name';
    name.textContent = acct.name || 'Account';

    const aprEl = document.createElement('span');
    aprEl.className = 'dr-apr';
    const rateVal = _aprRates[acct.id];
    aprEl.textContent = (rateVal != null && Number.isFinite(rateVal)) ? `${rateVal}%` : '—';

    const amount = document.createElement('span');
    amount.className = 'dr-balance debt-row-balance';
    amount.textContent = fmtDollar(balance);

    const deltaEl = document.createElement('span');
    const latestDelta = latestDebtHistoryDelta(acct.id);
    deltaEl.className = 'dr-delta';
    if (latestDelta == null || latestDelta === 0) {
      deltaEl.textContent = '';
      deltaEl.setAttribute('aria-label', 'No recent account balance change');
    } else {
      deltaEl.textContent = fmtSignedDollar(latestDelta);
      deltaEl.classList.add(latestDelta < 0 ? 'down' : 'up');
      deltaEl.title = 'Most recent account balance change';
    }

    const sparkWrap = document.createElement('span');
    sparkWrap.className = 'dr-spark';
    const histPoints = (_debtHistory[acct.id] || []).map(p => p.balance);
    const sparkSvg = buildSparklineSvg(histPoints);
    sparkWrap.appendChild(sparkSvg || buildDebtBalanceBar(balance, maxBalance));

    row.appendChild(name);
    row.appendChild(aprEl);
    row.appendChild(amount);
    row.appendChild(deltaEl);
    row.appendChild(sparkWrap);
    listEl.appendChild(row);
  }

  if (totalEl && stats.debtRemaining != null) totalEl.textContent = fmtDollar(stats.debtRemaining);
}

function fillThisTurnPanel(stats) {
  const listEl = document.getElementById('this-turn-list');
  const netEl = document.getElementById('this-turn-net');
  const sinceEl = document.getElementById('turn-since-label');
  if (!listEl) return;

  // Turn-start date label
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
  if (accountLines.length === 0 && ndVal === 0 && pdVal === 0) return;

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
    netEl.textContent = fmtSignedDollar(netThisTurn);
    netEl.className = 'session-net-val ' + (netThisTurn < 0 ? 'neg' : netThisTurn > 0 ? 'pos' : '');
    const sessionCard = document.getElementById('session-card');
    if (sessionCard) {
      sessionCard.classList.toggle('session-card--good', netThisTurn < 0);
      sessionCard.classList.toggle('session-card--bad', netThisTurn > 0);
    }
  }
}

/* ── Net Worth Climb SVG chart ────────────────────────────────────────────── */

function renderNetWorthClimb(history) {
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

  // Gradient fill area
  const areaPoints = [
    `${x(0).toFixed(1)},${(PAD_Y + plotH).toFixed(1)}`,
    ...points,
    `${x(history.length - 1).toFixed(1)},${(PAD_Y + plotH).toFixed(1)}`,
  ].join(' ');

  // Zero line position (if zero is within range)
  const zeroInRange = minV <= 0 && maxV >= 0;
  const zeroY = zeroInRange ? y(0).toFixed(1) : null;

  // Y-axis labels (min, mid, max)
  const midV = (minV + maxV) / 2;
  function fmtAxis(v) {
    const abs = Math.abs(v);
    if (abs >= 1000) return (v < 0 ? '-' : '') + '$' + (abs / 1000).toFixed(0) + 'k';
    return (v < 0 ? '-' : '') + '$' + abs.toFixed(0);
  }

  // X-axis labels (first and last date)
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

  // Grid lines
  const gridLines = [PAD_Y, PAD_Y + plotH / 2, PAD_Y + plotH];
  for (const gy of gridLines) {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', PAD_X); line.setAttribute('x2', W - PAD_X);
    line.setAttribute('y1', gy.toFixed(1)); line.setAttribute('y2', gy.toFixed(1));
    line.setAttribute('class', 'vnext-nw-grid');
    svg.appendChild(line);
  }

  // Zero line
  if (zeroY) {
    const zLine = document.createElementNS(NS, 'line');
    zLine.setAttribute('x1', PAD_X); zLine.setAttribute('x2', W - PAD_X);
    zLine.setAttribute('y1', zeroY); zLine.setAttribute('y2', zeroY);
    zLine.setAttribute('class', 'vnext-nw-zero');
    svg.appendChild(zLine);
  }

  // Gradient definition
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

  // Area fill
  const area = document.createElementNS(NS, 'polygon');
  area.setAttribute('points', areaPoints);
  area.setAttribute('class', 'vnext-nw-area');
  svg.appendChild(area);

  // Line
  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('points', polyline);
  line.setAttribute('class', 'vnext-nw-line');
  svg.appendChild(line);

  // Data dots
  for (let i = 0; i < history.length; i++) {
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', x(i).toFixed(1));
    dot.setAttribute('cy', y(history[i].netWorth).toFixed(1));
    dot.setAttribute('r', '4');
    dot.setAttribute('class', 'vnext-nw-dot');
    svg.appendChild(dot);
  }

  // Y-axis labels
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

  // X-axis labels
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

  // Legend
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
