'use strict';

const { DatabaseSync } = require('node:sqlite');
const { scrypt, scryptSync, randomBytes, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const scryptAsync = promisify(scrypt);
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.STEWARD_DB_PATH
  ? path.resolve(process.env.STEWARD_DB_PATH)
  : path.join(__dirname, 'steward.db');

// Same as db.js: ensure parent dir exists. Belt-and-suspenders in case
// db-auth is required before db.js by some future entry point.
try { fs.mkdirSync(path.dirname(DB_PATH), { recursive: true }); } catch { /* ignore */ }

const db = new DatabaseSync(DB_PATH);
// Enforce foreign keys on THIS connection too (it's a per-connection pragma).
// deleteUserAccount relies on ON DELETE CASCADE to clear sessions + reset tokens;
// make that guaranteed rather than dependent on the node:sqlite build default.
db.exec('PRAGMA foreign_keys = ON');

// Wait up to 5s for a lock rather than failing instantly with SQLITE_BUSY.
// This is a second connection to the same file as db.js; busy_timeout is
// per-connection, so it must be set here too. (journal_mode=WAL is a persistent
// DB property already set by db.js — it carries across connections.)
db.exec("PRAGMA busy_timeout = 5000");

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT    UNIQUE,
    email      TEXT    UNIQUE,
    password   TEXT,
    provider   TEXT    NOT NULL DEFAULT 'local',
    created_at TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL,
    expires_at TEXT    NOT NULL
  );

  -- Password reset tokens. token_hash stores a SHA-256 of the raw token so a
  -- DB leak doesn't hand attackers usable reset links. Tokens are single-use
  -- (used_at NOT NULL after redemption) and short-lived (1 hour).
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT    NOT NULL UNIQUE,
    expires_at TEXT    NOT NULL,
    used_at    TEXT,
    created_at TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user
    ON password_reset_tokens(user_id);
`);

// ── Password hashing (scrypt) ─────────────────────────────────────────────────

const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
// Current cost parameters. Raise SCRYPT_LN (and thus N) to strengthen hashing;
// every stored hash carries its OWN params, so old hashes still verify, and
// needsPasswordRehash() flags any weaker-than-current hash for a transparent
// upgrade on the user's next successful login.
const SCRYPT_LN = 14;            // log2(N)
const SCRYPT_N  = 1 << SCRYPT_LN; // 16384 — Node's default cost
const SCRYPT_R  = 8;
const SCRYPT_P  = 1;

function _scryptOpts({ N, r, p }) {
  return { N, r, p, maxmem: SCRYPT_MAXMEM };
}

// Parse either the versioned format `scrypt$ln=..,r=..,p=..$saltHex$keyHex` or
// the legacy `saltHex:keyHex` (which used Node's default params). Returns null
// if unparseable. Legacy is flagged so needsPasswordRehash can upgrade it.
function _parseStored(stored) {
  const s = String(stored || '');
  if (s.startsWith('scrypt$')) {
    const parts = s.split('$'); // ['scrypt', 'ln=14,r=8,p=1', salt, key]
    if (parts.length !== 4 || !parts[2] || !parts[3]) return null;
    const params = {};
    for (const kv of parts[1].split(',')) {
      const [k, v] = kv.split('=');
      params[k] = Number(v);
    }
    const N = Number.isFinite(params.ln) ? (1 << params.ln) : NaN;
    if (!Number.isFinite(N) || !Number.isFinite(params.r) || !Number.isFinite(params.p)) return null;
    return { salt: parts[2], keyHex: parts[3], N, r: params.r, p: params.p, ln: params.ln, legacy: false };
  }
  const [salt, keyHex] = s.split(':');
  if (!salt || !keyHex) return null;
  return { salt, keyHex, N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, ln: SCRYPT_LN, legacy: true };
}

function _encode(salt, keyHex) {
  return `scrypt$ln=${SCRYPT_LN},r=${SCRYPT_R},p=${SCRYPT_P}$${salt}$${keyHex}`;
}

function hashPassword(plain) {
  const salt = randomBytes(16).toString('hex');
  const keyHex = scryptSync(plain, salt, SCRYPT_KEYLEN, _scryptOpts({ N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })).toString('hex');
  return _encode(salt, keyHex);
}

// Async variants run scrypt on the libuv threadpool instead of blocking the main
// thread. The routes use these so a burst of logins/registrations can't stall the
// event loop for every other request. The sync versions are kept for tests and
// any synchronous caller; both emit and verify the same versioned format.
async function hashPasswordAsync(plain) {
  const salt = randomBytes(16).toString('hex');
  const keyHex = (await scryptAsync(plain, salt, SCRYPT_KEYLEN, _scryptOpts({ N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }))).toString('hex');
  return _encode(salt, keyHex);
}

function verifyPassword(plain, stored) {
  const parsed = _parseStored(stored);
  if (!parsed) return false;
  const storedBuf = Buffer.from(parsed.keyHex, 'hex');
  const derived = scryptSync(plain, parsed.salt, storedBuf.length, _scryptOpts(parsed));
  if (derived.length !== storedBuf.length) return false;
  return timingSafeEqual(derived, storedBuf);
}

async function verifyPasswordAsync(plain, stored) {
  const parsed = _parseStored(stored);
  if (!parsed) return false;
  const storedBuf = Buffer.from(parsed.keyHex, 'hex');
  const derived = await scryptAsync(plain, parsed.salt, storedBuf.length, _scryptOpts(parsed));
  if (derived.length !== storedBuf.length) return false;
  return timingSafeEqual(derived, storedBuf);
}

// True when a stored hash is legacy-format or uses cost params below the current
// target. The login route rehashes flagged hashes on the next successful login.
function needsPasswordRehash(stored) {
  const parsed = _parseStored(stored);
  if (!parsed) return false;
  return parsed.legacy || parsed.ln < SCRYPT_LN || parsed.r < SCRYPT_R || parsed.p < SCRYPT_P;
}

// ── User CRUD ─────────────────────────────────────────────────────────────────

// Shared insert used by both the sync and async create paths, given an
// already-computed password hash — so the two never drift.
function _insertLocalUser(username, hash, email) {
  const now = new Date().toISOString();
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  const info = db.prepare(`
    INSERT INTO users (username, email, password, provider, created_at)
    VALUES (?, ?, ?, 'local', ?)
  `).run(username, normalizedEmail, hash, now);
  return {
    id: Number(info.lastInsertRowid),
    username,
    email: normalizedEmail,
    provider: 'local',
  };
}

function createLocalUser(username, password, email) {
  return _insertLocalUser(username, hashPassword(password), email);
}

async function createLocalUserAsync(username, password, email) {
  return _insertLocalUser(username, await hashPasswordAsync(password), email);
}

function setUserEmail(userId, email) {
  const normalized = email ? String(email).trim().toLowerCase() : null;
  db.prepare(`UPDATE users SET email = ? WHERE id = ?`).run(normalized, userId);
  return normalized;
}

function setUserPassword(userId, newPlainPassword) {
  const hash = hashPassword(newPlainPassword);
  db.prepare(`UPDATE users SET password = ? WHERE id = ?`).run(hash, userId);
}

async function setUserPasswordAsync(userId, newPlainPassword) {
  const hash = await hashPasswordAsync(newPlainPassword);
  db.prepare(`UPDATE users SET password = ? WHERE id = ?`).run(hash, userId);
}

function findUserByUsername(username) {
  return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) || null;
}

function findUserByEmail(email) {
  return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) || null;
}

function findUserById(id) {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) || null;
}

/** Lightweight roster for admin tooling — no password/hash fields. */
function listAllUsers() {
  return db.prepare(
    `SELECT id, username, email, provider, created_at FROM users ORDER BY id ASC`,
  ).all();
}

function findOrCreateGoogleUser(email, displayName) {
  let user = findUserByEmail(email);
  if (user) {
    // Only authenticate into an existing row if it's actually a Google identity.
    // Merging into a pre-existing LOCAL account would let an attacker who
    // registered victim@example.com (email is not verified at registration) be
    // silently signed into by the real owner's Google login — account takeover.
    // Refuse; the caller surfaces a "link your accounts" style error instead.
    if (user.provider !== 'google') {
      const err = new Error('This email is already registered with a password. Sign in with your password.');
      err.code = 'EMAIL_OWNED_BY_LOCAL';
      throw err;
    }
    return user;
  }
  const now = new Date().toISOString();
  const username = displayName || email.split('@')[0];
  const info = db.prepare(`
    INSERT INTO users (username, email, provider, created_at)
    VALUES (?, ?, 'google', ?)
  `).run(username, email, now);
  return { id: Number(info.lastInsertRowid), username, email, provider: 'google' };
}

// ── Session management ────────────────────────────────────────────────────────

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function createSession(userId) {
  const id = randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  db.prepare(`
    INSERT INTO sessions (id, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(id, userId, now.toISOString(), expires.toISOString());
  return { id, expiresAt: expires };
}

function validateSession(sessionId) {
  if (!sessionId) return null;
  const row = db.prepare(`
    SELECT s.*, u.username, u.email, u.provider
    FROM sessions s JOIN users u ON s.user_id = u.id
    WHERE s.id = ?
  `).get(sessionId);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
    return null;
  }
  return {
    sessionId: row.id,
    userId: row.user_id,
    username: row.username,
    email: row.email,
    provider: row.provider,
  };
}

function deleteSession(sessionId) {
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
}

function deleteUserSessions(userId) {
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
}

/** Sign out every device except the calling one. Returns sessions removed. */
function deleteOtherUserSessions(userId, keepSessionId) {
  const info = db.prepare(`DELETE FROM sessions WHERE user_id = ? AND id != ?`)
    .run(userId, String(keepSessionId || ''));
  return Number(info.changes) || 0;
}

/**
 * Permanently delete a user account. Removes the user row, which CASCADEs to
 * sessions and password_reset_tokens via the schema foreign keys. Caller is
 * responsible for clearing game-data tables (snapshots / debt_account_* /
 * config) BEFORE invoking this, since those tables key on user_id but do not
 * declare CASCADE on the FK.
 */
function deleteUserAccount(userId) {
  db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
}

// Prune expired sessions (call periodically)
function pruneExpiredSessions() {
  db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(new Date().toISOString());
}

// ── Password reset tokens ─────────────────────────────────────────────────────

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

function _hashToken(raw) {
  return createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

/**
 * Issue a single-use password reset token for `userId`. Returns the *raw*
 * token (only ever in memory — never persisted) so the caller can drop it
 * into an email link. Storage is the SHA-256 hash; if the DB leaks, attackers
 * still need the raw token from the original email to redeem.
 */
function createPasswordResetToken(userId) {
  const raw = randomBytes(32).toString('base64url');
  const hash = _hashToken(raw);
  const now = new Date();
  const expires = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
  db.prepare(`
    INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, hash, expires.toISOString(), now.toISOString());
  return { token: raw, expiresAt: expires.toISOString() };
}

/**
 * Look up a token by its raw value. Returns null if missing, expired, or
 * already used. Caller must still mark it used after applying the reset.
 */
function findValidPasswordResetToken(rawToken) {
  if (!rawToken) return null;
  const hash = _hashToken(rawToken);
  const row = db.prepare(`
    SELECT t.id, t.user_id, t.expires_at, t.used_at, u.username, u.email
    FROM password_reset_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ?
  `).get(hash);
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return row;
}

function consumePasswordResetToken(tokenRowId) {
  db.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), tokenRowId);
}

function purgeExpiredPasswordResetTokens() {
  db.prepare(`DELETE FROM password_reset_tokens WHERE expires_at < ?`)
    .run(new Date().toISOString());
}

module.exports = {
  createLocalUser,
  createLocalUserAsync,
  findUserByUsername,
  findUserByEmail,
  findUserById,
  listAllUsers,
  findOrCreateGoogleUser,
  setUserEmail,
  setUserPassword,
  setUserPasswordAsync,
  createSession,
  validateSession,
  deleteSession,
  deleteUserSessions,
  deleteOtherUserSessions,
  deleteUserAccount,
  pruneExpiredSessions,
  verifyPassword,
  verifyPasswordAsync,
  needsPasswordRehash,
  createPasswordResetToken,
  findValidPasswordResetToken,
  consumePasswordResetToken,
  purgeExpiredPasswordResetTokens,
  PASSWORD_RESET_TTL_MS,
  SESSION_TTL_MS,
};
