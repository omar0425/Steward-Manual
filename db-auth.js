'use strict';

const { DatabaseSync } = require('node:sqlite');
const { scryptSync, randomBytes, timingSafeEqual, createHash } = require('node:crypto');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.STEWARD_DB_PATH
  ? path.resolve(process.env.STEWARD_DB_PATH)
  : path.join(__dirname, 'steward.db');

// Same as db.js: ensure parent dir exists. Belt-and-suspenders in case
// db-auth is required before db.js by some future entry point.
try { fs.mkdirSync(path.dirname(DB_PATH), { recursive: true }); } catch { /* ignore */ }

const db = new DatabaseSync(DB_PATH);

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

function hashPassword(plain) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(plain, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(plain, stored) {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const derived = scryptSync(plain, salt, SCRYPT_KEYLEN);
  const storedBuf = Buffer.from(key, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return timingSafeEqual(derived, storedBuf);
}

// ── User CRUD ─────────────────────────────────────────────────────────────────

function createLocalUser(username, password, email) {
  const now = new Date().toISOString();
  const hash = hashPassword(password);
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

function setUserEmail(userId, email) {
  const normalized = email ? String(email).trim().toLowerCase() : null;
  db.prepare(`UPDATE users SET email = ? WHERE id = ?`).run(normalized, userId);
  return normalized;
}

function setUserPassword(userId, newPlainPassword) {
  const hash = hashPassword(newPlainPassword);
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

function findOrCreateGoogleUser(email, displayName) {
  let user = findUserByEmail(email);
  if (user) return user;
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
  findUserByUsername,
  findUserByEmail,
  findUserById,
  findOrCreateGoogleUser,
  setUserEmail,
  setUserPassword,
  createSession,
  validateSession,
  deleteSession,
  deleteUserSessions,
  pruneExpiredSessions,
  verifyPassword,
  createPasswordResetToken,
  findValidPasswordResetToken,
  consumePasswordResetToken,
  purgeExpiredPasswordResetTokens,
  PASSWORD_RESET_TTL_MS,
  SESSION_TTL_MS,
};
