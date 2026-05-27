export type Receipt = {
  id: string;
  dealId: string;
  amount: number;
  receivedAt: string;
  note?: string;
  installments: number;
};

export type BaseDeal = {
  id: string;
  dealNo: number | string;
  dealDate: string;
  invested: number;
  months: number;
  total: number;
  useManualBalance: boolean;
  manualRecovered: number | null;
  manualRemaining: number | null;
  customer: string;
  mobileNo: string;
  referral: string;
  instalment: number;
  instalRcvd: number;
  profitPct: number;
  recoveredAmount: number;
  remainingAmount: number;
  createdAt: string;
  updatedAt: string;
};

export type MonthRecord = {
  id: string;
  monthId: string;
  dealId: string;
  received: number;
  receipts: Receipt[];
  snapshotRecovered: number | null;
  snapshotRemaining: number | null;
  createdAt: string;
  updatedAt: string;
};

export type MonthMeta = {
  id: string;
  label: string;
  createdAt: string;
};

export type Deal = BaseDeal & {
  received: number;
  receipts: Receipt[];
  snapshotRecovered: number | null;
  snapshotRemaining: number | null;
};

export type FormulaTemplates = {
  instalment: string;
  total: string;
  profitPct: string;
  recoveredAmount: string;
  remainingAmount: string;
};
