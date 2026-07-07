'use strict';

/**
 * Pure payoff amortization — shared by the "what if I paid more?" slider and
 * the unit tests (imported by node:test via dynamic import, so keep this file
 * free of DOM and module side effects).
 *
 * Model: monthly compounding at apr/12 applied to the opening balance, then
 * the payment. Deliberately the same shape services/forecast.js uses, so the
 * slider's story never contradicts the Monte Carlo forecast's.
 */

const MAX_MONTHS = 600; // 50 years — past this the plan isn't a plan

/**
 * Simulate paying a balance down with a fixed monthly payment.
 * @returns {{months:number|null, totalInterest:number, cleared:boolean}}
 *   months is null when the payment never clears the balance (payment does
 *   not outrun interest, or inputs are unusable).
 */
export function simulatePayoff(balance, aprPct, monthlyPayment) {
  let bal = Number(balance);
  const apr = Number(aprPct);
  const pay = Number(monthlyPayment);
  // Unusable balance ≠ cleared balance: NaN/Infinity means "can't simulate".
  if (!Number.isFinite(bal)) return { months: null, totalInterest: 0, cleared: false };
  if (bal <= 0) return { months: 0, totalInterest: 0, cleared: true };
  if (!Number.isFinite(pay) || pay <= 0) return { months: null, totalInterest: 0, cleared: false };
  const monthlyRate = Number.isFinite(apr) && apr > 0 ? apr / 100 / 12 : 0;

  let months = 0;
  let totalInterest = 0;
  while (bal > 0.005 && months < MAX_MONTHS) {
    const interest = bal * monthlyRate;
    // Payment must beat this month's interest or the balance never shrinks.
    if (pay <= interest) return { months: null, totalInterest: 0, cleared: false };
    totalInterest += interest;
    bal = bal + interest - pay;
    months += 1;
  }
  if (bal > 0.005) return { months: null, totalInterest: 0, cleared: false };
  return { months, totalInterest: Math.round(totalInterest * 100) / 100, cleared: true };
}

/**
 * Compare the current payment plan against paying `extra` more per month.
 * @returns {null | {
 *   baseMonths:number, newMonths:number, monthsSooner:number,
 *   baseInterest:number, newInterest:number, interestSaved:number
 * }}  null when the base plan itself can't be simulated (no payment, or the
 *     payment loses to interest — the caller should say so instead of lying).
 */
export function whatIfExtra(balance, aprPct, basePayment, extra) {
  const base = simulatePayoff(balance, aprPct, basePayment);
  if (base.months == null) return null;
  const add = Number(extra);
  const bumped = simulatePayoff(balance, aprPct, Number(basePayment) + (Number.isFinite(add) && add > 0 ? add : 0));
  if (bumped.months == null) return null; // can't happen when base cleared, but stay safe
  return {
    baseMonths: base.months,
    newMonths: bumped.months,
    monthsSooner: Math.max(0, base.months - bumped.months),
    baseInterest: base.totalInterest,
    newInterest: bumped.totalInterest,
    interestSaved: Math.max(0, Math.round((base.totalInterest - bumped.totalInterest) * 100) / 100),
  };
}

/**
 * Days until the next occurrence of a monthly due day, from `now`.
 * Due days past a month's end clamp to its last day (a "31st" due day is the
 * 28th/29th in February). Returns an integer ≥ 0 (0 = due today).
 */
export function daysUntilDueDay(dueDay, now = Date.now()) {
  const day = Number(dueDay);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const d = new Date(now);
  const y = d.getFullYear();
  const m = d.getMonth();
  const clamp = (yy, mm) => Math.min(day, new Date(yy, mm + 1, 0).getDate());
  const today = new Date(y, m, d.getDate()).getTime();
  let due = new Date(y, m, clamp(y, m)).getTime();
  if (due < today) {
    const ny = m === 11 ? y + 1 : y;
    const nm = m === 11 ? 0 : m + 1;
    due = new Date(ny, nm, clamp(ny, nm)).getTime();
  }
  return Math.round((due - today) / 86400000);
}
