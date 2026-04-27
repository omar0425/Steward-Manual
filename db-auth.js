'use strict';

const { DatabaseSync } = require('node:sqlite');
const { scryptSync, randomBytes, timingSafeEqual } = require('node:crypto');
const path = require('path');

const DB_PATH = process.env.STEWARD_DB_PATH
  ? path.resolve(process.env.STEWARD_DB_PATH)
  : path.join(__dirname, 'steward.db');
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

function createLocalUser(username, password) {
  const now = new Date().toISOString();
  const hash = hashPassword(password);
  const info = db.prepare(`
    INSERT INTO users (username, password, provider, created_at)
    VALUES (?, ?, 'local', ?)
  `).run(username, hash, now);
  return { id: Number(info.lastInsertRowid), username, provider: 'local' };
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

module.exports = {
  createLocalUser,
  findUserByUsername,
  findUserByEmail,
  findUserById,
  findOrCreateGoogleUser,
  createSession,
  validateSession,
  deleteSession,
  deleteUserSessions,
  pruneExpiredSessions,
  verifyPassword,
  SESSION_TTL_MS,
};
