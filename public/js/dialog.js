'use strict';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function visibleFocusableElements(overlay) {
  return Array.from(overlay.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter((node) => !node.hidden && node.getAttribute('aria-hidden') !== 'true'
      && node.getClientRects().length > 0);
}

/**
 * Gives a custom modal the keyboard behavior users expect:
 * Escape requests dismissal, Tab stays inside, and focus returns to the trigger.
 * Call release() from every close path before removing the overlay.
 */
export function createModalController(overlay, {
  initialFocus = null,
  onDismiss = null,
  restoreFocusTo = document.activeElement,
} = {}) {
  if (!overlay) {
    return { focusInitial() {}, release() {} };
  }

  let released = false;

  const resolveInitialFocus = () => {
    if (typeof initialFocus === 'function') return initialFocus();
    if (typeof initialFocus === 'string') return overlay.querySelector(initialFocus);
    return initialFocus;
  };

  const focusInitial = () => {
    const target = resolveInitialFocus() || visibleFocusableElements(overlay)[0];
    if (target && typeof target.focus === 'function') {
      try { target.focus(); } catch (_) { /* ignore */ }
      return;
    }
    overlay.setAttribute('tabindex', '-1');
    try { overlay.focus(); } catch (_) { /* ignore */ }
  };

  const onKeydown = (event) => {
    if (released) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (typeof onDismiss === 'function') onDismiss();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = visibleFocusableElements(overlay);
    if (focusable.length === 0) {
      event.preventDefault();
      focusInitial();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (!overlay.contains(active)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  document.addEventListener('keydown', onKeydown, true);

  const release = ({ restoreFocus = true } = {}) => {
    if (released) return;
    released = true;
    document.removeEventListener('keydown', onKeydown, true);
    if (restoreFocus && restoreFocusTo && restoreFocusTo.isConnected
      && typeof restoreFocusTo.focus === 'function') {
      try { restoreFocusTo.focus(); } catch (_) { /* ignore */ }
    }
  };

  return { focusInitial, release };
}
