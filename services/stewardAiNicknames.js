'use strict';

/**
 * Account nicknames — Pennybags christens your debts based on their behavior.
 * Once an account earns a name, the name sticks (don't rename "The Bleeder" to
 * "The Stubborn One" just because its APR field happens to disappear). The
 * persisted map is fed into every subsequent AI prompt as labels so the model
 * uses the same names you've already started thinking of.
 *
 * Pattern hierarchy (first match wins):
 *   The Bleeder         — APR ≥ 20%
 *   The Wound Reopens   — added debt at least twice in the last 6 history points
 *   The Stubborn One    — 4+ snapshots with balance variation under $20
 *   The Quiet Closer    — under $500 and trending downward
 *
 * No nickname is fine — most accounts won't have a clear pattern early.
 */

const { getConfig, setConfig } = require('../db');

const NICKNAME_KEY = 'steward_ai_nicknames';
const MIN_NICKNAME_AGE_TURNS = 3; // don't christen an account on turn 1

function readNicknames() {
  const raw = getConfig(NICKNAME_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function writeNicknames(map) {
  setConfig(NICKNAME_KEY, JSON.stringify(map));
}

/**
 * Detect a nickname for one account. Inputs:
 *   history: [{ date, balance }] ordered oldest → newest (matches db.getDebtAccountHistory)
 *   apr:     number or null
 *   currentBalance: number (today's balance)
 */
function detectNickname({ history, apr, currentBalance }) {
  // The Bleeder — high APR is enough on its own. We don't need a history
  // window to know what 24% APR is costing the player.
  if (Number.isFinite(apr) && apr >= 20) return 'The Bleeder';

  if (!Array.isArray(history) || history.length < MIN_NICKNAME_AGE_TURNS) return null;

  // The Wound Reopens — 2+ debt-up moves in the last 6 history points
  const recent = history.slice(-6); // newest at the end
  let increases = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].balance > recent[i - 1].balance + 5) increases++;
  }
  if (increases >= 2) return 'The Wound that Reopens';

  // The Stubborn One — last 4 snapshots all within $20 of each other,
  // balance not near zero (a $50 balance that holds steady isn't stubborn)
  if (history.length >= 4 && currentBalance >= 100) {
    const last4 = history.slice(-4);
    const max = Math.max(...last4.map((h) => h.balance));
    const min = Math.min(...last4.map((h) => h.balance));
    if (max - min < 20) return 'The Stubborn One';
  }

  // The Quiet Closer — small balance, trending down
  if (currentBalance > 0 && currentBalance < 500 && history.length >= 2) {
    const oldest = history[0].balance;
    const newest = history[history.length - 1].balance;
    if (newest < oldest - 5) return 'The Quiet Closer';
  }

  return null;
}

/**
 * Walk current accounts, assign nicknames to any unnamed ones whose history
 * now reveals a pattern. Names are sticky once given. Returns the full
 * { accountId: nickname } map (named accounts only).
 */
function refreshNicknames(currentAccounts, aprMap, historyByAccount) {
  const nicks = readNicknames();
  let changed = false;

  for (const acct of currentAccounts || []) {
    const id = String(acct && acct.id || '');
    if (!id || nicks[id]) continue;
    const apr = Number(aprMap && aprMap[id]);
    const history = (historyByAccount && historyByAccount[id]) || [];
    const nick = detectNickname({
      history,
      apr: Number.isFinite(apr) ? apr : null,
      currentBalance: Number(acct.balance) || 0,
    });
    if (nick) {
      nicks[id] = nick;
      changed = true;
    }
  }

  // Prune nicknames for accounts that no longer exist (user removed them)
  const liveIds = new Set((currentAccounts || []).map((a) => String(a && a.id || '')));
  for (const id of Object.keys(nicks)) {
    if (!liveIds.has(id)) {
      delete nicks[id];
      changed = true;
    }
  }

  if (changed) writeNicknames(nicks);
  return nicks;
}

module.exports = { readNicknames, refreshNicknames, detectNickname };
