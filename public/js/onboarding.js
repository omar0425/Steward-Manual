'use strict';

import { getDashboardRoot, isPlayDashboardDoc } from './shell.js';
import { DASHBOARD_ONBOARDING_KEY } from './commitment.js';

/* ── Dashboard onboarding (localStorage; guided walkthrough + spotlight) ─ */
const DASHBOARD_ONBOARDING_STEPS = [
  {
    lead: 'This card is your current payoff stage.',
    body: [
      'The badge, character, and stage name show where you are now. The line below the bar (\u201c$X debt remaining\u201d) is your full balance \u2014 every dollar still owed.',
    ],
    resolveTarget: () => onboardingResolveDashboardTarget('#hero-state-card'),
  },
  {
    lead: 'This is your escape gap.',
    body: [
      'The dollars to unlock the next stage \u2014 not your total debt. This is the number to close next.',
    ],
    resolveTarget: () => onboardingResolveDashboardTarget('#hero-escape-primary'),
  },
  {
    lead: 'The thin bar is in-stage progress.',
    body: [
      'How far you are through this stage. The dollar headline above is still the main signal; this bar resets when the next stage unlocks.',
    ],
    resolveTarget: () => onboardingResolveDashboardTarget('#command-progress-widget'),
  },
  {
    lead: 'Your journey is the full 10-stage climb.',
    body: [
      'Context for the whole path. The stage counter shows where you are; the escape gap above tells you what to close next.',
    ],
    resolveTarget: () => onboardingResolveDashboardTarget('.journey-section'),
  },
  {
    lead: 'The next stage is locked.',
    body: [
      'This card previews what you unlock by closing the escape gap. The amount shown is the same dollars-to-go number — keep it shrinking and the lock breaks.',
    ],
    resolveTarget: () => onboardingResolveDashboardTarget('#locked-next-card'),
  },
  {
    lead: 'This is where you update your numbers.',
    body: [
      'Edit balances inline whenever you make a payment, then hit Update Balances. Add new debts here too \u2014 this is your main action surface.',
    ],
    resolveTarget: () =>
      onboardingResolveDashboardTarget('#manual-entry-panel')
        || onboardingResolveDashboardTarget('#update-balances-btn'),
  },
  {
    lead: 'Debt Accounts breaks down what you owe.',
    body: [
      'Sort by Balance or APR, edit APRs, and use the sparkline plus recent change to see which accounts are moving.',
    ],
    resolveTarget: () => onboardingResolveDashboardTarget('#debt-accounts-list'),
  },
  {
    lead: 'Total Cleared is your permanent record.',
    body: [
      'It only goes up. New debt does not reduce it \u2014 this tracks every dollar paid against principal since tracking began.',
    ],
    resolveTarget: () => onboardingResolveDashboardTarget('#stat-cumulative-paydown'),
  },
  {
    lead: 'We stamp every save.',
    body: [
      'Last snapshot and freshness live here so you know when your data was last touched. Stale numbers mean the climb is paused, not over.',
    ],
    resolveTarget: () => onboardingResolveDashboardTarget('.data-strip'),
  },
];

/** Prefer targets inside the active dashboard root (avoids wrong node if IDs collide). */
function onboardingResolveDashboardTarget(sel) {
  const dash = getDashboardRoot();
  if (!dash) return null;
  try {
    return dash.querySelector(sel);
  } catch (err) {
    console.error('[onboarding] invalid selector', sel, err);
    return null;
  }
}

let dashboardOnboardingState = {
  active: false,
  stepIndex: 0,
  prevTarget: null,
  escapeHandler: null,
  resizeTimer: null,
  resizeHandler: null,
  scrollHandler: null,
  nextStepTimer: null,
};

function getDashboardOnboardingEls() {
  const root = document.getElementById('dashboard-onboarding-root');
  if (!root) {
    return {
      root: null,
      tooltip: null,
      leadEl: null,
      bodyEl: null,
      stepEl: null,
      nextBtn: null,
      backBtn: null,
      skipBtn: null,
      connectorPath: null,
    };
  }
  const tooltip = root.querySelector('#dashboard-onboarding-tooltip');
  const leadEl = root.querySelector('#dashboard-onboarding-lead');
  const bodyEl = root.querySelector('#dashboard-onboarding-body');
  const stepEl = root.querySelector('#dashboard-onboarding-step');
  const nextBtn = root.querySelector('#dashboard-onboarding-next');
  const backBtn = root.querySelector('#dashboard-onboarding-back');
  const skipBtn = root.querySelector('#dashboard-onboarding-skip');
  const connectorPath = root.querySelector('#dashboard-onboarding-connector-path');
  return { root, tooltip, leadEl, bodyEl, stepEl, nextBtn, backBtn, skipBtn, connectorPath };
}

const DASHBOARD_ONBOARDING_MARKUP = [
  '<div class="dashboard-onboarding-backdrop" id="dashboard-onboarding-backdrop"></div>',
  '<svg class="dashboard-onboarding-connector" id="dashboard-onboarding-connector" width="100%" height="100%" aria-hidden="true" focusable="false">',
  '  <defs>',
  '    <marker id="dashboard-onboarding-arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="userSpaceOnUse">',
  '      <path d="M0,0 L0,6 L9,3 z" fill="var(--forest-700, #2e5c46)" />',
  '    </marker>',
  '  </defs>',
  '  <path id="dashboard-onboarding-connector-path" class="dashboard-onboarding-connector-path" fill="none" stroke="var(--forest-700, #2e5c46)" stroke-width="3" stroke-linecap="round" marker-end="url(#dashboard-onboarding-arrowhead)" />',
  '</svg>',
  '<div class="dashboard-onboarding-callout" id="dashboard-onboarding-tooltip" role="dialog" aria-modal="true" aria-labelledby="dashboard-onboarding-lead">',
  '  <p class="dashboard-onboarding-step-badge" id="dashboard-onboarding-step"></p>',
  '  <p class="dashboard-onboarding-lead" id="dashboard-onboarding-lead"></p>',
  '  <div class="dashboard-onboarding-body" id="dashboard-onboarding-body"></div>',
  '  <div class="dashboard-onboarding-actions">',
  '    <button type="button" class="dashboard-onboarding-skip" id="dashboard-onboarding-skip">Skip</button>',
  '    <div class="dashboard-onboarding-actions-primary">',
  '      <button type="button" class="dashboard-onboarding-back" id="dashboard-onboarding-back">Back</button>',
  '      <button type="button" class="dashboard-onboarding-next" id="dashboard-onboarding-next">Next</button>',
  '    </div>',
  '  </div>',
  '</div>',
].join('');

function ensureDashboardOnboardingUi() {
  let { root, tooltip, leadEl, bodyEl, stepEl, nextBtn, backBtn, skipBtn, connectorPath } = getDashboardOnboardingEls();
  const complete =
    root &&
    tooltip &&
    leadEl &&
    bodyEl &&
    stepEl &&
    nextBtn &&
    backBtn &&
    skipBtn &&
    connectorPath;
  if (complete) {
    return { root, tooltip, leadEl, bodyEl, stepEl, nextBtn, backBtn, skipBtn, connectorPath };
  }

  if (root) {
    root.innerHTML = DASHBOARD_ONBOARDING_MARKUP;
    delete root.dataset.bound;
  } else {
    root = document.createElement('div');
    root.id = 'dashboard-onboarding-root';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = DASHBOARD_ONBOARDING_MARKUP;
    document.body.appendChild(root);
  }
  ({ root, tooltip, leadEl, bodyEl, stepEl, nextBtn, backBtn, skipBtn, connectorPath } = getDashboardOnboardingEls());
  return { root, tooltip, leadEl, bodyEl, stepEl, nextBtn, backBtn, skipBtn, connectorPath };
}

/** Point on `rect` border from its center toward (tx, ty). */
function onboardingRectEdgeToward(rect, tx, ty) {
  const cx = rect.left + rect.width * 0.5;
  const cy = rect.top + rect.height * 0.5;
  let dx = tx - cx;
  let dy = ty - cy;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const halfW = rect.width * 0.5;
  const halfH = rect.height * 0.5;
  const t =
    dx !== 0 || dy !== 0
      ? Math.min(
          dx !== 0 ? halfW / Math.abs(dx) : Infinity,
          dy !== 0 ? halfH / Math.abs(dy) : Infinity,
        )
      : 0;
  return { x: cx + dx * t, y: cy + dy * t };
}

/** Dim overlay everywhere except a clear ellipse over the spotlight target (viewport coords). */
function layoutDashboardOnboardingBackdropMask(backdropEl, targetRect) {
  if (!backdropEl) return;
  if (!targetRect || (targetRect.width < 1 && targetRect.height < 1)) {
    backdropEl.style.webkitMaskImage = '';
    backdropEl.style.maskImage = '';
    return;
  }
  const pad = 14;
  const cx = targetRect.left + targetRect.width * 0.5;
  const cy = targetRect.top + targetRect.height * 0.5;
  const rad =
    Math.hypot(Math.max(targetRect.width, 8) + pad * 2, Math.max(targetRect.height, 8) + pad * 2) * 0.5;
  const inner = Math.max(0, rad - 1);
  const grad = `radial-gradient(circle ${rad}px at ${cx}px ${cy}px, rgba(0,0,0,0) 0px, rgba(0,0,0,0) ${inner}px, rgba(0,0,0,1) ${rad}px)`;
  backdropEl.style.webkitMaskImage = grad;
  backdropEl.style.maskImage = grad;
}

function layoutDashboardOnboardingConnector(pathEl, calloutEl, targetEl) {
  if (!pathEl || !calloutEl || !targetEl) return;
  if (!targetEl.isConnected) {
    pathEl.setAttribute('d', '');
    return;
  }
  const c = calloutEl.getBoundingClientRect();
  const t = targetEl.getBoundingClientRect();
  if (t.bottom < 0 || t.top > window.innerHeight || t.right < 0 || t.left > window.innerWidth) {
    pathEl.setAttribute('d', '');
    return;
  }
  const tcx = t.left + t.width * 0.5;
  const tcy = t.top + t.height * 0.5;
  const ccx = c.left + c.width * 0.5;
  const ccy = c.top + c.height * 0.5;
  const start = onboardingRectEdgeToward(c, tcx, tcy);
  const end = onboardingRectEdgeToward(t, ccx, ccy);
  pathEl.setAttribute(
    'd',
    `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} L ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
  );
}

function layoutDashboardOnboardingTooltip(tooltipEl, targetEl) {
  if (!tooltipEl || !targetEl) {
    console.warn('[onboarding] layout skipped: missing tooltip or target', { tooltipEl, targetEl });
    return;
  }
  if (!targetEl.isConnected) {
    console.warn('[onboarding] layout skipped: target not connected', targetEl);
    return;
  }
  const margin = 16;
  const gap = 12;
  let r;
  try {
    r = targetEl.getBoundingClientRect();
  } catch (err) {
    console.error('[onboarding] getBoundingClientRect failed', err);
    return;
  }
  if (!r.width && !r.height) {
    console.warn('[onboarding] target has zero-size rect; positioning may be unreliable', targetEl);
  }
  const backdropEl = document.getElementById('dashboard-onboarding-backdrop');
  layoutDashboardOnboardingBackdropMask(backdropEl, r);

  const first = tooltipEl.getBoundingClientRect();
  const allowFlip = tooltipEl.dataset.onboardingPlaced === '1';

  tooltipEl.style.setProperty('transition', 'none');
  tooltipEl.style.visibility = 'hidden';
  tooltipEl.style.left = '-10000px';
  tooltipEl.style.top = '0px';
  try {
    const tw = tooltipEl.offsetWidth;
    const th = tooltipEl.offsetHeight;
    let top = r.bottom + gap;
    if (top + th > window.innerHeight - margin) {
      top = r.top - gap - th;
    }
    if (top < margin) top = margin;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - tw - margin));
    tooltipEl.style.top = `${Math.round(top)}px`;
    tooltipEl.style.left = `${Math.round(left)}px`;
  } finally {
    tooltipEl.style.visibility = '';
  }
  void tooltipEl.offsetWidth;
  tooltipEl.style.removeProperty('transition');

  const pathEl = document.getElementById('dashboard-onboarding-connector-path');
  const redrawConnector = () => layoutDashboardOnboardingConnector(pathEl, tooltipEl, targetEl);
  redrawConnector();

  if (allowFlip) {
    const last = tooltipEl.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      tooltipEl.style.setProperty('transition', 'none');
      tooltipEl.style.transform = `translate(${dx}px, ${dy}px)`;
      void tooltipEl.offsetWidth;
      tooltipEl.style.removeProperty('transition');
      requestAnimationFrame(() => {
        tooltipEl.style.transform = 'translate(0, 0)';
        let settled = false;
        const finishMove = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(fallbackMove);
          tooltipEl.removeEventListener('transitionend', onMoveEnd);
          redrawConnector();
        };
        const onMoveEnd = ev => {
          if (ev.propertyName !== 'transform') return;
          finishMove();
        };
        const fallbackMove = window.setTimeout(finishMove, 280);
        tooltipEl.addEventListener('transitionend', onMoveEnd);
      });
    }
  }
  tooltipEl.dataset.onboardingPlaced = '1';
}

function clearDashboardOnboardingSpotlight() {
  if (dashboardOnboardingState.prevTarget) {
    try {
      dashboardOnboardingState.prevTarget.classList.remove('dashboard-onboarding-spotlight-target');
    } catch (err) {
      console.warn('[onboarding] could not clear spotlight class', err);
    }
    dashboardOnboardingState.prevTarget = null;
  }
}

function teardownDashboardOnboardingListeners() {
  if (dashboardOnboardingState.escapeHandler) {
    document.removeEventListener('keydown', dashboardOnboardingState.escapeHandler);
    dashboardOnboardingState.escapeHandler = null;
  }
  if (dashboardOnboardingState.resizeHandler) {
    window.removeEventListener('resize', dashboardOnboardingState.resizeHandler);
    dashboardOnboardingState.resizeHandler = null;
  }
  if (dashboardOnboardingState.scrollHandler) {
    window.removeEventListener('scroll', dashboardOnboardingState.scrollHandler);
    dashboardOnboardingState.scrollHandler = null;
  }
  if (dashboardOnboardingState.resizeTimer) {
    window.clearTimeout(dashboardOnboardingState.resizeTimer);
    dashboardOnboardingState.resizeTimer = null;
  }
}

function closeDashboardOnboarding(markComplete) {
  const { root, tooltip } = getDashboardOnboardingEls();
  if (dashboardOnboardingState.nextStepTimer) {
    window.clearTimeout(dashboardOnboardingState.nextStepTimer);
    dashboardOnboardingState.nextStepTimer = null;
  }
  clearDashboardOnboardingSpotlight();
  teardownDashboardOnboardingListeners();
  document.body.classList.remove('dashboard-onboarding-open');
  if (root) {
    root.classList.remove('is-active');
    root.setAttribute('aria-hidden', 'true');
  }
  if (tooltip) {
    tooltip.removeAttribute('aria-label');
    delete tooltip.dataset.onboardingPlaced;
    tooltip.style.removeProperty('transform');
  }
  const connectorPath = document.getElementById('dashboard-onboarding-connector-path');
  if (connectorPath) connectorPath.setAttribute('d', '');
  const backdropEl = document.getElementById('dashboard-onboarding-backdrop');
  if (backdropEl) {
    backdropEl.style.webkitMaskImage = '';
    backdropEl.style.maskImage = '';
  }
  dashboardOnboardingState.active = false;
  if (markComplete) {
    try {
      localStorage.setItem(DASHBOARD_ONBOARDING_KEY, '1');
    } catch {
      /* ignore */
    }
  }
}

function goDashboardOnboardingStep(index, skipDepth = 0) {
  let tooltip;
  let leadEl;
  let bodyEl;
  let stepEl;
  let nextBtn;
  let backBtn;
  let skipBtn;
  try {
    ({ tooltip, leadEl, bodyEl, stepEl, nextBtn, backBtn, skipBtn } = ensureDashboardOnboardingUi());
    if (!tooltip || !leadEl || !bodyEl || !stepEl || !nextBtn || !backBtn || !skipBtn) {
      console.error('[onboarding] onboarding DOM incomplete', {
        tooltip,
        leadEl,
        bodyEl,
        stepEl,
        nextBtn,
        backBtn,
        skipBtn,
      });
      closeDashboardOnboarding(true);
      return;
    }

    if (index < 0 || index >= DASHBOARD_ONBOARDING_STEPS.length) {
      if (index !== DASHBOARD_ONBOARDING_STEPS.length) {
        console.warn('[onboarding] step index out of range, closing', index);
      }
      closeDashboardOnboarding(true);
      return;
    }

    if (skipDepth > 12) {
      console.warn('[onboarding] too many skipped steps, closing');
      closeDashboardOnboarding(true);
      return;
    }

    clearDashboardOnboardingSpotlight();
    const step = DASHBOARD_ONBOARDING_STEPS[index];
    let target = null;
    try {
      target = step.resolveTarget && step.resolveTarget();
    } catch (err) {
      console.error('[onboarding] resolveTarget threw', index, err);
    }
    if (!target || !(target instanceof Element)) {
      console.warn('[onboarding] missing target for step, skipping', index, step);
      goDashboardOnboardingStep(index + 1, skipDepth + 1);
      return;
    }

    dashboardOnboardingState.stepIndex = index;
    dashboardOnboardingState.prevTarget = target;
    try {
      target.classList.add('dashboard-onboarding-spotlight-target');
    } catch (err) {
      console.error('[onboarding] could not add spotlight class', err);
      goDashboardOnboardingStep(index + 1, skipDepth + 1);
      return;
    }

    /* Smooth scroll runs asynchronously; layout ran in rAF before scroll finished → bad rects and broken Next hits. */
    target.scrollIntoView({ block: 'center', behavior: 'auto' });

    leadEl.textContent = step.lead;
    bodyEl.textContent = '';
    for (const line of step.body) {
      const p = document.createElement('p');
      p.textContent = line;
      bodyEl.appendChild(p);
    }
    stepEl.textContent = `Step ${index + 1} of ${DASHBOARD_ONBOARDING_STEPS.length}`;
    nextBtn.textContent = index >= DASHBOARD_ONBOARDING_STEPS.length - 1 ? 'Done' : 'Next';
    backBtn.disabled = index === 0;
    tooltip.setAttribute('aria-label', [step.lead, ...step.body].join(' '));

    requestAnimationFrame(() => {
      try {
        layoutDashboardOnboardingTooltip(tooltip, target);
        nextBtn.focus({ preventScroll: true });
      } catch (err) {
        console.error('[onboarding] post-step layout/focus failed', err);
      }
    });
  } catch (err) {
    console.error('[onboarding] goDashboardOnboardingStep failed', index, err);
    closeDashboardOnboarding(true);
  }
}

function bindDashboardOnboardingOnce() {
  const els = ensureDashboardOnboardingUi();
  const { root, nextBtn, backBtn, skipBtn } = els;
  const backdrop = document.getElementById('dashboard-onboarding-backdrop');
  if (!root || !nextBtn || !backBtn || !skipBtn || root.dataset.bound === '1') return;
  root.dataset.bound = '1';

  nextBtn.addEventListener('click', () => {
    if (!dashboardOnboardingState.active) return;
    if (dashboardOnboardingState.nextStepTimer) window.clearTimeout(dashboardOnboardingState.nextStepTimer);
    const nextIndex = dashboardOnboardingState.stepIndex + 1;
    dashboardOnboardingState.nextStepTimer = window.setTimeout(() => {
      dashboardOnboardingState.nextStepTimer = null;
      if (!dashboardOnboardingState.active) return;
      goDashboardOnboardingStep(nextIndex);
    }, 150);
  });
  backBtn.addEventListener('click', () => {
    if (!dashboardOnboardingState.active) return;
    if (dashboardOnboardingState.nextStepTimer) window.clearTimeout(dashboardOnboardingState.nextStepTimer);
    const prevIndex = dashboardOnboardingState.stepIndex - 1;
    if (prevIndex < 0) return;
    goDashboardOnboardingStep(prevIndex);
  });
  skipBtn.addEventListener('click', () => {
    if (!dashboardOnboardingState.active) return;
    closeDashboardOnboarding(true);
  });
  if (backdrop) {
    backdrop.addEventListener('click', () => {
      if (!dashboardOnboardingState.active) return;
      closeDashboardOnboarding(true);
    });
  }
}

export function startDashboardOnboarding(opts = {}) {
  const force = opts && opts.force === true;
  if (!getDashboardRoot()) return;
  if (dashboardOnboardingState.active) return;
  if (!force) {
    try {
      if (localStorage.getItem(DASHBOARD_ONBOARDING_KEY)) return;
    } catch {
      /* ignore */
    }
  }

  bindDashboardOnboardingOnce();
  const { root } = ensureDashboardOnboardingUi();
  if (!root) return;

  dashboardOnboardingState.active = true;
  root.classList.add('is-active');
  root.setAttribute('aria-hidden', 'false');
  document.body.classList.add('dashboard-onboarding-open');

  dashboardOnboardingState.escapeHandler = ev => {
    if (ev.key === 'Escape' && dashboardOnboardingState.active) {
      ev.preventDefault();
      closeDashboardOnboarding(true);
    }
  };
  document.addEventListener('keydown', dashboardOnboardingState.escapeHandler);

  const onResize = () => {
    if (!dashboardOnboardingState.active) return;
    if (dashboardOnboardingState.resizeTimer) window.clearTimeout(dashboardOnboardingState.resizeTimer);
    dashboardOnboardingState.resizeTimer = window.setTimeout(() => {
      const i = dashboardOnboardingState.stepIndex;
      const step = DASHBOARD_ONBOARDING_STEPS[i];
      let target = null;
      try {
        target = step && step.resolveTarget && step.resolveTarget();
      } catch (err) {
        console.error('[onboarding] resize step resolve threw', err);
      }
      const { tooltip } = getDashboardOnboardingEls();
      if (target && tooltip && target.isConnected) {
        try {
          layoutDashboardOnboardingTooltip(tooltip, target);
        } catch (err) {
          console.error('[onboarding] resize layout failed', err);
        }
      }
    }, 80);
  };
  window.addEventListener('resize', onResize);
  dashboardOnboardingState.resizeHandler = onResize;

  const onScroll = () => {
    if (!dashboardOnboardingState.active) return;
    const i = dashboardOnboardingState.stepIndex;
    const step = DASHBOARD_ONBOARDING_STEPS[i];
    let target = null;
    try { target = step && step.resolveTarget && step.resolveTarget(); } catch { /* ignore */ }
    const { connectorPath, tooltip } = getDashboardOnboardingEls();
    if (connectorPath && tooltip && target && target.isConnected) {
      layoutDashboardOnboardingConnector(connectorPath, tooltip, target);
    }
    const backdropEl = document.getElementById('dashboard-onboarding-backdrop');
    if (backdropEl && target && target.isConnected) {
      try { layoutDashboardOnboardingBackdropMask(backdropEl, target.getBoundingClientRect()); } catch { /* ignore */ }
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  dashboardOnboardingState.scrollHandler = onScroll;

  goDashboardOnboardingStep(0);
}

export function offerFirstVisitDashboardOnboarding() {
  if (!getDashboardRoot()) return;
  if (window.__stewardDashboardOnboardingOffered) return;
  window.__stewardDashboardOnboardingOffered = true;
  startDashboardOnboarding({ force: false });
}

export function installDashboardHowItWorksButton() {
  if (!getDashboardRoot()) return;

  /* Preferred surface: the top-nav button rendered by play.js. */
  const navBtn = document.getElementById('nav-how-it-works-btn');
  if (navBtn && navBtn.dataset.bound !== '1') {
    navBtn.dataset.bound = '1';
    navBtn.addEventListener('click', () => startDashboardOnboarding({ force: true }));
  }

  /* Legacy floating button — kept off when the nav surface exists so we don't
     double-install. If somehow the nav button isn't present (older shell),
     fall back to the original floating button so the tour stays reachable. */
  if (!navBtn && !document.getElementById('dashboard-how-it-works-btn')) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'dashboard-how-it-works-btn';
    btn.className = 'dashboard-how-btn';
    btn.textContent = 'How this works';
    btn.addEventListener('click', () => startDashboardOnboarding({ force: true }));
    document.body.appendChild(btn);
  }
}

/* Button install is deferred — called from boot.js after mountPlayShell builds the DOM. */

