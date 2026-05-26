/**
 * syncEngine.ts — conflict-aware, always-online sync engine
 *
 * Rules:
 *  1. Every write goes to RxDB locally first (instant, offline-safe).
 *  2. When online, the op is pushed to the server immediately.
 *  3. On conflict (server doc is newer):
 *       - BaseDeal fields  → server wins (last-write-wins by updatedAt)
 *       - MonthRecord.receipts → MERGED: keep all unique receipt ids,
 *         prefer the one with the latest receivedAt when same id exists.
 *  4. A WebSocket-like "live" poll (5 s when tab visible, 30 s when hidden)
 *     pulls server changes so local stays fresh while online.
 *  5. When offline the queue is persisted in RxDB meta so it survives
 *     page refreshes. On reconnect the queue is drained automatically.
 */

import { getRxDb }                              from "./db";
import { isServerReachable, resetReachabilityCache } from "./reachability";
import type { BaseDeal, FormulaTemplates, MonthMeta, MonthRecord, Receipt } from "./types";

const BASE = (import.meta.env.VITE_API_URL as string) ?? "";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SyncOp =
  | { op: "saveBaseDeals";        payload: BaseDeal[] }
  | { op: "saveBaseDeal";         payload: BaseDeal }
  | { op: "deleteDealEverywhere"; payload: { dealId: string } }
  | { op: "createNextMonth";      payload: { fromMonthId: string; newMonthId: string; label: string } }
  | { op: "saveMonthRecord";      payload: MonthRecord }
  | { op: "saveMonthRecords";     payload: MonthRecord[] }
  | { op: "propagateSnapshot";    payload: { dealId: string; fromMonthId: string; newRecovered: number; newRemaining: number } }
  | { op: "setActiveMonthId";     payload: { monthId: string } }
  | { op: "setFormulas";          payload: FormulaTemplates };

export type SyncStatus = "idle" | "syncing" | "error" | "offline";

export type ConflictResolution = {
  type: "deal" | "monthRecord";
  id: string;
  localWon: boolean;
  merged: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal state
// ─────────────────────────────────────────────────────────────────────────────

type Listener        = (status: SyncStatus, pending: number) => void;
type ConflictListener = (r: ConflictResolution) => void;

let _status:            SyncStatus        = "idle";
let _pending            = 0;
let _listeners:         Listener[]        = [];
let _conflictListeners: ConflictListener[] = [];
let _queue:             SyncOp[]          = [];
let _running            = false;
let _started            = false;
let _retryTimer:        ReturnType<typeof setTimeout>  | null = null;
let _pollTimer:         ReturnType<typeof setTimeout>  | null = null;
let _visibilityHandler: (() => void) | null = null;

const QUEUE_META_KEY = "syncQueue";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function notify() {
  _listeners.forEach((l) => l(_status, _pending));
}

function setStatus(s: SyncStatus) {
  if (_status === s) return;
  _status = s;
  notify();
}

function notifyConflict(r: ConflictResolution) {
  _conflictListeners.forEach((l) => l(r));
}

async function apiFetch(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return method === "DELETE" ? undefined : res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue persistence (survives page refresh)
// ─────────────────────────────────────────────────────────────────────────────

async function persistQueue(): Promise<void> {
  try {
    const db = await getRxDb();
    // Stringify + parse to guarantee a plain object — never store a proxy/frozen ref
    const plain = JSON.parse(JSON.stringify(_queue));
    await db.meta.upsert({ key: QUEUE_META_KEY, value: plain });
  } catch { /* non-fatal */ }
}

async function loadPersistedQueue(): Promise<void> {
  try {
    const db  = await getRxDb();
    const doc = await db.meta.findOne(QUEUE_META_KEY).exec();
    if (doc) {
      const saved = (doc.toJSON() as { key: string; value: SyncOp[] }).value;
      if (Array.isArray(saved) && saved.length > 0) {
        // Deep-clone so we get a plain mutable array, not RxDB's frozen proxy
        _queue   = JSON.parse(JSON.stringify(saved));
        _pending = _queue.length;
        notify();
      }
    }
  } catch { /* non-fatal */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Receipt merge logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * mergeReceipts — for the same MonthRecord from two devices:
 *   • Keep all receipts that exist on only one side.
 *   • When the same receipt id exists on both sides, keep the one
 *     with the latest receivedAt (most recent edit wins).
 *   • Recalculate `received` as sum of merged receipts.
 */
function mergeReceipts(local: Receipt[], server: Receipt[]): Receipt[] {
  const map = new Map<string, Receipt>();

  // Add server receipts first
  for (const r of server) map.set(r.id, r);

  // Merge local: if same id exists, keep the one with latest receivedAt
  for (const r of local) {
    const existing = map.get(r.id);
    if (!existing) {
      map.set(r.id, r);
    } else {
      // Keep the one edited most recently
      if (r.receivedAt > existing.receivedAt) map.set(r.id, r);
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.receivedAt.localeCompare(b.receivedAt)
  );
}

function sumReceipts(receipts: Receipt[]): number {
  return receipts.reduce((s, r) => s + r.amount, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Conflict resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * resolveBaseDeal
 * Server doc is newer → server wins. Update local RxDB silently.
 */
async function resolveBaseDealConflict(
  local: BaseDeal,
  server: BaseDeal
): Promise<void> {
  const db = await getRxDb();
  await db.basedeals.upsert(server);
  notifyConflict({ type: "deal", id: local.id, localWon: false, merged: false });
}

/**
 * resolveMonthRecord
 * Receipts are merged. Then:
 *   - If server updatedAt is newer, use server's other fields + merged receipts.
 *   - If local updatedAt is newer, use local's other fields + merged receipts.
 * Either way, both local RxDB and server get the merged result.
 */
async function resolveMonthRecordConflict(
  local: MonthRecord,
  server: MonthRecord
): Promise<MonthRecord> {
  const mergedReceipts = mergeReceipts(local.receipts, server.receipts);
  const mergedReceived = sumReceipts(mergedReceipts);

  // Base is whichever side is newer
  const base = server.updatedAt > local.updatedAt ? server : local;

  const merged: MonthRecord = {
    ...base,
    receipts:  mergedReceipts,
    received:  mergedReceived,
    updatedAt: new Date().toISOString(),
  };

  // Update local RxDB
  const db = await getRxDb();
  await db.monthrecords.upsert(merged);

  notifyConflict({ type: "monthRecord", id: local.id, localWon: false, merged: true });
  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// Push ops — each checks for conflict before accepting server rejection
// ─────────────────────────────────────────────────────────────────────────────

async function pushBaseDeal(deal: BaseDeal): Promise<void> {
  try {
    await apiFetch("PUT", `/deals/${deal.id}`, deal);
  } catch (err: unknown) {
    // 409 → server has a newer version
    if (err instanceof Error && err.message.includes("409")) {
      const serverDoc = await apiFetch("GET", `/deals/${deal.id}`) as BaseDeal;
      if (serverDoc && serverDoc.updatedAt > deal.updatedAt) {
        await resolveBaseDealConflict(deal, serverDoc);
        return; // don't retry — server won
      }
    }
    throw err; // re-throw for retry
  }
}

async function pushMonthRecord(record: MonthRecord): Promise<void> {
  try {
    await apiFetch("PUT", `/month-records/${record.id}`, record);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("409")) {
      const serverDoc = await apiFetch("GET", `/month-records/${record.id}`) as MonthRecord;
      if (serverDoc) {
        const merged = await resolveMonthRecordConflict(record, serverDoc);
        // Push merged result back to server
        await apiFetch("PUT", `/month-records/${merged.id}`, merged);
        return;
      }
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Execute a single queued op
// ─────────────────────────────────────────────────────────────────────────────

async function executeSyncOp(op: SyncOp): Promise<void> {
  switch (op.op) {
    case "saveBaseDeals":
      await Promise.all(op.payload.map(pushBaseDeal));
      break;

    case "saveBaseDeal":
      await pushBaseDeal(op.payload);
      break;

    case "deleteDealEverywhere":
      await apiFetch("DELETE", `/deals/${op.payload.dealId}`);
      break;

    case "createNextMonth":
      await apiFetch("POST", "/months/next", op.payload);
      break;

    case "saveMonthRecord":
      await pushMonthRecord(op.payload);
      break;

    case "saveMonthRecords":
      await Promise.all(op.payload.map(pushMonthRecord));
      break;

    case "propagateSnapshot":
      await apiFetch("POST", "/propagate-snapshot", op.payload);
      break;

    case "setActiveMonthId":
      await apiFetch("PUT", "/meta/activeMonthId", { value: op.payload.monthId });
      break;

    case "setFormulas":
      await apiFetch("PUT", "/meta/formulas", { value: op.payload });
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue processor
// ─────────────────────────────────────────────────────────────────────────────

async function processQueue(): Promise<void> {
  if (_running || _queue.length === 0) return;
  _running = true;

  const reachable = await isServerReachable();
  if (!reachable) {
    setStatus("offline");
    _running = false;
    scheduleRetry();
    return;
  }

  setStatus("syncing");

  // Always work on a guaranteed-mutable copy
  _queue = Array.from(_queue).map((op) => JSON.parse(JSON.stringify(op)));

  while (_queue.length > 0) {
    const op = _queue[0];
    try {
      await executeSyncOp(op);
      _queue = _queue.slice(1);   // slice returns a new array — never mutates
      _pending = _queue.length;
      await persistQueue();
      notify();
    } catch (err) {
      console.error("[syncEngine] op failed, will retry:", op.op, err);
      setStatus("error");
      _running = false;
      scheduleRetry();
      return;
    }
  }

  _pending = 0;
  setStatus("idle");
  _running = false;
}

function scheduleRetry() {
  if (_retryTimer) clearTimeout(_retryTimer);
  _retryTimer = setTimeout(() => {
    resetReachabilityCache();
    void processQueue();
  }, 15_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pull: server → local RxDB  (keeps local fresh while online)
// ─────────────────────────────────────────────────────────────────────────────

async function pullAll(): Promise<void> {
  // Don't pull while there are pending local writes — local is the source of truth
  if (_queue.length > 0) return;

  const db = await getRxDb();

  const [deals, months, activeMonthData, formulasData] = await Promise.all([
    apiFetch("GET", "/deals")             as Promise<BaseDeal[]>,
    apiFetch("GET", "/months")            as Promise<MonthMeta[]>,
    apiFetch("GET", "/meta/activeMonthId").catch(() => ({ value: null })) as Promise<{ value: string | null }>,
    apiFetch("GET", "/meta/formulas").catch(() => ({ value: null }))      as Promise<{ value: FormulaTemplates | null }>,
  ]);

  // ── Deals: per-doc conflict check ──────────────────────────────────────
  if (deals?.length) {
    const localDocs = await db.basedeals.find().exec();
    const localMap  = new Map(localDocs.map((d) => [d.id, d.toJSON() as BaseDeal]));

    // Build set of deal ids that have pending local writes — don't overwrite these
    const pendingDealIds = new Set(
      _queue.flatMap((op) => {
        if (op.op === "saveBaseDeal")   return [op.payload.id];
        if (op.op === "saveBaseDeals")  return op.payload.map((d) => d.id);
        if (op.op === "deleteDealEverywhere") return [op.payload.dealId];
        return [];
      })
    );

    for (const serverDeal of deals) {
      if (pendingDealIds.has(serverDeal.id)) continue; // local write pending — skip
      const local = localMap.get(serverDeal.id);
      // Only accept server doc when it is STRICTLY newer than local
      if (!local || serverDeal.updatedAt > local.updatedAt) {
        await db.basedeals.upsert(serverDeal);
      }
      // equal or local newer → leave local alone
    }
  }

  // ── Months: upsert server months, remove any local-only phantom months ──
  if (months?.length) {
    const serverMonthIds = new Set(months.map((m) => m.id));

    // Remove local months that don't exist on server (phantoms from old seed logic)
    const localMonthDocs = await db.months.find().exec();
    for (const localDoc of localMonthDocs) {
      if (!serverMonthIds.has(localDoc.id)) {
        await localDoc.remove();
        // Also remove associated month records
        const orphanRecords = await db.monthrecords
          .find({ selector: { monthId: localDoc.id } }).exec();
        await Promise.all(orphanRecords.map((r) => r.remove()));
      }
    }

    // Upsert server months (plain upsert — never call createNextMonth here)
    await db.months.bulkUpsert(months);

    // Pull each month's records
    const recordArrays = await Promise.all(
      months.map((m) =>
        (apiFetch("GET", `/month-records/${m.id}`) as Promise<MonthRecord[]>)
          .catch(() => [] as MonthRecord[])
      )
    );
    const allServerRecords = recordArrays.flat();

    // Build set of record ids with pending local writes
    const pendingRecordIds = new Set(
      _queue.flatMap((op) => {
        if (op.op === "saveMonthRecord")  return [op.payload.id];
        if (op.op === "saveMonthRecords") return op.payload.map((r) => r.id);
        return [];
      })
    );

    for (const serverRec of allServerRecords) {
      if (pendingRecordIds.has(serverRec.id)) continue; // pending local write — skip

      const localDoc = await db.monthrecords.findOne(serverRec.id).exec();
      const local    = localDoc ? (localDoc.toJSON() as MonthRecord) : null;

      if (!local) {
        // New record from server
        await db.monthrecords.upsert(serverRec);
        continue;
      }

      if (serverRec.updatedAt === local.updatedAt) continue; // identical

      // Both sides changed → merge receipts, use newer base
      const mergedReceipts = mergeReceipts(local.receipts, serverRec.receipts);
      const mergedReceived = sumReceipts(mergedReceipts);
      const base           = serverRec.updatedAt > local.updatedAt ? serverRec : local;

      const merged: MonthRecord = {
        ...base,
        receipts:  mergedReceipts,
        received:  mergedReceived,
        updatedAt: new Date().toISOString(),
      };

      await db.monthrecords.upsert(merged);

      // If local was newer or we merged, push the result back up
      if (local.updatedAt >= serverRec.updatedAt) {
        enqueueSyncOp({ op: "saveMonthRecord", payload: merged });
      }
    }
  }

  // ── Meta ───────────────────────────────────────────────────────────────
  if (activeMonthData?.value != null)
    await db.meta.upsert({ key: "activeMonthId", value: activeMonthData.value });
  if (formulasData?.value != null)
    await db.meta.upsert({ key: "formulaTemplates", value: formulasData.value });
}

// ─────────────────────────────────────────────────────────────────────────────
// Live polling — 5 s visible / 30 s hidden
// ─────────────────────────────────────────────────────────────────────────────

function getInterval() {
  return document.visibilityState === "visible" ? 5_000 : 30_000;
}

function schedulePoll() {
  if (_pollTimer) clearTimeout(_pollTimer);
  _pollTimer = setTimeout(async () => {
    const reachable = await isServerReachable();
    if (reachable) {
      // Drain any queued writes first, then pull
      await processQueue();
      if (_queue.length === 0) {
        setStatus("syncing");
        await pullAll().catch(console.error);
        if (_status === "syncing") setStatus("idle");
      }
    } else {
      setStatus("offline");
    }
    schedulePoll(); // reschedule
  }, getInterval());
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function onSyncStatus(cb: Listener): () => void {
  _listeners.push(cb);
  cb(_status, _pending);
  return () => { _listeners = _listeners.filter((l) => l !== cb); };
}

export function onConflict(cb: ConflictListener): () => void {
  _conflictListeners.push(cb);
  return () => { _conflictListeners = _conflictListeners.filter((l) => l !== cb); };
}

export function getPendingCount(): number { return _pending; }

export function enqueueSyncOp(op: SyncOp): void {
  // Always rebuild as a plain mutable array — _queue may be frozen/proxy after RxDB load
  _queue = [..._queue, JSON.parse(JSON.stringify(op))];
  _pending = _queue.length;
  notify();
  void persistQueue();
  void processQueue();
}

export function startSyncEngine(): () => void {
  if (_started) return () => {};
  _started = true;

  // Load any ops queued before a page refresh
  loadPersistedQueue().then(() => {
    // Initial: drain queue, then pull
    isServerReachable().then(async (ok) => {
      if (ok) {
        await processQueue();
        setStatus("syncing");
        await pullAll().catch(console.error);
        setStatus("idle");
      } else {
        setStatus("offline");
      }
      schedulePoll();
    });
  });

  // Online/offline events
  const onOnline  = () => { resetReachabilityCache(); void processQueue(); };
  const onOffline = () => { setStatus("offline"); };
  window.addEventListener("online",  onOnline);
  window.addEventListener("offline", onOffline);

  // Adjust poll interval when tab visibility changes
  _visibilityHandler = () => schedulePoll();
  document.addEventListener("visibilitychange", _visibilityHandler);

  // Electron graceful-close flush
  (window as unknown as Record<string, unknown>).__syncFlushPromise = processQueue;

  return () => {
    _started = false;
    window.removeEventListener("online",  onOnline);
    window.removeEventListener("offline", onOffline);
    if (_visibilityHandler)
      document.removeEventListener("visibilitychange", _visibilityHandler);
    if (_pollTimer)  clearTimeout(_pollTimer);
    if (_retryTimer) clearTimeout(_retryTimer);
    _queue   = [];
    _pending = 0;
  };
}
