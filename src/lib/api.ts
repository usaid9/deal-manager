import type { BaseDeal, FormulaTemplates, MonthMeta, MonthRecord } from "./types";

const BASE = import.meta.env.VITE_API_URL;

const req = async <T = void>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return method === "DELETE" ? undefined as T : res.json() as Promise<T>;
};

const get = <T>(path: string) => req<T>("GET", path);
const put = (path: string, body: unknown) => req("PUT", path, body);
const post = (path: string, body: unknown) => req("POST", path, body);
const del = (path: string) => req("DELETE", path);

// ── Base Deals ────────────────────────────────────────────────
export const getBaseDeals = () => get<BaseDeal[]>("/deals");
export const saveBaseDeals = (deals: BaseDeal[]) => put("/deals", deals);
export const saveBaseDeal = (deal: BaseDeal) => put(`/deals/${deal.id}`, deal);
export const deleteBaseDeal = (id: string) => del(`/deals/${id}`);
export const deleteDealEverywhere = (id: string) => del(`/deals/${id}`);

// ── Months ────────────────────────────────────────────────────
export const getMonths = () => get<MonthMeta[]>("/months");
export const createNextMonth = (fromMonthId: string, newMonthId: string, label: string) =>
  post("/months/next", { fromMonthId, newMonthId, label });
export const deleteMonth = (monthId: string) => del(`/months/${monthId}`);

// ── Month Records ─────────────────────────────────────────────
export const getMonthRecords = (monthId: string) =>
  get<MonthRecord[]>(`/month-records/${monthId}`);
export const saveMonthRecord = (record: MonthRecord) =>
  put(`/month-records/${record.id}`, record);
export const saveMonthRecords = (records: MonthRecord[]) =>
  put("/month-records", records);

// ── Snapshot propagation ──────────────────────────────────────
export const propagateSnapshotForward = (
  dealId: string, fromMonthId: string, newRecovered: number, newRemaining: number
) => post("/propagate-snapshot", { dealId, fromMonthId, newRecovered, newRemaining });

// ── Meta ──────────────────────────────────────────────────────
export const getActiveMonthId = async (): Promise<string | undefined> => {
  const { value } = await get<{ value: string | null }>("/meta/activeMonthId");
  return value ?? undefined;
};
export const setActiveMonthId = (monthId: string) =>
  put("/meta/activeMonthId", { value: monthId });

export const getFormulas = async (): Promise<FormulaTemplates | undefined> => {
  const { value } = await get<{ value: FormulaTemplates | null }>("/meta/formulas");
  return value ?? undefined;
};
export const setFormulas = (formulas: FormulaTemplates) =>
  put("/meta/formulas", { value: formulas });

export const getAllRecordsForDeal = (dealId: string) =>
  get<MonthRecord[]>(`/deals/${dealId}/all-records`);
