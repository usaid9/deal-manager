/**
 * store.ts — online-first data layer
 *
 * Every write goes to RxDB locally first, then immediately to the API.
 * Reads come from RxDB; a startup pull seeds the local cache.
 */

import * as db    from "./db";
import * as api   from "./api";
import { isServerReachable }  from "./reachability";
import type { BaseDeal, FormulaTemplates, MonthMeta, MonthRecord } from "./types";

// ── Base Deals ─────────────────────────────────────────────────────────────

export async function getBaseDeals(): Promise<BaseDeal[]> {
  return db.getBaseDeals();
}

export async function saveBaseDeals(deals: BaseDeal[]): Promise<void> {
  await db.saveBaseDeals(deals);
  await api.saveBaseDeals(deals);
}

export async function saveBaseDeal(deal: BaseDeal): Promise<void> {
  await db.saveBaseDeal(deal);
  await api.saveBaseDeal(deal);
}

export async function deleteDealEverywhere(dealId: string): Promise<void> {
  await db.deleteDealEverywhere(dealId);
  await api.deleteDealEverywhere(dealId);
}

// ── Months ─────────────────────────────────────────────────────────────────

export async function getMonths(): Promise<MonthMeta[]> {
  return db.getMonths();
}

export async function createNextMonth(
  fromMonthId: string,
  newMonthId: string,
  label: string
): Promise<void> {
  await db.createNextMonth(fromMonthId, newMonthId, label);
  await api.createNextMonth(fromMonthId, newMonthId, label);
}

// ── Month Records ──────────────────────────────────────────────────────────

export async function getMonthRecords(monthId: string): Promise<MonthRecord[]> {
  return db.getMonthRecords(monthId);
}

export async function saveMonthRecord(record: MonthRecord): Promise<void> {
  await db.saveMonthRecord(record);
  await api.saveMonthRecord(record);
}

export async function saveMonthRecords(records: MonthRecord[]): Promise<void> {
  await db.saveMonthRecords(records);
  await api.saveMonthRecords(records);
}

// ── Snapshot propagation ───────────────────────────────────────────────────

export async function propagateSnapshotForward(
  dealId: string,
  fromMonthId: string,
  newRecovered: number,
  newRemaining: number
): Promise<void> {
  await db.propagateSnapshotForward(dealId, fromMonthId, newRecovered, newRemaining);
  await api.propagateSnapshotForward(dealId, fromMonthId, newRecovered, newRemaining);
}

// ── Meta ───────────────────────────────────────────────────────────────────

export async function getActiveMonthId(): Promise<string | undefined> {
  return db.getActiveMonthId();
}

export async function setActiveMonthId(monthId: string): Promise<void> {
  await db.setActiveMonthId(monthId);
  await api.setActiveMonthId(monthId);
}

export async function getFormulas(): Promise<FormulaTemplates | undefined> {
  return db.getFormulas();
}

export async function setFormulas(formulas: FormulaTemplates): Promise<void> {
  await db.setFormulas(formulas);
  await api.setFormulas(formulas);
}

// ── Seed / manual sync controls (kept for SyncPanel backward-compat) ────────

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
  return () => { _onSeedDone = null; };
}

export function onSyncConflict(_cb: (info: ConflictInfo) => void): () => void {
  return () => {};
}

let _seedPromise: Promise<void> | null = null;

/**
 * seedFromMongoIfNeeded — called from App.tsx on mount.
 * Pulls remote data once to seed the local cache.
 */
export async function seedFromMongoIfNeeded(): Promise<void> {
  if (_seedPromise) return _seedPromise;
  _seedPromise = (async () => {
    await forcePullFromRemote();
    _onSeedDone?.();
  })();
  try {
    await _seedPromise;
  } finally {
    _seedPromise = null;
  }
}

// ── Manual sync controls (SyncPanel UI) ───────────────────────────────────

export async function forcePullFromRemote(): Promise<void> {
  const [remoteDeals, remoteMonths] = await Promise.all([
    api.getBaseDeals(),
    api.getMonths(),
  ]);
  const rxdb = await db.getRxDbInstance();

  // Reconcile months — remove local phantoms first
  const serverMonthIds = new Set(remoteMonths.map((m) => m.id));
  const localMonthDocs = await rxdb.months.find().exec();
  for (const doc of localMonthDocs) {
    if (!serverMonthIds.has(doc.id)) {
      await doc.remove();
      const orphans = await rxdb.monthrecords
        .find({ selector: { monthId: doc.id } }).exec();
      await Promise.all(orphans.map((r) => r.remove()));
    }
  }

  await rxdb.basedeals.bulkUpsert(remoteDeals);
  await rxdb.months.bulkUpsert(remoteMonths);

  const allRecords: MonthRecord[] = [];
  for (const m of remoteMonths) {
    const recs = await api.getMonthRecords(m.id).catch(() => [] as MonthRecord[]);
    allRecords.push(...recs);
  }
  if (allRecords.length) await rxdb.monthrecords.bulkUpsert(allRecords);

  const [activeMonthId, formulas] = await Promise.all([
    api.getActiveMonthId().catch(() => undefined),
    api.getFormulas().catch(() => undefined),
  ]);
  if (activeMonthId) await db.setActiveMonthId(activeMonthId);
  if (formulas)      await db.setFormulas(formulas);
}

export async function forcePushToRemote(): Promise<void> {
  const [localDeals, localMonths] = await Promise.all([
    db.getBaseDeals(),
    db.getMonths(),
  ]);
  await api.saveBaseDeals(localDeals).catch(() => {});
  for (const m of localMonths) {
    await api.createNextMonth("", m.id, m.label).catch(() => {});
    const records = await db.getMonthRecords(m.id);
    if (records.length) await api.saveMonthRecords(records).catch(() => {});
  }
}

export async function getSyncInfo(): Promise<{
  localNewest: string; remoteNewest: string;
  localCount: number;  remoteCount: number;
  reachable: boolean;
}> {
  const reachable = await isServerReachable();
  if (!reachable) {
    const local = await db.getBaseDeals();
    const ln    = local.reduce((m, d) => d.updatedAt > m ? d.updatedAt : m, "");
    return { localNewest: ln, remoteNewest: "", localCount: local.length, remoteCount: 0, reachable: false };
  }
  const [local, remote] = await Promise.all([db.getBaseDeals(), api.getBaseDeals()]);
  const ln = local.reduce((m, d)  => d.updatedAt > m ? d.updatedAt : m, "");
  const rn = remote.reduce((m, d) => d.updatedAt > m ? d.updatedAt : m, "");
  return { localNewest: ln, remoteNewest: rn, localCount: local.length, remoteCount: remote.length, reachable: true };
}
