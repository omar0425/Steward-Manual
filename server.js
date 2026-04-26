'use strict';

const express   = require('express');
const path      = require('path');
const apiRouter = require('./routes/api');

const app  = express();
const publicDir = path.join(__dirname, 'public');
const PORT = (() => {
  const n = parseInt(process.env.PORT || '3000', 10);
  return Number.isFinite(n) && n > 0 ? n : 3000;
})();

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json());

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

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api', stewardLocalhostApiCors);
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  next();
});
app.use('/api', apiRouter);
app.get('/health', (req, res) =>
  res.json({ ok: true, uptime: process.uptime(), app: 'steward-manual' }),
);

// ── HTML pages ────────────────────────────────────────────────────────────────
app.get(['/showcase', '/showcase/'], (req, res) => {
  res.sendFile(path.join(publicDir, 'showcase.html'));
});

function sendMainShell(req, res) {
  res.sendFile(path.join(publicDir, 'play.html'));
}

app.get(['/', '/index.html'], sendMainShell);
app.get(['/play', '/play/'], sendMainShell);

app.use(express.static(publicDir));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'play.html'));
});

// ── Boot ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  console.log(`\n  Steward (Manual) running at ${base}`);
  console.log(`  Dashboard:       ${base}/`);
  console.log(`  Tier gallery:    ${base}/showcase`);
  console.log(`  Health check:    ${base}/health\n`);
});
