'use strict';

/**
 * Web-push wrapper with zero-config VAPID: the signing key pair is generated
 * on first use and persisted in app_meta, so no environment variables are
 * needed and the keys survive restarts (a changed key would orphan every
 * existing subscription).
 */

const webpush = require('web-push');
const {
  getAppMeta,
  setAppMeta,
  listPushSubscriptionsForUser,
  deletePushSubscriptionAnyUser,
} = require('../db');
const { APP_BASE_URL } = require('./email');

const VAPID_KEY = 'vapid_keys_v1';

let _vapid = null;
function ensureVapidKeys() {
  if (_vapid) return _vapid;
  const raw = getAppMeta(VAPID_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.publicKey && parsed.privateKey) {
        _vapid = parsed;
      }
    } catch (_) { /* regenerate below */ }
  }
  if (!_vapid) {
    _vapid = webpush.generateVAPIDKeys();
    setAppMeta(VAPID_KEY, JSON.stringify(_vapid));
    console.log('[push] Generated VAPID key pair (stored in app_meta).');
  }
  // The VAPID subject must be an https: URL or a mailto: — the localhost
  // default (http://localhost:3000) is rejected by web-push, so fall back.
  const subject = APP_BASE_URL && APP_BASE_URL.startsWith('https://')
    ? APP_BASE_URL
    : 'mailto:steward@localhost.invalid';
  webpush.setVapidDetails(subject, _vapid.publicKey, _vapid.privateKey);
  return _vapid;
}

function getPublicKey() {
  return ensureVapidKeys().publicKey;
}

/**
 * Send a payload to every subscription a user has. Dead endpoints (404/410 —
 * the browser unsubscribed or the user cleared site data) are pruned so the
 * table never accumulates corpses. Returns { sent, pruned, failed }.
 */
async function sendToUser(userId, payload) {
  ensureVapidKeys();
  const subs = listPushSubscriptionsForUser(userId);
  let sent = 0;
  let pruned = 0;
  let failed = 0;
  const body = JSON.stringify(payload);
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: 24 * 60 * 60 },
      );
      sent += 1;
    } catch (err) {
      const code = err && err.statusCode;
      if (code === 404 || code === 410) {
        deletePushSubscriptionAnyUser(s.endpoint);
        pruned += 1;
      } else {
        failed += 1;
        console.error(`[push] send failed (user=${userId}, status=${code || 'n/a'})`);
      }
    }
  }
  return { sent, pruned, failed };
}

module.exports = { ensureVapidKeys, getPublicKey, sendToUser };
