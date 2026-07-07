'use strict';

/* Account CLEARED — the loudest moment in the app. Shown once when a balance
   hits exactly $0 (armed server-side by the snapshot route), with a canvas-
   rendered card the user can share or save. Dismissing POSTs
   account-cleared-seen so it never re-fires. */

import { stewardApiUrl } from './api.js';

let _showing = false;

function fmtMoney(n) {
  return '$' + Math.round(Number(n)).toLocaleString();
}

function fmtDate(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/* Draw the shareable card: dark navy, gold seal, account name, the journey. */
function drawCard(cleared) {
  const W = 1000, H = 620;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#0e1220';
  ctx.fillRect(0, 0, W, H);
  const grad = ctx.createRadialGradient(W / 2, 0, 80, W / 2, 0, 620);
  grad.addColorStop(0, 'rgba(200,168,76,0.16)');
  grad.addColorStop(1, 'rgba(200,168,76,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(200,168,76,0.55)';
  ctx.lineWidth = 3;
  ctx.strokeRect(24, 24, W - 48, H - 48);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#c8a84c';
  ctx.font = '600 26px "IBM Plex Mono", monospace';
  ctx.fillText('S T E W A R D', W / 2, 96);

  ctx.fillStyle = '#ece8dc';
  ctx.font = '700 92px "Cormorant Garamond", Georgia, serif';
  ctx.fillText('CLEARED', W / 2, 216);

  ctx.fillStyle = '#c8a84c';
  ctx.font = '600 44px "Cormorant Garamond", Georgia, serif';
  const name = String(cleared.name || 'Account').slice(0, 40);
  ctx.fillText(name, W / 2, 296);

  ctx.fillStyle = '#8e9ab8';
  ctx.font = '400 30px "IBM Plex Sans", sans-serif';
  ctx.fillText(`${fmtMoney(cleared.startBalance)}  →  $0`, W / 2, 376);
  ctx.font = '400 24px "IBM Plex Sans", sans-serif';
  ctx.fillText(fmtDate(cleared.clearedAt), W / 2, 428);

  ctx.fillStyle = '#c8a84c';
  ctx.font = '48px serif';
  ctx.fillText('✦', W / 2, 512);
  return c;
}

async function dismiss(overlay) {
  overlay.remove();
  _showing = false;
  try {
    await fetch(stewardApiUrl('/api/config/account-cleared-seen'), { method: 'POST' });
  } catch (_) { /* worst case it shows once more next load */ }
}

function showOverlay(clearedList) {
  const cleared = clearedList[0]; // one at a time; several in one pull is vanishingly rare
  const overlay = document.createElement('div');
  overlay.id = 'account-cleared-overlay';
  overlay.className = 'paydown-confirm-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${cleared.name} cleared`);
  overlay.innerHTML = `
    <div class="paydown-confirm-card cleared-card">
      <div class="cleared-burst" aria-hidden="true">✦</div>
      <div class="cleared-eyebrow">Debt destroyed</div>
      <h3 class="cleared-title">CLEARED</h3>
      <div class="cleared-name"></div>
      <div class="cleared-journey"></div>
      <div class="cleared-date"></div>
      <div class="paydown-confirm-actions cleared-actions">
        <button type="button" class="paydown-confirm-cancel" id="cleared-dismiss">Keep climbing</button>
        <button type="button" class="paydown-confirm-save" id="cleared-save">Save card</button>
      </div>
    </div>
  `;
  overlay.querySelector('.cleared-name').textContent = cleared.name || 'Account';
  overlay.querySelector('.cleared-journey').textContent = `${fmtMoney(cleared.startBalance)} → $0`;
  overlay.querySelector('.cleared-date').textContent = fmtDate(cleared.clearedAt);
  document.body.appendChild(overlay);

  overlay.querySelector('#cleared-dismiss').addEventListener('click', () => void dismiss(overlay));
  // Same escape hatches as every other Steward overlay: click the dim or Esc.
  overlay.addEventListener('click', (e) => { if (e.target === overlay) void dismiss(overlay); });
  const onKey = (e) => {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', onKey, true);
      void dismiss(overlay);
    }
  };
  document.addEventListener('keydown', onKey, true);

  overlay.querySelector('#cleared-save').addEventListener('click', async () => {
    const canvas = drawCard(cleared);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const file = new File([blob], `steward-cleared-${(cleared.name || 'account').replace(/\W+/g, '-').toLowerCase()}.png`, { type: 'image/png' });
    // Native share sheet where available (phones); download everywhere else.
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Debt cleared', text: `${cleared.name}: ${fmtMoney(cleared.startBalance)} → $0. Cleared.` });
        return;
      } catch (_) { /* user cancelled share → fall through to download */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
}

/** Called on every status render; fires at most once per armed celebration. */
export function maybeCelebrateCleared(status) {
  if (_showing) return;
  const list = status && Array.isArray(status.accountCleared) ? status.accountCleared : [];
  const valid = list.filter((c) => c && c.name && Number.isFinite(Number(c.startBalance)));
  if (valid.length === 0) return;
  if (document.getElementById('account-cleared-overlay')) return;
  _showing = true;
  showOverlay(valid);
}
