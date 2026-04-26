'use strict';

/**
 * Preview-only enhancements for /steward-vnext.
 * Core numbers and tier labels come from app.js render() + /api/status.
 */

let narrativeCache = null;

async function loadNarrative() {
  if (narrativeCache) return narrativeCache;
  const url =
    typeof window !== 'undefined' && typeof window.stewardApiUrl === 'function'
      ? window.stewardApiUrl('/debt-tier-narrative.json')
      : '/debt-tier-narrative.json';
  const res = await fetch(url);
  if (!res.ok) throw new Error('debt-tier-narrative.json');
  narrativeCache = await res.json();
  return narrativeCache;
}

function fmtDollarLocal(n) {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const str = '$' + abs.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return n < 0 ? '-' + str : str;
}

/** Matches `formatNextTierGapMoneyPrefix` in app.js for journey gap copy. */
function formatJourneyGapMoney(gapDollars) {
  const g = Number(gapDollars);
  if (!Number.isFinite(g) || g <= 0) return fmtDollarLocal(0);
  const r = fmtDollarLocal(g);
  return r === '$0' ? '< $1' : r;
}

/** Final debt dollars toward $0 (positive debt → dollar string; tiny positive → &lt; $1). */
function formatJourneyGoalMoney(debtDollars) {
  const g = Number(debtDollars);
  if (!Number.isFinite(g) || g <= 0) return fmtDollarLocal(0);
  const r = fmtDollarLocal(g);
  return r === '$0' ? '< $1' : r;
}

/** Matches `fmtDate` in app.js (used for checkpoint copy consistency with the data strip). */
function fmtDateCheckpoint(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Local calendar anchors at 6:00 AM — same construction as `nextScheduledTimes` in routes/api.js
 * (1st, 15th, last day of the current month).
 */
function stewardMonthPullAnchors(now) {
  const y = now.getFullYear();
  const m = now.getMonth();
  return [
    { key: 'begin', label: 'Month-start gate', at: new Date(y, m, 1, 6, 0, 0) },
    { key: 'mid', label: 'Mid-month gate', at: new Date(y, m, 15, 6, 0, 0) },
    { key: 'end', label: 'Month-end gate', at: new Date(y, m + 1, 0, 6, 0, 0) },
  ];
}

/**
 * Short hero supporting copy for vNext only (render() still owns tier data; this trims noise after paint).
 */
function applyVnextHeroStoryCopy(tier, stab, narr) {
  const heroCopyEl = document.getElementById('hero-tier-copy');
  if (!heroCopyEl) return;
  const isWealthyExposed = tier.id === 'wealthy' && stab && stab.id === 'exposed';
  if (isWealthyExposed) {
    heroCopyEl.textContent =
      'Debt is at zero. Breathing room is still thin — build cushion before you stretch.';
    return;
  }
  if (tier.id === 'rock_bottom') {
    heroCopyEl.textContent =
      'In the hole. The meter is running. The amount above is dollars to your next payoff stage.';
    return;
  }
  const row = narr && narr.tiers && narr.tiers[tier.id];
  const tag = row && row.climbTagline;
  if (tag) {
    heroCopyEl.textContent = tag.length > 100 ? `${tag.slice(0, 97).trim()}…` : tag;
    return;
  }
  heroCopyEl.textContent = `On ${tier.label}: the headline dollars mark distance to your next payoff stage.`;
}

/** In-band % threshold for vNext “finish line” emphasis (reads `aria-valuenow` only). */
const VNEXT_NEAR_STAGE_PCT = 85;

/**
 * Near-finish cue above the bar (≥85% from `aria-valuenow` only; preview copy).
 * @param {number} pct
 */
function pickVnextFinishCueText(pct) {
  if (!Number.isFinite(pct)) return '';
  if (pct >= 90) return 'Finish this stage.';
  if (pct >= VNEXT_NEAR_STAGE_PCT) return 'Push through. You\u2019re almost there.';
  return '';
}

function syncVnextNearStageChrome(isNear, pct) {
  const root = document.getElementById('dashboard-vnext');
  const cue = document.getElementById('vnext-progress-finish-cue');
  if (root) root.classList.toggle('is-near-stage-finish', isNear);
  if (cue) cue.textContent = isNear ? pickVnextFinishCueText(pct) : '';
}

/**
 * Cumulative tier axis from `stats.debtTierJourney` (GET /api/status). No client-side climb math.
 * @param {object} stats
 * @param {{ id: string }|null|undefined} tier
 * @param {object|null|undefined} nextTier
 */
function fillVnextDebtJourney(stats, tier, nextTier) {
  const panel = document.getElementById('vnext-journey-panel');
  const root = document.getElementById('vnext-journey-visual');
  const track = document.getElementById('vnext-journey-track');
  const fill = document.getElementById('vnext-journey-fill');
  const ticksEl = document.getElementById('vnext-journey-ticks');
  const marker = document.getElementById('vnext-journey-marker');
  const lineNext = document.getElementById('vnext-journey-line-next');
  const lineGoal = document.getElementById('vnext-journey-line-goal');
  const statNext = document.getElementById('vnext-journey-stat-next');
  const statGoal = document.getElementById('vnext-journey-stat-goal');

  if (!panel || !root || !track) return;

  const j = stats && stats.debtTierJourney;
  if (!j) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  root.hidden = false;

  const pctRaw = Number(j.pctAlongJourney);
  const safePct = Number.isFinite(pctRaw) ? Math.min(100, Math.max(0, pctRaw)) : 0;
  if (fill) fill.style.width = `${safePct}%`;
  if (marker) marker.style.left = `${safePct}%`;

  if (ticksEl) {
    ticksEl.textContent = '';
    const list = Array.isArray(j.ticks) ? j.ticks : [];
    for (const t of list) {
      const tick = document.createElement('span');
      tick.className = 'vnext-journey-tick' + (t.isNextStageLine ? ' is-next-boundary' : '');
      const p = Number(t.tickPct);
      tick.style.left = `${Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0}%`;
      tick.title = `${t.badge} — debt threshold $${Number(t.threshold).toLocaleString('en-US')}`;
      ticksEl.appendChild(tick);
    }
  }

  const nbp = Number(j.nextTierBoundaryPct);
  const nextPct = Number.isFinite(nbp) ? Math.min(100, Math.max(0, nbp)) : 0;
  const hideNextLine =
    !nextTier || (tier && tier.id === 'winning');
  if (lineNext) {
    lineNext.hidden = hideNextLine;
    if (!hideNextLine) lineNext.style.left = `${nextPct}%`;
  }

  if (lineGoal) {
    lineGoal.style.left = '100%';
    lineGoal.hidden = false;
  }

  track.setAttribute('aria-valuenow', String(Math.round(safePct)));
  track.setAttribute(
    'aria-valuetext',
    `${safePct.toFixed(1)}% along the full payoff axis from the ladder top to zero debt.`,
  );

  const toNext = Number(j.dollarsToNextTier);
  const toGoal = Number(j.dollarsToFinalGoal);

  if (statNext) {
    if (!nextTier) {
      statNext.textContent = `${fmtDollarLocal(0)} to next tier`;
    } else {
      statNext.textContent = `${formatJourneyGapMoney(toNext)} to next tier`;
    }
  }

  if (statGoal) {
    statGoal.textContent = `${formatJourneyGoalMoney(toGoal)} to final goal`;
  }
}

function fillVnextProgressReadout() {
  const w = document.getElementById('command-progress-widget');
  const out = document.getElementById('vnext-inband-pct-readout');
  if (!w || !out) return;
  const n = parseFloat(w.getAttribute('aria-valuenow'), 10);
  if (!Number.isFinite(n)) {
    out.textContent = '';
    syncVnextNearStageChrome(false, NaN);
    return;
  }
  out.textContent = `${n.toFixed(1)}% of this stage`;
  syncVnextNearStageChrome(n >= VNEXT_NEAR_STAGE_PCT, n);
}

const VNEXT_LS_LAST_INBAND_PCT = 'stewardVnextLastInbandPct';
const VNEXT_LS_FORWARD_STREAK = 'stewardVnextForwardStreak';

function roundPctSnapshot(n) {
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;
}

/**
 * Parse dollar gap from `#board-tier-gap-headline` text (dollars-only row) or legacy full headline strings.
 * @returns {{ kind: 'amount', gap: number } | { kind: 'final' } | { kind: 'unknown' }}
 */
function parseGapDollarsFromBoardHeadline(headline) {
  const h = (headline || '').trim();
  if (!h || h === '—') return { kind: 'unknown' };
  if (/final\s+payoff/i.test(h)) return { kind: 'final' };
  if (/^at\s+the\s+threshold/i.test(h)) return { kind: 'amount', gap: 0 };
  if (/^<\s*\$1$/i.test(h)) return { kind: 'amount', gap: 1 };
  const plain = h.match(/^\$([\d,]+)$/);
  if (plain) {
    const gap = parseInt(plain[1].replace(/,/g, ''), 10);
    if (Number.isFinite(gap) && gap >= 0) return { kind: 'amount', gap };
  }
  const mEscape = h.match(/^(\$[\d,]+|<\s*\$1)\s+to\s+escape\s+/i);
  if (mEscape) {
    const raw = mEscape[1].trim();
    if (/^<\s*\$1/i.test(raw)) return { kind: 'amount', gap: 1 };
    const gap = parseInt(raw.replace(/[$,]/g, ''), 10);
    if (Number.isFinite(gap) && gap >= 0) return { kind: 'amount', gap };
  }
  const mReach = h.match(/^(\$[\d,]+|<\s*\$1)\s+to\s+reach\s+/i);
  if (mReach) {
    const raw = mReach[1].trim();
    if (/^<\s*\$1/i.test(raw)) return { kind: 'amount', gap: 1 };
    const gap = parseInt(raw.replace(/[$,]/g, ''), 10);
    if (Number.isFinite(gap) && gap >= 0) return { kind: 'amount', gap };
  }
  const m = h.match(/^\$([\d,]+)\s+left\s+to\s+/i);
  if (m) {
    const gap = parseInt(m[1].replace(/,/g, ''), 10);
    if (Number.isFinite(gap) && gap >= 0) return { kind: 'amount', gap };
  }
  return { kind: 'unknown' };
}

/** Monthly pacing nudge: gap/30, rounded to nearest $5 (min $5 when gap > 0). */
function computeTodayMoveDollars(gap) {
  if (gap == null || gap <= 0) return null;
  const raw = gap / 30;
  let x = Math.round(raw / 5) * 5;
  if (x < 5) x = 5;
  return x;
}

function setVnextTodayPrimaryWithAmount(primaryEl, x) {
  primaryEl.textContent = '';
  primaryEl.appendChild(document.createTextNode('Move '));
  const amt = document.createElement('span');
  amt.className = 'vnext-today-amount';
  amt.textContent = fmtDollarLocal(x);
  primaryEl.appendChild(amt);
  primaryEl.appendChild(document.createTextNode(' today'));
}

/**
 * Dollar token as shown in `#board-tier-gap-headline` (no formatting math).
 * @returns {string|null}
 */
function moneyTokenFromBoardHeadline(headline) {
  const h = (headline || '').trim();
  if (/^(?:\$[\d,]+|<\s*\$1)$/i.test(h)) return h.replace(/\s+/g, ' ').trim();
  const m2 = h.match(/^(\$[\d,]+|<\s*\$1)\s+to\s+escape\s+/i);
  if (m2) return m2[1].replace(/\s+/g, ' ').trim();
  const m = h.match(/^(\$[\d,]+|<\s*\$1)\s+left\s+to\s+/i);
  if (!m) return null;
  return m[1].replace(/\s+/g, ' ').trim();
}

function setVnextTodayGapLine(gapLineEl, headline) {
  if (!gapLineEl) return;
  const token = moneyTokenFromBoardHeadline(headline);
  gapLineEl.textContent = token ? `You\u2019re ${token} from the next stage.` : '';
}

function fillVnextTodayBlock() {
  const primaryEl = document.getElementById('vnext-today-primary');
  const gapLineEl = document.getElementById('vnext-today-gap-line');
  const feedbackEl = document.getElementById('vnext-today-feedback');
  const streakEl = document.getElementById('vnext-today-streak');
  if (!primaryEl) return;

  const boardGapEl = document.getElementById('board-tier-gap-headline');
  const headline = (boardGapEl?.textContent || '').trim();
  const parsed = parseGapDollarsFromBoardHeadline(headline);

  if (parsed.kind === 'final') {
    primaryEl.textContent = 'Final stretch — hold the line today.';
  } else if (parsed.kind === 'amount' && parsed.gap === 0) {
    primaryEl.textContent = 'At the threshold — even a small payment shifts the bar.';
  } else if (parsed.kind === 'amount') {
    const x = computeTodayMoveDollars(parsed.gap);
    if (x != null) {
      setVnextTodayPrimaryWithAmount(primaryEl, x);
    } else {
      primaryEl.textContent = 'Match today to the pace in the progress block above.';
    }
  } else {
    primaryEl.textContent = 'Match today to the pace in the progress block above.';
  }

  const w = document.getElementById('command-progress-widget');
  const currentRaw = w ? parseFloat(w.getAttribute('aria-valuenow'), 10) : NaN;
  const current = roundPctSnapshot(currentRaw);

  setVnextTodayGapLine(gapLineEl, headline);

  let lastStored = null;
  let prevStreak = 0;
  try {
    const s = localStorage.getItem(VNEXT_LS_LAST_INBAND_PCT);
    if (s != null && s !== '') {
      const n = parseFloat(s, 10);
      if (Number.isFinite(n)) lastStored = roundPctSnapshot(n);
    }
    const st = localStorage.getItem(VNEXT_LS_FORWARD_STREAK);
    if (st != null && st !== '') {
      const k = parseInt(st, 10);
      if (Number.isFinite(k) && k >= 0) prevStreak = k;
    }
  } catch {
    lastStored = null;
  }

  if (feedbackEl) {
    if (current == null || lastStored == null) {
      feedbackEl.textContent = '';
      feedbackEl.hidden = true;
    } else if (current > lastStored) {
      feedbackEl.textContent = 'Bar up since last check.';
      feedbackEl.hidden = false;
    } else if (current < lastStored) {
      feedbackEl.textContent = 'Bar dropped — reset the plan.';
      feedbackEl.hidden = false;
    } else {
      feedbackEl.textContent = '';
      feedbackEl.hidden = true;
    }
  }

  let streak = prevStreak;
  if (current != null) {
    if (lastStored == null) {
      streak = 0;
    } else if (current > lastStored) {
      streak = prevStreak + 1;
    } else {
      streak = 0;
    }
  }

  if (streakEl) {
    const displayStreak = current != null ? streak : prevStreak;
    if (displayStreak >= 2) {
      streakEl.textContent = `Streak: ${displayStreak} days`;
      streakEl.hidden = false;
    } else {
      streakEl.textContent = '';
      streakEl.hidden = true;
    }
  }

  if (current != null) {
    try {
      localStorage.setItem(VNEXT_LS_LAST_INBAND_PCT, String(current));
      localStorage.setItem(VNEXT_LS_FORWARD_STREAK, String(streak));
    } catch {
      /* ignore quota / private mode */
    }
  }
}

/**
 * One-line command from board gap figure + hero headline (no new dollar math).
 * @param {{ tier: { id: string, label: string }, nextTier?: object|null, stability?: { id: string, label: string } }} payload
 */
function fillVnextNextMove(payload) {
  const primaryEl = document.getElementById('vnext-next-move-primary');
  const contextEl = document.getElementById('vnext-next-move-context');
  const secondaryEl = document.getElementById('vnext-next-move-secondary');
  if (!primaryEl) return;

  const tier = payload && payload.tier;
  const nextTier = payload && payload.nextTier;
  const tierLabel = tier && tier.label ? tier.label : 'this stage';

  const boardGapEl = document.getElementById('board-tier-gap-headline');
  const headline = (boardGapEl?.textContent || '').trim();
  const cardLine = (document.getElementById('card-tier-gap-headline')?.textContent || '').trim();

  let primary = '';
  if (!nextTier) {
    primary = 'Final payoff — hold the line.';
  } else if (/^at\s+the\s+threshold/i.test(cardLine)) {
    primary = cardLine;
  } else if (!headline || headline === '—') {
    primary = 'Next step loads with your numbers.';
  } else if (/^(?:\$[\d,]+|<\s*\$1)$/i.test(headline)) {
    primary = `Pay down ${headline} to escape ${tierLabel}`;
  } else if (/\s+to\s+escape\s+/i.test(headline)) {
    const m = headline.match(/^(.+?)\s+to\s+escape\s+(.+)$/i);
    primary = m ? `Pay down ${m[1].trim()} to escape ${m[2].trim()}` : headline;
  } else if (/\s+to\s+reach\s+/i.test(headline)) {
    const m = headline.match(/^(.+?)\s+to\s+reach\s+(.+)$/i);
    primary = m ? `Pay down ${m[1].trim()} to reach ${m[2].trim()}` : headline;
  } else if (/^(?:\$0|<\s*\$1)\s+left\s+to\s+/i.test(headline)) {
    const dest = headline.replace(/^[\s\S]*?left\s+to\s+/i, '').trim();
    primary = dest
      ? `Pay down to reach ${dest} — you're there`
      : 'Pay down to cross into the next payoff stage';
  } else {
    const needle = ' left to ';
    const i = headline.indexOf(needle);
    if (i !== -1) {
      const money = headline.slice(0, i).trim();
      const dest = headline.slice(i + needle.length).trim();
      primary = `Pay down ${money} to reach ${dest}`;
    } else {
      primary = headline;
    }
  }
  primaryEl.textContent = primary;

  if (contextEl) {
    contextEl.textContent = '';
    contextEl.hidden = true;
  }

  if (secondaryEl) {
    secondaryEl.textContent = '';
    secondaryEl.hidden = true;
  }
}

/** Showcase-aligned mount offsets (character fit inside gallery cards). */
const VNEXT_EXPLORE_MOUNT_OFFSETS = {
  rock_bottom: { x: 0, y: 34, scale: 0.88 },
  broke: { x: 0, y: 36, scale: 0.92 },
  struggling: { x: 0, y: 38, scale: 0.95 },
  surviving: { x: 0, y: 40, scale: 1.0 },
  stabilizing: { x: 0, y: 41, scale: 1.02 },
  stable: { x: 0, y: 42, scale: 1.04 },
  building: { x: 0, y: 40, scale: 1.04 },
  thriving: { x: 0, y: 46, scale: 0.98 },
  winning: { x: 0, y: 40, scale: 0.8 },
  wealthy: { x: 0, y: 46, scale: 0.72 },
};

function hexToRgbaAccent(hex, alpha) {
  const a = typeof alpha === 'number' && Number.isFinite(alpha) ? alpha : 0.55;
  if (typeof hex !== 'string' || hex[0] !== '#' || hex.length < 7) {
    return `rgba(255,255,255,${a})`;
  }
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return `rgba(255,255,255,${a})`;
  return `rgba(${r},${g},${b},${a})`;
}

let vnextExploreDidInitialScroll = false;

function buildVnextExploreCardRow(def, narrTiers, metaMap) {
  const meta = metaMap[def.id] || {};
  const narrRow = narrTiers && narrTiers[def.id];

  const wrap = document.createElement('div');
  wrap.className = 'vnext-sc-wrap';
  wrap.dataset.tierId = def.id;

  const card = document.createElement('div');
  card.className = 'vnext-sc-card state-card';
  card.dataset.state = def.id;
  card.style.setProperty('--vnext-sc-accent', hexToRgbaAccent(meta.accent, 0.62));

  const mount = document.createElement('div');
  mount.className = 'vnext-sc-mount';
  const st = buildSteward(def.id);
  mount.appendChild(st);

  const stewardWrap = mount.querySelector('.steward-wrap');
  const off = VNEXT_EXPLORE_MOUNT_OFFSETS[def.id];
  if (off && stewardWrap) {
    stewardWrap.style.transform = `translate3d(${off.x}px, ${off.y}px, 0) scale(${off.scale})`;
    stewardWrap.style.transformOrigin = 'center bottom';
  }

  card.appendChild(mount);

  const badge = document.createElement('div');
  badge.className = 'vnext-sc-badge';
  badge.textContent = def.badge;
  card.appendChild(badge);

  const chip = document.createElement('div');
  chip.className = 'vnext-sc-active-chip';
  chip.textContent = 'You are here';
  chip.hidden = true;
  card.appendChild(chip);

  const footer = document.createElement('div');
  footer.className = 'vnext-sc-footer';

  const topRow = document.createElement('div');
  topRow.className = 'vnext-sc-top-row';
  const phaseEl = document.createElement('span');
  phaseEl.className = 'vnext-sc-phase';
  phaseEl.textContent = meta.phase || '—';
  topRow.appendChild(phaseEl);
  footer.appendChild(topRow);

  const nameEl = document.createElement('p');
  nameEl.className = 'vnext-sc-tier-name';
  nameEl.textContent = def.label;
  footer.appendChild(nameEl);

  const flavorEl = document.createElement('p');
  flavorEl.className = 'vnext-sc-flavor';
  flavorEl.textContent = (narrRow && narrRow.climbTagline) || meta.cue || '';
  footer.appendChild(flavorEl);

  const note = document.createElement('p');
  note.className = 'vnext-sc-footnote';
  note.textContent = 'Live pace & dollars — next section';
  footer.appendChild(note);

  card.appendChild(footer);

  if (def.id === 'wealthy') {
    const sparkles = document.createElement('div');
    sparkles.className = 'wealthy-sparkles';
    for (let i = 1; i <= 10; i++) {
      const s = document.createElement('span');
      s.className = `ws ws-${i}`;
      sparkles.appendChild(s);
    }
    card.appendChild(sparkles);
  }

  wrap.appendChild(card);
  return wrap;
}

function updateVnextExploreActive(activeId) {
  document.querySelectorAll('#vnext-explore-climb-track .vnext-sc-wrap').forEach((w) => {
    const id = w.dataset.tierId;
    const card = w.querySelector('.vnext-sc-card');
    const chip = w.querySelector('.vnext-sc-active-chip');
    const on = id === activeId;
    w.classList.toggle('is-current', on);
    if (card) card.classList.toggle('is-active', on);
    if (chip) chip.hidden = !on;
  });
}

function ensureVnextExploreClimb(tierId, narr) {
  const track = document.getElementById('vnext-explore-climb-track');
  if (!track || typeof buildSteward !== 'function') return;

  const flow = window.stewardTierFlow;
  const metaMap = window.stewardTierMeta;
  if (!Array.isArray(flow) || !metaMap) return;

  if (!track.dataset.vnextMounted) {
    track.textContent = '';
    for (const def of flow) {
      track.appendChild(buildVnextExploreCardRow(def, narr && narr.tiers, metaMap));
    }
    track.dataset.vnextMounted = '1';
  } else if (narr && narr.tiers) {
    /* Refresh taglines if narrative arrived after first paint. */
    track.querySelectorAll('.vnext-sc-wrap').forEach((w) => {
      const id = w.dataset.tierId;
      const row = id ? narr.tiers[id] : null;
      const flavor = w.querySelector('.vnext-sc-flavor');
      if (flavor && row && row.climbTagline) flavor.textContent = row.climbTagline;
    });
  }

  updateVnextExploreActive(tierId);

  if (!vnextExploreDidInitialScroll) {
    vnextExploreDidInitialScroll = true;
    requestAnimationFrame(() => {
      const cur = track.querySelector('.vnext-sc-wrap.is-current');
      if (cur) cur.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
  }
}

function fillVnextCheckpoints(meta) {
  const list = document.getElementById('vnext-checkpoint-list');
  const intro = document.getElementById('vnext-checkpoints-intro');
  if (!list || !intro) return;

  const nextPullEl = document.getElementById('data-next-pull');
  const ynabEl = document.getElementById('data-ynab-pulled');
  const nextPull = nextPullEl?.textContent?.trim() || '—';
  const ynabPulled = ynabEl?.textContent?.trim() || '—';
  intro.textContent =
    `Scheduled pulls: 1st, 15th, and last day of the month (6:00 AM). Next window: ${nextPull}. Last YNAB pull (from strip): ${ynabPulled}.`;

  const now = new Date();
  const nowMs = now.getTime();
  const lastMs = meta && meta.ynabPulledAt ? new Date(meta.ynabPulledAt).getTime() : null;

  list.textContent = '';
  for (const a of stewardMonthPullAnchors(now)) {
    const t = a.at.getTime();
    let statusClass;
    let statusLabel;
    let detail;
    if (nowMs < t) {
      statusClass = 'is-upcoming';
      statusLabel = 'Queued';
      detail = `Gate opens ${fmtDateCheckpoint(a.at.toISOString())}.`;
    } else if (lastMs != null && !Number.isNaN(lastMs) && lastMs >= t) {
      statusClass = 'is-clear';
      statusLabel = 'In sync';
      detail = 'Last pull meets or beats this gate.';
    } else {
      statusClass = 'is-due';
      statusLabel = 'Refresh';
      detail =
        'Gate passed; last pull still before it — hit ↻ below when you can.';
    }

    const li = document.createElement('li');
    li.className = `vnext-checkpoint-row ${statusClass}`;
    const title = document.createElement('div');
    title.className = 'vnext-checkpoint-title';
    title.textContent = a.label;
    const badge = document.createElement('span');
    badge.className = 'vnext-checkpoint-badge';
    badge.textContent = statusLabel;
    const metaRow = document.createElement('p');
    metaRow.className = 'vnext-checkpoint-detail';
    metaRow.textContent = detail;
    li.appendChild(title);
    li.appendChild(badge);
    li.appendChild(metaRow);
    list.appendChild(li);
  }
}

/** Bar width = progress toward Breathing Room goal months (API `breathingRoomGoalMonths`, default 2.0); does not alter `effectiveRunwayMonths`. */

/**
 * UI-only labels when `stability.label` is unavailable (presentation only).
 * @param {number} months
 */
function breathingRoomLabelFromMonthsOnly(months) {
  if (!Number.isFinite(months)) return '';
  if (months < 0.5) return 'Exposed';
  if (months < 1.0) return 'Stabilizing';
  if (months < 2.0) return 'Steady';
  return 'Fortified';
}

/** @param {{ id?: string, label?: string, effectiveRunwayMonths?: number|null, breathingRoomGoalMonths?: number|null, breathingRoomReached?: boolean, breathingRoomGapMonths?: number|null }|null|undefined} stab */
function fillVnextBreathingRoom(stab) {
  const root = document.getElementById('vnext-breathing-room');
  const track = document.getElementById('vnext-breathing-room-track');
  const fill = document.getElementById('vnext-breathing-room-fill');
  const readout = document.getElementById('vnext-breathing-room-readout');
  if (!root || !track || !fill || !readout) return;

  const rawMonths = stab && stab.effectiveRunwayMonths;
  if (rawMonths == null || !Number.isFinite(rawMonths)) {
    root.hidden = true;
    fill.style.width = '0%';
    readout.textContent = '';
    track.setAttribute('aria-valuenow', '0');
    track.setAttribute('aria-valuetext', '');
    root.classList.remove('is-exposed', 'is-stabilizing', 'is-fortified');
    return;
  }

  const months = Math.max(0, rawMonths);
  const goal =
    stab && Number.isFinite(Number(stab.breathingRoomGoalMonths)) ? Number(stab.breathingRoomGoalMonths) : 2.0;
  const reached = months >= goal;
  const gapMo = reached ? 0 : Math.round((goal - months) * 100) / 100;

  const pct = Math.min(100, (months / goal) * 100);
  fill.style.width = `${pct}%`;
  track.setAttribute('aria-valuenow', String(Math.round(pct)));
  const label =
    stab && typeof stab.label === 'string' && stab.label.trim()
      ? stab.label.trim()
      : breathingRoomLabelFromMonthsOnly(months);
  track.setAttribute(
    'aria-valuetext',
    reached
      ? `${months.toFixed(1)} mo runway — Breathing Room goal reached (${goal.toFixed(1)} mo target). ${label}.`
      : `${months.toFixed(1)} mo runway — ${gapMo.toFixed(1)} mo to ${goal.toFixed(1)} mo goal. ${label}.`,
  );

  if (reached) {
    readout.textContent = `${months.toFixed(1)} mo · Breathing Room goal reached (${goal.toFixed(1)} mo) · ${label}`;
  } else {
    readout.textContent = `${months.toFixed(1)} mo · ${gapMo.toFixed(1)} mo to goal (${goal.toFixed(1)} mo) · ${label}`;
  }

  root.hidden = false;
  root.classList.remove('is-exposed', 'is-stabilizing', 'is-fortified');
  const bandId = stab && stab.id;
  if (bandId === 'exposed' || bandId === 'stabilizing' || bandId === 'fortified') {
    root.classList.add(bandId === 'exposed' ? 'is-exposed' : bandId === 'fortified' ? 'is-fortified' : 'is-stabilizing');
  } else {
    if (months < 0.5) root.classList.add('is-exposed');
    else if (months < 2.0) root.classList.add('is-stabilizing');
    else root.classList.add('is-fortified');
  }
}

/** Fallback if app headline helper is unavailable; matches `formatNextTierGapHeadline` wording. */
function formatGapHeadline(nextTier, currentTier) {
  if (typeof window.formatNextTierGapHeadline === 'function') {
    return window.formatNextTierGapHeadline(nextTier, currentTier);
  }
  if (!nextTier) return 'Final payoff stage — no dollars left to the next threshold';
  const g = Number(nextTier.gapDollars);
  if (!Number.isFinite(g) || g < 0) return 'Final payoff stage — no dollars left to the next threshold';
  const rounded = fmtDollarLocal(g);
  const money = rounded === '$0' && g > 0 ? '< $1' : rounded;
  const tierLabel =
    currentTier && typeof currentTier === 'object' && currentTier.label
      ? currentTier.label
      : 'this stage';
  if (g === 0) {
    return money === '$0' ? `At the threshold — next: ${nextTier.label}` : `${money} to escape ${tierLabel}`;
  }
  return `${money} to escape ${tierLabel}`;
}

/**
 * @param {{ tier: object, stats: object, nextTier: object|null, meta: object, stability: object, snapshots: array }} payload
 */
window.stewardVnextEnhance = async function stewardVnextEnhance(payload) {

  let narr = null;
  try {
    narr = await loadNarrative();
  } catch {
    narr = null;
  }

  const { tier, nextTier, meta, stability: stab } = payload;
  const row = narr && narr.tiers && narr.tiers[tier.id];
  const sgKey = row && row.stageGroup;
  const sg = narr && narr.stageGroups && sgKey ? narr.stageGroups[sgKey] : null;

  const tagEl = document.getElementById('vnext-tier-accolade');
  if (tagEl) {
    /* Tagline already surfaces on explore cards; keep the hero scan path minimal. */
    tagEl.textContent = '';
    tagEl.hidden = true;
  }

  applyVnextHeroStoryCopy(tier, stab, narr);

  const stageChip = document.getElementById('vnext-stage-group-chip');
  if (stageChip) {
    if (sg && sg.label) {
      stageChip.textContent = sg.label + ' stage';
      stageChip.title = sg.blurb || '';
      stageChip.hidden = false;
    } else if (sgKey) {
      stageChip.textContent = sgKey + ' stage';
      stageChip.title = '';
      stageChip.hidden = false;
    } else {
      stageChip.hidden = true;
    }
  }

  const gapCallout = document.getElementById('vnext-tier-gap-callout-value');
  const gapCalloutLabel = document.getElementById('vnext-gap-callout-label');
  if (gapCallout) {
    if (nextTier) {
      if (gapCalloutLabel) gapCalloutLabel.textContent = 'Next payoff stage';
      gapCallout.textContent = `${nextTier.badge} · ${nextTier.label}`;
    } else {
      if (gapCalloutLabel) gapCalloutLabel.textContent = 'Payoff path';
      gapCallout.textContent = 'Final stage — no next threshold';
    }
  }

  const freshEl = document.getElementById('vnext-hero-freshness');
  if (freshEl && meta && meta.freshness) {
    freshEl.textContent = meta.freshness;
    freshEl.className = 'vnext-hero-freshness';
    if (meta.freshness.startsWith('Stale')) freshEl.classList.add('is-stale');
    else if (meta.freshness.includes('h ago')) freshEl.classList.add('is-aged');
  }

  fillVnextDebtJourney(payload.stats, tier, nextTier);
  fillVnextProgressReadout();
  fillVnextTodayBlock();
  fillVnextNextMove(payload);
  fillVnextBreathingRoom(stab);
  fillVnextCheckpoints(meta);
  ensureVnextExploreClimb(tier.id, narr);

};
