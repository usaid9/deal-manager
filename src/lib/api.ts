/**
 * api.ts — replaces db.ts (IndexedDB) with MongoDB REST API calls.
 * All exported function signatures are identical to the old db.ts so
 * App.tsx needs ZERO changes except the import path.
 */

import type { BaseDeal, FormulaTemplates, MonthMeta, MonthRecord } from "./types";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function put(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}`);
}

async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
}

// ── Base Deals ────────────────────────────────────────────────
export async function getBaseDeals(): Promise<BaseDeal[]> {
  return get<BaseDeal[]>("/deals");
}

export async function saveBaseDeals(deals: BaseDeal[]): Promise<void> {
  await put("/deals", deals);
}

export async function saveBaseDeal(deal: BaseDeal): Promise<void> {
  await put(`/deals/${deal.id}`, deal);
}

export async function deleteBaseDeal(id: string): Promise<void> {
  await del(`/deals/${id}`);
}

export async function deleteDealEverywhere(id: string): Promise<void> {
  await del(`/deals/${id}`);
}

// ── Months ────────────────────────────────────────────────────
export async function getMonths(): Promise<MonthMeta[]> {
  return get<MonthMeta[]>("/months");
}

export async function createNextMonth(
  fromMonthId: string,
  newMonthId: string,
  label: string
): Promise<void> {
  await post("/months/next", { fromMonthId, newMonthId, label });
}

// ── Month Records ─────────────────────────────────────────────
export async function getMonthRecords(monthId: string): Promise<MonthRecord[]> {
  return get<MonthRecord[]>(`/month-records/${monthId}`);
}

export async function saveMonthRecord(record: MonthRecord): Promise<void> {
  await put(`/month-records/${record.id}`, record);
}

export async function saveMonthRecords(records: MonthRecord[]): Promise<void> {
  await put("/month-records", records);
}

export async function deleteMonthRecordsForDeal(_dealId: string): Promise<void> {
  // handled server-side by DELETE /deals/:id
}

// ── Propagate snapshots ───────────────────────────────────────
export async function propagateSnapshotForward(
  dealId: string,
  fromMonthId: string,
  newRecovered: number,
  newRemaining: number
): Promise<void> {
  await post("/propagate-snapshot", {
    dealId,
    fromMonthId,
    newRecovered,
    newRemaining
  });
}

// ── Meta ──────────────────────────────────────────────────────
export async function getActiveMonthId(): Promise<string | undefined> {
  const { value } = await get<{ value: string | null }>("/meta/activeMonthId");
  return value ?? undefined;
}

export async function setActiveMonthId(monthId: string): Promise<void> {
  await put("/meta/activeMonthId", { value: monthId });
}

export async function getFormulas(): Promise<FormulaTemplates | undefined> {
  const { value } = await get<{ value: FormulaTemplates | null }>("/meta/formulas");
  return value ?? undefined;
}

export async function setFormulas(formulas: FormulaTemplates): Promise<void> {
  await put("/meta/formulas", { value: formulas });
}

export async function deleteMonth(monthId: string): Promise<void> {
  await del(`/months/${monthId}`);
}

export async function getAllRecordsForDeal(dealId: string): Promise<MonthRecord[]> {
  return get<MonthRecord[]>(`/deals/${dealId}/all-records`);
}
