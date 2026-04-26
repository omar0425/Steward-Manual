'use strict';

/**
 * Minimal app state machine.
 * States: COMMITMENT → START → LOADING → READY | ERROR
 *
 * Uses body[data-app-mode] for CSS visibility (same pattern as current Steward)
 * but transitions are explicit and centralized.
 */

export const AppMode = {
  COMMITMENT: 'commitment',
  START:      'start',
  LOADING:    'loading',
  READY:      'ready',
  ERROR:      'error',
};

let _currentMode = AppMode.START;
let _onTransition = null;

export function currentMode() {
  return _currentMode;
}

export function setTransitionHandler(fn) {
  _onTransition = fn;
}

export function transitionTo(nextMode, reason) {
  const prev = _currentMode;
  console.debug('[state]', prev, '→', nextMode, reason || '');
  _currentMode = nextMode;

  if (document.body) {
    document.body.dataset.appMode = nextMode;
  }

  if (nextMode === AppMode.READY) {
    try { sessionStorage.setItem('steward_app_ready', '1'); } catch (_) {}
  }

  if (_onTransition) {
    _onTransition(nextMode, prev, reason);
  }
}

export function isSessionResume() {
  try {
    return sessionStorage.getItem('steward_app_ready') === '1';
  } catch (_) {
    return false;
  }
}
