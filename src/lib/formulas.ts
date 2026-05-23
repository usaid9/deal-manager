import type { FormulaTemplates } from "./types";

// Kept for reference / Excel export compatibility
export const DEFAULT_FORMULAS: FormulaTemplates = {
  instalment: "=ROUND(((C2+(C2*D2*3.3333333333/100))/D2),2)",
  total: "=D2*I2",
  profitPct: "=ROUND((((E2-C2)/D2)*D2)/C2*100,2)",
  recoveredAmount: "=E2-N2",
  remainingAmount: "=I2*(D2-K2)"
};

export function extractFormulaTemplates(
  _sheet: Record<string, { f?: string }>
): FormulaTemplates {
  return DEFAULT_FORMULAS;
}

export function applyRowToFormula(formula: string, row: number): string {
  if (!formula) return "";
  return formula.replace(/(\$?[A-Z]{1,3})(\$?\d+)/g, (_, col, rowRef) => {
    if (rowRef.startsWith("$")) return `${col}${rowRef}`;
    return `${col}${row}`;
  });
}
