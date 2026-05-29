/**
 * syncEngine.ts — removed (online-only mode)
 *
 * The offline sync engine, RxDB queue, conflict resolution, and polling
 * have all been removed. This file only exports the types and no-op stubs
 * that App.tsx still references so it compiles without changes.
 */

export type SyncStatus = "idle" | "syncing" | "error" | "offline";

export type ConflictResolution = {
  type: "deal" | "monthRecord";
  id: string;
  localWon: boolean;
  merged: boolean;
};

type Listener = (status: SyncStatus, pending: number) => void;

let _listeners: Listener[] = [];

export function onSyncStatus(cb: Listener): () => void {
  _listeners.push(cb);
  cb("idle", 0);
  return () => { _listeners = _listeners.filter((l) => l !== cb); };
}

export function onConflict(_cb: unknown): () => void {
  return () => {};
}

export function getPendingCount(): number { return 0; }

export function enqueueSyncOp(_op: unknown): void {}

export function startSyncEngine(): () => void {
  _listeners.forEach((l) => l("idle", 0));
  return () => {};
}
