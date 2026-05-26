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
  onDelete?: (dealId: string) => void;
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

export default function DealDrawer({ mode, open, variant = "panel", deal, onClose, onSave, onAddReceipt, onDelete }: Props) {
  const [draft, setDraft] = useState<Deal>(emptyDeal());
  const [editing, setEditing] = useState(false);
  const [customInstalment, setCustomInstalment] = useState(false);
  const [allRecords, setAllRecords] = useState<MonthRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (!open) { setEditing(false); setAllRecords([]); setDetailsOpen(false); return; }
    if (deal) {
      setDraft({ ...deal });
      const auto = calcInstalment(deal.invested, deal.months);
      setCustomInstalment(deal.instalment > 0 && Math.abs(deal.instalment - auto) > 0.01);
      setLoadingRecords(true);
      getAllRecordsForDeal(deal.id).then(setAllRecords).catch(() => setAllRecords([])).finally(() => setLoadingRecords(false));
    } else if (mode === "new") {
      setDraft(emptyDeal()); setCustomInstalment(false); setEditing(true); setAllRecords([]);
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

  // Receipt pills grouped by month
  const receiptMonths = useMemo(() => {
    const grouped: { monthId: string; label: string; amount: number; installments: number }[] = [];
    const seen = new Set<string>();
    for (const rec of allRecords) {
      if (!seen.has(rec.monthId) && rec.receipts.length > 0) {
        seen.add(rec.monthId);
        grouped.push({
          monthId: rec.monthId,
          label: new Date(rec.monthId + "-01").toLocaleString("en-US", { month: "short", year: "2-digit" }),
          amount: rec.receipts.reduce((s, r) => s + r.amount, 0),
          installments: rec.receipts.reduce((s, r) => s + (r.installments ?? 0), 0)
        });
      }
    }
    if ((draft.receipts ?? []).length > 0 && allRecords.length === 0) {
      grouped.push({
        monthId: "current",
        label: "This month",
        amount: draft.receipts.reduce((s, r) => s + r.amount, 0),
        installments: draft.receipts.reduce((s, r) => s + (r.installments ?? 0), 0)
      });
    }
    return grouped.sort((a, b) => b.monthId.localeCompare(a.monthId));
  }, [allRecords, draft.receipts]);

  if (!open) return null;

  const set = (field: keyof Deal, value: string | number | boolean | null) =>
    setDraft((c) => ({ ...c, [field]: value, updatedAt: new Date().toISOString() }));

  const handleSave = () => {
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
          <p className="drawer__eyebrow">{mode === "new" ? "New deal" : `Deal #${draft.dealNo}`}</p>
          <h2 style={{ margin: "2px 0 6px" }}>{draft.customer || "Untitled"}</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="deal-card__deal-no">#{draft.dealNo}</span>
            {draft.dealDate && (
              <span className="deal-card__date">{new Date(draft.dealDate).toLocaleDateString("en-GB")}</span>
            )}
            {mode === "view" && (
              <>
                <span className={`pill ${isClosed ? "pill--closed" : "pill--active"}`}>{isClosed ? "closed" : "active"}</span>
                <span className={`pill ${receivedThisMonth ? "pill--rcvd" : "pill--pending"}`}>{receivedThisMonth ? "received" : "pending"}</span>
              </>
            )}
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
            {/* Primary stats — always visible */}
            <div className="deal-primary-stats">
              <div className="dps-cell">
                <p className="dps-label">Invested</p>
                <p className="dps-value">{fmt(draft.invested)}</p>
              </div>
              <div className="dps-cell">
                <p className="dps-label">Total</p>
                <p className="dps-value">{fmt(computed.total)}</p>
              </div>
              <div className="dps-cell">
                <p className="dps-label">Instalment</p>
                <p className="dps-value">{fmt(computed.instalment)}</p>
              </div>
              <div className="dps-cell">
                <p className="dps-label">Instals Rcvd</p>
                <p className="dps-value">{draft.instalRcvd}</p>
              </div>
              {draft.dealDate && (
                <div className="dps-cell">
                  <p className="dps-label">Date</p>
                  <p className="dps-value">{new Date(draft.dealDate).toLocaleDateString()}</p>
                </div>
              )}
            </div>

            {/* Collapsible further details */}
            <button className="details-toggle" onClick={() => setDetailsOpen((o) => !o)}>
              {detailsOpen ? "▲ Hide details" : "▼ More details"}
            </button>
            {detailsOpen && (
              <div className="deal-summary">
                {[
                  ["Profit %", `${computed.profitPct.toFixed(2)}%`],
                  ["Recovered", fmt(computed.recovered)],
                  ["Remaining", fmt(computed.remaining), true],
                  ...(draft.mobileNo ? [["Mobile", draft.mobileNo]] : []),
                  ...(draft.referral ? [["Referral", draft.referral]] : []),
                ].map(([label, value, accent]) => (
                  <Row key={label as string} label={label as string} value={value as string} accent={Boolean(accent)} />
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn--primary" style={{ flex: 1 }} onClick={() => onAddReceipt(draft.id)}>+ Add Receipt</button>
              <button className="btn btn--ghost" onClick={() => setEditing(true)}>Edit</button>
            </div>

            {/* Receipt pills */}
            <div className="receipt-pills-section">
              <p className="receipt-pills-label">
                Receipts
                {loadingRecords && <span className="muted"> (loading…)</span>}
              </p>
              {receiptMonths.length === 0 && !loadingRecords ? (
                <p className="muted" style={{ fontSize: 13 }}>No receipts yet.</p>
              ) : (
                <div className="receipt-pills">
                  {receiptMonths.map((g) => (
                    <span key={g.monthId} className="receipt-pill" title={fmt(g.amount)}>
                      {g.label} · {g.installments} inst · {fmt(g.amount)}
                    </span>
                  ))}
                </div>
              )}
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
              <label>Deal No<input value={draft.dealNo} onChange={(e) => set("dealNo", e.target.value)} /></label>
              <label>Deal Date<input type="date" value={draft.dealDate ? draft.dealDate.slice(0, 10) : ""} onChange={(e) => set("dealDate", e.target.value)} /></label>
              <label>Customer<input value={draft.customer} onChange={(e) => set("customer", e.target.value)} /></label>
              <label>Mobile No<input value={draft.mobileNo} onChange={(e) => set("mobileNo", e.target.value)} /></label>
              <label>Referral<input value={draft.referral} onChange={(e) => set("referral", e.target.value)} /></label>
              <label>Invested<input type="number" value={draft.invested || ""} onChange={(e) => { set("invested", Number(e.target.value)); if (!customInstalment) set("instalment", 0); }} /></label>
              <label>Months<input type="number" value={draft.months || ""} onChange={(e) => { set("months", Number(e.target.value)); if (!customInstalment) set("instalment", 0); }} /></label>
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
                {[["Total", fmt(computed.total)], ["Profit %", `${computed.profitPct.toFixed(2)}%`],
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
          <button className="btn btn--ghost" onClick={() => mode === "new" ? onClose() : setEditing(false)}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave}>Save deal</button>
        </div>
      )}
    </aside>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`deal-summary__row${accent ? " deal-summary__row--accent" : ""}`}>
      <span>{label}</span><strong>{value}</strong>
    </div>
  );
}