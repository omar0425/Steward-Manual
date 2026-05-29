'use strict';

import { TIER_FLOW, TIER_META, TIER_INDEX } from './tiers.js';
import { getDashboardRoot } from './shell.js';

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
  // The consolidated shell always uses the vNext layout, so there is no
  // classic-layout DOM surgery to perform — just stamp the version marker
  // once so callers treat the dashboard as upgraded. (The former classic
  // branch was ~220 lines of dead code removed alongside
  // isClassicLayoutDashboardDoc.)
  const dashboard = getDashboardRoot();
  if (!dashboard || dashboard.dataset.layoutVersion === DASHBOARD_LAYOUT_VERSION) return;
  dashboard.dataset.layoutVersion = DASHBOARD_LAYOUT_VERSION;
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
