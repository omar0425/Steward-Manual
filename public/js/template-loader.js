'use strict';

/**
 * Loads the steward character template HTML and injects it into the DOM.
 * This replaces the static <template> block that lives in each HTML shell
 * in the original Steward.
 */
export async function loadCharacterTemplate() {
  if (document.getElementById('steward-template')) return;

  try {
    const res = await fetch('/steward-template.html');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    // Parse as full document so <template> is handled correctly
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const template = doc.querySelector('#steward-template');
    if (template) {
      // Import the node into the current document and append
      document.body.appendChild(document.importNode(template, true));
    }
  } catch (err) {
    console.error('[template-loader] Could not load steward-template.html:', err);
  }
}
