import type { FormulaTemplates } from "./types";

export const DEFAULT_FORMULAS: FormulaTemplates = {
  instalment: "=ROUND(((C2+(C2*D2*3.3333333333/100))/D2),2)",
  total: "=D2*I2",
  profitPct: "=ROUND((((E2-C2)/D2)*D2)/C2*100,2)",
  recoveredAmount: "=E2-N2",
  remainingAmount: "=I2*(D2-K2)"
};

export function applyRowToFormula(formula: string, row: number): string {
  if (!formula) return "";
  return formula.replace(/(\$?[A-Z]{1,3})(\$?\d+)/g, (_, col, rowRef) =>
    rowRef.startsWith("$") ? `${col}${rowRef}` : `${col}${row}`
  );
}
