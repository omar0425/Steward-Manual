'use strict';

/**
 * When the HTML shell is served from another dev origin (e.g. Vite on :3002), point fetches at the
 * Steward Node process (e.g. http://localhost:3000) so status / snapshots / brokerage stay single-backend.
 * Set: `window.__STEWARD_API_ORIGIN__ = 'http://localhost:3000'` or meta `steward-api-origin`.
 * Use value `same` (or `__STEWARD_API_ORIGIN__ = 'same'`) to always use `location.origin` (matches auto-picked PORT).
 */
export function stewardApiOrigin() {
  if (typeof window === 'undefined') return '';
  const originFromSame = () =>
    window.location && window.location.origin ? window.location.origin.replace(/\/$/, '') : '';
  const resolve = (raw) => {
    const s = (raw || '').toString().trim();
    if (!s) return '';
    if (s.toLowerCase() === 'same') return originFromSame();
    return s.replace(/\/$/, '');
  };
  const g = resolve(window.__STEWARD_API_ORIGIN__);
  if (g) return g;
  const meta =
    typeof document !== 'undefined' ? document.querySelector('meta[name="steward-api-origin"]') : null;
  const c = resolve(meta && meta.content ? meta.content : '');
  return c || '';
}

/** User-facing base URL for hints (matches current tab port when on http(s)). */
export function stewardPublicOriginHint() {
  if (typeof window === 'undefined' || !window.location) return 'http://localhost:3000';
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    return `${window.location.protocol}//${window.location.host}`;
  }
  return 'http://localhost:3000';
}

export function stewardApiUrl(resourcePath) {
  const p = resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`;
  const o = stewardApiOrigin();
  return o ? `${o}${p}` : p;
}

/** Read fetch Response body as JSON; throws with a clear message if the server returned HTML or an error page. */
export async function readJsonRes(res, label) {
  const text = await res.text();
  if (!res.ok) {
    const bit = text ? text.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
    throw new Error(`${label} returned HTTP ${res.status}${bit ? ` — ${bit}` : ''}`);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `${label} was not valid JSON. Open Steward at ${stewardPublicOriginHint()}/ (run npm start in the steward folder), not by double‑clicking index.html.`,
    );
  }
}

export async function readBrokerageRes(res) {
  const text = await res.text();
  if (!res.ok) return { fetchFailed: true };
  try {
    return text ? JSON.parse(text) : { fetchFailed: true };
  } catch {
    return { fetchFailed: true };
  }
}
