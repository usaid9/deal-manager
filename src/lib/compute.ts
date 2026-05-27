import type { Deal } from "./types";

const toNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** ROUND(((C + C*D*3.333%) / D), 2) */
export function calcInstalment(invested: number, months: number): number {
  if (!months) return 0;
  return Math.round(((invested + invested * months * 0.033333333333) / months) * 100) / 100;
}

export const calcTotal = (instalment: number, months: number) => instalment * months;

export function calcProfitPct(total: number, invested: number): number {
  if (!invested) return 0;
  return Math.round(((total - invested) / invested) * 10000) / 100;
}

export const calcRemaining = (instalment: number, months: number, instalRcvd: number) =>
  Math.max(0, instalment * (months - instalRcvd));

export const calcRecovered = (total: number, remaining: number) =>
  Math.max(0, total - remaining);

export function recalculateDeals(deals: Deal[]): Deal[] {
  return deals.map((deal) => {
    const invested = toNum(deal.invested);
    const months = toNum(deal.months);
    const instalment = deal.instalment > 0 ? toNum(deal.instalment) : calcInstalment(invested, months);
    const total = instalment * months;
    const profitPct = calcProfitPct(total, invested);

    let remaining = toNum(deal.remainingAmount);
    let recovered = toNum(deal.recoveredAmount);

    if (remaining === 0 && recovered === 0 && months > 0) {
      remaining = calcRemaining(instalment, months, deal.instalRcvd ?? 0);
      recovered = calcRecovered(total, remaining);
    }

    if (deal.useManualBalance) {
      if (deal.manualRemaining != null) {
        remaining = Math.max(0, toNum(deal.manualRemaining));
        recovered = Math.max(0, total - remaining);
      } else if (deal.manualRecovered != null) {
        recovered = Math.max(0, toNum(deal.manualRecovered));
        remaining = Math.max(0, total - recovered);
      }
    }

    return { ...deal, instalment, total, profitPct, recoveredAmount: recovered, remainingAmount: remaining, useManualBalance: deal.useManualBalance === true };
  });
}
