'use strict';

/* Steward Chat (beta) — upgrades the "Ask the Steward" panel into a real
   conversation for the beta account. The probe (GET /api/steward-ai/chat)
   404s for everyone else, so this module silently does nothing for them and
   they keep the one-shot chip Q&A.

   What the beta gets:
   - a persistent thread (server-side, survives reloads/devices)
   - a free-text box — explain the situation, ask anything
   - a standing "My situation" note the Steward always knows (injected into
     every AI surface, not just chat)
   - the suggestion chips feed the chat instead of the one-shot endpoint */

import { stewardApiUrl } from './api.js';

let _busy = false;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function renderThread(threadEl, messages) {
  threadEl.textContent = '';
  for (const m of messages) {
    const row = el('div', `steward-chat-msg steward-chat-msg--${m.role === 'assistant' ? 'steward' : 'you'}`);
    row.appendChild(el('span', 'steward-chat-who', m.role === 'assistant' ? '🧐' : 'You'));
    row.appendChild(el('span', 'steward-chat-text', m.text));
    threadEl.appendChild(row);
  }
  threadEl.scrollTop = threadEl.scrollHeight;
}

function appendMsg(threadEl, role, text) {
  const row = el('div', `steward-chat-msg steward-chat-msg--${role === 'assistant' ? 'steward' : 'you'}`);
  row.appendChild(el('span', 'steward-chat-who', role === 'assistant' ? '🧐' : 'You'));
  row.appendChild(el('span', 'steward-chat-text', text));
  threadEl.appendChild(row);
  threadEl.scrollTop = threadEl.scrollHeight;
  return row;
}

async function sendChat(threadEl, input, sendBtn, message) {
  if (_busy || !message.trim()) return;
  _busy = true;
  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;
  appendMsg(threadEl, 'user', message.trim());
  const pending = appendMsg(threadEl, 'assistant', 'The Steward is considering…');
  pending.classList.add('steward-chat-msg--pending');
  try {
    const res = await fetch(stewardApiUrl('/api/steward-ai/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.trim() }),
    });
    const data = await res.json().catch(() => null);
    pending.classList.remove('steward-chat-msg--pending');
    if (data && data.ok && data.reply) {
      pending.querySelector('.steward-chat-text').textContent = data.reply;
    } else {
      pending.classList.add('steward-chat-msg--error');
      pending.querySelector('.steward-chat-text').textContent =
        (data && data.error) || 'The Steward could not answer just now.';
    }
  } catch (_) {
    pending.classList.remove('steward-chat-msg--pending');
    pending.classList.add('steward-chat-msg--error');
    pending.querySelector('.steward-chat-text').textContent = 'Could not reach the Steward. Try again.';
  }
  _busy = false;
  input.disabled = false;
  sendBtn.disabled = false;
  try { input.focus(); } catch (_) { /* ignore */ }
}

function buildChatUi(panel, state) {
  // Retitle the panel: it's a conversation now.
  const sub = panel.querySelector('.tc-section-sublabel');
  if (sub) sub.textContent = 'A running conversation, grounded in your own numbers. Tell it what’s going on.';

  // ── Standing situation note ──
  const noteWrap = el('details', 'steward-chat-note');
  const noteSummary = el('summary', 'steward-chat-note-summary', '📝 My situation (the Steward always knows this)');
  const noteArea = document.createElement('textarea');
  noteArea.className = 'steward-chat-note-input';
  noteArea.rows = 3;
  noteArea.maxLength = 2000;
  noteArea.placeholder = 'e.g. “Work slowed down in June so I missed two payments on the Visa. Back to full hours now. Trying to catch up without touching savings.”';
  noteArea.value = state.situationNote || '';
  const noteActions = el('div', 'steward-chat-note-actions');
  const noteSave = el('button', 'refresh-btn', 'Save note');
  noteSave.type = 'button';
  const noteMsg = el('span', 'steward-chat-note-msg', '');
  noteActions.appendChild(noteSave);
  noteActions.appendChild(noteMsg);
  noteWrap.appendChild(noteSummary);
  noteWrap.appendChild(noteArea);
  noteWrap.appendChild(noteActions);

  noteSave.addEventListener('click', async () => {
    noteSave.disabled = true;
    noteMsg.textContent = 'Saving…';
    try {
      const res = await fetch(stewardApiUrl('/api/steward-ai/situation-note'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: noteArea.value }),
      });
      noteMsg.textContent = res.ok ? 'Saved — the Steward knows.' : 'Could not save.';
    } catch (_) { noteMsg.textContent = 'Could not save.'; }
    noteSave.disabled = false;
    window.setTimeout(() => { noteMsg.textContent = ''; }, 2500);
  });

  // ── Thread + input ──
  const thread = el('div', 'steward-chat-thread');
  thread.id = 'steward-chat-thread';
  thread.setAttribute('aria-live', 'polite');
  renderThread(thread, state.messages || []);

  const inputRow = el('div', 'steward-chat-input-row');
  const input = document.createElement('textarea');
  input.className = 'steward-chat-input';
  input.id = 'steward-chat-input';
  input.rows = 2;
  input.maxLength = 1500;
  input.placeholder = 'Tell the Steward what’s going on, or ask anything… (Enter to send, Shift+Enter for a new line)';
  const send = el('button', 'commitment-btn steward-chat-send', 'Send');
  send.type = 'button';
  send.id = 'steward-chat-send';
  inputRow.appendChild(input);
  inputRow.appendChild(send);

  send.addEventListener('click', () => void sendChat(thread, input, send, input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendChat(thread, input, send, input.value);
    }
  });

  const clearBtn = el('button', 'steward-chat-clear', 'Start a fresh conversation');
  clearBtn.type = 'button';
  clearBtn.addEventListener('click', async () => {
    if (!window.confirm('Clear this conversation? The Steward keeps your situation note either way.')) return;
    try {
      await fetch(stewardApiUrl('/api/steward-ai/chat/clear'), { method: 'POST' });
      renderThread(thread, []);
    } catch (_) { /* leave as-is */ }
  });

  // Insert: note above the chips, thread + input below them. Chips stay — they
  // become quick-starts that feed the conversation.
  const chips = panel.querySelector('#ask-steward-chips');
  panel.insertBefore(noteWrap, chips);
  panel.appendChild(thread);
  panel.appendChild(inputRow);
  panel.appendChild(clearBtn);

  // The one-shot answer box is superseded by the thread.
  const oneShot = panel.querySelector('#ask-steward-answer');
  if (oneShot) oneShot.remove();

  // Intercept chip clicks in the CAPTURE phase so the legacy one-shot handler
  // (bound by initAskSteward) never fires in chat mode.
  chips.addEventListener('click', (e) => {
    const btn = e.target.closest('.ask-steward-chip');
    if (!btn) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    void sendChat(thread, input, send, btn.textContent.trim());
  }, true);
}

/** Called from boot. Probes the gated endpoint; 404 = not the beta account. */
export async function initStewardChat() {
  const panel = document.getElementById('ask-steward-panel');
  if (!panel || panel.dataset.chatMode === '1') return;
  let res;
  try {
    res = await fetch(stewardApiUrl('/api/steward-ai/chat'));
  } catch (_) { return; }
  if (!res.ok) return;
  const state = await res.json().catch(() => null);
  // beta:false → not the beta account; keep the one-shot chip behavior.
  if (!state || !state.ok || state.beta !== true) return;
  panel.dataset.chatMode = '1';
  buildChatUi(panel, state);
  // Chat mode is useful even before the AI key is set (the thread explains
  // itself); the panel unhides via initAskSteward when aiEnabled, but in chat
  // mode we show it regardless so the note box is reachable.
  panel.hidden = false;
}
