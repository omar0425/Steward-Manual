'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// The "$"/"%" affixes in the calculator and Strategy Lab are absolutely
// positioned ON TOP of their input, so every such input must reserve padding on
// that side or the user's digits render over the symbol. That was live: the
// Strategy Lab budget field reused the wrap+affix markup, but the padding lived
// in a per-id rule (#calc-dollars) that only covered the calculator, so a typed
// budget sat on top of the "$".
//
// Read the real markup and the real stylesheet — no browser — and assert every
// prefix-affixed input is covered by a rule, so a third field added tomorrow
// cannot reintroduce the overlap.

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public', 'style.css'), 'utf8');
const markup = fs.readFileSync(path.join(root, 'public', 'js', 'views', 'play.js'), 'utf8');

/** `.calc-input-wrap` spans, with the affix/input order preserved. */
function inputWraps() {
  const out = [];
  const re = /<span class="calc-input-wrap">([\s\S]*?)<\/span>\s*<\/label>/g;
  let m;
  while ((m = re.exec(markup))) out.push(m[1]);
  return out;
}

/** Declared value of `prop` in the first block matching `selector`, or null. */
function declaredPx(selector, prop) {
  const at = css.indexOf(selector + ' {');
  if (at < 0) return null;
  const block = css.slice(at, css.indexOf('}', at));
  const m = new RegExp(`(?:^|[;{]\\s*)${prop}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(block);
  return m ? Number(m[1]) : null;
}

// The affix's own offset from the field edge; the input must clear it.
const AFFIX_LEFT = declaredPx('.calc-affix', 'left');

test('affix offset is declared, so "clears the affix" has a real yardstick', () => {
  assert.ok(Number.isFinite(AFFIX_LEFT) && AFFIX_LEFT > 0, `.calc-affix left: ${AFFIX_LEFT}`);
});

test('every prefix-affixed input reserves room for its symbol', () => {
  const wraps = inputWraps();
  assert.ok(wraps.length >= 2, `expected several affixed fields, found ${wraps.length}`);

  // A PREFIX affix precedes its input in the DOM; a suffix follows it.
  const prefixed = wraps.filter((w) => {
    const affix = w.indexOf('calc-affix');
    const input = w.indexOf('<input');
    return affix >= 0 && input >= 0 && affix < input && !w.includes('calc-affix--suffix');
  });
  assert.ok(prefixed.length >= 2, `expected ≥2 prefix-affixed fields, found ${prefixed.length}`);

  // One structural rule must cover them all — per-id rules silently miss any
  // field added later, which is exactly how the Strategy Lab bug happened.
  const structural = declaredPx('.calc-affix:not(.calc-affix--suffix) + .calc-input', 'padding-left');
  assert.ok(
    Number.isFinite(structural),
    'no structural padding-left rule for prefix affixes — a new field would overlap its "$"',
  );
  assert.ok(
    structural > AFFIX_LEFT,
    `padding-left ${structural}px must clear the affix at ${AFFIX_LEFT}px`,
  );

  // And every one of them really does carry an id the stylesheet can't miss.
  for (const w of prefixed) {
    assert.match(w, /<input[^>]*class="calc-input"/, 'affixed field uses the .calc-input class');
  }
});

test('the suffix field still reserves room on the right', () => {
  const suffixed = inputWraps().filter((w) => w.includes('calc-affix--suffix'));
  assert.equal(suffixed.length, 1, 'one suffix field today (the percent input)');
  const id = /<input id="([\w-]+)"/.exec(suffixed[0])[1];
  const pad = declaredPx(`#${id}`, 'padding-right');
  assert.ok(Number.isFinite(pad) && pad > AFFIX_LEFT, `#${id} padding-right: ${pad}`);
});
