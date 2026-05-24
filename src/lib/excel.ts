import * as XLSX from "xlsx";
import type { BaseDeal, Deal, FormulaTemplates, MonthRecord } from "./types";
import { applyRowToFormula, DEFAULT_FORMULAS } from "./formulas";
import { recalculateDeals } from "./compute";

const HEADERS = [
  "Deal No", "Deal Date", "Invested", "Months", "Total",
  "Customer", "Mobile No", "Referral", "Instalment",
  "Received", "Instal Rcvd", "Profit %", "Recovered Amount", "Remaining Amount"
];

const toNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const toStr = (v: unknown) => (v == null ? "" : String(v));
const toIso = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return "";
};
const toDateCell = (v: string): Date | "" => {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "" : d;
};
const formulaCell = (formula: string, value: number) =>
  formula.trim() ? { f: formula, v: value } : value;

export async function loadDealsFromExcel(
  url: string, monthId: string
): Promise<{ baseDeals: BaseDeal[]; monthRecords: MonthRecord[]; formulas: FormulaTemplates }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load Excel file.");

  const workbook = XLSX.read(await res.arrayBuffer(), { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false }) as unknown[][];

  const now = new Date().toISOString();
  const deals: Deal[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row?.length || row[0] == null || row[0] === "") continue;
    deals.push({
      id: crypto.randomUUID(),
      dealNo: String(row[0]),
      dealDate: toIso(row[1]),
      invested: toNum(row[2]),
      months: toNum(row[3]),
      total: toNum(row[4]),
      customer: toStr(row[5]),
      mobileNo: toStr(row[6]),
      referral: toStr(row[7]),
      instalment: toNum(row[8]),
      received: toNum(row[9]),
      instalRcvd: toNum(row[10]),
      profitPct: toNum(row[11]),
      recoveredAmount: toNum(row[12]),
      remainingAmount: toNum(row[13]),
      useManualBalance: false,
      manualRecovered: null, manualRemaining: null,
      receipts: [], snapshotRecovered: null, snapshotRemaining: null,
      createdAt: now, updatedAt: now
    });
  }

  const recalculated = recalculateDeals(deals);
  const baseDeals = recalculated.map(({ received, receipts, snapshotRecovered, snapshotRemaining, ...base }) => base);
  const monthRecords: MonthRecord[] = recalculated.map((d) => ({
    id: `${monthId}:${d.id}`, monthId, dealId: d.id,
    received: d.received, receipts: d.receipts,
    snapshotRecovered: null, snapshotRemaining: null,
    createdAt: now, updatedAt: now
  }));

  return { baseDeals, monthRecords, formulas: DEFAULT_FORMULAS };
}

type ExportOptions = { deals: Deal[]; formulas: FormulaTemplates; fileName: string };

export function exportDealsToExcel({ deals, formulas, fileName }: ExportOptions): void {
  const rows = deals.map((deal, i) => {
    const r = i + 2;
    const instF = applyRowToFormula(formulas.instalment ?? "", r);
    const useManual = deal.useManualBalance;
    return [
      String(deal.dealNo ?? ""),
      toDateCell(deal.dealDate),
      deal.invested, deal.months,
      formulaCell(applyRowToFormula(formulas.total, r), deal.total),
      deal.customer, deal.mobileNo, deal.referral,
      formulaCell(instF, deal.instalment),
      deal.received, deal.instalRcvd,
      formulaCell(applyRowToFormula(formulas.profitPct, r), deal.profitPct),
      formulaCell(useManual ? "" : applyRowToFormula(formulas.recoveredAmount, r), deal.recoveredAmount),
      formulaCell(useManual ? "" : applyRowToFormula(formulas.remainingAmount, r), deal.remainingAmount)
    ];
  });
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Deals");
  XLSX.writeFile(wb, fileName, { compression: true });
}
