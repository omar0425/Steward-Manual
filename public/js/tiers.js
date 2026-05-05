'use strict';

/* Debt tier ladder only. Tier id "stabilizing" (badge 05) is payoff stage — not the same axis as
   liquidity stability.id "stabilizing" (middle cushion band, user label Steady from API). */
export const TIER_FLOW = [
  { id: 'rock_bottom', badge: '01', label: 'Buried',      phase: 'Pressure',   cue: 'Cut the balance. Guard cash.',              accent: '#d06b86', soft: 'rgba(208,107,134,0.18)', strong: '#b54361', start: '#ffb09a', end: '#c4475c', fill: 'rgba(181,69,97,0.22)', line: 'rgba(213,96,124,0.92)' },
  { id: 'broke',       badge: '02', label: 'Digging',     phase: 'Pressure',   cue: 'Hold the line. No backsliding.',            accent: '#b18f7a', soft: 'rgba(177,143,122,0.18)', strong: '#8d6b56', start: '#f3c59b', end: '#b87442', fill: 'rgba(177,116,66,0.20)', line: 'rgba(199,132,78,0.88)' },
  { id: 'struggling',  badge: '03', label: 'Pushing',     phase: 'Pressure',   cue: 'Net is down \u2014 keep paying.',           accent: '#cf8d7d', soft: 'rgba(207,141,125,0.18)', strong: '#af6f5f', start: '#f6c3a8', end: '#cc7d61', fill: 'rgba(191,111,91,0.20)', line: 'rgba(214,129,105,0.88)' },
  { id: 'surviving',   badge: '04', label: 'Climbing',    phase: 'Momentum',   cue: 'Mid-climb. Don\u2019t ease pressure.',      accent: '#c7a15f', soft: 'rgba(199,161,95,0.18)', strong: '#a37e38', start: '#f8d48d', end: '#c79a3a', fill: 'rgba(199,154,58,0.20)', line: 'rgba(213,171,82,0.88)' },
  { id: 'stabilizing', badge: '05', label: 'Steady',      phase: 'Momentum',   cue: 'Keep doing what works.',                   accent: '#8db86f', soft: 'rgba(141,184,111,0.18)', strong: '#67934a', start: '#cbe7a8', end: '#79b557', fill: 'rgba(111,163,76,0.20)', line: 'rgba(129,188,87,0.88)' },
  { id: 'stable',      badge: '06', label: 'Building',    phase: 'Momentum',   cue: 'It\u2019s working. Stay on it.',           accent: '#68bf7d', soft: 'rgba(104,191,125,0.18)', strong: '#389560', start: '#9be2ad', end: '#38b76d', fill: 'rgba(56,151,96,0.20)', line: 'rgba(74,190,114,0.88)' },
  { id: 'building',    badge: '07', label: 'Lifting',     phase: 'Final Push', cue: 'Habits set here \u2014 stack payments.',    accent: '#4d86c7', soft: 'rgba(77,134,199,0.18)', strong: '#2d67aa', start: '#93c7ff', end: '#3b86e4', fill: 'rgba(53,116,196,0.18)', line: 'rgba(77,146,224,0.88)' },
  { id: 'thriving',    badge: '08', label: 'Closing',     phase: 'Final Push', cue: 'Rare territory \u2014 stay strict.',        accent: '#8b67d8', soft: 'rgba(139,103,216,0.18)', strong: '#6d42c6', start: '#bea5ff', end: '#8858ef', fill: 'rgba(114,76,201,0.20)', line: 'rgba(145,112,225,0.90)' },
  { id: 'winning',     badge: '09', label: 'Finishing',   phase: 'Final Push', cue: 'Last miles. Don\u2019t drift.',             accent: '#d2b249', soft: 'rgba(210,178,73,0.20)', strong: '#b68a1f', start: '#ffe38f', end: '#d6ad34', fill: 'rgba(189,146,34,0.22)', line: 'rgba(221,188,72,0.92)' },
  { id: 'wealthy',     badge: '10', label: 'Debt Free', phase: 'Debt Free',  cue: 'Debt zero. Build from here.',               accent: '#f0c743', soft: 'rgba(240,199,67,0.22)', strong: '#d59d14', start: '#ffe991', end: '#f2c230', fill: 'rgba(214,157,20,0.24)', line: 'rgba(245,205,77,0.94)' },
];

export const TIER_META = Object.fromEntries(TIER_FLOW.map(tier => [tier.id, tier]));
export const TIER_INDEX = Object.fromEntries(TIER_FLOW.map((tier, index) => [tier.id, index]));

/** One behavioral cue per debt tier (tier id -> line). Same ids as `tiers.js` / payoff ladder. */
const TIER_BEHAVIOR_LINE = {
  rock_bottom: "Cut the balance. Guard cash.",
  broke: "Hold the line. No backsliding.",
  struggling: "Net is down \u2014 keep paying.",
  surviving: "Mid-climb. Don\u2019t ease pressure.",
  stabilizing: "Keep doing what works.",
  stable: "It\u2019s working. Stay on it.",
  building: "Habits set here \u2014 stack payments.",
  thriving: "Rare territory \u2014 stay strict.",
  winning: "Last miles. Don\u2019t drift.",
  wealthy: "Debt zero. Build from here.",
};

const TIER_QUOTE = {
  rock_bottom: 'Do not make this beautiful. Make it smaller.',
  broke: 'The first dent matters. Protect it.',
  struggling: 'The climb is ugly before it is convincing.',
  surviving: 'Stay alive, stay current, keep cutting.',
  stabilizing: 'The panic is quieter. Do not confuse quiet with done.',
  stable: 'You have footing now. Use it.',
  building: 'Break the pattern before the balance breaks you again.',
  thriving: 'This is where discipline gets boring. Good.',
  winning: 'No victory laps before zero.',
  wealthy: 'The debt is gone. Now build the life after it.',
};

export function tierBehaviorLine(tierId) {
  const line = tierId && TIER_BEHAVIOR_LINE[tierId];
  return typeof line === 'string' ? line : '';
}

export function tierQuote(tierId) {
  const line = tierId && TIER_QUOTE[tierId];
  return typeof line === 'string' ? line : '';
}
