'use strict';

import { loadCharacterTemplate } from './template-loader.js';

/* ── All 10 tiers — flavor text + accent colors ────────────────────── */
const ALL_TIERS = [
  { id: 'rock_bottom', label: 'Buried', badge: '01',
    flavor:  'Do not make this beautiful. Make it smaller.',
    copy:    'Debt north of $79K. The starting line.',
    next:    '→ Next payoff stage: under $79K',
    accent:  'rgba(192,57,43,0.72)',
    threshold: 79000 },

  { id: 'broke',       label: 'Digging',     badge: '02',
    flavor:  'The first dent matters. Protect it.',
    copy:    '$70K–$79K range. The hole is getting shallower.',
    next:    '→ Next payoff stage: under $70K',
    accent:  'rgba(180,90,30,0.72)',
    threshold: 70000 },

  { id: 'struggling',  label: 'Pushing',     badge: '03',
    flavor:  'The climb is ugly before it is convincing.',
    copy:    '$60K–$70K. The number is moving.',
    next:    '→ Next payoff stage: under $60K',
    accent:  'rgba(190,130,28,0.72)',
    threshold: 60000 },

  { id: 'surviving',   label: 'Climbing',    badge: '04',
    flavor:  'Stay alive, stay current, keep cutting.',
    copy:    '$50K–$60K. Halfway to halfway.',
    next:    '→ Next payoff stage: under $50K',
    accent:  'rgba(160,160,28,0.72)',
    threshold: 50000 },

  { id: 'stabilizing', label: 'Steady',      badge: '05',
    flavor:  'The panic is quieter. Do not confuse quiet with done.',
    copy:    '$40K–$50K. Five figures feels different.',
    next:    '→ Next payoff stage: under $40K',
    accent:  'rgba(80,180,80,0.72)',
    threshold: 40000 },

  { id: 'stable',      label: 'Building',    badge: '06',
    flavor:  'You have footing now. Use it.',
    copy:    '$30K–$40K. The end is in the distance.',
    next:    '→ Next payoff stage: under $30K',
    accent:  'rgba(46,180,110,0.72)',
    threshold: 30000 },

  { id: 'building',    label: 'Lifting',     badge: '07',
    flavor:  'Break the pattern before the balance breaks you again.',
    copy:    '$20K–$30K. Final third underway.',
    next:    '→ Next payoff stage: under $20K',
    accent:  'rgba(36,190,140,0.72)',
    threshold: 20000 },

  { id: 'thriving',    label: 'Closing',     badge: '08',
    flavor:  'This is where discipline gets boring. Good.',
    copy:    '$10K–$20K. Most people never reach here.',
    next:    '→ Next payoff stage: under $10K',
    accent:  'rgba(36,200,160,0.72)',
    threshold: 10000 },

  { id: 'winning',     label: 'Finishing',   badge: '09',
    flavor:  'No victory laps before zero.',
    copy:    'Under $10K. The finish line is visible.',
    next:    '→ Next payoff stage: debt = $0',
    accent:  'rgba(218,185,45,0.80)',
    threshold: 0 },

  { id: 'wealthy',     label: 'Debt Free',   badge: '10',
    flavor:  'The debt is gone. Now build the life after it.',
    copy:    'Debt cleared. The climb is complete; the next chapter starts after this.',
    next:    'Final payoff stage',
    accent:  'rgba(245,210,55,0.90)',
    threshold: -Infinity },
];

/**
 * Debt-only bar fill: same band math as the dashboard; sample debt at band midpoint for the gallery.
 * @param {number} tierIndex
 * @param {number} rockBottomBuffer from /debt-tier-constants.json
 */
function showcaseDebtTierBandPct(tierIndex, rockBottomBuffer) {
  const current = ALL_TIERS[tierIndex];
  const next = ALL_TIERS[tierIndex + 1];
  if (!next || current.threshold === -Infinity) {
    return {
      pct: 100,
      caption: '',
    };
  }

  const lower = current.threshold;
  let upper;
  if (tierIndex === 0) {
    upper = lower + rockBottomBuffer;
  } else {
    upper = ALL_TIERS[tierIndex - 1].threshold;
  }
  const sampleDebt = (upper + lower) / 2;
  const span = Math.max(upper - lower, 1);
  const rawPct = Math.min(100, Math.max(0, ((upper - sampleDebt) / span) * 100));
  const pct = roundDebtTierBandPctClient(rawPct);
  return {
    pct: Number.isFinite(pct) ? pct : 0,
    caption: '',
  };
}

/* ── Per-card showcase centering offsets ─────────────────────────────
   x = rightward nudge (px), y = upward nudge (negative = up)
   scale = showcase-specific scene scale
   Tuned individually per card against the showcase grid. ──────────── */
const SHOWCASE_OFFSETS = {
  rock_bottom:  { x: 0,  y: 34, scale: 1.02 },
  broke:        { x: 0,  y: 36, scale: 1.06 },
  struggling:   { x: 0,  y: 38, scale: 1.10 },
  surviving:    { x: 0,  y: 40, scale: 1.15 },
  stabilizing:  { x: 0,  y: 41, scale: 1.18 },
  stable:       { x: 0,  y: 42, scale: 1.20 },
  building:     { x: 0,  y: 40, scale: 1.20 },
  thriving:     { x: 0,  y: 61, scale: 1.14 },
  winning:      { x: 0,  y: 40, scale: 0.92 },
  wealthy:      { x: 0,  y: 46, scale: 0.84 },
};

/* ── Threshold label (below card) ──────────────────────────────────── */
function thresholdLabel(tier) {
  if (tier.threshold === -Infinity) return 'Debt: $0';
  if (tier.threshold === 0)         return 'Debt: under $10K';
  return `Debt: over $${(tier.threshold / 1000).toFixed(0)}K`;
}

/** Sample debt at band midpoint · same gap rule as dashboard (`debtRemaining - currentTier.threshold`). */
function illustrativeGapHeadline(tier, tierIndex, rockBottomBuffer) {
  const idx = ALL_TIERS.findIndex(t => t.id === tier.id);
  const nextT = ALL_TIERS[idx + 1];
  if (!nextT || tier.threshold === -Infinity) {
    return typeof formatNextTierGapHeadline === 'function'
      ? formatNextTierGapHeadline(null)
      : 'Final payoff stage — no dollars left to the next threshold';
  }
  const lower = tier.threshold;
  let upper;
  if (tierIndex === 0) upper = lower + rockBottomBuffer;
  else upper = ALL_TIERS[tierIndex - 1].threshold;
  const sampleDebt = (upper + lower) / 2;
  const gap = Math.max(0, sampleDebt - lower);
  return formatNextTierGapHeadline({ gapDollars: gap, label: nextT.label });
}

function nextTierElement(tier, tierIndex, rockBottomBuffer) {
  const el = document.createElement('p');
  el.className = 'sc-next-target';
  if (tier.id === 'wealthy') {
    el.textContent = typeof formatNextTierGapHeadline === 'function'
      ? formatNextTierGapHeadline(null)
      : 'Final payoff stage: no dollars left to the next threshold';
  } else {
    el.textContent = illustrativeGapHeadline(tier, tierIndex, rockBottomBuffer);
  }
  return el;
}

/* ── Build one full showcase card ──────────────────────────────────── */
function buildCard(tier, rockBottomBuffer) {
  const tierIndex = ALL_TIERS.findIndex(t => t.id === tier.id);
  const bandDemo = showcaseDebtTierBandPct(tierIndex, rockBottomBuffer);
  const theme = TIER_META?.[tier.id] || {};
  const wrap = document.createElement('div');
  wrap.className = 'sc-wrap';
  wrap.dataset.tierId = tier.id;
  wrap.dataset.phase = (theme.phase || 'state').toLowerCase();

  /* State card — gets background gradient from .state-card[data-state] in style.css */
  const card = document.createElement('div');
  card.className = 'sc-card state-card';
  card.dataset.state = tier.id;
  card.dataset.tier = tier.id;
  card.style.setProperty('--sc-accent', theme.accent || tier.accent);

  /* Character mount — larger top tiers get a small showcase-only fit adjustment */
  const mount = document.createElement('div');
  mount.className = 'sc-mount';
  mount.dataset.showcaseState = tier.id;
  mount.appendChild(buildSteward(tier.id));

  const stewardWrap = mount.querySelector('.steward-wrap');
  const off = SHOWCASE_OFFSETS[tier.id];
  if (off && stewardWrap) {
    stewardWrap.style.transform = `translate3d(${off.x}px, ${off.y}px, 0) scale(${off.scale})`;
    stewardWrap.style.transformOrigin = 'center bottom';
  }

  card.appendChild(mount);

  /* Badge chip — top-left */
  const badge = document.createElement('div');
  badge.className = 'sc-badge';
  badge.textContent = tier.badge;
  card.appendChild(badge);

  /* Footer overlay */
  const footer = document.createElement('div');
  footer.className = 'sc-footer';

  const topRow = document.createElement('div');
  topRow.className = 'sc-top-row';

  const phaseEl = document.createElement('span');
  phaseEl.className = 'sc-phase';
  phaseEl.textContent = theme.phase || 'State';
  topRow.appendChild(phaseEl);
  footer.appendChild(topRow);

  const nameEl = document.createElement('p');
  nameEl.className = 'sc-tier-name';
  nameEl.textContent = tier.label;
  footer.appendChild(nameEl);

  const flavorEl = document.createElement('p');
  flavorEl.className = 'sc-flavor';
  flavorEl.textContent = tier.flavor;
  footer.appendChild(flavorEl);

  const barRow = document.createElement('div');
  barRow.className = 'sc-bar-row';
  const track = document.createElement('div');
  track.className = 'sc-bar-track';
  const fill = document.createElement('div');
  fill.className = 'sc-bar-fill';
  fill.style.width = `${bandDemo.pct}%`;
  fill.style.boxShadow = `0 0 10px 3px ${theme.accent || tier.accent}`;
  track.title =
    'Illustrative gallery: thin bar is position inside this stage only. Live dashboard headline is dollars to the next payoff stage—not breathing room.';
  track.appendChild(fill);
  barRow.appendChild(track);
  footer.appendChild(barRow);

  footer.appendChild(nextTierElement(tier, tierIndex, rockBottomBuffer));

  card.appendChild(footer);


  wrap.appendChild(card);

  const copyWrap = document.createElement('div');
  copyWrap.className = 'sc-copy';

  const copyLabel = document.createElement('span');
  copyLabel.className = 'sc-copy-label';
  copyLabel.textContent = `Payoff stage · ${thresholdLabel(tier)} · ${theme.phase || 'State'}`;
  copyWrap.appendChild(copyLabel);

  const copyText = document.createElement('span');
  copyText.className = 'sc-copy-text';
  copyText.textContent = tier.copy;
  copyWrap.appendChild(copyText);

  const cueText = document.createElement('span');
  cueText.className = 'sc-cue';
  cueText.textContent = theme.cue || tier.flavor;
  copyWrap.appendChild(cueText);

  wrap.appendChild(copyWrap);
  return wrap;
}

/* ── Mount all 10 cards (buffer from debt-tier-constants.json) ─────── */
const grid = document.getElementById('showcase-grid');
document.title = 'Steward | Debt tier gallery';
const showcaseTitle = document.querySelector('.showcase-title');
const showcaseSubtitle = document.querySelector('.showcase-subtitle');
const backButton = document.querySelector('.back-btn');
if (showcaseTitle) showcaseTitle.textContent = 'Steward | Debt tier gallery';
if (showcaseSubtitle) {
  showcaseSubtitle.textContent =
    'Illustrative gallery · live dashboard: dollars to the next payoff stage first · thin bars = position inside this stage only';
}
if (backButton) backButton.textContent = 'Back to dashboard';

function markActiveFromApi() {
  return fetch('/api/status')
    .then(r => (r.ok ? r.json() : null))
    .then(data => {
      if (!data?.ready || !data?.tier?.id) return;
      const activeTierId = data.tier.id;
      const activeWrap = document.querySelector(`[data-tier-id="${activeTierId}"]`);
      if (!activeWrap) return;

      const card = activeWrap.querySelector('.sc-card');
      if (card) card.classList.add('is-active');

      const chip = document.createElement('div');
      chip.className = 'sc-active-chip';
      chip.textContent = 'You are here';
      card.appendChild(chip);

      const stats = data.stats;
      const nextTier = data.nextTier;
      const fill = activeWrap.querySelector('.sc-bar-fill');
      const track = activeWrap.querySelector('.sc-bar-track');
      const nextTargetEl = activeWrap.querySelector('.sc-next-target');
      const barDisplay =
        stats && typeof debtTierBandBarDisplay === 'function' ? debtTierBandBarDisplay(stats) : null;
      if (barDisplay && fill && Number.isFinite(barDisplay.displayPct)) {
        fill.style.width = `${barDisplay.displayPct}%`;
        if (nextTargetEl && typeof formatNextTierGapHeadline === 'function') {
          if (activeTierId === 'wealthy') {
            nextTargetEl.textContent = formatNextTierGapHeadline(null);
          } else if (nextTier) {
            nextTargetEl.textContent = formatNextTierGapHeadline(nextTier);
          } else {
            nextTargetEl.textContent = formatNextTierGapHeadline(null);
          }
        }
        if (track) {
          track.title =
            'Live data: thin bar is position inside this stage only. Dollars to the next payoff stage are below—not breathing room.';
        }
      }

      if (typeof syncDebtTierBandDebugOverlay === 'function' && barDisplay && stats) {
        syncDebtTierBandDebugOverlay(stats, barDisplay.rawPct, barDisplay.displayPct);
      }

      activeWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    })
    .catch(() => {});
}

function mountShowcaseGrid(rockBottomBuffer) {
  ALL_TIERS.forEach(tier => grid.appendChild(buildCard(tier, rockBottomBuffer)));
  markActiveFromApi();
}

/* The character template is shared with the dashboard (steward-template.html)
   and fetched once — the showcase no longer carries its own inline copy. */
Promise.all([
  fetch('debt-tier-constants.json').then(r => (r.ok ? r.json() : {})).catch(() => ({})),
  loadCharacterTemplate(),
])
  .then(([j]) => {
    const buf = Number(j.ROCK_BOTTOM_BAND_BUFFER);
    mountShowcaseGrid(Number.isFinite(buf) ? buf : 10000);
  })
  .catch(() => mountShowcaseGrid(10000));
