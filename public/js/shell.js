'use strict';

/**
 * Shell detection — consolidated Steward app.
 *
 * After consolidation, / and /play both serve the unified Play shell.
 * /showcase is the tier gallery. All other routes serve the main shell.
 */

export function currentShell() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/showcase') return 'showcase';
  return 'play';
}

/** Dashboard root element. */
export function getDashboardRoot() {
  return (
    document.getElementById('dashboard-vnext') ||
    document.getElementById('dashboard-play') ||
    document.getElementById('dashboard')
  );
}

/** @deprecated — classic shell retired. Always returns false. */
export function isClassicDashboardDoc() {
  return false;
}

/** Returns true for the main Steward shell. */
export function isPlayDashboardDoc() {
  return currentShell() === 'play';
}

/** @deprecated — consolidated shell uses vNext layout. Always returns false. */
export function isClassicLayoutDashboardDoc() {
  return false;
}
