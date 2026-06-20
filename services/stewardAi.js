'use strict';

/**
 * Steward AI — Pennybags-voiced commentary on each fresh snapshot.
 *
 *   - Sonnet 4.6 by default (override with STEWARD_AI_MODEL).
 *   - One API call per turn returns a JSON envelope with BOTH the dialog text
 *     and a one-line ledger entry, so the always-on chronicle costs zero
 *     additional tokens.
 *   - Three call types:
 *       generateModeDialog()      rotating dialog, AI picks one of the
 *                                 eligible modes server-side.
 *       generateClosingCertificate()   deterministic: an account just hit $0.
 *       generateQuarterlyLetter()      deterministic: 90 days since last.
 *   - On any API error (auth, network, malformed JSON) returns
 *     { ok: false }. Callers map that to a 204 so the dialog closes
 *     silently — Pennybags would rather say nothing than something bad.
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.STEWARD_AI_MODEL || 'claude-sonnet-4-6';

function isConfigured() {
  return !!ANTHROPIC_API_KEY;
}

// ── Voice (shared system-prompt preamble) ─────────────────────────────────────
const PENNYBAGS_VOICE =
  'You are the Steward — modeled on Mr. Pennybags, the top-hat-and-monocle ' +
  'gentleman of finance who has watched many players climb out of debt. ' +
  "Picture a pocket watch, a knowing wink, the easy authority of someone who " +
  'has seen the game played a thousand times. ' +
  "Warm but candid. Dry, not jolly. Plain-spoken about dollars. " +
  'Never preachy. Never saccharine. No exclamation marks. ' +
  "Never use the phrases 'great job', 'you got this', 'amazing', 'awesome', " +
  "'congrats', 'congratulations', or 'keep it up'. " +
  'Address the player directly as "you." ' +
  'Refer to accounts by the user-supplied name; if a nickname is provided, ' +
  'use the nickname in parentheses on first mention, then by nickname thereafter. ' +
  'Use specific dollar figures from the data. No emojis. No markdown.';

// ── Mode instructions (only the chosen mode\'s lines are emphasized to the AI) ─
const MODE_INSTRUCTIONS = {
  adversary:
    "Adversary mode: personify INTEREST as the antagonist taking from the user " +
    "each month. Name the dollar amount (interest.monthlyCost). One short " +
    'sentence of accusation, one short sentence of counter-move.',
  todays_deal:
    "Today's Deal mode: name ONE specific transaction the user could make " +
    "this turn (or have made), framed as a 'deal'. Use the account with the " +
    'highest interest cost (interest.topAccount). Specify dollars saved or earned.',
  climb_forecast:
    "Climb Forecast mode: cite a forecast DATE from forecasts[0..2] (already " +
    'projected from their pace). Frame it as a milestone they are pacing toward. ' +
    'Tie one concrete action to keeping that date.',
  if_you_do_nothing:
    "Idle Silver mode: a sober projection of what happens if they hold still. " +
    "Use interest.monthlyCost × 6 to show 6-month drift. Quote a Pennybags " +
    "aphorism about idle money becoming the bank's gold. One nudge.",
  anti_flattery:
    "Anti-Flattery mode: this turn went sideways (debt added or stalled). " +
    'Name it calmly, no judgment. State the dollar shift. End with a question ' +
    'or a small reset prompt. Do NOT scold.',
  observation:
    'Observation mode: one quiet, specific observation from the data — a ' +
    'pattern across snapshotTrail, an account whose nickname earned it this ' +
    'turn, a quiet milestone. End with the next move.',
};

// ── Common Anthropic-call helper ──────────────────────────────────────────────
async function callAnthropic({ system, userContent, maxTokens }) {
  if (!isConfigured()) return { ok: false, error: 'no_api_key' };
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
  } catch (err) {
    console.error('[stewardAi] fetch failed:', err && err.message ? err.message : err);
    return { ok: false, error: 'network' };
  }
  let body;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const errType = body && body.error && body.error.type;
    if (res.status === 401 || errType === 'authentication_error') {
      return { ok: false, error: 'no_api_key' };
    }
    console.error('[stewardAi] API error', res.status, body && body.error ? body.error : body);
    return { ok: false, error: (body && body.error && body.error.message) || `http_${res.status}` };
  }
  const text =
    body && Array.isArray(body.content)
      ? body.content
          .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text)
          .join('')
          .trim()
      : '';
  if (!text) return { ok: false, error: 'empty_reply' };
  return { ok: true, text };
}

/**
 * Models like Sonnet emit JSON reliably when asked, but occasionally wrap it
 * in a fenced code block. Strip fences before parsing.
 */
function tryParseJson(text) {
  if (!text || typeof text !== 'string') return null;
  let s = text.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  }
  try { return JSON.parse(s); } catch { return null; }
}

function asString(v, max = 400) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

// ── Rotating-mode dialog (Layer 2) ────────────────────────────────────────────
/**
 * Returns { ok, mode, dialog_text, ledger_line } on success.
 * eligibleModes: array of mode keys the server has gated as appropriate. The
 * AI MUST choose one of these — anything else falls back to 'observation'.
 */
async function generateModeDialog({ eligibleModes, payload }) {
  const modeMenu = eligibleModes
    .map((m) => `  - ${m}: ${MODE_INSTRUCTIONS[m] || ''}`)
    .join('\n');

  const system =
    PENNYBAGS_VOICE +
    '\n\n' +
    'TASK: read the snapshot data and write the Steward\'s remark for this turn. ' +
    'You will pick ONE narrative mode from the eligible list below — each ' +
    'mode has a specific instruction. Then you will also write a single ' +
    'one-line "ledger entry" in the Steward\'s journal — a chronicler\'s line, ' +
    'past-tense, third-person, naming a concrete fact from this turn.\n\n' +
    'ELIGIBLE MODES (pick exactly one):\n' +
    modeMenu +
    '\n\nHARD RULES:\n' +
    '- Two sentences maximum in dialog_text, 50 words max.\n' +
    '- One sentence in ledger_line, 25 words max, past tense.\n' +
    '- Never restate the tier label, total paid, or gap to next tier — the ' +
    'dashboard already shows those.\n' +
    '- Reference specific account names + nicknames from accounts[] when relevant.\n' +
    '- Output MUST be a single JSON object with exactly these keys: ' +
    '{ "mode": "<one of the eligible modes>", "dialog_text": "...", "ledger_line": "..." }.\n' +
    '- No markdown, no code fences, no commentary outside the JSON.';

  const userContent =
    'SNAPSHOT DATA:\n' +
    JSON.stringify(payload, null, 0);

  const res = await callAnthropic({ system, userContent, maxTokens: 380 });
  if (!res.ok) return res;

  const parsed = tryParseJson(res.text);
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'malformed_json', raw: res.text };
  }
  const mode = eligibleModes.includes(parsed.mode) ? parsed.mode : 'observation';
  return {
    ok: true,
    mode,
    dialog_text: asString(parsed.dialog_text, 600),
    ledger_line: asString(parsed.ledger_line, 200),
  };
}

// ── Closing Certificate (Layer 1, deterministic) ──────────────────────────────
async function generateClosingCertificate({ closing, payload }) {
  const system =
    PENNYBAGS_VOICE +
    '\n\nTASK: an account just hit $0 — write a Pennybags-style payoff ' +
    'certificate. Tone is ceremonial but dry, like a proclamation read at a ' +
    'private club. Two short paragraphs maximum. Reference the account by ' +
    'name. Include the dollars retired and (if available from nicknames in ' +
    'accounts[]) any character the account had developed. Also produce a ' +
    'ledger_line marking the closure in past tense.\n\n' +
    'OUTPUT FORMAT (strict JSON, no fences):\n' +
    '{ "mode": "closing_certificate", "title": "...", "dialog_text": "...", "ledger_line": "..." }';

  const userContent =
    'PAID-OFF ACCOUNT:\n' +
    JSON.stringify(closing) +
    '\n\nFULL SNAPSHOT:\n' +
    JSON.stringify(payload, null, 0);

  const res = await callAnthropic({ system, userContent, maxTokens: 480 });
  if (!res.ok) return res;
  const parsed = tryParseJson(res.text);
  if (!parsed) return { ok: false, error: 'malformed_json', raw: res.text };
  return {
    ok: true,
    mode: 'closing_certificate',
    title: asString(parsed.title, 120) || 'A Notice of Closure',
    dialog_text: asString(parsed.dialog_text, 900),
    ledger_line: asString(parsed.ledger_line, 200),
  };
}

// ── Quarterly Letter (Layer 1, deterministic) ─────────────────────────────────
async function generateQuarterlyLetter({ payload }) {
  const system =
    PENNYBAGS_VOICE +
    '\n\nTASK: write a Quarterly Letter from the Steward to the user — the ' +
    "kind of short note a wealth manager would send a real client. Three " +
    'paragraphs, 90 words total max:\n' +
    '  1. Recap of the past 90 days using specific dollar figures from stats.\n' +
    '  2. One observation about pattern or trajectory.\n' +
    '  3. A single piece of counsel for the next quarter, naming an account.\n\n' +
    'Open with "My dear holder," and close with "— the Steward". Reference ' +
    'account nicknames where they exist. Calm, dignified, no flattery.\n\n' +
    'OUTPUT FORMAT (strict JSON, no fences):\n' +
    '{ "mode": "quarterly_letter", "title": "...", "dialog_text": "...", "ledger_line": "..." }';

  const userContent = 'SNAPSHOT DATA:\n' + JSON.stringify(payload, null, 0);

  const res = await callAnthropic({ system, userContent, maxTokens: 700 });
  if (!res.ok) return res;
  const parsed = tryParseJson(res.text);
  if (!parsed) return { ok: false, error: 'malformed_json', raw: res.text };
  return {
    ok: true,
    mode: 'quarterly_letter',
    title: asString(parsed.title, 120) || 'A Letter from the Steward',
    dialog_text: asString(parsed.dialog_text, 1400),
    ledger_line: asString(parsed.ledger_line, 200),
  };
}

// ── Tier-card quote (Layer 0, ambient) ────────────────────────────────────────
/**
 * One short engraved maxim for the stage card, fitted to where the player
 * stands now. Returns { ok, text } on success. Kept deliberately terse and
 * plain — it sits under the stage name, not in a dialog.
 */
async function generateTierQuote({ payload }) {
  const system =
    PENNYBAGS_VOICE +
    '\n\nTASK: write ONE short maxim for the Steward\'s stage card — a single ' +
    'line engraved beneath the stage name, fitted to where the player stands ' +
    'this turn. It is not a remark or a paragraph; it is one sharp line.\n\n' +
    'HARD RULES:\n' +
    '- Exactly ONE sentence, 13 words maximum. Never two sentences.\n' +
    '- Plain and immediately clear — a stranger must understand it at a glance. ' +
    'No riddles, no metaphors that need decoding.\n' +
    '- No dollar figures, no account names, no tier/stage label — the card ' +
    'already shows those.\n' +
    '- Output strict JSON, no fences: { "quote": "..." }';

  const userContent = 'SNAPSHOT DATA:\n' + JSON.stringify(payload, null, 0);

  const res = await callAnthropic({ system, userContent, maxTokens: 80 });
  if (!res.ok) return res;
  const parsed = tryParseJson(res.text);
  const quote = parsed ? asString(parsed.quote, 140) : '';
  if (!quote) return { ok: false, error: 'malformed_json', raw: res.text };
  return { ok: true, text: quote };
}

// ── Ask the Steward (interactive Q&A) ─────────────────────────────────────────
/**
 * Answer a user's question grounded strictly in their climb data. Returns
 * { ok, text } on success. The payload is the same context object the dialog
 * modes use, so the Steward can cite real figures (interest, pace, forecasts).
 */
async function generateAnswer({ question, payload }) {
  const system =
    PENNYBAGS_VOICE +
    '\n\nThe player asked you a direct question about their debt. Answer it ' +
    'in 2–4 short sentences using the figures provided. Be decisive and ' +
    'useful — give a real number or a real next move, never a non-answer.\n\n' +
    'HARD RULES:\n' +
    '- NEVER mention data, fields, arrays, "the system", "on file", or what ' +
    'you were "given". The player has no idea those exist. Speak only about ' +
    'their money, in plain English.\n' +
    '- This is a MONTHLY tool: the player checks in once a month, not daily. ' +
    'Frame every rate, paydown, and interest figure PER MONTH. Never speak in ' +
    'daily terms — no "per day", no "a day", no daily dollar amounts. If you ' +
    'need a yearly figure, use month × 12.\n' +
    '- When you state how much they paid down over a period, use the TOTAL ' +
    'across ALL their cards — the drop in their whole balance. The provided ' +
    'monthly paydown already sums every card. NEVER quote a single card\'s ' +
    'payment as if it were the month\'s total; one account\'s figure is not ' +
    'the month\'s paydown.\n' +
    '- Do the arithmetic yourself from what you have. Compute a payoff horizon ' +
    'from the average monthly paydown against the balance even when no date is ' +
    'precomputed.\n' +
    '- CRITICAL: compare the monthly paydown to the monthly interest. If ' +
    'interest is close to or larger than what they are paying down, say so ' +
    'plainly — the balance is barely moving or growing, and no honest payoff ' +
    'date exists at this pace. Then state the lever: roughly how much per ' +
    'month, above interest, would actually turn it around.\n' +
    '- If a figure truly is not available (e.g. no APRs entered), name the ONE ' +
    'thing they could enter to get a sharper answer — framed as their next ' +
    'move, in one short clause, not as an apology or a refusal.\n' +
    '- Never invent numbers. Plain prose only: no markdown, lists, or headings.';

  const userContent =
    'QUESTION: ' + String(question) + '\n\nFIGURES (for your reasoning only — ' +
    'never refer to this object):\n' + JSON.stringify(payload, null, 0);

  const res = await callAnthropic({ system, userContent, maxTokens: 320 });
  if (!res.ok) return res;
  return { ok: true, text: asString(res.text, 1200) };
}

module.exports = {
  isConfigured,
  generateModeDialog,
  generateClosingCertificate,
  generateQuarterlyLetter,
  generateTierQuote,
  generateAnswer,
  MODEL,
};
