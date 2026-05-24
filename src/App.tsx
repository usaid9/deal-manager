import { useEffect, useMemo, useState } from "react";
import DealCard from "./components/DealCard";
import DealDrawer from "./components/DealDrawer";
import Modal from "./components/Modal";
import { recalculateDeals, calcInstalment } from "./lib/compute";
import {
  createNextMonth, deleteDealEverywhere, getActiveMonthId, getBaseDeals,
  getFormulas, getMonthRecords, getMonths, propagateSnapshotForward,
  saveBaseDeals, saveBaseDeal, saveMonthRecord, saveMonthRecords,
  setActiveMonthId, setFormulas, deleteMonth
} from "./lib/api";
import { loadDealsFromExcel } from "./lib/excel";
import { DEFAULT_FORMULAS } from "./lib/formulas";
import type { BaseDeal, Deal, FormulaTemplates, MonthMeta, MonthRecord } from "./lib/types";

const currency = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });

// ── In-memory cache (survives back-navigation within the same tab) ──────────
const _cache: {
  baseDeals?: BaseDeal[];
  months?: MonthMeta[];
  activeMonthId?: string;
  monthRecords: Record<string, MonthRecord[]>;
} = { monthRecords: {} };

const cache = {
  get baseDeals() { return _cache.baseDeals; },
  set baseDeals(v) { _cache.baseDeals = v; },
  get months() { return _cache.months; },
  set months(v) { _cache.months = v; },
  get activeMonthId() { return _cache.activeMonthId; },
  set activeMonthId(v) { _cache.activeMonthId = v; },
  getRecords(monthId: string) { return _cache.monthRecords[monthId]; },
  setRecords(monthId: string, v: MonthRecord[]) { _cache.monthRecords[monthId] = v; },
  invalidateRecords(monthId: string) { delete _cache.monthRecords[monthId]; },
};

const monthIdForDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const monthLabelForDate = (d: Date) =>
  d.toLocaleString("en-US", { month: "short", year: "numeric" });

type ReceiptDraft = { amount: number; receivedAt: string; note: string; installments: number; targetMonthId: string };
const emptyReceipt = (monthId: string | null): ReceiptDraft => ({
  amount: 0, receivedAt: new Date().toISOString().slice(0, 10), note: "", installments: 1,
  targetMonthId: monthId ?? ""
});

export default function App() {
  const [baseDeals, setBaseDeals] = useState<BaseDeal[]>([]);
  const [monthRecords, setMonthRecords] = useState<MonthRecord[]>([]);
  const [months, setMonths] = useState<MonthMeta[]>([]);
  const [activeMonthId, setActiveMonthState] = useState<string | null>(null);
  const [formulas, setFormulaState] = useState<FormulaTemplates>(DEFAULT_FORMULAS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [referralFilter, setReferralFilter] = useState("all");
  const [receiptFilter, setReceiptFilter] = useState<"all" | "received" | "pending">("all");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"view" | "new">("view");
  const [drawerDealId, setDrawerDealId] = useState<string | null>(null);

  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptDealId, setReceiptDealId] = useState<string | null>(null);
  const [receiptDraft, setReceiptDraft] = useState<ReceiptDraft>(emptyReceipt(null));
  const [formWarning, setFormWarning] = useState<string | null>(null);

  const [addMonthOpen, setAddMonthOpen] = useState(false);
  const [addMonthInput, setAddMonthInput] = useState("");
  const [addMonthError, setAddMonthError] = useState<string | null>(null);

  const { detailDealId, detailMonthId } = useMemo(() => {
    if (typeof window === "undefined") return { detailDealId: null, detailMonthId: null };
    const p = new URLSearchParams(window.location.search);
    return { detailDealId: p.get("dealId"), detailMonthId: p.get("monthId") };
  }, []);

  const detailMode = Boolean(detailDealId);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        // If cache is warm (back-navigation), use it immediately — no DB round-trips
        if (cache.baseDeals && cache.months && cache.activeMonthId) {
          const monthId = detailMonthId || cache.activeMonthId;
          const cachedRecords = cache.getRecords(monthId);
          if (!cancelled) {
            setBaseDeals(cache.baseDeals);
            setMonths(cache.months);
            setActiveMonthState(monthId);
            setMonthRecords(cachedRecords ?? []);
            setLoading(false);
            // If records weren't cached yet for this month, fetch them quietly
            if (!cachedRecords) {
              const records = await getMonthRecords(monthId);
              cache.setRecords(monthId, records);
              if (!cancelled) setMonthRecords(records);
            }
          }
          return;
        }

        const storedFormulas = await getFormulas();
        if (storedFormulas) setFormulaState({ ...DEFAULT_FORMULAS, ...storedFormulas });
        let monthList = await getMonths();
        let monthId = detailMonthId || (await getActiveMonthId()) || null;
        if (!monthId) {
          const now = new Date();
          monthId = monthIdForDate(now);
          if (!monthList.find((m) => m.id === monthId)) {
            await createNextMonth("", monthId, monthLabelForDate(now));
            monthList = await getMonths();
          }
          await setActiveMonthId(monthId);
        }
        const storedBaseDeals = await getBaseDeals();
        if (storedBaseDeals.length === 0 && monthId) {
          if (!monthList.find((m) => m.id === monthId)) {
            await createNextMonth("", monthId, monthLabelForDate(new Date()));
            monthList = await getMonths();
          }
          const { baseDeals: b, monthRecords: mr, formulas: f } =
            await loadDealsFromExcel("/Deals Manager.xlsx", monthId);
          await Promise.all([saveBaseDeals(b), saveMonthRecords(mr), setFormulas(f)]);
          if (!cancelled) {
            setFormulaState({ ...DEFAULT_FORMULAS, ...f });
            setBaseDeals(b); setMonthRecords(mr);
            cache.baseDeals = b; cache.setRecords(monthId, mr);
          }
        } else if (monthId) {
          const records = await getMonthRecords(monthId);
          cache.baseDeals = storedBaseDeals; cache.setRecords(monthId, records);
          if (!cancelled) { setBaseDeals(storedBaseDeals); setMonthRecords(records); }
        }
        cache.months = monthList; cache.activeMonthId = monthId ?? undefined;
        if (!cancelled) { setMonths(monthList); setActiveMonthState(monthId); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    init();
    return () => { cancelled = true; };
  }, [detailMonthId]);

  useEffect(() => {
    if (!activeMonthId) return;
    const refresh = async () => {
      try {
        const [b, records, monthList] = await Promise.all([getBaseDeals(), getMonthRecords(activeMonthId), getMonths()]);
        cache.baseDeals = b; cache.setRecords(activeMonthId, records); cache.months = monthList;
        setBaseDeals(b); setMonthRecords(records); setMonths(monthList);
      } catch { /* ignore */ }
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [activeMonthId]);

  useEffect(() => {
    if (!detailMode || !detailDealId) return;
    setDrawerDealId(detailDealId); setDrawerMode("view"); setDrawerOpen(true);
  }, [detailDealId, detailMode]);

  const mergeDeals = (bd: BaseDeal[], mr: MonthRecord[]) => {
    const map = new Map(mr.map((r) => [r.dealId, r]));
    return bd.map((d) => {
      const r = map.get(d.id);
      return { ...d, received: r?.received ?? 0, receipts: r?.receipts ?? [], snapshotRecovered: r?.snapshotRecovered ?? null, snapshotRemaining: r?.snapshotRemaining ?? null };
    });
  };

  const deals = useMemo(() => recalculateDeals(mergeDeals(baseDeals, monthRecords)), [baseDeals, monthRecords]);

  const referralOptions = useMemo(() => {
    const vals = new Set(deals.map((d) => d.referral).filter(Boolean));
    return ["all", ...Array.from(vals)];
  }, [deals]);

  const sortedMonths = useMemo(() => [...months].sort((a, b) => b.id.localeCompare(a.id)), [months]);
  const activeMonthLabel = useMemo(() => months.find((m) => m.id === activeMonthId)?.label ?? "", [activeMonthId, months]);

  const visibleDeals = useMemo(() => {
    if (!activeMonthId) return deals;
    return deals.filter((d) => {
      if (d.remainingAmount <= 0) {
        return d.receipts.some((r) => r.receivedAt?.slice(0, 7) === activeMonthId);
      }
      return true;
    });
  }, [deals, activeMonthId]);

  const filteredDeals = useMemo(() => {
    const low = query.trim().toLowerCase();
    return visibleDeals
      .filter((d) => {
        const rcvd = d.received > 0 || d.receipts.length > 0;
        if (receiptFilter === "received" && !rcvd) return false;
        if (receiptFilter === "pending" && rcvd) return false;
        if (referralFilter !== "all" && d.referral !== referralFilter) return false;
        if (!low) return true;
        return [d.customer, d.dealNo, d.mobileNo, d.referral].map((v) => String(v).toLowerCase()).join(" ").includes(low);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [visibleDeals, query, receiptFilter, referralFilter]);

  const monthlyStats = useMemo(() => {
    // All deals relevant this month: active ones + completed ones that finished this month
    const allThisMonth = visibleDeals; // visibleDeals already includes completed-this-month deals
    const activeDeals = allThisMonth.filter((d) => d.remainingAmount > 0);
    const expectedThisMonth = activeDeals.reduce((s, d) => {
      const inst = d.instalment > 0 ? d.instalment : calcInstalment(d.invested, d.months);
      return s + inst;
    }, 0);
    const receivedThisMonth = monthRecords.reduce((s, r) => s + (r.received ?? 0), 0);
    // Count receipts across ALL deals this month (including completed)
    const rcvdCount = allThisMonth.filter((d) => d.received > 0 || d.receipts.length > 0).length;
    const pendingCount = activeDeals.filter((d) => !(d.received > 0 || d.receipts.length > 0)).length;
    return { expectedThisMonth, receivedThisMonth, activeCount: activeDeals.length, rcvdCount, pendingCount };
  }, [visibleDeals, monthRecords]);

  const selectedDeal = useMemo(() => drawerDealId ? deals.find((d) => d.id === drawerDealId) ?? null : null, [deals, drawerDealId]);

  const openDealWindow = (id: string) => {
    if (!activeMonthId || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("detail", "1");
    url.searchParams.set("dealId", id);
    url.searchParams.set("monthId", activeMonthId);
    window.location.href = url.toString();
  };

  const handleSaveDeal = async (deal: Deal) => {
    if (!activeMonthId) { setFormWarning("Select a month before saving."); return; }
    if (!deal.customer || !deal.dealNo) { setFormWarning("Deal number and customer are required."); return; }
    const now = new Date().toISOString();
    const { received, receipts, ...baseFields } = deal;
    const useManualBalance = deal.useManualBalance === true;
    const nextBase: BaseDeal = {
      ...baseFields, dealDate: deal.dealDate ? new Date(deal.dealDate).toISOString() : "",
      useManualBalance,
      manualRecovered: useManualBalance ? (deal.manualRecovered ?? deal.recoveredAmount) : null,
      manualRemaining: useManualBalance ? (deal.manualRemaining ?? deal.remainingAmount) : null,
      createdAt: deal.createdAt || now, updatedAt: now
    };
    if (baseDeals.some((d) => d.id !== nextBase.id && String(d.dealNo) === String(nextBase.dealNo))) {
      setFormWarning("Deal number already exists."); return;
    }
    const nextBaseDeals = drawerMode === "new" ? [nextBase, ...baseDeals] : baseDeals.map((d) => d.id === nextBase.id ? nextBase : d);
    const existing = monthRecords.find((r) => r.dealId === nextBase.id);
    const nextRecord: MonthRecord = {
      id: existing?.id ?? `${activeMonthId}:${nextBase.id}`,
      monthId: activeMonthId, dealId: nextBase.id,
      received: Number.isFinite(received) ? received : 0,
      receipts: Array.isArray(receipts) ? receipts : [],
      snapshotRecovered: existing?.snapshotRecovered ?? null,
      snapshotRemaining: existing?.snapshotRemaining ?? null,
      createdAt: existing?.createdAt ?? now, updatedAt: now
    };
    const nextMonthRecords = existing ? monthRecords.map((r) => r.dealId === nextBase.id ? nextRecord : r) : [nextRecord, ...monthRecords];
    setMonthRecords(nextMonthRecords);
    await saveMonthRecord(nextRecord);
    const recalculated = recalculateDeals(mergeDeals(nextBaseDeals, nextMonthRecords));
    const sanitized = recalculated.map(({ received: _r, receipts: _rc, snapshotRecovered: _src, snapshotRemaining: _srm, ...d }) => d);
    setBaseDeals(sanitized);
    cache.baseDeals = sanitized;
    cache.setRecords(activeMonthId, nextMonthRecords);
    await saveBaseDeals(sanitized);
    setDrawerOpen(false); setFormWarning(null);
  };

  const handleSaveReceipt = async () => {
    if (!receiptDealId) return;
    const targetMonthId = receiptDraft.targetMonthId || activeMonthId;
    if (!targetMonthId || !/^\d{4}-\d{2}$/.test(targetMonthId)) { setFormWarning("Invalid month."); return; }
    const targetBase = baseDeals.find((d) => d.id === receiptDealId);
    if (!targetBase) return;
    const targetMonthRecords = targetMonthId === activeMonthId ? monthRecords : await getMonthRecords(targetMonthId);
    const existing = targetMonthRecords.find((r) => r.dealId === receiptDealId);
    if (existing && existing.receipts && existing.receipts.length > 0) {
      setFormWarning(`A receipt already exists for this deal in ${targetMonthId}.`); return;
    }
    let currentMonths = months;
    if (!currentMonths.find((m) => m.id === targetMonthId)) {
      const [y, mo] = targetMonthId.split("-").map(Number);
      const label = new Date(y, mo - 1).toLocaleString("en-US", { month: "short", year: "numeric" });
      await createNextMonth(activeMonthId ?? "", targetMonthId, label);
      currentMonths = await getMonths(); setMonths(currentMonths);
    }
    const now = new Date().toISOString();
    const newReceipt = { id: crypto.randomUUID(), dealId: receiptDealId, amount: receiptDraft.amount, receivedAt: new Date(receiptDraft.receivedAt).toISOString(), note: receiptDraft.note, installments: receiptDraft.installments };
    const nextRecord: MonthRecord = {
      id: existing?.id ?? `${targetMonthId}:${receiptDealId}`,
      monthId: targetMonthId, dealId: receiptDealId,
      received: (existing?.received ?? 0) + receiptDraft.amount,
      receipts: [...(existing?.receipts ?? []), newReceipt],
      snapshotRecovered: existing?.snapshotRecovered ?? null, snapshotRemaining: existing?.snapshotRemaining ?? null,
      createdAt: existing?.createdAt ?? now, updatedAt: now
    };
    const effectiveInstalment = targetBase.instalment > 0 ? targetBase.instalment : calcInstalment(targetBase.invested, targetBase.months);
    const dealTotal = targetBase.total > 0 ? targetBase.total : effectiveInstalment * targetBase.months;
    const openingRemaining = existing?.snapshotRemaining ?? (targetBase.remainingAmount > 0 ? targetBase.remainingAmount : dealTotal);
    const totalRcvd = (existing?.received ?? 0) + receiptDraft.amount;
    const newRemaining = Math.max(0, openingRemaining - totalRcvd);
    const newRecovered = Math.max(0, dealTotal - newRemaining);
    const updatedBase: BaseDeal = { ...targetBase, instalRcvd: targetBase.instalRcvd + receiptDraft.installments, recoveredAmount: newRecovered, remainingAmount: newRemaining, manualRecovered: targetBase.useManualBalance ? newRecovered : targetBase.manualRecovered, manualRemaining: targetBase.useManualBalance ? newRemaining : targetBase.manualRemaining, updatedAt: now };
    if (targetMonthId === activeMonthId) {
      const nextMonthRecords = existing ? monthRecords.map((r) => r.dealId === receiptDealId ? nextRecord : r) : [nextRecord, ...monthRecords];
      setMonthRecords(nextMonthRecords);
      cache.setRecords(activeMonthId, nextMonthRecords);
    } else {
      cache.invalidateRecords(targetMonthId);
    }
    const nextBaseDeals = baseDeals.map((d) => d.id === receiptDealId ? updatedBase : d);
    setBaseDeals(nextBaseDeals);
    cache.baseDeals = nextBaseDeals;
    await Promise.all([saveMonthRecord(nextRecord), saveBaseDeal(updatedBase), propagateSnapshotForward(receiptDealId, targetMonthId, newRecovered, newRemaining)]);
    setReceiptOpen(false);
  };

  const handleDeleteDeal = async (dealId: string) => {
    if (!window.confirm("Delete this deal from all months?")) return;
    await deleteDealEverywhere(dealId);
    const nextDeals = baseDeals.filter((d) => d.id !== dealId);
    const nextRecords = monthRecords.filter((r) => r.dealId !== dealId);
    setBaseDeals(nextDeals); setMonthRecords(nextRecords);
    cache.baseDeals = nextDeals;
    if (activeMonthId) cache.setRecords(activeMonthId, nextRecords);
    detailMode ? window.history.back() : setDrawerOpen(false);
  };

  const handleSelectMonth = async (monthId: string) => {
    setActiveMonthState(monthId);
    cache.activeMonthId = monthId;
    await setActiveMonthId(monthId);
    const cached = cache.getRecords(monthId);
    if (cached) { setMonthRecords(cached); return; }
    const records = await getMonthRecords(monthId);
    cache.setRecords(monthId, records);
    setMonthRecords(records);
  };

  const openAddMonth = () => {
    const sorted = [...months].sort((a, b) => b.id.localeCompare(a.id));
    let defaultVal: string;
    if (sorted.length > 0) {
      const [y, m] = sorted[0].id.split("-").map(Number);
      const next = new Date(y, m);
      defaultVal = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
    } else {
      const now = new Date();
      defaultVal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    }
    setAddMonthInput(defaultVal); setAddMonthError(null); setAddMonthOpen(true);
  };

  const handleAddMonthSubmit = async () => {
    const trimmed = addMonthInput.trim();
    if (!/^\d{4}-\d{2}$/.test(trimmed)) { setAddMonthError("Use YYYY-MM format."); return; }
    if (months.find((m) => m.id === trimmed)) { setAddMonthOpen(false); await handleSelectMonth(trimmed); return; }
    const [y, mo] = trimmed.split("-").map(Number);
    const label = new Date(y, mo - 1).toLocaleString("en-US", { month: "short", year: "numeric" });
    await createNextMonth(activeMonthId ?? "", trimmed, label);
    const newMonths = await getMonths();
    cache.months = newMonths;
    setMonths(newMonths); setAddMonthOpen(false);
    await handleSelectMonth(trimmed);
  };

  const handleDeleteMonth = async (monthId: string) => {
    if (months.length <= 1) { alert("Cannot delete the only month."); return; }
    const month = months.find((m) => m.id === monthId);
    if (!window.confirm(`Delete "${month?.label ?? monthId}" and all its receipts?`)) return;
    await deleteMonth(monthId);
    const monthList = await getMonths();
    cache.months = monthList; cache.invalidateRecords(monthId);
    setMonths(monthList);
    if (activeMonthId === monthId) {
      const next = [...monthList].sort((a, b) => b.id.localeCompare(a.id))[0];
      if (next) await handleSelectMonth(next.id);
    }
  };

  if (loading) return <div className="loading"><div className="spinner" /><p>Loading deals database...</p></div>;
  if (error) return <div className="loading"><h2>Something went wrong</h2><p>{error}</p></div>;

  const drawerIsOpen = detailMode ? Boolean(selectedDeal) : drawerOpen;

  return (
    <div className={`app ${detailMode ? "app--detail" : ""}`}>
      <main className="main">
        {!detailMode && (
          <>
            {/* Monthly dashboard */}
            <section className="month-dashboard">
              <div className="month-dashboard__header">
                <div className="month-dashboard__title-row">
                  <select
                    value={activeMonthId ?? ""}
                    onChange={(e) => void handleSelectMonth(e.target.value)}
                    className="month-select"
                  >
                    {sortedMonths.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                  <div className="month-dashboard__btns">
                    <button className="btn btn--ghost btn--sm" onClick={openAddMonth}>+ Month</button>
                    <button className="btn btn--ghost btn--sm icon-btn" title="Delete month" onClick={() => activeMonthId && void handleDeleteMonth(activeMonthId)}>🗑</button>
                  </div>
                </div>
              </div>
              <div className="month-dashboard__stats">
                <div className="month-stat">
                  <p className="month-stat__label">Expected</p>
                  <p className="month-stat__value">{currency.format(monthlyStats.expectedThisMonth)}</p>
                  <p className="month-stat__sub">{monthlyStats.activeCount} active deals</p>
                </div>
                <div className="month-stat month-stat--rcvd">
                  <p className="month-stat__label">Received</p>
                  <p className="month-stat__value">{currency.format(monthlyStats.receivedThisMonth)}</p>
                  <p className="month-stat__sub">{monthlyStats.rcvdCount} receipts</p>
                </div>
                <div className="month-stat month-stat--pending">
                  <p className="month-stat__label">Pending</p>
                  <p className="month-stat__value">{currency.format(Math.max(0, monthlyStats.expectedThisMonth - monthlyStats.receivedThisMonth))}</p>
                  <p className="month-stat__sub">{monthlyStats.pendingCount} unpaid</p>
                </div>
              </div>
            </section>

            {/* Filters toolbar */}
            <section className="toolbar">
              <div className="search">
                <input placeholder="Search name, deal no, referral…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="toolbar__filters">
                <div className="filter-select-wrap">
                  <span className="filter-select-icon">👤</span>
                  <select value={referralFilter} onChange={(e) => setReferralFilter(e.target.value)}>
                    {referralOptions.map((o) => (
                      <option key={o} value={o}>{o === "all" ? "All referrals" : o}</option>
                    ))}
                  </select>
                </div>
                <div className="filter-select-wrap">
                  <span className="filter-select-icon">💳</span>
                  <select value={receiptFilter} onChange={(e) => setReceiptFilter(e.target.value as typeof receiptFilter)}>
                    <option value="all">All deals</option>
                    <option value="received">Received</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>
              </div>
            </section>

            {filteredDeals.length === 0 ? (
              <section className="empty">
                <h2>No deals match.</h2>
                <p>Try another search or change the filters.</p>
              </section>
            ) : (
              <section className="deal-list">
                {filteredDeals.map((deal) => (
                  <DealCard key={deal.id} deal={deal} onSelect={openDealWindow}
                    onReceive={(id) => { setReceiptDealId(id); setReceiptDraft(emptyReceipt(activeMonthId)); setReceiptOpen(true); }} />
                ))}
              </section>
            )}
          </>
        )}

        {detailMode && !selectedDeal && (
          <section className="empty"><h2>Deal not found.</h2></section>
        )}
      </main>

      {/* FAB — add new deal */}
      {!detailMode && (
        <button
          className="fab"
          title="Add new deal"
          onClick={() => { setDrawerDealId(null); setDrawerMode("new"); setDrawerOpen(true); setFormWarning(null); }}
        >+</button>
      )}

      <DealDrawer
        mode={drawerMode} open={drawerIsOpen} variant={detailMode ? "page" : "panel"}
        deal={drawerMode === "view" ? selectedDeal : null} formulas={formulas}
        onClose={() => detailMode ? window.history.back() : setDrawerOpen(false)}
        onSave={handleSaveDeal}
        onAddReceipt={(id) => { setReceiptDealId(id); setReceiptDraft(emptyReceipt(activeMonthId)); setReceiptOpen(true); }}
        onDelete={handleDeleteDeal}
      />

      <Modal open={addMonthOpen} title="Add month" onClose={() => setAddMonthOpen(false)}>
        <div className="modal__form">
          <label>Month (YYYY-MM)
            <input type="month" value={addMonthInput}
              onChange={(e) => { setAddMonthInput(e.target.value); setAddMonthError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") void handleAddMonthSubmit(); }}
              autoFocus />
          </label>
          {addMonthError && <p className="modal__error">{addMonthError}</p>}
          <p className="modal__hint">Add any past or future month.</p>
          <div className="modal__actions">
            <button className="btn btn--ghost" onClick={() => setAddMonthOpen(false)}>Cancel</button>
            <button className="btn btn--primary" onClick={() => void handleAddMonthSubmit()}>Add</button>
          </div>
        </div>
      </Modal>

      <Modal open={receiptOpen} title="Add receipt" onClose={() => setReceiptOpen(false)}>
        <div className="modal__form">
          <label>Month
            <input type="month" value={receiptDraft.targetMonthId}
              onChange={(e) => setReceiptDraft((c) => ({ ...c, targetMonthId: e.target.value }))} />
          </label>
          <p className="modal__hint">One receipt per deal per month only.</p>
          {(["amount", "receivedAt", "installments"] as const).map((field) => (
            <label key={field}>
              {field === "amount" ? "Amount" : field === "receivedAt" ? "Date received" : "Instalments counted"}
              <input type={field === "receivedAt" ? "date" : "number"} value={receiptDraft[field]}
                onChange={(e) => setReceiptDraft((c) => ({ ...c, [field]: field === "receivedAt" ? e.target.value : Number(e.target.value) }))} />
            </label>
          ))}
          <label>Note
            <textarea value={receiptDraft.note} onChange={(e) => setReceiptDraft((c) => ({ ...c, note: e.target.value }))} placeholder="Optional" />
          </label>
          <div className="modal__actions">
            <button className="btn btn--ghost" onClick={() => setReceiptOpen(false)}>Cancel</button>
            <button className="btn btn--primary" onClick={() => void handleSaveReceipt()}>Save</button>
          </div>
        </div>
      </Modal>

      {formWarning && (
        <div className="toast" role="status">
          {formWarning}
          <button className="toast__close" onClick={() => setFormWarning(null)}>×</button>
        </div>
      )}
    </div>
  );
}
