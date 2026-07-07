'use strict';

/* Payment-reminder push: registers the service worker and manages the
   subscribe/unsubscribe toggle in the data strip. Push needs a due day set on
   at least one account to be useful, but the toggle works independently —
   subscribing first and setting due days later is fine. */

import { stewardApiUrl } from './api.js';

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.warn('[push] SW registration failed:', err && err.message);
    return null;
  }
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function subscribeToReminders() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };
  const keyRes = await fetch(stewardApiUrl('/api/push/public-key'));
  const keyData = await keyRes.json().catch(() => null);
  if (!keyRes.ok || !keyData || !keyData.publicKey) return { ok: false, reason: 'no_key' };
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
  });
  const save = await fetch(stewardApiUrl('/api/push/subscribe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  if (!save.ok) {
    try { await sub.unsubscribe(); } catch (_) { /* best effort */ }
    return { ok: false, reason: 'save_failed' };
  }
  return { ok: true };
}

export async function unsubscribeFromReminders() {
  const sub = await currentSubscription();
  if (!sub) return { ok: true };
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch (_) { /* still clear server side */ }
  await fetch(stewardApiUrl('/api/push/unsubscribe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }).catch(() => null);
  return { ok: true };
}

function setBtnState(btn, subscribed) {
  btn.dataset.subscribed = subscribed ? '1' : '0';
  btn.textContent = subscribed ? '🔔 Reminders on' : '🔕 Enable reminders';
  btn.title = subscribed
    ? 'Payment reminders are on for this device. Click to turn off.'
    : 'Get a notification a few days before each payment due date (set due days in Edit APRs & terms).';
}

/** Wire the reminders toggle. Idempotent; hides the button when unsupported. */
export async function initPushToggle() {
  const btn = document.getElementById('push-reminders-btn');
  if (!btn) return;
  if (!pushSupported()) { btn.hidden = true; return; }
  if (btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';

  await registerServiceWorker();
  let sub = null;
  try { sub = await currentSubscription(); } catch (_) { /* treat as unsubscribed */ }
  setBtnState(btn, !!sub);
  btn.hidden = false;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      if (btn.dataset.subscribed === '1') {
        await unsubscribeFromReminders();
        setBtnState(btn, false);
      } else {
        const r = await subscribeToReminders();
        if (r.ok) {
          setBtnState(btn, true);
        } else if (r.reason === 'denied') {
          btn.textContent = 'Notifications blocked in browser';
          window.setTimeout(() => setBtnState(btn, false), 3000);
        } else {
          btn.textContent = 'Could not enable — try again';
          window.setTimeout(() => setBtnState(btn, false), 3000);
        }
      }
    } catch (err) {
      console.warn('[push] toggle failed:', err && err.message);
      setBtnState(btn, btn.dataset.subscribed === '1');
    }
    btn.disabled = false;
  });
}
