'use strict';

/**
 * Tiny email sender. Dispatches to Resend's HTTP API when configured;
 * falls back to console output for local dev so the reset link is always
 * visible somewhere even without an API key.
 *
 * Configuration (env vars):
 *   RESEND_API_KEY   API key from resend.com. If unset → console-log mode.
 *   EMAIL_FROM       Sender (e.g. "Steward <noreply@yourdomain.com>"). The
 *                    domain must be verified in Resend. Default fallback is
 *                    "onboarding@resend.dev" which only delivers to the
 *                    account owner's email — fine for testing, useless for real users.
 *   APP_BASE_URL     Used to construct reset links. Default http://localhost:3000.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'Steward <onboarding@resend.dev>';
const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

function isConfigured() {
  return !!RESEND_API_KEY;
}

/**
 * Send an email. Returns { ok, dispatched, providerId?, error? }.
 *   dispatched: 'resend' | 'console' (so callers and tests can assert path)
 * Never throws — failure to send a reset email should not 500 the API.
 */
async function sendEmail({ to, subject, html, text }) {
  if (!to || !subject || (!html && !text)) {
    return { ok: false, dispatched: 'none', error: 'Missing to / subject / body.' };
  }

  if (!isConfigured()) {
    // Dev mode: log the message body so the link is reachable even without
    // a configured provider. INTENTIONALLY logs the full text — anyone with
    // server log access can already reset accounts in dev anyway.
    console.log('\n────────────────────── [email] (no RESEND_API_KEY, console mode) ──────────────────────');
    console.log(`  To:      ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  ${(text || html).replace(/\n/g, '\n  ')}`);
    console.log('───────────────────────────────────────────────────────────────────────────────────────\n');
    return { ok: true, dispatched: 'console' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html, text }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[email] Resend rejected request:', res.status, body);
      return { ok: false, dispatched: 'resend', error: body && body.message ? body.message : `HTTP ${res.status}` };
    }
    return { ok: true, dispatched: 'resend', providerId: body && body.id };
  } catch (err) {
    console.error('[email] Resend fetch failed:', err && err.message ? err.message : err);
    return { ok: false, dispatched: 'resend', error: err && err.message ? err.message : 'fetch failed' };
  }
}

/**
 * Build a password-reset email. Kept separate from sendEmail so the route can
 * generate the body deterministically (e.g. for tests / debugging) before
 * actually dispatching.
 */
function buildPasswordResetEmail({ username, resetUrl, ttlMinutes }) {
  const safeUser = String(username || 'there');
  const safeTtl = Number.isFinite(Number(ttlMinutes)) ? Math.max(1, Math.round(Number(ttlMinutes))) : 60;
  const text =
`Hi ${safeUser},

You (or someone using your email) requested a password reset for your Steward account.

Open this link to set a new password — it expires in ${safeTtl} minute${safeTtl === 1 ? '' : 's'}:

${resetUrl}

If you didn't request this, you can safely ignore this email — your password won't change.

— Steward`;

  const html =
`<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1a;line-height:1.5;max-width:560px;margin:0 auto;padding:24px;">
  <p>Hi ${escapeHtml(safeUser)},</p>
  <p>You (or someone using your email) requested a password reset for your Steward account.</p>
  <p style="margin:24px 0;">
    <a href="${escapeHtml(resetUrl)}" style="background:#c8a84c;color:#1a1a1a;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">Set a new password</a>
  </p>
  <p style="color:#666;font-size:13px;">Or copy and paste this link — it expires in ${safeTtl} minute${safeTtl === 1 ? '' : 's'}:<br>
  <code style="font-size:12px;word-break:break-all;">${escapeHtml(resetUrl)}</code></p>
  <p style="color:#666;font-size:13px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="color:#999;font-size:11px;">— Steward</p>
</body></html>`;

  return { subject: 'Reset your Steward password', text, html };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validate an email shape. Permissive — meant to catch typos, not enforce RFC.
 * Server stores normalized lower-case; UNIQUE index in DB handles dedupe.
 */
function looksLikeEmail(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length < 5 || t.length > 254) return false;
  // local@domain.tld — at least one dot in the domain part, no whitespace
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

module.exports = {
  sendEmail,
  buildPasswordResetEmail,
  looksLikeEmail,
  APP_BASE_URL,
};
