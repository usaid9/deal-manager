import { useEffect, useMemo, useState } from "react";
import type { Deal, FormulaTemplates, MonthRecord } from "../lib/types";
import { calcInstalment, calcTotal, calcProfitPct, calcRemaining, calcRecovered } from "../lib/compute";
import { getAllRecordsForDeal } from "../lib/api";

const currency = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });
const fmt = (n: number) => currency.format(n);

type Props = {
  mode: "view" | "new";
  open: boolean;
  variant?: "panel" | "page";
  deal: Deal | null;
  formulas: FormulaTemplates;
  onClose: () => void;
  onSave: (deal: Deal) => void;
  onAddReceipt: (dealId: string) => void;
  onDeleteReceipt?: (dealId: string, monthId: string, receiptId: string) => void | Promise<void>;
  onDelete?: (dealId: string) => void;
};

type ReceiptItem = {
  key: string;
  monthId: string;
  label: string;
  receiptId: string;
  amount: number;
  installments: number;
  receivedAt: string;
  note?: string;
};

type ReceiptGroup = {
  monthId: string;
  label: string;
  total: number;
  installments: number;
  items: ReceiptItem[];
};

const emptyDeal = (): Deal => {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), dealNo: "", dealDate: "", invested: 0, months: 0, total: 0,
    customer: "", mobileNo: "", referral: "", instalment: 0, received: 0, instalRcvd: 0,
    profitPct: 0, recoveredAmount: 0, remainingAmount: 0,
    useManualBalance: false, manualRecovered: null, manualRemaining: null,
    receipts: [], snapshotRecovered: null, snapshotRemaining: null, createdAt: now, updatedAt: now
  };
};

export default function DealDrawer({ mode, open, variant = "panel", deal, onClose, onSave, onAddReceipt, onDeleteReceipt, onDelete }: Props) {
  const [draft, setDraft] = useState<Deal>(emptyDeal());
  const [editing, setEditing] = useState(false);
  const [customInstalment, setCustomInstalment] = useState(false);
  const [allRecords, setAllRecords] = useState<MonthRecord[]>([]);
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedReceiptKeys, setSelectedReceiptKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!open) { setEditing(false); setAllRecords([]); setDeleteMode(false); setSelectedReceiptKeys([]); return; }
    if (deal) {
      setDraft({ ...deal });
      const auto = calcInstalment(deal.invested, deal.months);
      setCustomInstalment(deal.instalment > 0 && Math.abs(deal.instalment - auto) > 0.01);
      getAllRecordsForDeal(deal.id).then(setAllRecords).catch(() => setAllRecords([]));
    } else if (mode === "new") {
      setDraft(emptyDeal()); setCustomInstalment(false); setEditing(true); setAllRecords([]); setDeleteMode(false); setSelectedReceiptKeys([]);
    }
  }, [open, deal, mode]);

  const computed = useMemo(() => {
    const invested = draft.invested || 0;
    const months = draft.months || 0;
    const instalRcvd = draft.instalRcvd || 0;
    const instalment = customInstalment && draft.instalment > 0 ? draft.instalment : calcInstalment(invested, months);
    const total = calcTotal(instalment, months);
    const profitPct = calcProfitPct(total, invested);
    let remaining: number, recovered: number;
    if (draft.useManualBalance) {
      if (draft.manualRemaining != null) { remaining = Math.max(0, draft.manualRemaining); recovered = Math.max(0, total - remaining); }
      else if (draft.manualRecovered != null) { recovered = Math.max(0, draft.manualRecovered); remaining = Math.max(0, total - recovered); }
      else { remaining = calcRemaining(instalment, months, instalRcvd); recovered = calcRecovered(total, remaining); }
    } else {
      remaining = draft.remainingAmount > 0 ? draft.remainingAmount : calcRemaining(instalment, months, instalRcvd);
      recovered = draft.recoveredAmount > 0 ? draft.recoveredAmount : calcRecovered(total, remaining);
    }
    return { instalment, total, profitPct, remaining, recovered };
  }, [draft, customInstalment]);

  const requiredMissing = useMemo(() => {
    const missing: string[] = [];
    const dealNoValue = typeof draft.dealNo === "string" ? draft.dealNo.trim() : String(draft.dealNo ?? "").trim();
    if (!dealNoValue) missing.push("Deal No");
    const dealDateValue = draft.dealDate ? draft.dealDate.slice(0, 10) : null;
    if (!dealDateValue || !/^\d{4}-\d{2}-\d{2}$/.test(dealDateValue)) missing.push("Deal Date");
    if (!draft.customer || !draft.customer.trim()) missing.push("Customer");
    if (!Number.isFinite(draft.invested) || draft.invested <= 0) missing.push("Invested");
    if (!Number.isFinite(draft.months) || draft.months <= 0) missing.push("Months");
    return missing;
  }, [draft.dealNo, draft.dealDate, draft.customer, draft.invested, draft.months]);

  // Receipt pills grouped by month
  const receiptMonths = useMemo(() => {
    const grouped: { monthId: string; label: string; amount: number; installments: number; receivedDates: string[] }[] = [];
    const seen = new Set<string>();
    for (const rec of allRecords) {
      if (!seen.has(rec.monthId) && rec.receipts.length > 0) {
        seen.add(rec.monthId);
        grouped.push({
          monthId: rec.monthId,
          label: new Date(rec.monthId + "-01").toLocaleString("en-US", { month: "short", year: "2-digit" }),
          amount: rec.receipts.reduce((s, r) => s + r.amount, 0),
          installments: rec.receipts.reduce((s, r) => s + (r.installments ?? 0), 0),
          receivedDates: rec.receipts.map((r) => new Date(r.receivedAt).toLocaleDateString("en-GB"))
        });
      }
    }
    if ((draft.receipts ?? []).length > 0 && allRecords.length === 0) {
      grouped.push({
        monthId: "current",
        label: "This month",
        amount: draft.receipts.reduce((s, r) => s + r.amount, 0),
        installments: draft.receipts.reduce((s, r) => s + (r.installments ?? 0), 0),
        receivedDates: draft.receipts.map((r) => new Date(r.receivedAt).toLocaleDateString("en-GB"))
      });
    }
    return grouped.sort((a, b) => b.monthId.localeCompare(a.monthId));
  }, [allRecords, draft.receipts]);

  const receiptItems = useMemo(() => {
    const items: ReceiptItem[] = [];
    if (allRecords.length > 0) {
      for (const rec of allRecords) {
        const label = new Date(rec.monthId + "-01").toLocaleString("en-US", { month: "short", year: "2-digit" });
        for (const r of rec.receipts) {
          items.push({
            key: `${rec.monthId}:${r.id}`,
            monthId: rec.monthId,
            label,
            receiptId: r.id,
            amount: r.amount,
            installments: r.installments ?? 0,
            receivedAt: r.receivedAt,
            note: r.note
          });
        }
      }
    } else if ((draft.receipts ?? []).length > 0) {
      for (const r of draft.receipts) {
        items.push({
          key: `current:${r.id}`,
          monthId: "current",
          label: "This month",
          receiptId: r.id,
          amount: r.amount,
          installments: r.installments ?? 0,
          receivedAt: r.receivedAt,
          note: r.note
        });
      }
    }
    return items.sort((a, b) => b.monthId.localeCompare(a.monthId) || b.receivedAt.localeCompare(a.receivedAt));
  }, [allRecords, draft.receipts]);

  const receiptGroups = useMemo(() => {
    const grouped = new Map<string, ReceiptGroup>();
    for (const item of receiptItems) {
      const existing = grouped.get(item.monthId);
      if (existing) {
        existing.items.push(item);
        existing.total += item.amount;
        existing.installments += item.installments;
      } else {
        grouped.set(item.monthId, {
          monthId: item.monthId,
          label: item.label,
          total: item.amount,
          installments: item.installments,
          items: [item]
        });
      }
    }
    return Array.from(grouped.values()).sort((a, b) => b.monthId.localeCompare(a.monthId));
  }, [receiptItems]);

  const receiptsTotal = receiptItems.reduce((sum, item) => sum + item.amount, 0);

  const deletableReceiptItems = receiptItems.filter((item) => item.monthId !== "current");

  if (!open) return null;

  const set = (field: keyof Deal, value: string | number | boolean | null) =>
    setDraft((c) => ({ ...c, [field]: value, updatedAt: new Date().toISOString() }));

  const handleSave = () => {
    if (requiredMissing.length > 0) return;
    onSave({ ...draft, instalment: computed.instalment, total: computed.total, profitPct: computed.profitPct, recoveredAmount: computed.recovered, remainingAmount: computed.remaining, updatedAt: new Date().toISOString() });
    setEditing(false);
  };

  const toggleManual = (enabled: boolean) => {
    setDraft((c) => ({ ...c, useManualBalance: enabled, manualRecovered: enabled ? (c.manualRecovered ?? computed.recovered) : null, manualRemaining: enabled ? (c.manualRemaining ?? computed.remaining) : null, updatedAt: new Date().toISOString() }));
  };

  const isPage = variant === "page";
  const isClosed = computed.remaining <= 0 && draft.months > 0;
  const receivedThisMonth = draft.received > 0 || (draft.receipts?.length ?? 0) > 0;
  const showForm = editing || mode === "new";

  return (
    <aside className={isPage ? "drawer drawer--page" : "drawer"} aria-hidden={!open}>
      <div className="drawer__header">
        <div>
          <span className="deal-card__customer">{draft.customer || "Untitled"}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="deal-card__deal-no">#{draft.dealNo}</span>
            <span className="deal-card__date">{draft.dealDate ? new Date(draft.dealDate + "T00:00:00").toLocaleDateString('en-GB') : ""}</span>
            <span className={`pill ${isClosed ? "pill--closed" : "pill--active"}`}>{isClosed ? "closed" : "active"}</span>
            <span className={`pill ${receivedThisMonth ? "pill--rcvd" : "pill--pending"}`}>{receivedThisMonth ? "received" : "pending"}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {mode === "view" && onDelete && (
            <button className="btn btn--danger" onClick={() => onDelete(draft.id)}>Delete</button>
          )}
          <button className="btn btn--ghost" onClick={onClose}>← Back</button>
        </div>
      </div>

      <div className="drawer__content">
        {mode === "view" && !showForm && (
          <>
            <div className="deal-card__grid">
              <div className="deal-card__grid-row">
                <div className="deal-card__grid-item">
                  <span className="deal-card__label">Invested</span>
                  <span className="deal-card__value">{fmt(draft.invested)}</span>
                </div>
                <div className="deal-card__grid-item">
                  <span className="deal-card__label">Recoverable</span>
                  <span className="deal-card__value">{fmt(computed.total)}</span>
                </div>
                <div className="deal-card__grid-item">
                  <span className="deal-card__label">Recovered</span>
                  <span className="deal-card__value">{fmt(computed.recovered)}</span>
                </div>
              </div>
              <div className="deal-card__grid-row">
                <div className="deal-card__grid-item">
                  <span className="deal-card__label">Instalment</span>
                  <span className="deal-card__value">{fmt(computed.instalment)}</span>
                </div>
                <div className="deal-card__grid-item">
                  <span className="deal-card__label">Instal Rcvd</span>
                  <span className="deal-card__value">{draft.instalRcvd}/{draft.months}</span>
                </div>
                <div className="deal-card__grid-item">
                  <span className="deal-card__label">Remaining</span>
                  <span className="deal-card__value">{fmt(computed.remaining)}</span>
                </div>
              </div>
              <div className="deal-card__grid-row">
                <div className="deal-card__grid-item">
                  <span className="deal-card__label">Contact No.</span>
                  <span className="deal-card__value">{draft.mobileNo}</span>
                </div>
                <div className="deal-card__grid-item">
                  <span className="deal-card__label">Referral</span>
                  <span className="deal-card__value">{draft.referral}</span>
                </div>
                <div className="deal-card__grid-item">
                  <span className="deal-card__label">Profit %</span>
                  <span className="deal-card__value">{computed.profitPct.toFixed(2)}%</span>
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: "auto" }}>
              {receiptItems.length > 0 && (
                <section>
                  <div className="drawer__receipts-header">
                    <span className="deal-card__label">Receipts</span>
                    <span className="drawer__receipts-total">{fmt(receiptsTotal)}</span>
                  </div>
                  {receiptGroups.map((group) => (
                    <div key={group.monthId} className="receipt-group">
                      <div className="receipt-group__header">
                        <span>{group.label}</span>
                        <span>{group.installments} inst · {fmt(group.total)}</span>
                      </div>
                      <ul className="receipt-list">
                        {group.items.map((item) => (
                          <li key={item.key}>
                            <p className="receipt-amount">
                              {fmt(item.amount)} · {new Date(item.receivedAt).toLocaleDateString("en-GB")} · {item.installments} inst
                            </p>
                            {item.note && <p className="receipt-note">{item.note}</p>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              )}
              {receiptMonths.length > 0 && (
                <section className="receipt-pills-section">
                  <p className="receipt-pills-label">receipts</p>
                  <div className="receipt-pills">
                    {receiptMonths.map((m) => (
                      <span key={m.monthId} className="receipt-pill">
                        {m.label} · {m.receivedDates.join(", ")} · {m.installments} inst · {fmt(m.amount)}
                      </span>
                    ))}
                  </div>
                  {onDeleteReceipt && receiptItems.length > 0 && (
                    <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
                      <button
                        className="btn btn--danger"
                        style={{ justifySelf: "flex-start" }}
                        onClick={() => {
                          setDeleteMode((v) => !v);
                          setSelectedReceiptKeys([]);
                        }}
                      >Delete receipts</button>
                      {deleteMode && (
                        <div style={{ display: "grid", gap: 6 }}>
                          {deletableReceiptItems.length === 0 && (
                            <p className="deal-card__label">No receipts available to delete.</p>
                          )}
                          {deletableReceiptItems.map((item) => (
                            <label key={item.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <input
                                type="checkbox"
                                checked={selectedReceiptKeys.includes(item.key)}
                                onChange={() => {
                                  setSelectedReceiptKeys((prev) =>
                                    prev.includes(item.key)
                                      ? prev.filter((k) => k !== item.key)
                                      : [...prev, item.key]
                                  );
                                }}
                              />
                              <span style={{ fontSize: 12 }}>
                                {item.label} · {new Date(item.receivedAt).toLocaleDateString("en-GB")} · {item.installments} inst · {fmt(item.amount)}
                                {item.note ? ` - ${item.note}` : ""}
                              </span>
                            </label>
                          ))}
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              className="btn btn--ghost"
                              onClick={() => { setDeleteMode(false); setSelectedReceiptKeys([]); }}
                            >Cancel</button>
                            <button
                              className="btn btn--danger"
                              disabled={selectedReceiptKeys.length === 0}
                              onClick={() => {
                                if (!onDeleteReceipt) return;
                                const selectedItems = deletableReceiptItems.filter((item) => selectedReceiptKeys.includes(item.key));
                                if (selectedItems.length === 0) return;
                                if (!window.confirm("Delete selected receipts?")) return;
                                void (async () => {
                                  for (const item of selectedItems) {
                                    await onDeleteReceipt(draft.id, item.monthId, item.receiptId);
                                  }
                                  setDeleteMode(false);
                                  setSelectedReceiptKeys([]);
                                })();
                              }}
                            >Delete selected</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn--primary" style={{ flex: 1 }} onClick={() => onAddReceipt(draft.id)}>+ Add Receipt</button>
                <button className="btn btn--ghost" onClick={() => setEditing(true)}>Edit</button>
              </div>
            </div>
          </>
        )}

        {showForm && (
          <>
            {mode === "view" && (
              <button className="btn btn--ghost" style={{ alignSelf: "flex-start", marginBottom: 4 }} onClick={() => setEditing(false)}>
                ← Back to summary
              </button>
            )}
            <div className="form-grid">
              <label>Deal No<input required value={draft.dealNo} onChange={(e) => set("dealNo", e.target.value)} /></label>
              <label>Deal Date<input required type="date" value={draft.dealDate ? draft.dealDate.slice(0, 10) : ""} onChange={(e) => set("dealDate", e.target.value)} /></label>
              <label>Customer<input required value={draft.customer} onChange={(e) => set("customer", e.target.value)} /></label>
              <label>Mobile No<input value={draft.mobileNo} onChange={(e) => set("mobileNo", e.target.value)} /></label>
              <label>Referral<input value={draft.referral} onChange={(e) => set("referral", e.target.value)} /></label>
              <label>Invested<input required min={1} type="number" value={draft.invested || ""} onChange={(e) => { set("invested", Number(e.target.value)); if (!customInstalment) set("instalment", 0); }} /></label>
              <label>Months<input required min={1} type="number" value={draft.months || ""} onChange={(e) => { set("months", Number(e.target.value)); if (!customInstalment) set("instalment", 0); }} /></label>
              <label style={{ gridColumn: "1 / -1" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span>Instalment</span>
                  <label className="toggle" style={{ fontSize: "0.8rem", gap: 6 }}>
                    <input type="checkbox" checked={customInstalment} onChange={(e) => { setCustomInstalment(e.target.checked); if (!e.target.checked) set("instalment", 0); }} />
                    <span>Custom</span>
                  </label>
                </div>
                <input type="number"
                  value={customInstalment ? (draft.instalment || "") : (computed.instalment || "")}
                  readOnly={!customInstalment}
                  style={{ background: customInstalment ? undefined : "var(--surface-2)", cursor: customInstalment ? "text" : "default" }}
                  onChange={(e) => { if (customInstalment) set("instalment", Number(e.target.value)); }} />
              </label>
              <label>Instal Rcvd<input type="number" value={draft.instalRcvd || ""} onChange={(e) => set("instalRcvd", Number(e.target.value))} /></label>
            </div>

            {(draft.invested > 0 || draft.months > 0) && (
              <div className="drawer__formula">
                {[["Recoverable", fmt(computed.total)], ["Profit %", `${computed.profitPct.toFixed(2)}%`],
                  ["Recovered", fmt(computed.recovered)], ["Remaining", fmt(computed.remaining)]].map(([l, v]) => (
                  <div key={l}><p className="deal-card__label">{l}</p><p className="drawer__value">{v}</p></div>
                ))}
              </div>
            )}

            <div className="manual-balance">
              <label className="toggle">
                <input type="checkbox" checked={draft.useManualBalance === true} onChange={(e) => toggleManual(e.target.checked)} />
                <span>Manual balance override</span>
              </label>
              {draft.useManualBalance && (
                <div className="manual-balance__grid">
                  <label>Recovered<input type="number" value={draft.manualRecovered ?? ""} onChange={(e) => { const v = Number(e.target.value); setDraft((c) => ({ ...c, manualRecovered: v, manualRemaining: Math.max(0, computed.total - v), updatedAt: new Date().toISOString() })); }} /></label>
                  <label>Remaining<input type="number" value={draft.manualRemaining ?? ""} onChange={(e) => { const v = Number(e.target.value); setDraft((c) => ({ ...c, manualRemaining: v, manualRecovered: Math.max(0, computed.total - v), updatedAt: new Date().toISOString() })); }} /></label>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {showForm && (
        <div className="drawer__footer">
          {requiredMissing.length > 0 && (
            <span className="deal-card__label" style={{ color: "#991b1b", marginRight: "auto" }}>
              Required: {requiredMissing.join(", ")}.
            </span>
          )}
          <button className="btn btn--ghost" onClick={() => mode === "new" ? onClose() : setEditing(false)}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={requiredMissing.length > 0}>Save deal</button>
        </div>
      )}
    </aside>
  );
}
