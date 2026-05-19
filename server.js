'use strict';

const fs   = require('fs');
const path = require('path');

// Load .env file into process.env (avoids adding dotenv dependency)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const express    = require('express');
const apiRouter  = require('./routes/api');
const authRouter = require('./routes/auth');
const { COOKIE_NAME } = require('./routes/auth');
const { validateSession, pruneExpiredSessions } = require('./db-auth');

const app  = express();
const publicDir = path.join(__dirname, 'public');
const PORT = (() => {
  const n = parseInt(process.env.PORT || '3000', 10);
  return Number.isFinite(n) && n > 0 ? n : 3000;
})();

// ── Trust the platform reverse proxy ─────────────────────────────────────────
// Railway / Render / Heroku terminate TLS at the edge and forward via HTTP
// with X-Forwarded-* headers. Without this, req.protocol stays 'http',
// req.secure is false, and req.ip is the proxy's IP. Setting to 1 trusts
// exactly one hop — sufficient for Railway's setup and safer than `true`
// (which would let any upstream spoof these headers).
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// ── Production sanity check: persistent DB path ──────────────────────────────
// On Railway / Render / Fly, the container filesystem is ephemeral. Without
// STEWARD_DB_PATH pointing at a mounted volume, every redeploy wipes the
// SQLite file — i.e. all users + snapshots vanish. Warn loudly at boot so a
// well-meaning deploy doesn't silently destroy data.
if (process.env.NODE_ENV === 'production' && !process.env.STEWARD_DB_PATH) {
  console.warn(
    '\n[Steward] WARNING: STEWARD_DB_PATH is not set in production.\n' +
    '  The SQLite database lives in the container\'s ephemeral filesystem and\n' +
    '  will be wiped on every redeploy. Mount a persistent volume (e.g. Railway\n' +
    '  → New → Volume) and set STEWARD_DB_PATH=/data/steward.db.\n',
  );
}

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json());

// Simple cookie parser (avoids adding cookie-parser dependency)
app.use((req, res, next) => {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    for (const pair of header.split(';')) {
      const idx = pair.indexOf('=');
      if (idx > 0) {
        const key = pair.substring(0, idx).trim();
        const val = pair.substring(idx + 1).trim();
        req.cookies[key] = decodeURIComponent(val);
      }
    }
  }
  // Polyfill res.cookie / res.clearCookie if not present
  if (!res.cookie) {
    res.cookie = (name, value, opts = {}) => {
      let str = `${name}=${encodeURIComponent(value)}`;
      if (opts.maxAge) str += `; Max-Age=${Math.floor(opts.maxAge / 1000)}`;
      if (opts.httpOnly) str += '; HttpOnly';
      if (opts.sameSite) str += `; SameSite=${opts.sameSite}`;
      if (opts.path) str += `; Path=${opts.path}`;
      if (process.env.NODE_ENV === 'production') str += '; Secure';
      res.append('Set-Cookie', str);
      return res;
    };
  }
  if (!res.clearCookie) {
    res.clearCookie = (name, opts = {}) => {
      let str = `${name}=; Max-Age=0`;
      if (opts.path) str += `; Path=${opts.path}`;
      str += '; HttpOnly';
      res.append('Set-Cookie', str);
      return res;
    };
  }
  next();
});

// Session middleware — attach req.user if valid session cookie exists
app.use((req, res, next) => {
  const sid = req.cookies[COOKIE_NAME];
  if (sid) {
    req.user = validateSession(sid);
  }
  next();
});

// ── API CORS: localhost-only ──────────────────────────────────────────────────
function stewardLocalhostApiCors(req, res, next) {
  const origin = req.headers.origin;
  if (
    origin &&
    /^\s*https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\s*$/i.test(origin)
  ) {
    res.setHeader('Access-Control-Allow-Origin', origin.trim());
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
    const reqHdr = req.headers['access-control-request-headers'];
    if (reqHdr) res.setHeader('Access-Control-Allow-Headers', reqHdr);
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

// ── Auth routes (no guard — must be accessible before login) ──────────────────
app.use('/api/auth', stewardLocalhostApiCors);
app.use('/api/auth', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  next();
});
app.use('/api/auth', authRouter);

// ── API routes (guarded) ─────────────────────────────────────────────────────
app.use('/api', stewardLocalhostApiCors);
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  next();
});
app.use('/api', (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, error: 'Not authenticated.' });
  }
  next();
});
app.use('/api', apiRouter);
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'API route not found' });
});

// ── Health (no auth) ──────────────────────────────────────────────────────────
app.get('/health', (req, res) =>
  res.json({ ok: true, uptime: process.uptime(), app: 'steward-manual' }),
);

// ── HTML pages ────────────────────────────────────────────────────────────────
// Public pages (no auth required)
app.get(['/login', '/login/'], (req, res) => {
  if (req.user) return res.redirect('/');
  res.sendFile(path.join(publicDir, 'login.html'));
});

// Forgot / reset live in login.html and switch panels based on URL pathname,
// so both paths serve the same shell. No auth guard — reset must work for
// users who can't sign in.
app.get(['/forgot-password', '/forgot-password/'], (req, res) => {
  res.sendFile(path.join(publicDir, 'login.html'));
});
app.get(['/reset-password', '/reset-password/'], (req, res) => {
  res.sendFile(path.join(publicDir, 'login.html'));
});

app.get(['/showcase', '/showcase/'], (req, res) => {
  res.sendFile(path.join(publicDir, 'showcase.html'));
});

// Auth guard for all other pages
function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

function sendMainShell(req, res) {
  res.sendFile(path.join(publicDir, 'play.html'));
}

app.get(['/', '/index.html'], requireAuth, sendMainShell);
app.get(['/play', '/play/'], requireAuth, sendMainShell);

app.use(express.static(publicDir));

// SPA fallback (auth-guarded)
app.get('*', requireAuth, (req, res) => {
  res.sendFile(path.join(publicDir, 'play.html'));
});

// ── Error handler (MUST be the last app.use) ──────────────────────────────────
// Express's default error handler renders an HTML stack trace that leaks
// absolute filesystem paths (e.g. C:\Users\…\Steward-Manual\…). Catch
// malformed-JSON SyntaxErrors from express.json() — and any other unhandled
// errors — and return a minimal JSON response instead.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // body-parser flags malformed JSON with type 'entity.parse.failed'
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: 'Malformed JSON in request body.' });
  }
  console.error('[Steward] Unhandled error:', err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, error: 'Internal server error.' });
});

// ── Prune expired sessions every hour ─────────────────────────────────────────
setInterval(pruneExpiredSessions, 60 * 60 * 1000);

// ── Boot ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  console.log(`\n  Steward (Manual) running at ${base}`);
  console.log(`  Dashboard:       ${base}/`);
  console.log(`  Login:           ${base}/login`);
  console.log(`  Tier gallery:    ${base}/showcase`);
  console.log(`  Health check:    ${base}/health\n`);
}).on('error', (err) => {
  console.error(`[Steward] Failed to bind port ${PORT}:`, err && err.message ? err.message : err);
  process.exit(1);
});
