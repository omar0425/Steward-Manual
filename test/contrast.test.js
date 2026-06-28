'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// WCAG relative-luminance contrast, computed from the real tokens in style.css
// (no browser needed). Catches the "muted text too faint to read" class of UI
// bug deterministically, and fails if a future token edit drops below AA.

function lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function luminance(hex) {
  const m = hex.replace('#', '');
  return 0.2126 * lin(parseInt(m.slice(0, 2), 16))
       + 0.7152 * lin(parseInt(m.slice(2, 4), 16))
       + 0.0722 * lin(parseInt(m.slice(4, 6), 16));
}
function ratio(a, b) {
  const l1 = luminance(a); const l2 = luminance(b);
  const hi = Math.max(l1, l2); const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

/** Pull the `--name: #hex;` tokens from a given selector's first block. */
function themeTokens(selector) {
  const start = css.indexOf(selector + ' {');
  assert.ok(start >= 0, `selector ${selector} not found`);
  const block = css.slice(start, css.indexOf('}', start));
  const tokens = {};
  const re = /--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g;
  let m;
  while ((m = re.exec(block))) tokens[m[1]] = m[2];
  return tokens;
}

const AA = 4.5; // WCAG AA for normal text
// Text + accent colors that render as text on panel surfaces.
const FOREGROUNDS = ['text', 'text-2', 'text-3', 'label', 'gold', 'emerald', 'rose', 'amber'];

for (const selector of ['[data-theme="dark"]', '[data-theme="light"]']) {
  test(`contrast: ${selector} text colors meet WCAG AA on --surface`, () => {
    const t = themeTokens(selector);
    const bg = t.surface;
    assert.ok(bg, `${selector} has --surface`);
    for (const fg of FOREGROUNDS) {
      assert.ok(t[fg], `${selector} has --${fg}`);
      const r = ratio(t[fg], bg);
      assert.ok(r >= AA, `${selector} --${fg} (${t[fg]}) on --surface (${bg}) = ${r.toFixed(2)} < ${AA}`);
    }
  });
}
