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
const {
  validateSession,
  pruneExpiredSessions,
  purgeExpiredPasswordResetTokens,
} = require('./db-auth');

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
// SQLite file — i.e. all users + snapshots vanish. A console.warn here was
// previously ignored and silently destroyed a live user base; refuse to boot
// instead so a misconfigured deploy fails its healthcheck loudly.
// Opt-out: set STEWARD_ALLOW_EPHEMERAL_DB=1 (only for throwaway envs).
if (
  process.env.NODE_ENV === 'production' &&
  !process.env.STEWARD_DB_PATH &&
  process.env.STEWARD_ALLOW_EPHEMERAL_DB !== '1'
) {
  console.error(
    '\n[Steward] FATAL: STEWARD_DB_PATH is not set in production.\n' +
    '  The SQLite database would live on the container\'s ephemeral filesystem\n' +
    '  and be wiped on every redeploy. Mount a persistent volume (e.g. Railway\n' +
    '  → New → Volume) and set STEWARD_DB_PATH=/data/steward.db.\n' +
    '  To override for a throwaway env, set STEWARD_ALLOW_EPHEMERAL_DB=1.\n',
  );
  process.exit(1);
}

// ── Production sanity check: password-reset email ─────────────────────────────
// Non-fatal — the app works without it — but without RESEND_API_KEY the reset
// link only prints to the server console, so a user who forgets their password
// is effectively locked out unless someone reads the Railway logs for them.
if (process.env.NODE_ENV === 'production' && !process.env.RESEND_API_KEY) {
  console.warn(
    '\n[Steward] WARNING: RESEND_API_KEY is not set in production.\n' +
    '  Password-reset emails will NOT be delivered — reset links only print to\n' +
    '  this log. Set RESEND_API_KEY (and EMAIL_FROM on a Resend-verified domain)\n' +
    '  so users can recover their accounts themselves.\n',
  );
}

// ── Middleware ─────────────────────────────────────────────────────────────────

// Security headers. Scripts are now fully external (login.html's inline block
// moved to /js/login.js; play.js's inline onclicks became listeners), so
// script-src drops 'unsafe-inline' — injected <script>/onclick markup no longer
// executes. style-src keeps 'unsafe-inline' because inline style="" attributes
// and <style> blocks remain in the markup (far lower risk than script). Plus:
// no framing (clickjacking), no MIME sniffing, no third-party sources of any
// kind (fonts/icons are self-hosted), HSTS once behind TLS.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Default JSON parser (100kb) for the whole app. The data-restore routes handle
// full exports that legitimately exceed that, and mount their own 8mb parser —
// but a global parser here would consume the stream first and reject the body
// with 413 before the route parser ran, silently breaking restore for exactly
// the users with enough history to need it. Skip those paths so their larger
// limit applies.
const globalJsonParser = express.json();
const RESTORE_PATH_RE = /^(?:\/api\/restore|\/admin\/api\/users\/\d+\/restore)\/?$/;
app.use((req, res, next) => {
  if (RESTORE_PATH_RE.test(req.path)) return next();
  return globalJsonParser(req, res, next);
});

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
  // Express 4 provides res.cookie / res.clearCookie natively, so the old
  // hand-rolled polyfill here was dead code. The `Secure`-in-production flag it
  // used to add now lives on the cookie itself (see setSessionCookie in
  // routes/auth.js) so the behavior is preserved without the dead branch.
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

// ── Backups ──────────────────────────────────────────────────────────────────
//
// Two layers:
//  1. Daily on-volume rotation (production only): VACUUM INTO a dated copy in
//     <db-dir>/backups/, keeping the last 7. Protects against corruption and
//     bad deploys — NOT against losing the volume itself.
//  2. GET /admin/backup, guarded by STEWARD_BACKUP_TOKEN: streams a consistent
//     copy of the live DB. Pull it from another machine on a schedule (see
//     scripts/pull-backup.ps1) for an off-site copy that survives volume loss.

const { db: liveDb } = require('./db');
const crypto = require('crypto');
const BACKUP_TOKEN = process.env.STEWARD_BACKUP_TOKEN || '';
const DB_DIR = path.dirname(
  process.env.STEWARD_DB_PATH
    ? path.resolve(process.env.STEWARD_DB_PATH)
    : path.join(__dirname, 'steward.db'),
);
const BACKUP_DIR = path.join(DB_DIR, 'backups');
const BACKUP_KEEP = 7;

function vacuumInto(destPath) {
  // VACUUM INTO writes a compact, consistent snapshot even mid-WAL. SQLite
  // refuses to overwrite, so callers pass a fresh path. Single quotes in the
  // path would break the literal — none of our generated paths contain them.
  liveDb.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
}

function runDailyBackupRotation() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const dest = path.join(BACKUP_DIR, `steward-${today}.db`);
    if (!fs.existsSync(dest)) {
      vacuumInto(dest);
      // Self-verify the snapshot we just wrote — a silently-corrupt backup is
      // worse than none (false confidence). Log loudly if it fails to verify.
      let verified = false;
      try {
        const { DatabaseSync } = require('node:sqlite');
        const check = new DatabaseSync(dest);
        const integ = check.prepare('PRAGMA integrity_check').get();
        verified = !!integ && (integ.integrity_check || Object.values(integ)[0]) === 'ok';
        check.close();
      } catch (err) {
        console.error('[backup] integrity check threw:', err && err.message);
      }
      if (verified) console.log(`[backup] daily snapshot written + verified: ${dest}`);
      else console.error(`[backup] WARNING: daily snapshot FAILED integrity check — do NOT rely on it: ${dest}`);
    }
    const old = fs.readdirSync(BACKUP_DIR)
      .filter((f) => /^steward-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort()
      .slice(0, -BACKUP_KEEP);
    for (const f of old) fs.unlinkSync(path.join(BACKUP_DIR, f));
  } catch (err) {
    console.error('[backup] daily rotation failed:', err && err.message);
  }
}

if (process.env.NODE_ENV === 'production') {
  runDailyBackupRotation();
  const handle = setInterval(runDailyBackupRotation, 12 * 60 * 60 * 1000);
  if (typeof handle.unref === 'function') handle.unref();
}

// ── Inactivity nudge (production only) ────────────────────────────────────────
// Daily sweep: users whose latest snapshot is older than STEWARD_NUDGE_DAYS
// (default 10; 0 disables) get one email per lapse via Resend. The sweep is a
// no-op when RESEND_API_KEY is unset.
if (process.env.NODE_ENV === 'production') {
  const { runInactivityNudgeSweep } = require('./services/nudge');
  const sweep = () => { runInactivityNudgeSweep().catch((err) => console.error('[nudge] sweep failed:', err)); };
  setTimeout(sweep, 60 * 1000); // let boot settle first
  const nudgeHandle = setInterval(sweep, 24 * 60 * 60 * 1000);
  if (typeof nudgeHandle.unref === 'function') nudgeHandle.unref();
}

// ── Payment due-date reminders (production only) ──────────────────────────────
// Sweeps every 6h: accounts with a due day set and a balance still owed get one
// reminder per statement cycle, 0–3 days before the due date, over web push
// (if the user opted in) and email (if a provider is configured). Runs more
// often than daily so a reminder isn't skipped when the server was asleep at
// the daily tick.
if (process.env.NODE_ENV === 'production') {
  const { runDueReminderSweep } = require('./services/reminders');
  const dueSweep = () => { runDueReminderSweep().catch((err) => console.error('[reminders] sweep failed:', err)); };
  setTimeout(dueSweep, 90 * 1000);
  const dueHandle = setInterval(dueSweep, 6 * 60 * 60 * 1000);
  if (typeof dueHandle.unref === 'function') dueHandle.unref();
}

app.get('/admin/backup', (req, res) => {
  if (!BACKUP_TOKEN) {
    return res.status(501).json({ ok: false, error: 'Backups not configured. Set STEWARD_BACKUP_TOKEN.' });
  }
  // Header only — a ?token= query string lands in proxy/access logs and browser
  // history, leaking the credential. Require the Authorization header.
  const supplied = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  // Hash both sides so timingSafeEqual gets equal-length buffers.
  const a = crypto.createHash('sha256').update(supplied).digest();
  const b = crypto.createHash('sha256').update(BACKUP_TOKEN).digest();
  if (!supplied || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ ok: false, error: 'Invalid backup token.' });
  }
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const tmp = path.join(require('os').tmpdir(), `steward-backup-${stamp}-${process.pid}.db`);
  try {
    vacuumInto(tmp);
  } catch (err) {
    console.error('[backup] VACUUM INTO failed:', err && err.message);
    return res.status(500).json({ ok: false, error: 'Backup failed.' });
  }
  res.download(tmp, `steward-backup-${stamp}.db`, () => {
    fs.unlink(tmp, () => {});
  });
});

// ── Admin tooling (ADMIN_TOKEN, no session) ───────────────────────────────────
// Mounted outside the /api session gate so the operator can inspect/repair a
// single user's data with just the token. See routes/admin.js.
app.use('/admin/api', require('./routes/admin'));

// ── Health (no auth) ──────────────────────────────────────────────────────────
// version comes from package.json (bumped per release batch); commit is the
// short deploy SHA when the platform provides one (Railway sets
// RAILWAY_GIT_COMMIT_SHA). Together they identify exactly which build is live.
const APP_VERSION = require('./package.json').version;
const APP_COMMIT =
  (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.STEWARD_COMMIT || '').slice(0, 7) || null;

app.get('/health', (req, res) =>
  res.json({
    ok: true,
    uptime: process.uptime(),
    app: 'steward-manual',
    version: APP_VERSION,
    commit: APP_COMMIT,
  }),
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

// Static cache policy. Without one, browsers heuristically cache css/js and
// can keep serving a stale bundle after a deploy. Fonts never change (the
// filenames encode family+weight) so they get a long immutable cache; every
// other asset must revalidate — ETag/Last-Modified make that a cheap 304.
app.use(express.static(publicDir, {
  setHeaders(res, filePath) {
    if (/\.(woff2?|ttf|otf)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

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
  // Oversized body — return the accurate 413 instead of collapsing it into a
  // generic 500. body-parser sets err.type='entity.too.large' / status 413.
  if (err && (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413)) {
    return res.status(413).json({ ok: false, error: 'Request body too large.' });
  }
  console.error('[Steward] Unhandled error:', err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, error: 'Internal server error.' });
});

// ── Prune expired sessions + reset tokens every hour ──────────────────────────
// .unref() so this timer never keeps the process alive on its own (parity with
// the backup + nudge intervals); a pending hourly cleanup shouldn't block a
// graceful shutdown.
const pruneHandle = setInterval(() => {
  pruneExpiredSessions();
  purgeExpiredPasswordResetTokens();
}, 60 * 60 * 1000);
if (typeof pruneHandle.unref === 'function') pruneHandle.unref();

// ── Boot ──────────────────────────────────────────────────────────────────────
// Loud, early warning if the SQLite file isn't on a Railway persistent volume —
// a redeploy would wipe every user's data. Logged once at boot.
try {
  const { storageDurabilityWarning } = require('./db');
  const warning = storageDurabilityWarning && storageDurabilityWarning();
  if (warning) {
    console.warn(`\n  ⚠️  [storage] ${warning}\n`);
  }
} catch (_) { /* never block startup on the check itself */ }

app.listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  console.log(`\n  Steward (Manual) v${APP_VERSION}${APP_COMMIT ? ` (${APP_COMMIT})` : ''} running at ${base}`);
  console.log(`  Dashboard:       ${base}/`);
  console.log(`  Login:           ${base}/login`);
  console.log(`  Tier gallery:    ${base}/showcase`);
  console.log(`  Health check:    ${base}/health\n`);
}).on('error', (err) => {
  console.error(`[Steward] Failed to bind port ${PORT}:`, err && err.message ? err.message : err);
  process.exit(1);
});
