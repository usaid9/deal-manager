/**
 * store.ts — MongoDB-direct data layer
 *
 * All reads and writes go directly to the MongoDB API server.
 * No local RxDB, no offline queue, no sync engine.
 */

import * as api from "./api";
import type { BaseDeal, FormulaTemplates, MonthMeta, MonthRecord } from "./types";

// ── Base Deals ─────────────────────────────────────────────────────────────

export async function getBaseDeals(): Promise<BaseDeal[]> {
  return api.getBaseDeals();
}

export async function saveBaseDeals(deals: BaseDeal[]): Promise<void> {
  await api.saveBaseDeals(deals);
}

export async function saveBaseDeal(deal: BaseDeal): Promise<void> {
  await api.saveBaseDeal(deal);
}

export async function deleteDealEverywhere(dealId: string): Promise<void> {
  await api.deleteDealEverywhere(dealId);
}

// ── Months ─────────────────────────────────────────────────────────────────

export async function getMonths(): Promise<MonthMeta[]> {
  return api.getMonths();
}

export async function createNextMonth(
  fromMonthId: string,
  newMonthId: string,
  label: string
): Promise<void> {
  await api.createNextMonth(fromMonthId, newMonthId, label);
}

// ── Month Records ──────────────────────────────────────────────────────────

export async function getMonthRecords(monthId: string): Promise<MonthRecord[]> {
  return api.getMonthRecords(monthId);
}

export async function saveMonthRecord(record: MonthRecord): Promise<void> {
  await api.saveMonthRecord(record);
}

export async function saveMonthRecords(records: MonthRecord[]): Promise<void> {
  await api.saveMonthRecords(records);
}

// ── Snapshot propagation ───────────────────────────────────────────────────

export async function propagateSnapshotForward(
  dealId: string,
  fromMonthId: string,
  newRecovered: number,
  newRemaining: number
): Promise<void> {
  await api.propagateSnapshotForward(dealId, fromMonthId, newRecovered, newRemaining);
}

// ── Meta ───────────────────────────────────────────────────────────────────

export async function getActiveMonthId(): Promise<string | undefined> {
  return api.getActiveMonthId();
}

export async function setActiveMonthId(monthId: string): Promise<void> {
  await api.setActiveMonthId(monthId);
}

export async function getFormulas(): Promise<FormulaTemplates | undefined> {
  return api.getFormulas();
}

export async function setFormulas(formulas: FormulaTemplates): Promise<void> {
  await api.setFormulas(formulas);
}
