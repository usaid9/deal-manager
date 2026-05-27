/**
 * db.ts  –  RxDB-backed local persistence layer
 *
 * Replaces the raw `idb` implementation with RxDB using the IndexedDB
 * storage adapter.  The public API surface (function names + signatures)
 * is identical to the old db.ts so that store.ts, App.tsx and every other
 * caller requires zero changes.
 *
 * Platforms:
 *   • Browser / Electron  – getRxStorage() returns IndexedDB storage
 *   • Capacitor / Android – getRxStorage() returns the same IndexedDB
 *     storage (Chromium WebView ships IndexedDB natively).  No extra
 *     SQLite plugin is required for the Gradle / Capacitor build.
 *
 * The getRxDb() promise is a singleton; every exported function awaits it
 * before touching data.
 */

import {
  createRxDatabase,
  addRxPlugin,
  type RxDatabase,
  type RxCollection,
  type RxDocument,
} from "rxdb";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema";
import { RxDBUpdatePlugin } from "rxdb/plugins/update";
import { RxDBQueryBuilderPlugin } from "rxdb/plugins/query-builder";

import type {
  BaseDeal,
  FormulaTemplates,
  MonthMeta,
  MonthRecord,
} from "./types";

// ── Dev-mode plugin (strips itself in production builds) ───────────────────
if (import.meta.env.DEV) {
  addRxPlugin(RxDBDevModePlugin);
}
addRxPlugin(RxDBMigrationSchemaPlugin);
addRxPlugin(RxDBUpdatePlugin);
addRxPlugin(RxDBQueryBuilderPlugin);

// ── Schema definitions ─────────────────────────────────────────────────────

const baseDealSchema = {
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id:               { type: "string", maxLength: 128 },
    dealNo:           { type: ["number", "string"] },
    dealDate:         { type: "string" },
    invested:         { type: "number" },
    months:           { type: "number" },
    total:            { type: "number" },
    useManualBalance: { type: "boolean" },
    manualRecovered:  { type: ["number", "null"] },
    manualRemaining:  { type: ["number", "null"] },
    customer:         { type: "string" },
    mobileNo:         { type: "string" },
    referral:         { type: "string" },
    instalment:       { type: "number" },
    instalRcvd:       { type: "number" },
    profitPct:        { type: "number" },
    recoveredAmount:  { type: "number" },
    remainingAmount:  { type: "number" },
    createdAt:        { type: "string", maxLength: 32 },
    updatedAt:        { type: "string", maxLength: 32 },
  },
  required: ["id"],
  indexes: ["updatedAt"],
} as const;

const monthMetaSchema = {
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id:        { type: "string", maxLength: 32 },
    label:     { type: "string" },
    createdAt: { type: "string" },
  },
  required: ["id"],
} as const;

const monthRecordSchema = {
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id:                { type: "string", maxLength: 256 },
    monthId:           { type: "string", maxLength: 32 },
    dealId:            { type: "string", maxLength: 128 },
    received:          { type: "number" },
    receipts:          { type: "array",  items: { type: "object" } },
    snapshotRecovered: { type: ["number", "null"] },
    snapshotRemaining: { type: ["number", "null"] },
    createdAt:         { type: "string", maxLength: 32 },
    updatedAt:         { type: "string", maxLength: 32 },
  },
  required: ["id"],
  indexes: ["monthId", "dealId"],
} as const;

/** key-value store for "meta" entries (activeMonthId, formulaTemplates) */
const metaSchema = {
  version: 0,
  primaryKey: "key",
  type: "object",
  properties: {
    key:   { type: "string", maxLength: 64 },
    value: {},
  },
  required: ["key"],
} as const;

// ── Database type ──────────────────────────────────────────────────────────

type DealManagerCollections = {
  basedeals:    RxCollection<BaseDeal>;
  months:       RxCollection<MonthMeta>;
  monthrecords: RxCollection<MonthRecord>;
  meta:         RxCollection<{ key: string; value: unknown }>;
};

type DealManagerDB = RxDatabase<DealManagerCollections>;

// ── Singleton initialisation ───────────────────────────────────────────────

let _dbPromise: Promise<DealManagerDB> | null = null;

/**
 * getRxDb() – returns (and lazily creates) the singleton RxDatabase.
 *
 * Storage choice:
 *   getRxStorageDexie() wraps Dexie.js which wraps IndexedDB.  It works
 *   in all Chromium-based environments: desktop browsers, Electron
 *   (chromium renderer), and Capacitor Android (Chromium WebView).
 *   No native plugin or Gradle dependency is required.
 */
export function getRxDb(): Promise<DealManagerDB> {
  if (_dbPromise) return _dbPromise;

  _dbPromise = (async () => {
    const db = await createRxDatabase<DealManagerCollections>({
      name: "dealmanagerdb",
      storage: getRxStorageDexie(),
      ignoreDuplicate: true,
    });

    await db.addCollections({
      basedeals: {
        schema: baseDealSchema,
        migrationStrategies: {},
      },
      months: {
        schema: monthMetaSchema,
        migrationStrategies: {},
      },
      monthrecords: {
        schema: monthRecordSchema,
        migrationStrategies: {},
      },
      meta: {
        schema: metaSchema,
        migrationStrategies: {},
      },
    });

    return db;
  })();

  return _dbPromise;
}

// ── Helper: strip RxDocument wrapper → plain JS object ────────────────────

function toPlainArray<T>(docs: RxDocument<T>[]): T[] {
  return docs.map((d) => d.toJSON() as T);
}

// ── Helpers ────────────────────────────────────────────────────────────────

const META_ACTIVE_MONTH = "activeMonthId";
const META_FORMULAS     = "formulaTemplates";

function monthIdForDate(date: Date): string {
  const year  = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function monthLabelForDate(date: Date): string {
  return date.toLocaleString("en-US", { month: "short", year: "numeric" });
}

// ── Base Deals ─────────────────────────────────────────────────────────────

export async function getBaseDeals(): Promise<BaseDeal[]> {
  const db   = await getRxDb();
  const docs = await db.basedeals.find().exec();
  return toPlainArray(docs);
}

export async function saveBaseDeals(deals: BaseDeal[]): Promise<void> {
  const db = await getRxDb();
  await db.basedeals.bulkUpsert(deals);
}

export async function saveBaseDeal(deal: BaseDeal): Promise<void> {
  const db = await getRxDb();
  await db.basedeals.upsert(deal);
}

export async function deleteBaseDeal(id: string): Promise<void> {
  const db  = await getRxDb();
  const doc = await db.basedeals.findOne(id).exec();
  if (doc) await doc.remove();
}

// ── Months ─────────────────────────────────────────────────────────────────

export async function getMonths(): Promise<MonthMeta[]> {
  const db   = await getRxDb();
  const docs = await db.months.find().exec();
  return toPlainArray(docs);
}

/**
 * createNextMonth – mirrors the old idb implementation exactly.
 *
 * Creates a new MonthMeta and seeds MonthRecords from the closing state of
 * `fromMonthId` (or from all open base deals when fromMonthId is empty).
 */
export async function createNextMonth(
  fromMonthId: string,
  newMonthId:  string,
  label:       string
): Promise<void> {
  const db = await getRxDb();

  // If newMonthId is empty this was called from a migration path – generate
  if (!newMonthId) {
    newMonthId = monthIdForDate(new Date());
    label      = label || monthLabelForDate(new Date());
  }

  const now = new Date().toISOString();

  // Upsert the month meta
  await db.months.upsert({ id: newMonthId, label, createdAt: now });

  // Gather base deals + prior-month records
  const [baseDealDocs, fromRecordDocs] = await Promise.all([
    db.basedeals.find().exec(),
    fromMonthId
      ? db.monthrecords.find({ selector: { monthId: fromMonthId } }).exec()
      : Promise.resolve([] as RxDocument<MonthRecord>[]),
  ]);

  const baseDeals   = toPlainArray<BaseDeal>(baseDealDocs);
  const fromRecords = toPlainArray<MonthRecord>(fromRecordDocs);
  const recordMap   = new Map(fromRecords.map((r) => [r.dealId, r]));

  const openDeals = baseDeals.filter((d) => d.remainingAmount > 0);

  const newRecords: MonthRecord[] = openDeals.map((deal) => {
    const prev = recordMap.get(deal.id);
    return {
      id:                `${newMonthId}:${deal.id}`,
      monthId:            newMonthId,
      dealId:             deal.id,
      received:           0,
      receipts:           [],
      snapshotRecovered:  prev ? deal.recoveredAmount : deal.recoveredAmount,
      snapshotRemaining:  prev ? deal.remainingAmount : deal.remainingAmount,
      createdAt:          now,
      updatedAt:          now,
    } as MonthRecord;
  });

  if (newRecords.length > 0) {
    await db.monthrecords.bulkUpsert(newRecords);
  }
}

// ── Snapshot propagation ───────────────────────────────────────────────────

export async function propagateSnapshotForward(
  dealId:       string,
  fromMonthId:  string,
  newRecovered: number,
  newRemaining: number
): Promise<void> {
  const db = await getRxDb();

  const [monthDocs, recordDocs] = await Promise.all([
    db.months.find().exec(),
    db.monthrecords.find({ selector: { dealId } }).exec(),
  ]);

  const allMonths  = toPlainArray<MonthMeta>(monthDocs);
  const allRecords = toPlainArray<MonthRecord>(recordDocs);

  const laterMonthIds = new Set(
    allMonths.filter((m) => m.id > fromMonthId).map((m) => m.id)
  );

  const toUpdate = allRecords.filter((r) => laterMonthIds.has(r.monthId));
  if (toUpdate.length === 0) return;

  const now = new Date().toISOString();
  const updated = toUpdate.map((r) => ({
    ...r,
    snapshotRecovered: newRecovered,
    snapshotRemaining: newRemaining,
    updatedAt:         now,
  })) as MonthRecord[];

  await db.monthrecords.bulkUpsert(updated);
}

// ── Month Records ──────────────────────────────────────────────────────────

export async function getMonthRecords(monthId: string): Promise<MonthRecord[]> {
  const db   = await getRxDb();
  const docs = await db.monthrecords.find({ selector: { monthId } }).exec();
  return toPlainArray(docs);
}

export async function saveMonthRecord(record: MonthRecord): Promise<void> {
  const db = await getRxDb();
  await db.monthrecords.upsert(record);
}

export async function saveMonthRecords(records: MonthRecord[]): Promise<void> {
  const db = await getRxDb();
  await db.monthrecords.bulkUpsert(records);
}

export async function deleteMonthRecordsForDeal(dealId: string): Promise<void> {
  const db   = await getRxDb();
  const docs = await db.monthrecords.find({ selector: { dealId } }).exec();
  await Promise.all(docs.map((d) => d.remove()));
}

export async function deleteDealEverywhere(dealId: string): Promise<void> {
  const db = await getRxDb();

  const [dealDoc, recordDocs] = await Promise.all([
    db.basedeals.findOne(dealId).exec(),
    db.monthrecords.find({ selector: { dealId } }).exec(),
  ]);

  await Promise.all([
    dealDoc ? dealDoc.remove() : Promise.resolve(),
    ...recordDocs.map((d) => d.remove()),
  ]);
}

// ── Meta ───────────────────────────────────────────────────────────────────

export async function getActiveMonthId(): Promise<string | undefined> {
  const db  = await getRxDb();
  const doc = await db.meta.findOne(META_ACTIVE_MONTH).exec();
  return (doc?.toJSON() as { key: string; value: string } | undefined)?.value;
}

export async function setActiveMonthId(monthId: string): Promise<void> {
  const db = await getRxDb();
  await db.meta.upsert({ key: META_ACTIVE_MONTH, value: monthId });
}

export async function getFormulas(): Promise<FormulaTemplates | undefined> {
  const db  = await getRxDb();
  const doc = await db.meta.findOne(META_FORMULAS).exec();
  return (doc?.toJSON() as { key: string; value: FormulaTemplates } | undefined)?.value;
}

export async function setFormulas(formulas: FormulaTemplates): Promise<void> {
  const db = await getRxDb();
  await db.meta.upsert({ key: META_FORMULAS, value: formulas });
}

/** Alias for store.ts direct collection access */
export const getRxDbInstance = getRxDb;
