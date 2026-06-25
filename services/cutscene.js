'use strict';

/**
 * Milestone cutscene gating.
 *
 * A personal easter egg: the account named LoudFlipFlopz gets a short cutscene
 * every Nth login. Login counts are kept per-user (config key `login_count`);
 * when this user crosses a multiple of CUTSCENE_EVERY the login route arms a
 * `pending_cutscene` flag the dashboard plays once on next load.
 *
 * Kept as a pure module so the gating is unit-testable without the HTTP layer.
 */

const CUTSCENE_USERNAME = 'LoudFlipFlopz';
const CUTSCENE_EVERY = 75;

/** Case-insensitive match for the single account this easter egg belongs to. */
function isCutsceneUser(username) {
  return (
    typeof username === 'string' &&
    username.trim().toLowerCase() === CUTSCENE_USERNAME.toLowerCase()
  );
}

/**
 * Should THIS login fire the cutscene? True only for the cutscene user, and only
 * on exact multiples of CUTSCENE_EVERY (75, 150, 225, …).
 *
 * @param {string} username    the username that just logged in
 * @param {number} loginCount  their running login count, AFTER incrementing
 */
function shouldFireCutscene(username, loginCount) {
  if (!isCutsceneUser(username)) return false;
  const n = Number(loginCount);
  return Number.isInteger(n) && n > 0 && n % CUTSCENE_EVERY === 0;
}

module.exports = {
  CUTSCENE_USERNAME,
  CUTSCENE_EVERY,
  isCutsceneUser,
  shouldFireCutscene,
};
