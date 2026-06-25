'use strict';

/**
 * Milestone cutscene gating + video pool.
 *
 * A personal easter egg for the account LoudFlipFlopz: whenever a balance update
 * drops total debt by BALANCE_DROP_TRIGGER ($500) or more, the login/snapshot
 * route arms a `pending_cutscene` flag and the dashboard plays a RANDOM clip from
 * the pool once. Everyone else is unaffected.
 *
 * The clips are large remote MP4s (Dropbox direct links), so the gated route
 * 302-redirects to one of these rather than shipping them in git. Override the
 * pool with STEWARD_CUTSCENE_VIDEOS (comma-separated URLs) if they ever move.
 *
 * Pure module so the gating + selection are unit-testable without the HTTP layer.
 */

const CUTSCENE_USERNAME = 'LoudFlipFlopz';
const BALANCE_DROP_TRIGGER = 500; // dollars of debt cleared in one update

// Stable Dropbox direct-download form: dl.dropboxusercontent.com + persistent
// rlkey (no short-lived `st` token). Verified to stream with range support.
const DEFAULT_CUTSCENE_VIDEOS = [
  'https://dl.dropboxusercontent.com/scl/fi/ak5hub8lolzr4yesgityv/cutscene-mask.mp4?rlkey=oq6qk7296rb16479revlp455v',
  'https://dl.dropboxusercontent.com/scl/fi/h2crg7i2d3noxl4ezotyq/cutscene-bongos.mp4?rlkey=sgu8lt8na7nsr3j55z9p903q0',
];

/** The active video pool — env override (comma-separated) or the defaults. */
function cutsceneVideos() {
  const env = process.env.STEWARD_CUTSCENE_VIDEOS;
  if (env && env.trim()) {
    const list = env.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) return list;
  }
  return DEFAULT_CUTSCENE_VIDEOS;
}

/** Case-insensitive match for the single account this easter egg belongs to. */
function isCutsceneUser(username) {
  return (
    typeof username === 'string' &&
    username.trim().toLowerCase() === CUTSCENE_USERNAME.toLowerCase()
  );
}

/**
 * Should THIS update fire the cutscene? True only for the cutscene user, and
 * only when total debt fell by at least BALANCE_DROP_TRIGGER in the update.
 *
 * @param {string} username    the username whose balance changed
 * @param {number} dropAmount  prevTotalDebt - newTotalDebt (positive = paid down)
 */
function paydownTriggersCutscene(username, dropAmount) {
  if (!isCutsceneUser(username)) return false;
  const d = Number(dropAmount);
  return Number.isFinite(d) && d >= BALANCE_DROP_TRIGGER;
}

/**
 * Pick a random clip from the pool. `rng` is injectable for deterministic tests.
 * Returns null when the pool is empty.
 */
function pickCutsceneVideo(rng = Math.random, videos = cutsceneVideos()) {
  if (!Array.isArray(videos) || videos.length === 0) return null;
  const i = Math.floor(rng() * videos.length) % videos.length;
  return videos[i];
}

/**
 * Resolve a STABLE clip for a given client seed, so every range request in one
 * playback hits the same file (a per-request random pick corrupts seeking — the
 * browser asks for a byte range of clip A and gets clip B). The client sends one
 * random seed per play; without a usable seed we fall back to a random pick.
 */
function selectCutsceneVideo(seed, videos = cutsceneVideos()) {
  if (!Array.isArray(videos) || videos.length === 0) return null;
  const n = Number(seed);
  if (Number.isFinite(n)) return videos[Math.abs(Math.trunc(n)) % videos.length];
  return pickCutsceneVideo(Math.random, videos);
}

module.exports = {
  CUTSCENE_USERNAME,
  BALANCE_DROP_TRIGGER,
  DEFAULT_CUTSCENE_VIDEOS,
  cutsceneVideos,
  isCutsceneUser,
  paydownTriggersCutscene,
  pickCutsceneVideo,
  selectCutsceneVideo,
};
