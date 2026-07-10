'use strict';

/**
 * Steward AI memory — small durable facts the Steward keeps about the player
 * across conversations ("paid on the 15th", "prioritizing the Visa", "car
 * repair coming in August"). Stored per-user in the config table; injected
 * into every AI context payload so the Steward never has to be re-told.
 *
 * Deliberately bounded: memories ride along on every model call, so the cap
 * is a context/token budget, not a storage limit. The AI consolidates or
 * deletes stale facts via its manage_memory tool; the player can also delete
 * any fact from the chat panel.
 */

const { getConfig, setConfig } = require('../db');

const MEMORY_KEY = 'steward_ai_memory';
const MEMORY_MAX = 80;          // facts kept (oldest evicted first)
const MEMORY_FACT_MAX_CHARS = 240;

function readStore() {
  try {
    const parsed = JSON.parse(getConfig(MEMORY_KEY) || '');
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
      return {
        nextId: Number.isInteger(parsed.nextId) && parsed.nextId > 0 ? parsed.nextId : 1,
        items: parsed.items.filter(
          (m) => m && Number.isInteger(m.id) && typeof m.fact === 'string' && m.fact.trim(),
        ),
      };
    }
  } catch { /* fall through to empty */ }
  return { nextId: 1, items: [] };
}

function writeStore(store) {
  setConfig(MEMORY_KEY, JSON.stringify({
    nextId: store.nextId,
    items: store.items.slice(-MEMORY_MAX),
  }));
}

function cleanFact(fact) {
  return String(fact || '').replace(/\s+/g, ' ').trim().slice(0, MEMORY_FACT_MAX_CHARS);
}

/** All memories, oldest first: [{id, fact, at, source}] */
function readMemories() {
  return readStore().items.map((m) => ({
    id: m.id,
    fact: String(m.fact).slice(0, MEMORY_FACT_MAX_CHARS),
    at: typeof m.at === 'string' ? m.at : null,
    source: m.source === 'ai' ? 'ai' : 'user',
  }));
}

/** Save a new fact. Returns {ok, id} or {ok:false, error}. */
function saveMemory(fact, source = 'ai') {
  const clean = cleanFact(fact);
  if (!clean) return { ok: false, error: 'Memory fact is empty.' };
  const store = readStore();
  // Exact-duplicate guard: saving the same sentence twice is a no-op.
  const dupe = store.items.find((m) => m.fact.toLowerCase() === clean.toLowerCase());
  if (dupe) return { ok: true, id: dupe.id, duplicate: true };
  const id = store.nextId;
  store.nextId += 1;
  store.items.push({ id, fact: clean, at: new Date().toISOString(), source: source === 'user' ? 'user' : 'ai' });
  if (store.items.length > MEMORY_MAX) store.items = store.items.slice(-MEMORY_MAX);
  writeStore(store);
  return { ok: true, id };
}

/** Replace the text of an existing fact. */
function updateMemory(id, fact) {
  const clean = cleanFact(fact);
  if (!clean) return { ok: false, error: 'Memory fact is empty.' };
  const store = readStore();
  const item = store.items.find((m) => m.id === Number(id));
  if (!item) return { ok: false, error: `No memory with id ${id}.` };
  item.fact = clean;
  item.at = new Date().toISOString();
  writeStore(store);
  return { ok: true, id: item.id };
}

/** Delete a fact by id. */
function deleteMemory(id) {
  const store = readStore();
  const before = store.items.length;
  store.items = store.items.filter((m) => m.id !== Number(id));
  if (store.items.length === before) return { ok: false, error: `No memory with id ${id}.` };
  writeStore(store);
  return { ok: true };
}

module.exports = {
  readMemories,
  saveMemory,
  updateMemory,
  deleteMemory,
  MEMORY_KEY,
  MEMORY_MAX,
  MEMORY_FACT_MAX_CHARS,
};
