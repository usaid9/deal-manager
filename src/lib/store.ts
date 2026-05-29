/**
 * store.ts — online-only data layer
 *
 * Every read and write goes directly to the server API.
 * No RxDB, no IndexedDB, no offline queue, no conflict resolution.
 */

import * as api from "./api";
import type { BaseDeal, FormulaTemplates, MonthMeta, MonthRecord } from "./types";

export type { ConflictResolution } from "./syncEngine";

// ── Base Deals ─────────────────────────────────────────────────────────────

export async function getBaseDeals(): Promise<BaseDeal[]> {
  return api.getBaseDeals();
}

export async function saveBaseDeals(deals: BaseDeal[]): Promise<void> {
  await Promise.all(deals.map((d) => api.saveBaseDeal(d)));
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

// ── No-op conflict hook (no local writes = no conflicts) ──────────────────

export function onConflict(_cb: unknown): () => void {
  return () => {};
}

// ── Backward-compat stubs used by App.tsx ─────────────────────────────────

type SeedCallback = () => void;

export type ConflictInfo = {
  localNewest: string;
  remoteNewest: string;
  localCount: number;
  remoteCount: number;
  resolve: (choice: "local" | "remote") => void;
};

let _onSeedDone: SeedCallback | null = null;

export function onSeedComplete(cb: SeedCallback): () => void {
  _onSeedDone = cb;
  setTimeout(() => _onSeedDone?.(), 0);
  return () => { _onSeedDone = null; };
}

export function onSyncConflict(_cb: (info: ConflictInfo) => void): () => void {
  return () => {};
}

export async function seedFromMongoIfNeeded(): Promise<void> {
  _onSeedDone?.();
}

// ── SyncPanel stubs ───────────────────────────────────────────────────────

export async function getSyncInfo(): Promise<{
  remoteCount: number;
  reachable: boolean;
}> {
  try {
    const deals = await api.getBaseDeals();
    return { remoteCount: deals.length, reachable: true };
  } catch {
    return { remoteCount: 0, reachable: false };
  }
}

export async function forcePullFromRemote(): Promise<void> {}
export async function forcePushToRemote(): Promise<void> {}
