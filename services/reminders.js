'use strict';

/**
 * Payment due-date reminders — one reminder per account per statement cycle,
 * sent when the due day is 0–3 days away and the account still carries a
 * balance. Delivered over email (when a provider is configured) and web push
 * (when the user opted in on any device); either channel alone is enough.
 *
 * Like the inactivity nudge, the sweep runs cross-user and reads the DB
 * directly instead of going through the per-request withUser() scope.
 * "Once per cycle" is tracked in the user's config under due_reminders_sent:
 *   { "<accountId>": "YYYY-MM of the due date last reminded for" }
 */

const { db } = require('../db');
const { sendEmail, isConfigured, APP_BASE_URL } = require('./email');
const { sendToUser } = require('./push');

const SENT_KEY = 'due_reminders_sent';
const REMIND_WINDOW_DAYS = 3;

function parseObj(raw) {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}

/** Due date for a monthly due-day at or after `now` (clamped to month length). */
function nextDueDate(dueDay, now) {
  const day = Number(dueDay);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const d = new Date(now);
  const clamp = (y, m) => Math.min(day, new Date(y, m + 1, 0).getDate());
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  let due = new Date(d.getFullYear(), d.getMonth(), clamp(d.getFullYear(), d.getMonth()));
  if (due < today) {
    const y = d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear();
    const m = d.getMonth() === 11 ? 0 : d.getMonth() + 1;
    due = new Date(y, m, clamp(y, m));
  }
  return due;
}

/** Cycle key ("YYYY-MM" of the DUE DATE) — marks one reminder per statement cycle. */
function cycleKeyFor(due) {
  return `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Pure-ish selector: everything that should be reminded right now.
 * Returns [{ userId, accountId, name, balance, minPayment, dueDate, daysUntil, cycleKey }].
 */
function selectDueReminders({ now = Date.now(), windowDays = REMIND_WINDOW_DAYS } = {}) {
  const users = db.prepare(`SELECT id, username, email FROM users`).all();
  const getCfg = db.prepare(`SELECT value FROM config WHERE user_id = ? AND key = ?`);
  const balances = db.prepare(
    `SELECT ynab_account_id AS id, last_balance AS balance FROM debt_account_balances WHERE user_id = ?`,
  );

  const out = [];
  for (const u of users) {
    const termsRow = getCfg.get(u.id, 'debt_terms');
    const terms = parseObj(termsRow && termsRow.value);
    const dueIds = Object.keys(terms).filter((id) => terms[id] && terms[id].dueDay);
    if (dueIds.length === 0) continue;

    const sentRow = getCfg.get(u.id, SENT_KEY);
    const sent = parseObj(sentRow && sentRow.value);
    const nameMap = parseObj((getCfg.get(u.id, 'debt_account_name_map') || {}).value);
    const balById = new Map(balances.all(u.id).map((r) => [String(r.id), Number(r.balance)]));

    for (const id of dueIds) {
      const bal = balById.get(String(id));
      if (!Number.isFinite(bal) || bal <= 0) continue; // paid off / not tracked
      const due = nextDueDate(terms[id].dueDay, now);
      if (!due) continue;
      const daysUntil = Math.round((due - new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate())) / 86400000);
      if (daysUntil < 0 || daysUntil > windowDays) continue;
      const cycleKey = cycleKeyFor(due);
      if (sent[id] === cycleKey) continue; // already reminded this cycle
      out.push({
        userId: u.id,
        username: u.username,
        email: u.email || null,
        accountId: String(id),
        name: nameMap[id] || 'an account',
        balance: Math.round(bal),
        minPayment: Number(terms[id].minPayment) > 0 ? Number(terms[id].minPayment) : null,
        dueDate: due.toISOString().slice(0, 10),
        daysUntil,
        cycleKey,
      });
    }
  }
  return out;
}

function markReminded(userId, accountId, cycleKey) {
  const row = db.prepare(`SELECT value FROM config WHERE user_id = ? AND key = ?`).get(userId, SENT_KEY);
  const sent = parseObj(row && row.value);
  sent[String(accountId)] = String(cycleKey);
  // Keep the map bounded: an account no longer in it just re-reminds next cycle.
  const keys = Object.keys(sent);
  if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete sent[k];
  db.prepare(`
    INSERT INTO config (user_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
  `).run(userId, SENT_KEY, JSON.stringify(sent));
}

function reminderCopy(r) {
  const when = r.daysUntil === 0 ? 'today' : r.daysUntil === 1 ? 'tomorrow' : `in ${r.daysUntil} days`;
  const min = r.minPayment ? ` Minimum payment: $${Math.round(r.minPayment).toLocaleString()}.` : '';
  return {
    title: `${r.name} payment due ${when}`,
    body: `${r.name} (balance $${r.balance.toLocaleString()}) is due ${when} — ${r.dueDate}.${min}`,
  };
}

/** One sweep: select, deliver (push + email), mark. Returns count delivered. */
async function runDueReminderSweep({ now = Date.now() } = {}) {
  const due = selectDueReminders({ now });
  let delivered = 0;
  for (const r of due) {
    const copy = reminderCopy(r);
    let anyChannel = false;
    try {
      const pushRes = await sendToUser(r.userId, {
        title: copy.title,
        body: copy.body,
        url: APP_BASE_URL || '/',
        tag: `due-${r.accountId}-${r.cycleKey}`,
      });
      if (pushRes.sent > 0) anyChannel = true;
    } catch (err) {
      console.error('[reminders] push failed:', err && err.message);
    }
    if (r.email && isConfigured()) {
      const result = await sendEmail({
        to: r.email,
        subject: copy.title,
        text: `${copy.body}\n\nUpdate the balance after you pay: ${APP_BASE_URL}\n\n— Steward`,
        html: `<p>${copy.body}</p><p><a href="${APP_BASE_URL}">Update the balance after you pay</a>.</p><p>— Steward</p>`,
      });
      if (result.ok) anyChannel = true;
    }
    if (anyChannel) {
      markReminded(r.userId, r.accountId, r.cycleKey);
      delivered += 1;
      console.log(`[reminders] sent for user=${r.username} account=${r.accountId} due=${r.dueDate}`);
    }
  }
  return delivered;
}

module.exports = {
  selectDueReminders,
  markReminded,
  nextDueDate,
  runDueReminderSweep,
  REMIND_WINDOW_DAYS,
  SENT_KEY,
};
