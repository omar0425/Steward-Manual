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
      report('error', e.message, e.error && e.error.stack);
    } catch { /* never throw */ }
  });

  window.addEventListener('unhandledrejection', (e) => {
    try {
      const r = e && e.reason;
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
