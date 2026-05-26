import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { recalculateDeals, calcInstalment } from "../lib/compute";
import {
  getBaseDeals, getMonthRecords, getMonths, saveBaseDeal,
} from "../lib/store";
import type { BaseDeal, Deal, MonthMeta, MonthRecord } from "../lib/types";

const currency = (v: number) =>
  new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(v);

const COLS: { key: string; label: string; flex: number; editable?: boolean; readOnly?: boolean; type?: string }[] = [
  { key: "dealNo",          label: "Deal No",   flex: 72,  editable: true, type: "text" },
  { key: "dealDate",        label: "Deal Date", flex: 100, editable: true, type: "date" },
  { key: "invested",        label: "Invested",  flex: 88,  editable: true, type: "number" },
  { key: "months",          label: "Months",    flex: 58,  editable: true, type: "number" },
  { key: "total",           label: "Total",     flex: 88,  readOnly: true },
  { key: "customer",        label: "Customer",  flex: 120, editable: true, type: "text" },
  { key: "mobileNo",        label: "Mobile No", flex: 105, editable: true, type: "text" },
  { key: "referral",        label: "Referral",  flex: 90,  editable: true, type: "text" },
  { key: "instalment",      label: "Instalment",flex: 88,  readOnly: true },
  { key: "received",        label: "Rcvd (PKR)",flex: 95,  readOnly: true },
  { key: "instalRcvd",      label: "Rcvd (#)",  flex: 68,  readOnly: true },
  { key: "profitPct",       label: "Profit %",  flex: 68,  readOnly: true },
  { key: "recoveredAmount", label: "Recovered", flex: 88,  readOnly: true },
  { key: "remainingAmount", label: "Remaining", flex: 88,  readOnly: true },
];

type CellPos = { row: number; col: number };

function colLetter(i: number) {
  let s = "";
  i++;
  while (i > 0) { s = String.fromCharCode(64 + (i % 26 || 26)) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

interface ExcelGridProps {
  activeMonthId: string | null;
  months: MonthMeta[];
}

export default function ExcelGrid({ activeMonthId, months }: ExcelGridProps) {
  const [baseDeals, setBaseDeals] = useState<BaseDeal[]>([]);
  const [allMonthRecords, setAllMonthRecords] = useState<Map<string, MonthRecord[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string>(activeMonthId ?? "");
  const [selected, setSelected] = useState<CellPos | null>(null);
  const [editing, setEditing] = useState<CellPos | null>(null);
  const [editVal, setEditVal] = useState("");
  const [filterText, setFilterText] = useState("");
  const [filterReferral, setFilterReferral] = useState("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "received" | "pending">("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [deals, monthList] = await Promise.all([getBaseDeals(), getMonths()]);
      const recordMap = new Map<string, MonthRecord[]>();
      await Promise.all(monthList.map(async (m) => {
        const r = await getMonthRecords(m.id);
        recordMap.set(m.id, r);
      }));
      if (!cancelled) { setBaseDeals(deals); setAllMonthRecords(recordMap); setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (activeMonthId) setSelectedMonth(activeMonthId);
  }, [activeMonthId]);

  const sortedMonths = useMemo(() => [...months].sort((a, b) => b.id.localeCompare(a.id)), [months]);

  const dealsForMonth = useMemo((): Deal[] => {
    const monthRecords = allMonthRecords.get(selectedMonth) ?? [];
    const cumulativeInstalMap = new Map<string, number>();
    const cumulativeReceivedMap = new Map<string, number>();
    allMonthRecords.forEach((records, mId) => {
      if (mId <= selectedMonth) {
        records.forEach((r) => {
          cumulativeInstalMap.set(r.dealId, (cumulativeInstalMap.get(r.dealId) ?? 0) + (r.receipts?.reduce((s, rec) => s + rec.installments, 0) ?? 0));
          cumulativeReceivedMap.set(r.dealId, (cumulativeReceivedMap.get(r.dealId) ?? 0) + (r.received ?? 0));
        });
      }
    });

    const currentMap = new Map(monthRecords.map((r) => [r.dealId, r]));
    const merged = baseDeals.map((d) => {
      const r = currentMap.get(d.id);
      const effectiveInstalment = d.instalment > 0 ? d.instalment : calcInstalment(d.invested, d.months);
      const dealTotal = d.total > 0 ? d.total : effectiveInstalment * d.months;
      const cumulativeReceived = cumulativeReceivedMap.get(d.id) ?? 0;
      const remaining = Math.max(0, dealTotal - cumulativeReceived);
      const recovered = Math.max(0, dealTotal - remaining);
      return {
        ...d,
        received: cumulativeReceivedMap.get(d.id) ?? 0,
        instalRcvd: cumulativeInstalMap.get(d.id) ?? 0,
        receipts: r?.receipts ?? [],
        snapshotRecovered: r?.snapshotRecovered ?? null,
        snapshotRemaining: r?.snapshotRemaining ?? null,
        recoveredAmount: recovered,
        remainingAmount: remaining,
      };
    });
    return recalculateDeals(merged);
  }, [baseDeals, allMonthRecords, selectedMonth]);

  const thisMonthRecords = useMemo(() => allMonthRecords.get(selectedMonth) ?? [], [allMonthRecords, selectedMonth]);

  const thisMonthRecordMap = useMemo(
    () => new Map(thisMonthRecords.map((r) => [r.dealId, r])),
    [thisMonthRecords]
  );

  const thisMonthReceivedMap = useMemo(
    () => new Map(thisMonthRecords.map((r) => [r.dealId, r.received ?? 0])),
    [thisMonthRecords]
  );

  const isReceivedThisMonth = useCallback((dealId: string) => {
    const rec = thisMonthRecordMap.get(dealId);
    return (rec?.received ?? 0) > 0 || (rec?.receipts?.length ?? 0) > 0;
  }, [thisMonthRecordMap]);

  const referralOptions = useMemo(() => {
    const vals = new Set(dealsForMonth.map((d) => d.referral).filter(Boolean));
    return ["all", ...Array.from(vals)];
  }, [dealsForMonth]);

  // ── FIX: Filter deals by deal date vs selected month (same logic as cards view) ──
  const visibleDeals = useMemo(() => {
    if (!selectedMonth) return dealsForMonth;
    return dealsForMonth.filter((d) => {
      // Never show a deal in a month before its deal date
      const dealMonthId = (d.dealDate || d.createdAt || "").slice(0, 7);
      if (dealMonthId && dealMonthId > selectedMonth) return false;

      // Hide completed deals unless they received a payment this month
      if (d.remainingAmount <= 0) return isReceivedThisMonth(d.id);
      return true;
    });
  }, [dealsForMonth, selectedMonth, isReceivedThisMonth]);

  const filteredDeals = useMemo(() => {
    const low = filterText.trim().toLowerCase();
    return visibleDeals.filter((d) => {
      if (filterReferral !== "all" && d.referral !== filterReferral) return false;
      const receivedThisMonth = isReceivedThisMonth(d.id);
      if (filterStatus === "received" && !receivedThisMonth) return false;
      if (filterStatus === "pending" && receivedThisMonth) return false;
      if (!low) return true;
      return [d.customer, d.dealNo, d.mobileNo, d.referral].map((v) => String(v).toLowerCase()).join(" ").includes(low);
    });
  }, [visibleDeals, filterText, filterReferral, filterStatus, isReceivedThisMonth]);

  const getCellValue = useCallback((deal: Deal, key: string, rowIdx: number): string => {
    if (key === "rowNum") return String(rowIdx + 1);
    if (key === "dealDate") return deal.dealDate ? deal.dealDate.slice(0, 10) : "";
    if (key === "received") {
      const v = thisMonthReceivedMap.get(deal.id);
      return v != null && v > 0 ? currency(v) : "";
    }
    if (["invested", "total", "instalment", "recoveredAmount", "remainingAmount"].includes(key)) {
      const v = (deal as unknown as Record<string, unknown>)[key] as number;
      return v != null && v !== 0 ? currency(v) : "";
    }
    if (key === "profitPct") {
      const v = deal.profitPct;
      return v != null ? `${v.toFixed(2)}%` : "";
    }
    const v = (deal as unknown as Record<string, unknown>)[key];
    return v != null ? String(v) : "";
  }, [thisMonthReceivedMap]);

  const startEdit = (rowIdx: number, colIdx: number, deal: Deal) => {
    const col = COLS[colIdx];
    if (!col.editable) return;
    setEditing({ row: rowIdx, col: colIdx });
    setSelected({ row: rowIdx, col: colIdx });
    const raw = (deal as unknown as Record<string, unknown>)[col.key];
    setEditVal(col.key === "dealDate" ? (deal.dealDate?.slice(0, 10) ?? "") : String(raw ?? ""));
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commitEdit = useCallback(async () => {
    if (!editing) return;
    const deal = filteredDeals[editing.row];
    if (!deal) { setEditing(null); return; }
    const col = COLS[editing.col];
    const now = new Date().toISOString();
    const updatedBase: BaseDeal = { ...deal };
    delete (updatedBase as Partial<Deal>).received;
    delete (updatedBase as Partial<Deal>).receipts;
    delete (updatedBase as Partial<Deal>).snapshotRecovered;
    delete (updatedBase as Partial<Deal>).snapshotRemaining;

    const k = col.key as keyof BaseDeal;
    if (col.type === "number") {
      (updatedBase as Record<string, unknown>)[k] = parseFloat(editVal) || 0;
    } else if (col.key === "dealDate") {
      (updatedBase as Record<string, unknown>)[k] = editVal ? new Date(editVal).toISOString() : "";
    } else {
      (updatedBase as Record<string, unknown>)[k] = editVal;
    }
    updatedBase.updatedAt = now;

    const inst = calcInstalment(updatedBase.invested, updatedBase.months);
    if (!updatedBase.instalment || updatedBase.instalment === deal.instalment) updatedBase.instalment = inst;
    const total = updatedBase.instalment * updatedBase.months;
    updatedBase.total = total;

    const nextDeals = baseDeals.map((d) => d.id === deal.id ? updatedBase : d);
    setBaseDeals(nextDeals);
    await saveBaseDeal(updatedBase);
    setEditing(null);
  }, [editing, filteredDeals, editVal, baseDeals]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); void commitEdit(); }
    if (e.key === "Escape") setEditing(null);
  };

  const handleGridKeyDown = (e: React.KeyboardEvent) => {
    if (!selected || editing) return;
    const { row, col } = selected;
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected({ row: Math.min(filteredDeals.length - 1, row + 1), col }); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelected({ row: Math.max(0, row - 1), col }); }
    if (e.key === "ArrowRight") { e.preventDefault(); setSelected({ row, col: Math.min(COLS.length - 1, col + 1) }); }
    if (e.key === "ArrowLeft") { e.preventDefault(); setSelected({ row, col: Math.max(0, col - 1) }); }
    if (e.key === "Enter" || e.key === "F2") {
      const deal = filteredDeals[row];
      if (deal) startEdit(row, col, deal);
    }
  };

  const nameBarCol = selected ? colLetter(selected.col + 1) : "";
  const nameBarRow = selected ? selected.row + 2 : "";
  const nameBarValue = selected && !editing
    ? (filteredDeals[selected.row] ? getCellValue(filteredDeals[selected.row], COLS[selected.col].key, selected.row) : "")
    : editVal;

  if (loading) return <div style={{ padding: 24, color: "#666" }}>Loading...</div>;

  return (
    <div className="excel-wrap" tabIndex={0} onKeyDown={handleGridKeyDown} ref={gridRef}>
      {/* Ribbon */}
      <div className="excel-ribbon">
        <div className="excel-ribbon__group">
          <label className="excel-ribbon__label">Month</label>
          <select className="excel-ribbon__sel" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
            {sortedMonths.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <div className="excel-ribbon__group">
          <label className="excel-ribbon__label">Search</label>
          <input className="excel-ribbon__input" placeholder="Filter rows…" value={filterText} onChange={(e) => setFilterText(e.target.value)} />
        </div>
        <div className="excel-ribbon__group">
          <label className="excel-ribbon__label">Referral</label>
          <select className="excel-ribbon__sel" value={filterReferral} onChange={(e) => setFilterReferral(e.target.value)}>
            {referralOptions.map((o) => <option key={o} value={o}>{o === "all" ? "All" : o}</option>)}
          </select>
        </div>
        <div className="excel-ribbon__group">
          <label className="excel-ribbon__label">Status</label>
          <select className="excel-ribbon__sel" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}>
            <option value="all">All</option>
            <option value="received">Received</option>
            <option value="pending">Pending</option>
          </select>
        </div>
        <div className="excel-ribbon__info">
          {filteredDeals.length} rows
        </div>
      </div>

      {/* Name bar */}
      <div className="excel-namebar">
        <div className="excel-namebar__ref">{selected ? `${nameBarCol}${nameBarRow}` : "A1"}</div>
        <div className="excel-namebar__divider" />
        <div className="excel-namebar__value">{nameBarValue}</div>
      </div>

      {/* Grid */}
      <div className="excel-scroll">
        <div className="excel-table">
          {/* Column headers */}
          <div className="excel-row excel-row--header">
            <div className="excel-row-num-header" />
            {COLS.map((col, ci) => (
              <div
                key={col.key}
                className={`excel-col-header${selected?.col === ci ? " excel-col-header--sel" : ""}`}
                style={{ flex: col.flex, minWidth: 60 }}
              >
                <span className="excel-col-letter">{colLetter(ci + 1)}</span>
                <span className="excel-col-name">{col.label}</span>
                {!col.editable && <span className="excel-col-lock">🔒</span>}
              </div>
            ))}
          </div>

          {filteredDeals.length === 0 ? (
            <div className="excel-empty">No deals found for this month / filter.</div>
          ) : filteredDeals.map((deal, rowIdx) => (
            <div
              key={deal.id}
              className={`excel-row${rowIdx % 2 === 1 ? " excel-row--alt" : ""}${selected?.row === rowIdx ? " excel-row--selected" : ""}`}
            >
              <div className={`excel-row-num${selected?.row === rowIdx ? " excel-row-num--sel" : ""}`}>{rowIdx + 2}</div>

              {COLS.map((col, ci) => {
                const colIdx = ci;
                const isSel = selected?.row === rowIdx && selected?.col === colIdx;
                const isEdit = editing?.row === rowIdx && editing?.col === colIdx;
                const val = getCellValue(deal, col.key, rowIdx);
                const isReceived = col.key === "received";
                const isEmpty = isReceived && !val;

                return (
                  <div
                    key={col.key}
                    className={`excel-cell${isSel ? " excel-cell--sel" : ""}${col.editable ? " excel-cell--editable" : " excel-cell--readonly"}${isEmpty ? " excel-cell--empty" : ""}${isReceived && val ? " excel-cell--received" : ""}`}
                    style={{ flex: col.flex, minWidth: 60 }}
                    onClick={() => { setSelected({ row: rowIdx, col: colIdx }); }}
                    onDoubleClick={() => startEdit(rowIdx, colIdx, deal)}
                  >
                    {isEdit ? (
                      <input
                        ref={inputRef}
                        className="excel-cell__input"
                        type={col.type === "date" ? "date" : col.type === "number" ? "number" : "text"}
                        value={editVal}
                        onChange={(e) => setEditVal(e.target.value)}
                        onBlur={() => void commitEdit()}
                        onKeyDown={handleKeyDown}
                      />
                    ) : (
                      <span className="excel-cell__val">{val}</span>
                    )}
                    {isSel && !isEdit && <div className="excel-cell__sel-dot" />}
                  </div>
                );
              })}
            </div>
          ))}

          {/* Totals row */}
          {filteredDeals.length > 0 && (
            <div className="excel-row excel-row--totals">
              <div className="excel-row-num" style={{ fontWeight: 700 }}>Σ</div>
              {COLS.map((col) => {
                const numCols = ["invested", "total", "instalment", "recoveredAmount", "remainingAmount", "instalRcvd"];
                const rcvdCols = ["received"];
                let val = "";
                if (numCols.includes(col.key)) {
                  const sum = filteredDeals.reduce((s, d) => s + ((d as unknown as Record<string, number>)[col.key] || 0), 0);
                  val = sum ? currency(sum) : "";
                } else if (rcvdCols.includes(col.key)) {
                  const sum = filteredDeals.reduce((s, d) => s + (thisMonthReceivedMap.get(d.id) ?? 0), 0);
                  val = sum ? currency(sum) : "";
                }
                return (
                  <div key={col.key} className="excel-cell excel-cell--total" style={{ flex: col.flex, minWidth: 60 }}>
                    <span className="excel-cell__val">{val}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="excel-statusbar">
        <span>Ready</span>
        <span>{filteredDeals.length} rows · {selectedMonth}</span>
        {selected && <span>Cell: {colLetter(selected.col + 1)}{selected.row + 2} · Double-click or F2 to edit</span>}
      </div>
    </div>
  );
}
