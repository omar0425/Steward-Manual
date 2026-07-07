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
const BALANCE_DROP_TRIGGER = 500; // legacy per-save trigger (kept for compat/tests)
// Accumulator bounds: the reward paces itself to the remaining fight.
const TRIGGER_MAX = 500; // early climb: fire every ~$500 of total paydown
const TRIGGER_MIN = 100; // end game: never demand more than $100 per fire
const TRIGGER_PCT = 0.10; // between the bounds: ~10% of what's still owed

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
 * LEGACY per-save trigger (superseded by the accumulator below, kept because
 * it is a documented, tested pure function): true only for the cutscene user
 * when a single update dropped total debt by BALANCE_DROP_TRIGGER+.
 */
function paydownTriggersCutscene(username, dropAmount) {
  if (!isCutsceneUser(username)) return false;
  const d = Number(dropAmount);
  return Number.isFinite(d) && d >= BALANCE_DROP_TRIGGER;
}

/**
 * Dollars of cumulative paydown required for the next fire, scaled to the
 * debt still owed: $500 while the mountain is big, tapering to $100 near the
 * summit so the reward never goes silent at the finish line.
 *   $50,000 owed → $500 · $3,000 owed → $300 · $800 owed → $100
 */
function cutsceneThreshold(currentDebt) {
  const d = Number(currentDebt);
  if (!Number.isFinite(d) || d <= 0) return TRIGGER_MIN;
  return Math.max(TRIGGER_MIN, Math.min(TRIGGER_MAX, Math.round(d * TRIGGER_PCT)));
}

/**
 * Feed one save's paydown into the accumulator and decide whether to fire.
 * Only positive drops accumulate — a month where interest pushed the balance
 * up doesn't drain credit already earned. One fire per save; the remainder
 * past the threshold carries over toward the next one.
 *
 * @param {number} bucket       cumulative paydown banked since the last fire
 * @param {number} drop         this save's total-debt drop (may be ≤ 0)
 * @param {number} currentDebt  debt remaining after this save
 * @returns {{ fire: boolean, bucket: number, threshold: number }}
 */
function accumulateCutsceneProgress(bucket, drop, currentDebt) {
  const threshold = cutsceneThreshold(currentDebt);
  let b = Number(bucket);
  if (!Number.isFinite(b) || b < 0) b = 0;
  const d = Number(drop);
  if (Number.isFinite(d) && d > 0) b = Math.round((b + d) * 100) / 100;
  if (b >= threshold) {
    return { fire: true, bucket: Math.round((b - threshold) * 100) / 100, threshold };
  }
  return { fire: false, bucket: b, threshold };
}

/**
 * Rotate the clip pool: never the same clip twice in a row (with two clips,
 * perfect alternation). No/invalid last index → start at 0.
 */
function nextCutsceneIndex(lastIndex, poolLength) {
  const len = Number(poolLength);
  if (!Number.isInteger(len) || len <= 0) return null;
  // Explicit null/absent check first: Number(null) is 0, which would read as
  // "clip 0 played last" and wrongly start a fresh rotation at clip 1.
  if (lastIndex == null || lastIndex === '') return 0;
  const last = Number(lastIndex);
  if (!Number.isInteger(last) || last < 0 || last >= len) return 0;
  return (last + 1) % len;
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
  cutsceneThreshold,
  accumulateCutsceneProgress,
  nextCutsceneIndex,
  pickCutsceneVideo,
  selectCutsceneVideo,
};
