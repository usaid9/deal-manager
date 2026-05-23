import * as XLSX from "xlsx";
import type { BaseDeal, Deal, FormulaTemplates, MonthRecord } from "./types";
import { HEADERS } from "./types";
import { applyRowToFormula, extractFormulaTemplates } from "./formulas";
import { recalculateDeals } from "./compute";

const toNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const toString = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
};

const toIsoDate = (value: unknown): string => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return "";
};

const toDateCell = (value: string): Date | "" => {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed;
};

const formulaCell = (formula: string, value: number) => {
  if (!formula.trim()) {
    return value;
  }
  return { f: formula, v: value };
};

export async function loadDealsFromExcel(
  url: string,
  monthId: string
): Promise<{ baseDeals: BaseDeal[]; monthRecords: MonthRecord[]; formulas: FormulaTemplates }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load Excel file.");
  }

  const data = await response.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const formulas = extractFormulaTemplates(
    sheet as Record<string, { f?: string }>
  );

  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    blankrows: false
  }) as unknown[][];

  const deals: Deal[] = [];
  const now = new Date().toISOString();

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.length === 0) {
      continue;
    }

    const dealNo = row[0];
    if (dealNo === null || dealNo === undefined || dealNo === "") {
      continue;
    }

    deals.push({
      id: crypto.randomUUID(),
      dealNo: String(dealNo),
      dealDate: toIsoDate(row[1]),
      invested: toNumber(row[2]),
      months: toNumber(row[3]),
      total: toNumber(row[4]),
      customer: toString(row[5]),
      mobileNo: toString(row[6]),
      referral: toString(row[7]),
      instalment: toNumber(row[8]),
      received: toNumber(row[9]),
      instalRcvd: toNumber(row[10]),
      profitPct: toNumber(row[11]),
      recoveredAmount: toNumber(row[12]),
      remainingAmount: toNumber(row[13]),
      useManualBalance: false,
      manualRecovered: null,
      manualRemaining: null,
      receipts: [],
      snapshotRecovered: null,
      snapshotRemaining: null,
      createdAt: now,
      updatedAt: now
    });
  }

  const recalculated = recalculateDeals(deals, formulas);
  const baseDeals = recalculated.map((deal) => {
    const { received, receipts, snapshotRecovered, snapshotRemaining, ...baseDeal } = deal;
    return baseDeal;
  });
  const monthRecords = recalculated.map((deal) => ({
    id: `${monthId}:${deal.id}`,
    monthId,
    dealId: deal.id,
    received: deal.received,
    receipts: deal.receipts,
    snapshotRecovered: null,
    snapshotRemaining: null,
    createdAt: now,
    updatedAt: now
  }));

  return {
    baseDeals,
    monthRecords,
    formulas
  };
}

type ExportOptions = {
  deals: Deal[];
  formulas: FormulaTemplates;
  fileName: string;
};

export function exportDealsToExcel({
  deals,
  formulas,
  fileName
}: ExportOptions): void {
  const rows = deals.map((deal, index) => {
    const rowNumber = index + 2;
    const instalmentFormula = formulas.instalment?.trim()
      ? applyRowToFormula(formulas.instalment, rowNumber)
      : "";
    const totalFormula = applyRowToFormula(formulas.total, rowNumber);
    const profitFormula = applyRowToFormula(formulas.profitPct, rowNumber);
    const recoveredFormula = deal.useManualBalance
      ? ""
      : applyRowToFormula(formulas.recoveredAmount, rowNumber);
    const remainingFormula = deal.useManualBalance
      ? ""
      : applyRowToFormula(formulas.remainingAmount, rowNumber);

    return [
      String(deal.dealNo ?? ""),
      toDateCell(deal.dealDate),
      deal.invested,
      deal.months,
      formulaCell(totalFormula, deal.total),
      deal.customer,
      deal.mobileNo,
      deal.referral,
      formulaCell(instalmentFormula, deal.instalment),
      deal.received,
      deal.instalRcvd,
      formulaCell(profitFormula, deal.profitPct),
      formulaCell(recoveredFormula, deal.recoveredAmount),
      formulaCell(remainingFormula, deal.remainingAmount)
    ];
  });

  const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Deals");
  XLSX.writeFile(workbook, fileName, { compression: true });
}
