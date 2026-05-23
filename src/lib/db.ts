import { openDB, type IDBPDatabase, type IDBPTransaction } from "idb";
import type { BaseDeal, FormulaTemplates, MonthMeta, MonthRecord } from "./types";

const DB_NAME = "deal-manager-db";
const DB_VERSION = 3;
const BASE_DEALS_STORE = "baseDeals";
const MONTH_DEALS_STORE = "monthDeals";
const MONTHS_STORE = "months";
const META_STORE = "meta";
const FORMULA_KEY = "formulaTemplates";
const ACTIVE_MONTH_KEY = "activeMonthId";

const monthIdForDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const monthLabelForDate = (date: Date) =>
  date.toLocaleString("en-US", { month: "short", year: "numeric" });

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade: async (db: IDBPDatabase, oldVersion: number, _newVersion: number | null, transaction: IDBPTransaction<unknown, string[], "versionchange">) => {
    if (!db.objectStoreNames.contains(META_STORE)) {
      db.createObjectStore(META_STORE);
    }
    if (!db.objectStoreNames.contains(BASE_DEALS_STORE)) {
      db.createObjectStore(BASE_DEALS_STORE, { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains(MONTHS_STORE)) {
      db.createObjectStore(MONTHS_STORE, { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains(MONTH_DEALS_STORE)) {
      const store = db.createObjectStore(MONTH_DEALS_STORE, { keyPath: "id" });
      store.createIndex("monthId", "monthId");
      store.createIndex("dealId", "dealId");
    } else {
      const store = transaction.objectStore(MONTH_DEALS_STORE);
      if (!store.indexNames.contains("monthId")) store.createIndex("monthId", "monthId");
      if (!store.indexNames.contains("dealId")) store.createIndex("dealId", "dealId");
    }

    // v1 → migrate old "deals" store
    if (oldVersion < 2 && db.objectStoreNames.contains("deals")) {
      const legacyStore = transaction.objectStore("deals");
      const legacyDeals = await legacyStore.getAll();
      const baseStore = transaction.objectStore(BASE_DEALS_STORE);
      const monthStore = transaction.objectStore(MONTHS_STORE);
      const monthDealsStore = transaction.objectStore(MONTH_DEALS_STORE);
      const now = new Date();
      const monthId = monthIdForDate(now);
      const monthMeta: MonthMeta = { id: monthId, label: monthLabelForDate(now), createdAt: now.toISOString() };
      await monthStore.put(monthMeta);
      for (const legacy of legacyDeals) {
        const { received, receipts, overrideMode, overrideValue, ...baseDeal } = legacy;
        await baseStore.put(baseDeal);
        const record: MonthRecord = {
          id: `${monthId}:${legacy.id}`,
          monthId,
          dealId: legacy.id,
          received: typeof received === "number" ? received : 0,
          receipts: Array.isArray(receipts) ? receipts : [],
          snapshotRecovered: null,
          snapshotRemaining: null,
          createdAt: legacy.createdAt || monthMeta.createdAt,
          updatedAt: legacy.updatedAt || monthMeta.createdAt
        };
        await monthDealsStore.put(record);
      }
      db.deleteObjectStore("deals");
      await transaction.objectStore(META_STORE).put(monthId, ACTIVE_MONTH_KEY);
    }

    // v2 → add snapshot fields to existing monthDeals records
    if (oldVersion < 3 && db.objectStoreNames.contains(MONTH_DEALS_STORE)) {
      const store = transaction.objectStore(MONTH_DEALS_STORE);
      const all = await store.getAll();
      for (const rec of all) {
        if (rec.snapshotRecovered === undefined) {
          rec.snapshotRecovered = null;
          rec.snapshotRemaining = null;
          await store.put(rec);
        }
      }
    }
  }
});

export async function getBaseDeals(): Promise<BaseDeal[]> {
  const db = await dbPromise;
  return db.getAll(BASE_DEALS_STORE);
}

export async function saveBaseDeals(deals: BaseDeal[]): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(BASE_DEALS_STORE, "readwrite");
  await Promise.all(deals.map((deal) => tx.store.put(deal)));
  await tx.done;
}

export async function saveBaseDeal(deal: BaseDeal): Promise<void> {
  const db = await dbPromise;
  await db.put(BASE_DEALS_STORE, deal);
}

export async function deleteBaseDeal(id: string): Promise<void> {
  const db = await dbPromise;
  await db.delete(BASE_DEALS_STORE, id);
}

export async function getMonths(): Promise<MonthMeta[]> {
  const db = await dbPromise;
  return db.getAll(MONTHS_STORE);
}

/**
 * Create a new month by snapshotting the current recovered/remaining
 * from `fromMonthId` for every open deal. Each deal in the new month
 * starts with received=0, receipts=[], but carries the closing balance
 * of the source month as its opening snapshot.
 */
export async function createNextMonth(
  fromMonthId: string,
  newMonthId: string,
  label: string
): Promise<void> {
  const db = await dbPromise;
  const [baseDeals, fromRecords] = await Promise.all([
    db.getAll(BASE_DEALS_STORE),
    db.getAllFromIndex(MONTH_DEALS_STORE, "monthId", fromMonthId)
  ]);

  const recordMap = new Map(fromRecords.map((r: MonthRecord) => [r.dealId, r]));
  const now = new Date().toISOString();

  // open deals = remaining > 0
  const openDeals = baseDeals.filter((d: BaseDeal) => d.remainingAmount > 0);

  const tx = db.transaction([MONTHS_STORE, MONTH_DEALS_STORE], "readwrite");
  await tx.objectStore(MONTHS_STORE).put({ id: newMonthId, label, createdAt: now });

  await Promise.all(
    openDeals.map((deal: BaseDeal) => {
      const prev = recordMap.get(deal.id);
      // snapshot = whatever the closing balance was in the source month
      const snapshotRecovered = prev
        ? deal.recoveredAmount // base already updated by receipt saves
        : deal.recoveredAmount;
      const snapshotRemaining = prev
        ? deal.remainingAmount
        : deal.remainingAmount;
      return tx.objectStore(MONTH_DEALS_STORE).put({
        id: `${newMonthId}:${deal.id}`,
        monthId: newMonthId,
        dealId: deal.id,
        received: 0,
        receipts: [],
        snapshotRecovered,
        snapshotRemaining,
        createdAt: now,
        updatedAt: now
      } as MonthRecord);
    })
  );
  await tx.done;
}

/**
 * When base deal balances change (receipt added in any month),
 * propagate new snapshot to all LATER months' records for that deal.
 * Earlier months are NOT affected.
 */
export async function propagateSnapshotForward(
  dealId: string,
  fromMonthId: string,
  newRecovered: number,
  newRemaining: number
): Promise<void> {
  const db = await dbPromise;
  const [allMonths, allRecordsForDeal] = await Promise.all([
    db.getAll(MONTHS_STORE),
    db.getAllFromIndex(MONTH_DEALS_STORE, "dealId", dealId)
  ]);

  // months strictly AFTER fromMonthId
  const laterMonthIds = new Set(
    allMonths
      .filter((m: MonthMeta) => m.id > fromMonthId)
      .map((m: MonthMeta) => m.id)
  );

  const toUpdate = allRecordsForDeal.filter((r: MonthRecord) => laterMonthIds.has(r.monthId));
  if (toUpdate.length === 0) return;

  const tx = db.transaction(MONTH_DEALS_STORE, "readwrite");
  await Promise.all(
    toUpdate.map((r: MonthRecord) =>
      tx.store.put({
        ...r,
        snapshotRecovered: newRecovered,
        snapshotRemaining: newRemaining,
        updatedAt: new Date().toISOString()
      })
    )
  );
  await tx.done;
}

export async function getMonthRecords(monthId: string): Promise<MonthRecord[]> {
  const db = await dbPromise;
  return db.getAllFromIndex(MONTH_DEALS_STORE, "monthId", monthId);
}

export async function saveMonthRecord(record: MonthRecord): Promise<void> {
  const db = await dbPromise;
  await db.put(MONTH_DEALS_STORE, record);
}

export async function saveMonthRecords(records: MonthRecord[]): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(MONTH_DEALS_STORE, "readwrite");
  await Promise.all(records.map((record) => tx.store.put(record)));
  await tx.done;
}

export async function deleteMonthRecordsForDeal(dealId: string): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(MONTH_DEALS_STORE, "readwrite");
  const index = tx.store.index("dealId");
  const keys = await index.getAllKeys(dealId);
  await Promise.all(keys.map((key: IDBValidKey) => tx.store.delete(key)));
  await tx.done;
}

export async function deleteDealEverywhere(dealId: string): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction([BASE_DEALS_STORE, MONTH_DEALS_STORE], "readwrite");
  await tx.objectStore(BASE_DEALS_STORE).delete(dealId);
  const index = tx.objectStore(MONTH_DEALS_STORE).index("dealId");
  const keys = await index.getAllKeys(dealId);
  await Promise.all(keys.map((key: IDBValidKey) => tx.objectStore(MONTH_DEALS_STORE).delete(key)));
  await tx.done;
}

export async function getActiveMonthId(): Promise<string | undefined> {
  const db = await dbPromise;
  return db.get(META_STORE, ACTIVE_MONTH_KEY);
}

export async function setActiveMonthId(monthId: string): Promise<void> {
  const db = await dbPromise;
  await db.put(META_STORE, monthId, ACTIVE_MONTH_KEY);
}

export async function getFormulas(): Promise<FormulaTemplates | undefined> {
  const db = await dbPromise;
  return db.get(META_STORE, FORMULA_KEY);
}

export async function setFormulas(formulas: FormulaTemplates): Promise<void> {
  const db = await dbPromise;
  await db.put(META_STORE, formulas, FORMULA_KEY);
}
