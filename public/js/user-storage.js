'use strict';

/*
 * Browser-only preferences must follow the signed-in account. Financial data
 * already lives server-side; this module only scopes lightweight UX state such
 * as the commitment, guided tour, and session timer.
 */
let currentUserId = null;
let scopePromise = null;

function normalizeUserId(value) {
  const id = String(value == null ? '' : value).trim();
  return id && /^[a-zA-Z0-9_-]+$/.test(id) ? id : null;
}

export async function initializeUserStorageScope() {
  if (currentUserId) return currentUserId;
  if (scopePromise) return scopePromise;
  scopePromise = (async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!res.ok) return null;
      const data = await res.json();
      currentUserId = normalizeUserId(data && data.user && data.user.id);
      return currentUserId;
    } catch {
      return null;
    }
  })();
  const resolved = await scopePromise;
  // A transient auth/network failure must not poison storage scoping for the
  // rest of the page lifetime. Let the next initializer retry.
  if (!resolved) scopePromise = null;
  return resolved;
}

export function userStorageKey(baseKey) {
  return currentUserId ? `${baseKey}:user:${currentUserId}` : null;
}

export function readUserStorage(baseKey) {
  const key = userStorageKey(baseKey);
  if (!key) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeUserStorage(baseKey, value) {
  const key = userStorageKey(baseKey);
  if (!key) return false;
  try {
    localStorage.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}

export function removeUserStorage(baseKey) {
  const key = userStorageKey(baseKey);
  try {
    if (key) localStorage.removeItem(key);
    // Retire the old unscoped key. Reading it would leak one account's UI
    // state into the next account using the same browser.
    localStorage.removeItem(baseKey);
  } catch {
    /* storage can be unavailable in hardened/private browser contexts */
  }
}
