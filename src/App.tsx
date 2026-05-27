import { useEffect, useMemo, useState } from "react";
import DealCard from "./components/DealCard";
import DealDrawer from "./components/DealDrawer";
import Modal from "./components/Modal";
import ExcelGrid from "./components/ExcelGrid";
import { recalculateDeals, calcInstalment } from "./lib/compute";
import {
  createNextMonth, deleteDealEverywhere, getActiveMonthId, getBaseDeals,
  getFormulas, getMonthRecords, getMonths, propagateSnapshotForward,
  saveBaseDeals, saveBaseDeal, saveMonthRecord, 
  setActiveMonthId, seedFromMongoIfNeeded
} from "./lib/store";
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

const normalizeReferral = (value: string) => value.trim().toLowerCase();

type ReceiptDraft = { amount: number; receivedAt: string; note: string; installments: number; targetMonthId: string };
const emptyReceipt = (monthId: string | null): ReceiptDraft => ({
  amount: 0, receivedAt: new Date().toISOString().slice(0, 10), note: "", installments: 1,
  targetMonthId: monthId ?? ""
});

export default function App() {
  const [baseDeals, setBaseDeals] = useState<BaseDeal[]>([]);
  const [monthRecords, setMonthRecords] = useState<MonthRecord[]>([]);
  const [recordsByMonth, setRecordsByMonth] = useState<Map<string, MonthRecord[]>>(new Map());
  const [months, setMonths] = useState<MonthMeta[]>([]);
  const [activeMonthId, setActiveMonthState] = useState<string | null>(null);
  const [formulas, setFormulaState] = useState<FormulaTemplates>(DEFAULT_FORMULAS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [referralFilter, setReferralFilter] = useState("all");
  const [receiptFilter, setReceiptFilter] = useState<"all" | "received" | "pending">("all");
  const [sortBy, setSortBy] = useState<"dealNo" | "customer" | "amount">("dealNo");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"view" | "new">("view");
  const [drawerDealId, setDrawerDealId] = useState<string | null>(null);

  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptDealId, setReceiptDealId] = useState<string | null>(null);
  const [receiptDraft, setReceiptDraft] = useState<ReceiptDraft>(emptyReceipt(null));
  const [receiptTargetRecords, setReceiptTargetRecords] = useState<MonthRecord[]>([]);
  const [receiptRecordsLoading, setReceiptRecordsLoading] = useState(false);
  const [formWarning, setFormWarning] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"cards" | "excel">("cards");

  const { detailDealId, detailMonthId } = useMemo(() => {
    if (typeof window === "undefined") return { detailDealId: null, detailMonthId: null };
    const p = new URLSearchParams(window.location.search);
    return { detailDealId: p.get("dealId"), detailMonthId: p.get("monthId") };
  }, []);

  const detailMode = Boolean(detailDealId);


  // ── Initial pull for online mode ───────────────────────────────────────
  const [seedVersion, setSeedVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void seedFromMongoIfNeeded().then(() => {
      if (cancelled) return;
      cache.baseDeals = undefined;
      cache.months = undefined;
      cache.activeMonthId = undefined;
      setSeedVersion((v) => v + 1);
    });
    return () => { cancelled = true; };
  }, []);

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
        if (monthId) {
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
  }, [detailMonthId, seedVersion]);

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
    if (!activeMonthId || months.length === 0) return;
    let cancelled = false;
    const load = async () => {
      const targetMonths = months.filter((m) => m.id <= activeMonthId).map((m) => m.id);
      const recordMap = new Map<string, MonthRecord[]>();
      await Promise.all(
        targetMonths.map(async (mId) => {
          const cached = cache.getRecords(mId);
          const records = cached ?? await getMonthRecords(mId);
          recordMap.set(mId, records);
          if (!cached) cache.setRecords(mId, records);
        })
      );
      if (!cancelled) setRecordsByMonth(recordMap);
    };
    load();
    return () => { cancelled = true; };
  }, [activeMonthId, months]);

  useEffect(() => {
    if (!activeMonthId) return;
    setRecordsByMonth((prev) => {
      const next = new Map(prev);
      next.set(activeMonthId, monthRecords);
      return next;
    });
  }, [activeMonthId, monthRecords]);

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

  const { cumulativeInstalMap, cumulativeReceivedMap, totalReceivedMap } = useMemo(() => {
    const instMap = new Map<string, number>();
    const rcvdMap = new Map<string, number>();
    const totalMap = new Map<string, number>();
    if (!activeMonthId) return { cumulativeInstalMap: instMap, cumulativeReceivedMap: rcvdMap, totalReceivedMap: totalMap };
    recordsByMonth.forEach((records, mId) => {
      records.forEach((r) => {
        totalMap.set(r.dealId, (totalMap.get(r.dealId) ?? 0) + (r.received ?? 0));
      });
      if (mId <= activeMonthId) {
        records.forEach((r) => {
          const instal = r.receipts?.reduce((s, rec) => s + (rec.installments ?? 0), 0) ?? 0;
          if ((r.receipts?.length ?? 0) > 0) {
            instMap.set(r.dealId, (instMap.get(r.dealId) ?? 0) + instal);
          }
          rcvdMap.set(r.dealId, (rcvdMap.get(r.dealId) ?? 0) + (r.received ?? 0));
        });
      }
    });
    return { cumulativeInstalMap: instMap, cumulativeReceivedMap: rcvdMap, totalReceivedMap: totalMap };
  }, [recordsByMonth, activeMonthId]);

  const deals = useMemo(() => {
    const currentMap = new Map(monthRecords.map((r) => [r.dealId, r]));
    const merged = baseDeals.map((d) => {
      const r = currentMap.get(d.id);
      const effectiveInstalment = d.instalment > 0 ? d.instalment : calcInstalment(d.invested, d.months);
      const dealTotal = d.total > 0 ? d.total : effectiveInstalment * d.months;
      const cumulativeReceived = cumulativeReceivedMap.get(d.id) ?? 0;
      const totalReceived = totalReceivedMap.get(d.id) ?? 0;
      const baseRemaining = d.useManualBalance
        ? (d.manualRemaining ?? (d.manualRecovered != null ? Math.max(0, dealTotal - d.manualRecovered) : d.remainingAmount))
        : d.remainingAmount;
      const remaining = Math.max(0, baseRemaining + (totalReceived - cumulativeReceived));
      const recovered = Math.max(0, dealTotal - remaining);
      const instalRcvd = (d.instalRcvd ?? 0) + (cumulativeInstalMap.get(d.id) ?? 0);
      return {
        ...d,
        received: r?.received ?? 0,
        receipts: r?.receipts ?? [],
        snapshotRecovered: r?.snapshotRecovered ?? null,
        snapshotRemaining: r?.snapshotRemaining ?? null,
        instalRcvd,
        recoveredAmount: recovered,
        remainingAmount: remaining,
      };
    });
    return recalculateDeals(merged);
  }, [baseDeals, monthRecords, cumulativeInstalMap, cumulativeReceivedMap, totalReceivedMap]);

  const referralOptions = useMemo(() => {
    const vals = new Set(deals.map((d) => normalizeReferral(d.referral)).filter((v) => v));
    return ["all", ...Array.from(vals).sort()];
  }, [deals]);

  const sortedMonths = useMemo(() => [...months].sort((a, b) => b.id.localeCompare(a.id)), [months]);

  const visibleDeals = useMemo(() => {
    if (!activeMonthId) return deals;
    return deals.filter((d) => {
      // Never show a deal in a month that precedes its deal date
      if (d.dealDate) {
        const dealMonth = d.dealDate.slice(0, 7); // "YYYY-MM"
        if (dealMonth > activeMonthId) return false;
      }
      if (d.remainingAmount <= 0) {
        return d.receipts.some((r) => r.receivedAt?.slice(0, 7) === activeMonthId);
      }
      return true;
    });
  }, [deals, activeMonthId]);

  const filteredDeals = useMemo(() => {
    const low = query.trim().toLowerCase();
    const filtered = visibleDeals
      .filter((d) => {
        const rcvd = d.received > 0 || d.receipts.length > 0;
        if (receiptFilter === "received" && !rcvd) return false;
        if (receiptFilter === "pending" && rcvd) return false;
        if (referralFilter !== "all" && normalizeReferral(d.referral) !== referralFilter) return false;
        if (!low) return true;
        return [d.customer, d.dealNo, d.mobileNo, d.referral].map((v) => String(v).toLowerCase()).join(" ").includes(low);
      });

    const toDealNo = (value: number | string) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };

    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "dealNo": {
          const na = toDealNo(a.dealNo);
          const nb = toDealNo(b.dealNo);
          if (na != null && nb != null) return na - nb;
          return String(a.dealNo).localeCompare(String(b.dealNo));
        }
        case "customer":
          return String(a.customer || "").localeCompare(String(b.customer || ""));
        case "amount":
          return (a.invested ?? 0) - (b.invested ?? 0);
        default:
          return 0;
      }
    });

    return sorted;
  }, [visibleDeals, query, receiptFilter, referralFilter, sortBy]);

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

  const receiptTargetMonthId = receiptDraft.targetMonthId || activeMonthId || "";

  useEffect(() => {
    if (!receiptOpen) { setReceiptTargetRecords([]); setReceiptRecordsLoading(false); return; }
    if (!receiptDealId || !receiptTargetMonthId) { setReceiptTargetRecords([]); setReceiptRecordsLoading(false); return; }

    let cancelled = false;
    const load = async () => {
      setReceiptRecordsLoading(true);
      let records: MonthRecord[] = [];
      if (receiptTargetMonthId === activeMonthId) {
        records = monthRecords;
      } else {
        records = recordsByMonth.get(receiptTargetMonthId) ?? await getMonthRecords(receiptTargetMonthId);
        if (!recordsByMonth.get(receiptTargetMonthId)) {
          setRecordsByMonth((prev) => {
            const next = new Map(prev);
            next.set(receiptTargetMonthId, records);
            return next;
          });
        }
      }
      if (!cancelled) {
        setReceiptTargetRecords(records);
        setReceiptRecordsLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [receiptOpen, receiptDealId, receiptTargetMonthId, activeMonthId, monthRecords, recordsByMonth]);

  const receiptTargetRecord = useMemo(
    () => receiptTargetRecords.find((r) => r.dealId === receiptDealId) ?? null,
    [receiptTargetRecords, receiptDealId]
  );
  const existingReceipt = receiptTargetRecord?.receipts?.[0] ?? null;
  const hasExistingReceipt = Boolean(existingReceipt);

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
    const receiptInstalments = cumulativeInstalMap.get(deal.id) ?? 0;
    const openingInstalments = Math.max(0, (deal.instalRcvd ?? 0) - receiptInstalments);
    const nextBase: BaseDeal = {
      ...baseFields, dealDate: deal.dealDate ? new Date(deal.dealDate).toISOString() : "",
      useManualBalance,
      manualRecovered: useManualBalance ? (deal.manualRecovered ?? deal.recoveredAmount) : null,
      manualRemaining: useManualBalance ? (deal.manualRemaining ?? deal.remainingAmount) : null,
      instalRcvd: openingInstalments,
      createdAt: deal.createdAt || now, updatedAt: now
    };
    if (baseDeals.some((d) => d.id !== nextBase.id && String(d.dealNo) === String(nextBase.dealNo))) {
      setFormWarning("Deal number already exists."); return;
    }
    // Auto-create the month for this deal's dealDate if it doesn't exist yet
    if (nextBase.dealDate) {
      const dealMonthId = nextBase.dealDate.slice(0, 7);
      if (!months.find((m) => m.id === dealMonthId)) {
        const [y, mo] = dealMonthId.split("-").map(Number);
        const label = new Date(y, mo - 1).toLocaleString("en-US", { month: "short", year: "numeric" });
        await createNextMonth(activeMonthId ?? "", dealMonthId, label);
        const freshMonths = await getMonths();
        setMonths(freshMonths);
        cache.months = freshMonths;
      }
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
    const updatedBase: BaseDeal = { ...targetBase, instalRcvd: targetBase.instalRcvd ?? 0, recoveredAmount: newRecovered, remainingAmount: newRemaining, manualRecovered: targetBase.useManualBalance ? newRecovered : targetBase.manualRecovered, manualRemaining: targetBase.useManualBalance ? newRemaining : targetBase.manualRemaining, updatedAt: now };
    const updatedTargetRecords = existing
      ? targetMonthRecords.map((r) => r.dealId === receiptDealId ? nextRecord : r)
      : [nextRecord, ...targetMonthRecords];

    if (targetMonthId === activeMonthId) {
      setMonthRecords(updatedTargetRecords);
      cache.setRecords(activeMonthId, updatedTargetRecords);
    } else {
      cache.setRecords(targetMonthId, updatedTargetRecords);
      setRecordsByMonth((prev) => {
        const next = new Map(prev);
        next.set(targetMonthId, updatedTargetRecords);
        return next;
      });
    }
    const nextBaseDeals = baseDeals.map((d) => d.id === receiptDealId ? updatedBase : d);
    setBaseDeals(nextBaseDeals);
    cache.baseDeals = nextBaseDeals;
    await Promise.all([saveMonthRecord(nextRecord), saveBaseDeal(updatedBase), propagateSnapshotForward(receiptDealId, targetMonthId, newRecovered, newRemaining)]);
    setReceiptOpen(false);
  };

  const handleDeleteReceipt = async (dealId: string, targetMonthId: string, receiptId: string) => {
    if (!dealId) return;
    if (!targetMonthId) return;
    const targetBase = baseDeals.find((d) => d.id === dealId);
    if (!targetBase) return;

    const targetMonthRecords = targetMonthId === activeMonthId ? monthRecords : await getMonthRecords(targetMonthId);
    const existing = targetMonthRecords.find((r) => r.dealId === dealId);
    if (!existing || !existing.receipts?.length) return;

    const nextReceipts = existing.receipts.filter((r) => r.id !== receiptId);
    if (nextReceipts.length === existing.receipts.length) return;

    const now = new Date().toISOString();
    const nextReceived = nextReceipts.reduce((s, r) => s + (r.amount ?? 0), 0);
    const nextRecord: MonthRecord = {
      ...existing,
      received: nextReceived,
      receipts: nextReceipts,
      updatedAt: now
    };

    const effectiveInstalment = targetBase.instalment > 0 ? targetBase.instalment : calcInstalment(targetBase.invested, targetBase.months);
    const dealTotal = targetBase.total > 0 ? targetBase.total : effectiveInstalment * targetBase.months;
    const openingRemaining = existing.snapshotRemaining ?? (targetBase.remainingAmount > 0 ? targetBase.remainingAmount : dealTotal);
    const newRemaining = Math.max(0, openingRemaining - nextReceived);
    const newRecovered = Math.max(0, dealTotal - newRemaining);
    const updatedBase: BaseDeal = {
      ...targetBase,
      instalRcvd: targetBase.instalRcvd ?? 0,
      recoveredAmount: newRecovered,
      remainingAmount: newRemaining,
      manualRecovered: targetBase.useManualBalance ? newRecovered : targetBase.manualRecovered,
      manualRemaining: targetBase.useManualBalance ? newRemaining : targetBase.manualRemaining,
      updatedAt: now
    };

    const updatedTargetRecords = targetMonthRecords.map((r) => r.dealId === dealId ? nextRecord : r);

    if (targetMonthId === activeMonthId) {
      setMonthRecords(updatedTargetRecords);
      cache.setRecords(activeMonthId, updatedTargetRecords);
    } else {
      cache.setRecords(targetMonthId, updatedTargetRecords);
      setRecordsByMonth((prev) => {
        const next = new Map(prev);
        next.set(targetMonthId, updatedTargetRecords);
        return next;
      });
    }

    setReceiptTargetRecords(updatedTargetRecords);

    const nextBaseDeals = baseDeals.map((d) => d.id === dealId ? updatedBase : d);
    setBaseDeals(nextBaseDeals);
    cache.baseDeals = nextBaseDeals;

    await Promise.all([
      saveMonthRecord(nextRecord),
      saveBaseDeal(updatedBase),
      propagateSnapshotForward(dealId, targetMonthId, newRecovered, newRemaining)
    ]);
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

  




  if (loading) return <div className="loading"><div className="spinner" /><p>Loading deals database...</p></div>;
  if (error) return <div className="loading"><h2>Something went wrong</h2><p>{error}</p></div>;

  const drawerIsOpen = detailMode ? Boolean(selectedDeal) : drawerOpen;

  return (
    <div className={`app ${detailMode ? "app--detail" : ""}${viewMode === "excel" ? " app--excel" : ""}`}>
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
                  <button
                    className="btn btn--ghost btn--sm"
                    title="Create next month"
                    onClick={async () => {
                      const latest = sortedMonths[0];
                      const base = latest?.id ?? monthIdForDate(new Date());
                      const [y, mo] = base.split("-").map(Number);
                      const next = mo === 12
                        ? `${y + 1}-01`
                        : `${y}-${String(mo + 1).padStart(2, "0")}`;
                      if (months.find((m) => m.id === next)) {
                        setFormWarning(`Month ${next} already exists.`); return;
                      }
                      const label = new Date(Number(next.split("-")[0]), Number(next.split("-")[1]) - 1)
                        .toLocaleString("en-US", { month: "short", year: "numeric" });
                      await createNextMonth(base, next, label);
                      const freshMonths = await getMonths();
                      setMonths(freshMonths);
                      cache.months = freshMonths;
                      await handleSelectMonth(next);
                    }}
                  >+ Month</button>
                  <div className="view-toggle">
                    <button className={`view-toggle__btn${viewMode === "cards" ? " view-toggle__btn--active" : ""}`} onClick={() => setViewMode("cards")}>⊞ Cards</button>
                    <button className={`view-toggle__btn${viewMode === "excel" ? " view-toggle__btn--active" : ""}`} onClick={() => setViewMode("excel")}>⊟ Table</button>
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
            {viewMode === "cards" && <section className="toolbar">
              <div className="search">
                <input placeholder="Search name, deal no, referral…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="toolbar__filters">
                <div className="filter-select-wrap">
                  <span className="filter-select-icon">👤</span>
                  <select value={referralFilter} onChange={(e) => setReferralFilter(e.target.value)}>
                    {referralOptions.map((o) => (
                      <option key={o} value={o}>{o === "all" ? "all referrals" : o}</option>
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
                <div className="filter-select-wrap">
                  <span className="filter-select-icon">Sort</span>
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
                    <option value="dealNo">Deal number</option>
                    <option value="customer">Name</option>
                    <option value="amount">Amount</option>
                  </select>
                </div>
              </div>
            </section>}

            {viewMode === "excel" && (
              <ExcelGrid activeMonthId={activeMonthId} months={months} />
            )}

            {viewMode === "cards" && (filteredDeals.length === 0 ? (
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
            ))}
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
        onDeleteReceipt={handleDeleteReceipt}
        onDelete={handleDeleteDeal}
      />

      

      <Modal open={receiptOpen} title="Add receipt" onClose={() => setReceiptOpen(false)}>
        <div className="modal__form">
          <label>Month
            <input type="month" value={receiptDraft.targetMonthId}
              onChange={(e) => setReceiptDraft((c) => ({ ...c, targetMonthId: e.target.value }))} />
          </label>
          <p className="modal__hint">One receipt per deal per month. Delete the existing one to replace it.</p>
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
          {receiptRecordsLoading && (
            <p className="modal__hint">Loading receipts...</p>
          )}
          {!receiptRecordsLoading && receiptTargetMonthId && (
            (receiptTargetRecord?.receipts?.length ?? 0) > 0 ? (
              <div style={{ display: "grid", gap: 8 }}>
                <p className="modal__hint">Existing receipt</p>
                {receiptTargetRecord?.receipts.map((r) => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: "6px 0" }}>
                    <div>
                      <strong>{currency.format(r.amount)}</strong> · {new Date(r.receivedAt).toLocaleDateString("en-GB")} · {r.installments} inst
                      {r.note ? ` - ${r.note}` : ""}
                    </div>
                    <button
                      className="btn btn--danger"
                      onClick={() => {
                        if (window.confirm("Delete this receipt?")) {
                          if (receiptDealId) {
                            void handleDeleteReceipt(receiptDealId, receiptTargetMonthId, r.id);
                          }
                        }
                      }}
                    >Delete</button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="modal__hint">No receipt for this month yet.</p>
            )
          )}
          <div className="modal__actions">
            <button className="btn btn--ghost" onClick={() => setReceiptOpen(false)}>Cancel</button>
            {hasExistingReceipt && receiptTargetMonthId && (
              <button
                className="btn btn--danger"
                onClick={() => {
                  if (window.confirm("Delete the existing receipt for this month?")) {
                    if (receiptDealId) {
                      void handleDeleteReceipt(receiptDealId, receiptTargetMonthId, existingReceipt!.id);
                    }
                  }
                }}
              >Delete receipt</button>
            )}
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