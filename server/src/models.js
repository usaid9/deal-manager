import mongoose from "mongoose";

const ReceiptSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    dealId: { type: String, required: true },
    amount: { type: Number, required: true },
    receivedAt: { type: String, required: true },
    note: { type: String, default: "" },
    installments: { type: Number, default: 1 }
  },
  { _id: false }
);

const BaseDealSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    dealNo: { type: mongoose.Schema.Types.Mixed },
    dealDate: String,
    invested: Number,
    months: Number,
    total: Number,
    useManualBalance: { type: Boolean, default: false },
    manualRecovered: { type: Number, default: null },
    manualRemaining: { type: Number, default: null },
    customer: String,
    mobileNo: String,
    referral: String,
    instalment: Number,
    instalRcvd: Number,
    profitPct: Number,
    recoveredAmount: Number,
    remainingAmount: Number,
    createdAt: String,
    updatedAt: String
  },
  { versionKey: false }
);

const MonthMetaSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    label: String,
    createdAt: String
  },
  { versionKey: false }
);

const MonthRecordSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    monthId: { type: String, required: true, index: true },
    dealId: { type: String, required: true, index: true },
    received: { type: Number, default: 0 },
    receipts: { type: [ReceiptSchema], default: [] },
    snapshotRecovered: { type: Number, default: null },
    snapshotRemaining: { type: Number, default: null },
    createdAt: String,
    updatedAt: String
  },
  { versionKey: false }
);

const MetaSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: mongoose.Schema.Types.Mixed
  },
  { versionKey: false }
);

export const BaseDeal = mongoose.model("BaseDeal", BaseDealSchema);
export const MonthMeta = mongoose.model("MonthMeta", MonthMetaSchema);
export const MonthRecord = mongoose.model("MonthRecord", MonthRecordSchema);
export const Meta = mongoose.model("Meta", MetaSchema);
