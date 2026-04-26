'use strict';

import { TIER_FLOW, TIER_META, TIER_INDEX } from './tiers.js';
import { getDashboardRoot, isClassicLayoutDashboardDoc } from './shell.js';
import { TOOLTIP_ASSET_RUNWAY } from './format.js';

let currentTierTheme = TIER_FLOW[0];

export function applyDashboardTheme(stateId, stabilityId) {
  const dashboard = getDashboardRoot();
  const theme = TIER_META[stateId] || TIER_FLOW[0];
  currentTierTheme = theme;
  /* Liquidity band id for data-stability / pill classes (default = middle band id stabilizing; chip text uses API label Steady). */
  const stab = stabilityId || 'stabilizing';
  if (dashboard) {
    dashboard.dataset.state = stateId;
    dashboard.dataset.stability = stab;
  }
  const heroEl = document.getElementById('hero-section');
  if (heroEl) heroEl.dataset.stability = stab;
  const boardEl = document.getElementById('financial-board');
  if (boardEl) boardEl.dataset.stability = stab;
  const cardEl = document.getElementById('hero-state-card');
  if (cardEl) cardEl.dataset.stability = stab;
  if (!dashboard) return;

  dashboard.style.setProperty('--state-accent', theme.accent);
  dashboard.style.setProperty('--state-accent-soft', theme.soft);
  dashboard.style.setProperty('--state-accent-strong', theme.strong);
  dashboard.style.setProperty('--state-progress-start', theme.start);
  dashboard.style.setProperty('--state-progress-end', theme.end);
  dashboard.style.setProperty('--state-spark-fill', theme.fill);
  dashboard.style.setProperty('--state-spark-line', theme.line);
}

const DASHBOARD_LAYOUT_VERSION = 'cmd-v3';

export function upgradeDashboardLayout() {
  const dashboard = getDashboardRoot();
  if (!dashboard || dashboard.dataset.layoutVersion === DASHBOARD_LAYOUT_VERSION) return;

  if (!isClassicLayoutDashboardDoc()) {
    dashboard.dataset.layoutVersion = DASHBOARD_LAYOUT_VERSION;
    return;
  }

  const hero = document.getElementById('hero-section');
  const story = hero?.querySelector('.hero-story-column, .hero-copy');
  const stage = hero?.querySelector('.hero-stage-column, .hero-character-wrap');
  if (!hero || !story || !stage) return;

  dashboard.removeAttribute('data-upgraded');
  dashboard.dataset.layoutVersion = DASHBOARD_LAYOUT_VERSION;
  stage.classList.add('hero-stage-column');
  story.classList.add('hero-story-column');

  const stageCard = document.getElementById('hero-state-card');
  if (stageCard && !stage.querySelector('.hero-stage-frame')) {
    const stageFrame = document.createElement('div');
    stageFrame.className = 'hero-stage-frame';
    stage.insertBefore(stageFrame, stageCard);
    stageFrame.appendChild(stageCard);
  }

  let chipRow = story.querySelector('.hero-chip-row');
  if (!chipRow) {
    chipRow = document.createElement('div');
    chipRow.className = 'hero-chip-row';
    const badge = document.getElementById('hero-badge');
    if (badge) badge.insertAdjacentElement('afterend', chipRow);
  }

  let phasePill = document.getElementById('hero-phase-pill');
  if (!phasePill) {
    phasePill = document.createElement('span');
    phasePill.id = 'hero-phase-pill';
    phasePill.className = 'hero-phase-pill';
    chipRow.appendChild(phasePill);
  }

  let livePill = document.getElementById('hero-live-pill');
  if (!livePill) {
    livePill = document.createElement('span');
    livePill.id = 'hero-live-pill';
    livePill.className = 'hero-live-pill';
    chipRow.appendChild(livePill);
  }

  let stabPill = document.getElementById('hero-stability-pill');
  if (!stabPill && chipRow) {
    stabPill = document.createElement('span');
    stabPill.id = 'hero-stability-pill';
    stabPill.className = 'hero-stability-pill';
    chipRow.insertBefore(stabPill, phasePill);
  }

  let axesHint = document.getElementById('hero-axes-hint');
  if (!axesHint && chipRow) {
    axesHint = document.createElement('p');
    axesHint.id = 'hero-axes-hint';
    axesHint.className = 'hero-axes-hint';
    chipRow.insertAdjacentElement('afterend', axesHint);
  }
  let heroLiqRunway = document.getElementById('hero-liquidity-runway');
  if (!heroLiqRunway && axesHint) {
    heroLiqRunway = document.createElement('p');
    heroLiqRunway.id = 'hero-liquidity-runway';
    heroLiqRunway.className = 'hero-liquidity-runway';
    axesHint.insertAdjacentElement('afterend', heroLiqRunway);
  }
  let heroGuardHint = document.getElementById('hero-guard-hint');
  if (!heroGuardHint && heroLiqRunway) {
    heroGuardHint = document.createElement('p');
    heroGuardHint.id = 'hero-guard-hint';
    heroGuardHint.className = 'hero-guard-hint';
    heroLiqRunway.insertAdjacentElement('afterend', heroGuardHint);
  }

  if (isClassicLayoutDashboardDoc()) {
    const heroBehaviorEl = document.getElementById('hero-tier-behavior');
    let heroNextAction = document.getElementById('hero-next-action');
    if (!heroNextAction && heroBehaviorEl) {
      heroNextAction = document.createElement('p');
      heroNextAction.id = 'hero-next-action';
      heroNextAction.className = 'hero-next-action';
      heroNextAction.hidden = true;
      heroBehaviorEl.insertAdjacentElement('afterend', heroNextAction);
    }
  }

  const heroCopy = document.getElementById('hero-tier-copy');
  let stabilityLead = document.getElementById('hero-stability-lead');
  if (!stabilityLead && heroCopy) {
    stabilityLead = document.createElement('p');
    stabilityLead.id = 'hero-stability-lead';
    stabilityLead.className = 'hero-stability-lead';
    heroCopy.insertAdjacentElement('afterend', stabilityLead);
  }
  let moodCopy = document.getElementById('hero-mood-copy');
  if (!moodCopy && heroCopy) {
    moodCopy = document.createElement('p');
    moodCopy.id = 'hero-mood-copy';
    moodCopy.className = 'hero-mood-copy';
    heroCopy.insertAdjacentElement('afterend', moodCopy);
  }

  story.querySelector('.hero-summary-grid')?.remove();

  const storyAnchor = moodCopy || heroCopy;
  let contextStrip = story.querySelector('.hero-context-strip');
  if (!contextStrip && storyAnchor) {
    contextStrip = document.createElement('div');
    contextStrip.className = 'hero-context-strip';

    const paid = document.createElement('div');
    paid.className = 'hero-context-cell';
    paid.id = 'dashboard-your-climb-spotlight';
    paid.innerHTML = '<span class="hero-context-label">Your climb</span>';
    const paidVal = document.createElement('span');
    paidVal.className = 'hero-context-value hero-context-paid';
    paidVal.id = 'hero-stat-paid';
    paidVal.textContent = '—';
    paid.appendChild(paidVal);
    const climbSummary = document.createElement('div');
    climbSummary.id = 'hero-climb-summary';
    climbSummary.className = 'hero-climb-summary';
    climbSummary.hidden = true;
    const lineNew = document.createElement('p');
    lineNew.className = 'hero-climb-summary-line';
    lineNew.id = 'hero-climb-line-new-debt';
    const linePd = document.createElement('p');
    linePd.className = 'hero-climb-summary-line';
    linePd.id = 'hero-climb-line-paydown';
    const lineNet = document.createElement('p');
    lineNet.className = 'hero-climb-summary-line';
    lineNet.id = 'hero-climb-line-net';
    climbSummary.appendChild(lineNew);
    climbSummary.appendChild(linePd);
    climbSummary.appendChild(lineNet);
    paid.appendChild(climbSummary);

    const runway = document.createElement('div');
    runway.className = 'hero-context-cell';
    runway.title = TOOLTIP_ASSET_RUNWAY;
    runway.innerHTML = '<span class="hero-context-label">Runway</span>';
    const runwayVal = document.createElement('span');
    runwayVal.className = 'hero-context-value';
    runwayVal.id = 'hero-stat-runway';
    runwayVal.textContent = '—';
    runway.appendChild(runwayVal);

    contextStrip.appendChild(paid);
    contextStrip.appendChild(runway);
    storyAnchor.insertAdjacentElement('afterend', contextStrip);
  }

  const contextStripExisting = story.querySelector('.hero-context-strip');
  const paidCellFirst = contextStripExisting?.querySelector('.hero-context-cell');
  if (paidCellFirst && !paidCellFirst.id) paidCellFirst.id = 'dashboard-your-climb-spotlight';
  if (paidCellFirst && !document.getElementById('hero-climb-summary')) {
    document.getElementById('hero-net-climb-honesty')?.remove();
    const climbSummary = document.createElement('div');
    climbSummary.id = 'hero-climb-summary';
    climbSummary.className = 'hero-climb-summary';
    climbSummary.hidden = true;
    const lineNew = document.createElement('p');
    lineNew.className = 'hero-climb-summary-line';
    lineNew.id = 'hero-climb-line-new-debt';
    const linePd = document.createElement('p');
    linePd.className = 'hero-climb-summary-line';
    linePd.id = 'hero-climb-line-paydown';
    const lineNet = document.createElement('p');
    lineNet.className = 'hero-climb-summary-line';
    lineNet.id = 'hero-climb-line-net';
    climbSummary.appendChild(lineNew);
    climbSummary.appendChild(linePd);
    climbSummary.appendChild(lineNet);
    paidCellFirst.appendChild(climbSummary);
  }

  const goalCard = story.querySelector('.hero-goal-card');
  const showcaseLink = story.querySelector('.showcase-link');
  const storyHook = document.getElementById('hero-mood-copy') || document.getElementById('hero-tier-copy');
  if (goalCard && showcaseLink && storyHook) {
    storyHook.insertAdjacentElement('afterend', showcaseLink);
  }
  goalCard?.remove();

  let rail = document.getElementById('hero-tier-rail');
  if (!rail) {
    rail = document.createElement('div');
    rail.id = 'hero-tier-rail';
    rail.className = 'hero-tier-rail';
    hero.appendChild(rail);
  }

  const legacyNextTier = [...dashboard.querySelectorAll('.next-tier-panel')]
    .find(panel => !panel.closest('.hero-story-column'));
  if (legacyNextTier) legacyNextTier.remove();

  dashboard.querySelector('.sparkline-panel')?.remove();

  const statsPanel = dashboard.querySelector('.stats-panel');
  if (statsPanel) {
    statsPanel.querySelector('.panel-head')?.remove();

    const looseBlocks = [...statsPanel.querySelectorAll('.stat-block')];
    if (looseBlocks.length && !statsPanel.querySelector('.stats-grid')) {
      const grid = document.createElement('div');
      grid.className = 'stats-grid';
      looseBlocks.forEach(block => grid.appendChild(block));
      statsPanel.appendChild(grid);
    }
  }

  const dataPanel = dashboard.querySelector('.data-strip, .data-panel');
  if (dataPanel) {
    dataPanel.querySelector('.panel-head')?.remove();
    const looseRows = [...dataPanel.querySelectorAll('.data-row')];
    if (looseRows.length && !dataPanel.querySelector('.data-list')) {
      const list = document.createElement('div');
      list.className = 'data-list';
      looseRows.forEach(row => list.appendChild(row));
      const actions = dataPanel.querySelector('.data-actions, .data-strip-actions');
      dataPanel.insertBefore(list, actions || null);
    }
  }
}

export function renderTierRail(currentId, nextTierId) {
  const rail = document.getElementById('hero-tier-rail');
  if (!rail) return;

  const currentIndex = TIER_INDEX[currentId] ?? 0;
  rail.innerHTML = '';

  TIER_FLOW.forEach((tier, index) => {
    const step = document.createElement('div');
    step.className = 'hero-tier-step';
    if (index < currentIndex) step.classList.add('is-complete');
    if (tier.id === currentId) step.classList.add('is-current');
    if (tier.id === nextTierId) step.classList.add('is-next');

    const badge = document.createElement('span');
    badge.className = 'hero-tier-step-badge';
    badge.textContent = tier.badge;

    const label = document.createElement('span');
    label.className = 'hero-tier-step-label';
    label.textContent = tier.label;

    const phase = document.createElement('span');
    phase.className = 'hero-tier-step-phase';
    phase.textContent = tier.phase;

    step.appendChild(badge);
    step.appendChild(label);
    step.appendChild(phase);
    rail.appendChild(step);
  });
}

export function setupHeroInteraction() {
  const hero = document.getElementById('hero-section');
  if (!hero || hero.dataset.motionBound === 'true') return;

  hero.dataset.motionBound = 'true';

  const reset = () => {
    hero.style.setProperty('--hero-tilt-x', '0px');
    hero.style.setProperty('--hero-tilt-y', '0px');
  };

  hero.addEventListener('pointermove', event => {
    const rect = hero.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) - 0.5;
    const y = ((event.clientY - rect.top) / rect.height) - 0.5;
    hero.style.setProperty('--hero-tilt-x', `${x * 18}px`);
    hero.style.setProperty('--hero-tilt-y', `${y * 14}px`);
  });

  hero.addEventListener('pointerleave', reset);
  reset();
}
