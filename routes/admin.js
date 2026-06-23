'use strict';

/**
 * Operator tooling, guarded by ADMIN_TOKEN (env var; never in the client).
 * Mounted OUTSIDE the /api session gate so it's reachable with just the token —
 * the same trust model as /admin/backup. Lets the operator inspect and repair
 * an individual user's data through the app's validated code paths instead of
 * hand-editing SQLite.
 *
 *   GET  /admin/api/users                 — roster (id, username, email)
 *   GET  /admin/api/users/:id/export      — full export of one user
 *   POST /admin/api/users/:id/restore     — rebuild one user from an export
 *   POST /admin/api/users/:id/recompute   — rebuild paid/new totals from history
 *                                           (dry-run unless ?apply=1)
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { withUser, exportUserData, importUserData, isValidImportPayload } = require('../db');
const { recomputeClimbTotalsFromHistory } = require('../services/climbMetrics');
const { findUserById, listAllUsers } = require('../db-auth');

function requireAdminToken(req, res, next) {
  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected) {
    return res.status(501).json({ ok: false, error: 'Admin API not configured. Set ADMIN_TOKEN.' });
  }
  const supplied =
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() ||
    String(req.headers['x-admin-token'] || '') ||
    String(req.query.token || '');
  // Hash both sides so timingSafeEqual gets equal-length buffers.
  const a = crypto.createHash('sha256').update(supplied).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (!supplied || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ ok: false, error: 'Invalid admin token.' });
  }
  next();
}

router.use(requireAdminToken);

function resolveUser(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ ok: false, error: 'User id must be an integer.' });
    return null;
  }
  const user = findUserById(id);
  if (!user) {
    res.status(404).json({ ok: false, error: `No user with id ${id}.` });
    return null;
  }
  return user;
}

router.get('/users', (req, res) => {
  res.json({ ok: true, users: listAllUsers() });
});

router.get('/users/:id/export', (req, res) => {
  const user = resolveUser(req, res);
  if (!user) return undefined;
  const data = withUser(user.id, () => exportUserData());
  return res.json({
    ok: true,
    user: { id: user.id, username: user.username, email: user.email || null },
    ...data,
  });
});

router.post('/users/:id/restore', express.json({ limit: '8mb' }), (req, res) => {
  const user = resolveUser(req, res);
  if (!user) return undefined;
  const check = isValidImportPayload(req.body);
  if (!check.ok) return res.status(400).json({ ok: false, error: check.error });
  try {
    const restored = withUser(user.id, () => importUserData(req.body));
    return res.json({ ok: true, user: { id: user.id, username: user.username }, restored });
  } catch (err) {
    console.error('[admin] restore', err);
    return res.status(500).json({ ok: false, error: 'Restore failed.' });
  }
});

router.post('/users/:id/recompute', (req, res) => {
  const user = resolveUser(req, res);
  if (!user) return undefined;
  const apply = req.query.apply === '1' || req.query.apply === 'true';
  try {
    const result = withUser(user.id, () => recomputeClimbTotalsFromHistory({ apply }));
    return res.json({ ok: true, user: { id: user.id, username: user.username }, ...result });
  } catch (err) {
    console.error('[admin] recompute', err);
    return res.status(500).json({ ok: false, error: 'Recompute failed.' });
  }
});

module.exports = router;
