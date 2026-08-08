'use strict';

/* Silent error capture, loaded for EVERY signed-in user. Anything that goes
   wrong in the page — an uncaught exception, an unhandled promise rejection,
   a 5xx from the API — is posted to /api/bug-report, where the server dedupes
   it and only the admin account can ever read it. This file must NEVER be
   user-visible in any way: no UI, no console output, and above all it must
   never throw (an error reporter that errors is worse than none).

   Plain classic script (not a module) so it loads and installs its handlers
   before main.js boots — module scripts are deferred past early boot errors. */
(() => {
  // Per-session ceilings so a render-loop bug can't hammer the endpoint. The
  // server dedupes by signature anyway; this just caps the network chatter.
  const MAX_REPORTS_PER_SESSION = 5;
  let sent = 0;
  const seen = new Set();

  /* Errors born inside a browser extension (or any script injected from a
     foreign origin) are not Steward bugs — a media extension throwing
     `EmptyRanges` files a report the admin can do nothing about, and every
     one burns a slot of the per-session cap that a real bug might need.
     Skip them at the source. Conservative signals only: an extension://
     scheme in the filename or stack, or a script file served from another
     origin (Steward loads all of its own JS same-origin). */
  const EXTENSION_URL = /(?:chrome-extension|moz-extension|safari-extension|safari-web-extension|ms-browser-extension):\/\//i;

  function isForeignScript(filename, stack) {
    try {
      if (EXTENSION_URL.test(String(stack || '')) || EXTENSION_URL.test(String(filename || ''))) return true;
      const f = String(filename || '');
      if (/^https?:\/\//i.test(f) && f.indexOf(location.origin + '/') !== 0) return true;
      return false;
    } catch { return false; }
  }

  function report(source, message, stack) {
    try {
      const msg = String(message || '').trim().slice(0, 500);
      if (!msg || sent >= MAX_REPORTS_PER_SESSION) return;
      const key = source + '|' + msg;
      if (seen.has(key)) return;
      seen.add(key);
      sent += 1;
      // keepalive lets a report from a closing tab still get out.
      fetch('/api/bug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          source,
          message: msg,
          stack: String(stack || '').slice(0, 4000),
          url: String(location.pathname || '').slice(0, 300),
        }),
      }).catch(() => {});
    } catch { /* never throw */ }
  }

  window.addEventListener('error', (e) => {
    try {
      // Resource-load failures (dead <img>/<script>) fire here with no message.
      if (!e || !e.message) return;
      // Cross-origin scripts get masked down to a bare "Script error." — no
      // stack, no file, nothing actionable. Steward has no cross-origin
      // scripts of its own, so these are injected-code noise too.
      if (/^Script error\.?$/.test(String(e.message).trim())) return;
      if (isForeignScript(e.filename, e.error && e.error.stack)) return;
      report('error', e.message, e.error && e.error.stack);
    } catch { /* never throw */ }
  });

  window.addEventListener('unhandledrejection', (e) => {
    try {
      const r = e && e.reason;
      if (isForeignScript('', r && r.stack)) return;
      report(
        'unhandledrejection',
        (r && r.message) || (typeof r === 'string' ? r : 'Unhandled rejection'),
        r && r.stack,
      );
    } catch { /* never throw */ }
  });

  // Server-side failures surface as 5xx responses the page otherwise swallows.
  // The reporter's own endpoint is excluded or a failing insert would recurse.
  const origFetch = window.fetch;
  window.fetch = function watchedFetch(input) {
    const p = origFetch.apply(this, arguments);
    try {
      const u = typeof input === 'string' ? input : (input && input.url) || '';
      if (u.indexOf('/api/bug-report') === -1) {
        p.then((resp) => {
          try {
            if (resp && resp.status >= 500) {
              report('http', 'HTTP ' + resp.status + ' from ' + u.slice(0, 200), '');
            }
          } catch { /* never throw */ }
        }, () => {});
      }
    } catch { /* never throw */ }
    return p;
  };
})();
