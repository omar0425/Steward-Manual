'use strict';

/* Steward Chat — upgrades the "Ask the Steward" panel into a real
   conversation, for every signed-in user.

   What you get:
   - a persistent thread (server-side, survives reloads/devices)
   - a free-text box — explain the situation, ask anything
   - the Steward can ACT: tell it about a payment, a new card, a due date or
     an APR and it records the entry through the app's own validated write
     path (undoable; a 📒 receipt line shows exactly what was recorded, and
     the dashboard refreshes to match)
   - a standing "My situation" note plus a visible, deletable list of facts
     the Steward remembers across conversations
   - the suggestion chips feed the chat instead of the one-shot endpoint */

import { stewardApiUrl } from './api.js';
import { buildSteward } from './character.js';

let _busy = false;
// Client-side copy of the live thread — powers the export and keeps the
// timestamps we render without re-fetching.
let _currentMessages = [];
const DRAFT_KEY = 'steward-chat-draft';

/* Small holographic "AI Steward" avatar for the chat header — the same character
   rig, reskinned via data-skin="ai", scaled down. Mirrors the tier the dashboard
   is currently showing (read off the hero card) so a Buried user gets the grim
   hologram and a Debt-Free user the triumphant one. Purely cosmetic. */
function currentStewardState() {
  const card = document.getElementById('hero-state-card');
  const heroState = card && card.dataset ? card.dataset.state : null;
  return heroState || 'building';
}

function buildAiStewardHeader() {
  const header = el('div', 'steward-ai-chat-header');
  header.style.cssText = 'display:flex;align-items:center;gap:14px;padding:2px 2px 12px;';

  const avatar = el('div', 'steward-ai-chat-avatar');
  // Decorative — the "AI Steward" text label beside it carries the meaning, so
  // hide the character from the a11y tree (its template carries an aria-label
  // without a role, which axe flags as a prohibited attribute otherwise).
  avatar.setAttribute('aria-hidden', 'true');
  avatar.style.cssText = 'flex:0 0 auto;width:100px;height:120px;position:relative;overflow:hidden;'
    + 'border-radius:16px;background:radial-gradient(circle at 50% 30%,#0b2f6e,#04122e);'
    + 'box-shadow:0 0 0 1px rgba(76,201,240,0.35),0 0 18px rgba(76,201,240,0.22);';
  const wrap = buildSteward(currentStewardState(), { skin: 'ai' });
  if (wrap) {
    const charEl = wrap.querySelector('.steward-character');
    if (charEl) charEl.removeAttribute('aria-label');
    // Push the character down within its own frame so the (tall) top hat + "AI"
    // band land inside the bust crop instead of poking out the top.
    wrap.style.setProperty('--scene-shift-y', '60px');
    const inner = el('div', 'steward-ai-chat-avatar-inner');
    inner.style.cssText = 'position:absolute;left:50%;top:6px;transform:translateX(-50%) scale(0.6);transform-origin:top center;';
    inner.appendChild(wrap);
    avatar.appendChild(inner);
  }

  const meta = el('div', 'steward-ai-chat-meta');
  const name = el('div', 'steward-ai-chat-name', 'AI Steward');
  name.style.cssText = 'font-family:"Cormorant Garamond",Georgia,serif;font-weight:800;font-size:1.15rem;color:#dff2ff;';
  const status = el('div', 'steward-ai-chat-status');
  status.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:0.72rem;letter-spacing:0.06em;text-transform:uppercase;color:#7fd8ff;margin-top:2px;';
  const dot = el('span'); dot.style.cssText = 'width:7px;height:7px;border-radius:50%;background:#4cc9f0;box-shadow:0 0 6px #4cc9f0;';
  status.appendChild(dot);
  status.appendChild(el('span', null, 'Online · reading your numbers'));
  meta.appendChild(name);
  meta.appendChild(status);

  header.appendChild(avatar);
  header.appendChild(meta);
  return header;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function fmtMsgTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric', minute: '2-digit',
  });
}

/* One message row: who + text, a muted timestamp, and (on Steward replies) a
   copy button so advice can be pasted into notes without hand-selection. */
function buildMsgRow(role, text, at) {
  const row = el('div', `steward-chat-msg steward-chat-msg--${role === 'assistant' ? 'steward' : 'you'}`);
  row.appendChild(el('span', 'steward-chat-who', role === 'assistant' ? '🧐' : 'You'));
  const body = el('span', 'steward-chat-text', text);
  row.appendChild(body);
  const meta = el('span', 'steward-chat-msg-meta');
  const time = fmtMsgTime(at);
  if (time) meta.appendChild(el('span', 'steward-chat-time', time));
  if (role === 'assistant') {
    const copy = el('button', 'steward-chat-copy', '⧉');
    copy.type = 'button';
    copy.title = 'Copy this reply';
    copy.setAttribute('aria-label', 'Copy this reply');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(body.textContent);
        copy.textContent = '✓';
        window.setTimeout(() => { copy.textContent = '⧉'; }, 1200);
      } catch (_) { /* clipboard unavailable — leave the glyph */ }
    });
    meta.appendChild(copy);
  }
  if (meta.childNodes.length) row.appendChild(meta);
  return row;
}

function renderThread(threadEl, messages) {
  threadEl.textContent = '';
  _currentMessages = (messages || []).map((m) => ({ role: m.role, text: m.text, at: m.at || null }));
  for (const m of _currentMessages) {
    threadEl.appendChild(buildMsgRow(m.role, m.text, m.at));
  }
  threadEl.scrollTop = threadEl.scrollHeight;
}

function appendMsg(threadEl, role, text, opts = {}) {
  const at = opts.at || new Date().toISOString();
  const row = buildMsgRow(role, text, opts.pending ? null : at);
  threadEl.appendChild(row);
  threadEl.scrollTop = threadEl.scrollHeight;
  if (!opts.pending) _currentMessages.push({ role, text, at });
  return row;
}

function appendActionReceipts(threadEl, actions) {
  for (const a of actions) {
    if (!a || !a.summary) continue;
    const row = el('div', 'steward-chat-msg steward-chat-msg--action');
    row.appendChild(el('span', 'steward-chat-who', '📒'));
    row.appendChild(el('span', 'steward-chat-text', a.summary));
    threadEl.appendChild(row);
  }
  threadEl.scrollTop = threadEl.scrollHeight;
}

async function sendChat(threadEl, input, sendBtn, message) {
  if (_busy || !message.trim()) return;
  _busy = true;
  input.value = '';
  try { localStorage.removeItem(DRAFT_KEY); } catch (_) { /* ignore */ }
  input.dispatchEvent(new Event('input')); // collapse the auto-grown box + counter
  input.disabled = true;
  sendBtn.disabled = true;
  appendMsg(threadEl, 'user', message.trim());
  const pending = appendMsg(threadEl, 'assistant', 'The Steward is considering…', { pending: true });
  pending.classList.add('steward-chat-msg--pending');
  // On failure the message is restored into the box, so retrying is one tap —
  // a failed send must never mean retyping the whole thing.
  const restoreOnError = () => {
    if (!input.value.trim()) {
      input.value = message.trim();
      input.dispatchEvent(new Event('input'));
    }
  };
  try {
    const res = await fetch(stewardApiUrl('/api/steward-ai/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.trim() }),
    });
    const data = await res.json().catch(() => null);
    pending.classList.remove('steward-chat-msg--pending');
    if (data && data.ok && data.reply) {
      pending.remove();
      // Ledger receipts render before the prose reply, in entry order.
      if (Array.isArray(data.actions) && data.actions.length) {
        appendActionReceipts(threadEl, data.actions);
        void refreshMemoryList();
      }
      appendMsg(threadEl, 'assistant', data.reply);
      // The Steward wrote to the ledger — refresh the dashboard so the
      // numbers on screen match what was just recorded.
      if (data.dataChanged && typeof window.stewardRefreshDashboard === 'function') {
        void window.stewardRefreshDashboard();
      }
    } else {
      pending.classList.add('steward-chat-msg--error');
      pending.querySelector('.steward-chat-text').textContent =
        ((data && data.error) || 'The Steward could not answer just now.') + ' — your message is back in the box.';
      restoreOnError();
    }
  } catch (_) {
    pending.classList.remove('steward-chat-msg--pending');
    pending.classList.add('steward-chat-msg--error');
    pending.querySelector('.steward-chat-text').textContent = 'Could not reach the Steward — your message is back in the box.';
    restoreOnError();
  }
  _busy = false;
  input.disabled = false;
  sendBtn.disabled = false;
  try { input.focus(); } catch (_) { /* ignore */ }
}

/* Download the visible conversation as a plain-text file. */
function exportConversation() {
  if (!_currentMessages.length) return;
  const lines = ['Steward conversation — exported ' + new Date().toLocaleString(), ''];
  for (const m of _currentMessages) {
    const when = fmtMsgTime(m.at);
    lines.push(`[${m.role === 'assistant' ? 'Steward' : 'You'}${when ? ` · ${when}` : ''}]`);
    lines.push(m.text, '');
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `steward-chat-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ── "What the Steward remembers" — player-visible memory with delete ─────────
let _memoryListEl = null;

function renderMemories(listEl, memories) {
  listEl.textContent = '';
  if (!memories || memories.length === 0) {
    listEl.appendChild(el('p', 'steward-chat-memory-empty',
      'Nothing yet. Tell the Steward something worth remembering — or say "remember that…"'));
    return;
  }
  for (const m of memories) {
    const row = el('div', 'steward-chat-memory-row');
    row.appendChild(el('span', 'steward-chat-memory-fact', m.fact));
    const del = el('button', 'steward-chat-memory-del', '✕');
    del.type = 'button';
    del.title = 'Forget this';
    del.setAttribute('aria-label', `Forget: ${m.fact}`);
    del.addEventListener('click', async () => {
      del.disabled = true;
      try {
        const res = await fetch(stewardApiUrl('/api/steward-ai/memory/delete'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: m.id }),
        });
        const data = await res.json().catch(() => null);
        if (data && data.ok) renderMemories(listEl, data.memories);
        else del.disabled = false;
      } catch (_) { del.disabled = false; }
    });
    row.appendChild(del);
    listEl.appendChild(row);
  }
}

async function refreshMemoryList() {
  if (!_memoryListEl) return;
  try {
    const res = await fetch(stewardApiUrl('/api/steward-ai/memory'));
    const data = await res.json().catch(() => null);
    if (data && data.ok) renderMemories(_memoryListEl, data.memories);
  } catch (_) { /* keep whatever is shown */ }
}

function buildChatUi(panel, state) {
  // Retitle the panel: it's a conversation now.
  const sub = panel.querySelector('.tc-section-sublabel');
  if (sub) sub.textContent = 'A running conversation, grounded in your own numbers. Tell it what happened — “paid $500 on the Visa” — and it records the entry for you.';

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

  // ── What the Steward remembers ──
  const memWrap = el('details', 'steward-chat-note steward-chat-memory');
  memWrap.appendChild(el('summary', 'steward-chat-note-summary', '🧠 What the Steward remembers'));
  const memList = el('div', 'steward-chat-memory-list');
  memWrap.appendChild(memList);
  _memoryListEl = memList;
  renderMemories(memList, state.memories || []);

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
  // Short enough to fit the two-line box on a phone — the third line of the
  // old placeholder clipped mid-word. Shift+Enter stays discoverable via title.
  // The aria-label is the real accessible name: a title alone trips axe's
  // label-title-only rule (and placeholders vanish the moment you type).
  input.placeholder = 'Tell the Steward what’s going on, or ask anything…';
  input.title = 'Enter to send · Shift+Enter for a new line';
  input.setAttribute('aria-label', 'Message the Steward');
  const send = el('button', 'commitment-btn steward-chat-send', 'Send');
  send.type = 'button';
  send.id = 'steward-chat-send';
  inputRow.appendChild(input);
  inputRow.appendChild(send);

  // Character headroom — only appears when the 1500 limit gets close, so it
  // never nags a one-liner.
  const counter = el('div', 'steward-chat-counter');
  counter.setAttribute('aria-live', 'polite');
  counter.hidden = true;

  // Auto-grow: a long story shouldn't scroll inside a two-line slit. Grows to
  // ~6 lines, then scrolls. Also persists the draft — a reload or an accidental
  // navigation must not eat a half-typed message.
  const syncInput = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    const left = input.maxLength - input.value.length;
    counter.hidden = left > 200;
    counter.textContent = left <= 200 ? `${left} characters left` : '';
    try {
      if (input.value.trim()) localStorage.setItem(DRAFT_KEY, input.value);
      else localStorage.removeItem(DRAFT_KEY);
    } catch (_) { /* private mode */ }
  };
  input.addEventListener('input', syncInput);
  try {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft) { input.value = draft; window.setTimeout(syncInput, 0); }
  } catch (_) { /* ignore */ }

  send.addEventListener('click', () => void sendChat(thread, input, send, input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendChat(thread, input, send, input.value);
    }
  });

  // ── Conversation tools: save / export / clear ──
  const tools = el('div', 'steward-chat-tools');
  const saveBtn = el('button', 'steward-chat-tool-btn', '💾 Save & start new');
  saveBtn.type = 'button';
  saveBtn.title = 'Snapshot this conversation into “Saved conversations” and start a fresh one.';
  const exportBtn = el('button', 'steward-chat-tool-btn', '⇣ Export .txt');
  exportBtn.type = 'button';
  exportBtn.title = 'Download this conversation as a plain-text file.';
  const clearBtn = el('button', 'steward-chat-tool-btn steward-chat-tool-btn--danger', '✕ Clear');
  clearBtn.type = 'button';
  clearBtn.title = 'Delete this conversation without saving it.';
  tools.append(saveBtn, exportBtn, clearBtn);

  // ── Saved conversations ──
  const archWrap = el('details', 'steward-chat-note steward-chat-archives');
  const archSummary = el('summary', 'steward-chat-note-summary', '📁 Saved conversations');
  const archList = el('div', 'steward-chat-archive-list');
  archWrap.appendChild(archSummary);
  archWrap.appendChild(archList);

  function renderArchives(archives) {
    archSummary.textContent = `📁 Saved conversations${archives.length ? ` (${archives.length})` : ''}`;
    archList.textContent = '';
    if (!archives.length) {
      archList.appendChild(el('p', 'steward-chat-memory-empty',
        'None yet. “Save & start new” keeps a conversation here so the thread never becomes one endless scroll.'));
      return;
    }
    for (const a of archives) {
      const row = el('div', 'steward-chat-archive-row');
      const open = el('button', 'steward-chat-archive-open');
      open.type = 'button';
      open.title = 'Reopen this conversation (the current one is saved automatically first).';
      open.appendChild(el('span', 'steward-chat-archive-title', a.title));
      open.appendChild(el('span', 'steward-chat-archive-meta',
        `${fmtMsgTime(a.savedAt)} · ${a.messageCount} message${a.messageCount === 1 ? '' : 's'}`));
      open.addEventListener('click', async () => {
        open.disabled = true;
        try {
          const res = await fetch(stewardApiUrl('/api/steward-ai/chat/archives/resume'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id }),
          });
          const data = await res.json().catch(() => null);
          if (data && data.ok) {
            renderThread(thread, data.messages || []);
            renderArchives(data.archives || []);
          } else { open.disabled = false; }
        } catch (_) { open.disabled = false; }
      });
      const del = el('button', 'steward-chat-memory-del', '✕');
      del.type = 'button';
      del.title = 'Delete this saved conversation';
      del.setAttribute('aria-label', `Delete saved conversation: ${a.title}`);
      del.addEventListener('click', async () => {
        if (!window.confirm(`Delete “${a.title}”? This can't be undone.`)) return;
        del.disabled = true;
        try {
          const res = await fetch(stewardApiUrl('/api/steward-ai/chat/archives/delete'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id }),
          });
          const data = await res.json().catch(() => null);
          if (data && data.ok) renderArchives(data.archives || []);
          else del.disabled = false;
        } catch (_) { del.disabled = false; }
      });
      row.append(open, del);
      archList.appendChild(row);
    }
  }
  renderArchives(state.archives || []);

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      const res = await fetch(stewardApiUrl('/api/steward-ai/chat/archive'), { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (data && data.ok) {
        renderThread(thread, []);
        renderArchives(data.archives || []);
        archWrap.open = true;
      }
    } catch (_) { /* leave as-is */ }
    saveBtn.disabled = false;
  });

  exportBtn.addEventListener('click', exportConversation);

  clearBtn.addEventListener('click', async () => {
    if (!window.confirm('Delete this conversation without saving? The Steward keeps your situation note either way.')) return;
    try {
      await fetch(stewardApiUrl('/api/steward-ai/chat/clear'), { method: 'POST' });
      renderThread(thread, []);
    } catch (_) { /* leave as-is */ }
  });

  // Insert: note above the chips, thread + input below them. Chips stay — they
  // become quick-starts that feed the conversation.
  const chips = panel.querySelector('#ask-steward-chips');
  panel.insertBefore(buildAiStewardHeader(), chips);
  panel.insertBefore(noteWrap, chips);
  panel.insertBefore(memWrap, chips);
  panel.insertBefore(archWrap, chips);
  panel.appendChild(thread);
  panel.appendChild(inputRow);
  panel.appendChild(counter);
  panel.appendChild(tools);

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

/** Called from boot. Probes the chat endpoint and builds the UI. */
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
