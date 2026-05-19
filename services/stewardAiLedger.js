'use strict';

/**
 * Steward AI Ledger — a running journal of one-line entries the AI writes
 * each turn (in Pennybags voice). Stored in the user-scoped config table as
 * a JSON array. Capped at MAX_ENTRIES to keep config rows compact.
 *
 * No standalone UI yet — this just persists the data so a future "Ledger"
 * page can render the climb's chronicle. Entries are written by the
 * /api/steward-ai/comment route as a side effect of the dialog call, so
 * the ledger costs nothing extra in tokens (one call, two outputs).
 */

const { getConfig, setConfig } = require('../db');

const LEDGER_KEY = 'steward_ai_ledger';
const MAX_ENTRIES = 200;

function readLedger() {
  const raw = getConfig(LEDGER_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/**
 * Append one entry. If the most recent entry has the same pulled_at, replace
 * it — that means we're regenerating a comment for the same snapshot (e.g.
 * after a server-side cache miss) and we don't want duplicates.
 */
function appendLedger({ pulled_at, line, mode }) {
  if (!line || typeof line !== 'string') return;
  const cleaned = line.trim();
  if (!cleaned) return;

  const entries = readLedger();
  const entry = { pulled_at, line: cleaned, mode: mode || 'observation' };

  const last = entries[entries.length - 1];
  if (last && last.pulled_at === pulled_at) {
    entries[entries.length - 1] = entry;
  } else {
    entries.push(entry);
  }
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);

  setConfig(LEDGER_KEY, JSON.stringify(entries));
}

module.exports = { readLedger, appendLedger };
