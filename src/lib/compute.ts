import type { Deal, FormulaTemplates } from "./types";

const toNum = (v: unknown): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

// ── Formula helpers (match Excel exactly) ────────────────────

/** ROUND(((C + C*D*3.333%) / D), 2) */
export function calcInstalment(invested: number, months: number): number {
  if (!months) return 0;
  return Math.round(((invested + invested * months * (3.3333333333 / 100)) / months) * 100) / 100;
}

export function calcTotal(instalment: number, months: number): number {
  return instalment * months;
}

export function calcProfitPct(total: number, invested: number): number {
  if (!invested) return 0;
  return Math.round(((total - invested) / invested) * 100 * 100) / 100;
}

/** Used only for initial deal creation (before any receipts exist) */
export function calcRemaining(instalment: number, months: number, instalRcvd: number): number {
  return Math.max(0, instalment * (months - instalRcvd));
}

export function calcRecovered(total: number, remaining: number): number {
  return Math.max(0, total - remaining);
}

/**
 * Recalculate display values for a list of deals.
 *
 * Remaining & Recovered are taken directly from the stored base deal
 * (which is updated correctly on every receipt save via snapshot logic).
 * We only recompute instalment / total / profitPct here.
 */
export function recalculateDeals(deals: Deal[], _formulas?: FormulaTemplates): Deal[] {
  return deals.map((deal) => {
    const invested   = toNum(deal.invested);
    const months     = toNum(deal.months);

    // Instalment: stored value wins; fall back to formula
    const instalment = deal.instalment > 0
      ? toNum(deal.instalment)
      : calcInstalment(invested, months);

    const total      = instalment * months;
    const profitPct  = calcProfitPct(total, invested);

    // Remaining / Recovered: trust what's stored on the deal.
    // These are maintained correctly by handleSaveReceipt (snapshot − received).
    let remaining = toNum(deal.remainingAmount);
    let recovered = toNum(deal.recoveredAmount);

    // If nothing stored yet (brand-new deal, no receipts), compute from formula
    if (remaining === 0 && recovered === 0 && deal.instalRcvd === 0 && months > 0) {
      remaining = calcRemaining(instalment, months, 0);
      recovered = calcRecovered(total, remaining);
    }

    if (deal.useManualBalance) {
      if (deal.manualRemaining !== null && deal.manualRemaining !== undefined) {
        remaining = Math.max(0, toNum(deal.manualRemaining));
        recovered = Math.max(0, total - remaining);
      } else if (deal.manualRecovered !== null && deal.manualRecovered !== undefined) {
        recovered = Math.max(0, toNum(deal.manualRecovered));
        remaining = Math.max(0, total - recovered);
      }
    }

    return {
      ...deal,
      instalment,
      total,
      profitPct,
      recoveredAmount: recovered,
      remainingAmount: remaining,
      useManualBalance: deal.useManualBalance === true,
    };
  });
}
