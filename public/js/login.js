    // Clear the session-resume flag so a fresh login always shows the start screen
    try { sessionStorage.removeItem('steward_app_ready'); } catch (_) {}

    // ── Theme toggle ──────────────────────────────────────────────────
    const themeBtn = document.getElementById('theme-btn');
    const saved = localStorage.getItem('steward-theme') || 'dark';
    document.body.dataset.theme = saved;
    const updateThemeBtn = () => {
      const isDark = document.body.dataset.theme === 'dark';
      themeBtn.textContent = isDark ? '☀ Light' : '☾ Dark';
      themeBtn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      themeBtn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    };
    updateThemeBtn();

    themeBtn.addEventListener('click', () => {
      const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
      document.body.dataset.theme = next;
      localStorage.setItem('steward-theme', next);
      updateThemeBtn();
    });

    // ── Panel toggle ──────────────────────────────────────────────────
    const panelLogin    = document.getElementById('panel-login');
    const panelRegister = document.getElementById('panel-register');
    const panelForgot   = document.getElementById('panel-forgot');
    const panelReset    = document.getElementById('panel-reset');
    const allPanels = [panelLogin, panelRegister, panelForgot, panelReset];

    function activate(panel) {
      allPanels.forEach(p => p && p.classList.remove('is-active'));
      if (panel) panel.classList.add('is-active');
    }

    document.getElementById('goto-register').addEventListener('click', () => {
      activate(panelRegister);
      document.getElementById('reg-username').focus();
    });
    document.getElementById('goto-login').addEventListener('click', () => {
      activate(panelLogin);
      document.getElementById('login-username').focus();
    });
    document.getElementById('goto-forgot').addEventListener('click', () => {
      activate(panelForgot);
      document.getElementById('forgot-email').focus();
    });
    document.getElementById('goto-login-from-forgot').addEventListener('click', () => {
      activate(panelLogin);
      document.getElementById('login-username').focus();
    });
    document.getElementById('goto-login-from-reset').addEventListener('click', () => {
      activate(panelLogin);
      document.getElementById('login-username').focus();
    });
    /* Account-deleted banner: shown when the user comes here from the dashboard
       Danger zone after deleting their account. Banner provides context + a
       shortcut to the register panel. */
    (() => {
      const banner = document.getElementById('login-deleted-banner');
      const goRegister = document.getElementById('goto-register-from-deleted');
      if (!banner) return;
      const params = new URLSearchParams(window.location.search);
      if (params.get('accountDeleted') === '1') {
        banner.hidden = false;
        /* Strip the param from the URL so a refresh doesn't keep showing the
           banner forever — the user has already seen it. */
        const cleanUrl = window.location.pathname + window.location.hash;
        try { window.history.replaceState({}, '', cleanUrl); } catch (_) {}
      }
      if (goRegister) {
        goRegister.addEventListener('click', () => {
          activate(panelRegister);
          const u = document.getElementById('reg-username');
          if (u) u.focus();
        });
      }
    })();

    // Decide initial panel based on URL pathname. /forgot-password and
    // /reset-password are served by the same shell as /login.
    (() => {
      const p = window.location.pathname;
      if (p === '/reset-password' || p === '/reset-password/') {
        activate(panelReset);
      } else if (p === '/forgot-password' || p === '/forgot-password/') {
        activate(panelForgot);
      }
    })();

    // ── Helpers ───────────────────────────────────────────────────────
    function showError(id, msg) {
      const el = document.getElementById(id);
      el.textContent = msg;
      el.classList.add('is-visible');
    }

    function clearError(id) {
      const el = document.getElementById(id);
      el.textContent = '';
      el.classList.remove('is-visible');
    }

    function setLoading(btn, loading) {
      btn.disabled = loading;
      btn.classList.toggle('is-loading', loading);
      btn.textContent = loading
        ? (btn.id === 'login-submit' ? 'Signing in…' : 'Creating…')
        : (btn.id === 'login-submit' ? 'Sign in' : 'Create account');
    }

    // ── Login form ────────────────────────────────────────────────────
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError('login-error');
      const btn      = document.getElementById('login-submit');
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;

      if (!username || !password) {
        showError('login-error', 'Please enter your username and password.');
        return;
      }

      setLoading(btn, true);
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          window.location.href = '/';
        } else {
          showError('login-error', data.error || 'Invalid username or password.');
        }
      } catch {
        showError('login-error', 'Could not reach the server. Try again.');
      } finally {
        setLoading(btn, false);
      }
    });

    // Permissive client-side email shape check (the server enforces a stricter version).
    function looksLikeEmail(s) {
      return typeof s === 'string'
        && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
        && s.trim().length <= 254;
    }

    // ── Register form ─────────────────────────────────────────────────
    document.getElementById('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError('register-error');
      const btn      = document.getElementById('register-submit');
      const username = document.getElementById('reg-username').value.trim();
      const email    = document.getElementById('reg-email').value.trim();
      const password = document.getElementById('reg-password').value;
      const confirm  = document.getElementById('reg-confirm').value;

      if (!username) {
        showError('register-error', 'Please enter a username.');
        return;
      }
      if (!email) {
        showError('register-error', 'Please enter your email so you can reset your password later.');
        document.getElementById('reg-email').classList.add('is-error');
        return;
      }
      if (!looksLikeEmail(email)) {
        showError('register-error', 'That email doesn’t look right. Double-check the format.');
        document.getElementById('reg-email').classList.add('is-error');
        return;
      }
      if (!password) {
        showError('register-error', 'Please enter a password.');
        document.getElementById('reg-password').classList.add('is-error');
        return;
      }
      if (password.length < 10) {
        showError('register-error', 'Password must be at least 10 characters.');
        document.getElementById('reg-password').classList.add('is-error');
        return;
      }
      if (password.length > 200) {
        showError('register-error', 'Password must be 200 characters or fewer.');
        document.getElementById('reg-password').classList.add('is-error');
        return;
      }
      if (!confirm) {
        showError('register-error', 'Please confirm your password.');
        document.getElementById('reg-confirm').classList.add('is-error');
        return;
      }
      if (password !== confirm) {
        showError('register-error', 'Passwords do not match.');
        document.getElementById('reg-confirm').classList.add('is-error');
        return;
      }

      ['reg-email', 'reg-password', 'reg-confirm'].forEach(id => document.getElementById(id).classList.remove('is-error'));

      setLoading(btn, true);
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, email, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          window.location.href = '/';
        } else {
          showError('register-error', data.error || 'Registration failed. Try different details.');
        }
      } catch {
        showError('register-error', 'Could not reach the server. Try again.');
      } finally {
        setLoading(btn, false);
      }
    });

    // ── Forgot password form ──────────────────────────────────────────
    document.getElementById('forgot-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError('forgot-error');
      const successEl = document.getElementById('forgot-success');
      successEl.style.display = 'none';

      const btn   = document.getElementById('forgot-submit');
      const email = document.getElementById('forgot-email').value.trim();

      if (!email || !looksLikeEmail(email)) {
        showError('forgot-error', 'Enter the email address you registered with.');
        document.getElementById('forgot-email').classList.add('is-error');
        return;
      }
      document.getElementById('forgot-email').classList.remove('is-error');

      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json().catch(() => ({}));
        // Server always returns a generic 200 (no enumeration). Show that
        // back to the user — same message regardless of whether the email
        // is on file.
        successEl.textContent = data.message || 'If an account with that email exists, a reset link is on its way.';
        successEl.style.display = 'block';
      } catch {
        showError('forgot-error', 'Could not reach the server. Try again.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Send reset link';
      }
    });

    // ── Reset password form ───────────────────────────────────────────
    document.getElementById('reset-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError('reset-error');
      const successEl = document.getElementById('reset-success');
      successEl.style.display = 'none';

      const btn = document.getElementById('reset-submit');
      const password = document.getElementById('reset-password').value;
      const confirm  = document.getElementById('reset-confirm').value;
      const token = new URLSearchParams(window.location.search).get('token') || '';

      if (!token) {
        showError('reset-error', 'No reset token in the URL. Request a new reset link.');
        return;
      }
      if (!password || password.length < 10) {
        showError('reset-error', 'Password must be at least 10 characters.');
        document.getElementById('reset-password').classList.add('is-error');
        return;
      }
      if (password.length > 200) {
        showError('reset-error', 'Password must be 200 characters or fewer.');
        document.getElementById('reset-password').classList.add('is-error');
        return;
      }
      if (password !== confirm) {
        showError('reset-error', 'Passwords do not match.');
        document.getElementById('reset-confirm').classList.add('is-error');
        return;
      }
      ['reset-password', 'reset-confirm'].forEach(id => document.getElementById(id).classList.remove('is-error'));

      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          successEl.textContent = data.message || 'Password updated. Please log in.';
          successEl.style.display = 'block';
          // Auto-bounce to the sign-in panel after a moment.
          setTimeout(() => {
            activate(panelLogin);
            window.history.replaceState({}, '', '/login');
            document.getElementById('login-username').focus();
          }, 1500);
        } else {
          showError('reset-error', data.error || 'Reset failed. Request a new link and try again.');
        }
      } catch {
        showError('reset-error', 'Could not reach the server. Try again.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save new password';
      }
    });

    // ── Clear field errors on input ───────────────────────────────────
    document.querySelectorAll('.login-input').forEach(input => {
      input.addEventListener('input', () => input.classList.remove('is-error'));
    });

    // ── Google OAuth — check if enabled and show buttons ─────────────
    (async () => {
      try {
        const res = await fetch('/api/auth/google/status');
        const data = await res.json();
        if (data.enabled) {
          document.getElementById('google-login-section').classList.add('is-enabled');
          document.getElementById('google-register-section').classList.add('is-enabled');
        }
      } catch { /* Google OAuth not available */ }
    })();

    // ── App version in the footer (from /health) ─────────────────────
    (async () => {
      try {
        const res = await fetch('/health');
        const h = await res.json();
        if (h && h.version) {
          document.getElementById('login-version').textContent =
            ` · v${h.version}${h.commit ? ` (${h.commit})` : ''}`;
        }
      } catch { /* footer stays plain */ }
    })();

    document.getElementById('google-login-btn').addEventListener('click', () => {
      window.location.href = '/api/auth/google';
    });
    document.getElementById('google-register-btn').addEventListener('click', () => {
      window.location.href = '/api/auth/google';
    });

    // ── Handle OAuth error query params ──────────────────────────────
    const urlParams = new URLSearchParams(window.location.search);
    const oauthError = urlParams.get('error');
    if (oauthError) {
      const messages = {
        google_denied: 'Google sign-in was cancelled.',
        google_not_configured: 'Google OAuth is not configured on this server.',
        google_token_failed: 'Google authentication failed. Please try again.',
        google_profile_failed: 'Could not retrieve your Google profile. Please try again.',
        google_failed: 'Google sign-in failed. Please try again.',
      };
      showError('login-error', messages[oauthError] || 'Sign-in failed. Please try again.');
      window.history.replaceState({}, '', '/login');
    }
