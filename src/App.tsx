import { useEffect, useMemo, useState } from "react";
import DealCard from "./components/DealCard";
import DealDrawer from "./components/DealDrawer";
import Modal from "./components/Modal";
import { recalculateDeals, calcInstalment } from "./lib/compute";
import {
  createNextMonth,
  deleteDealEverywhere,
  getActiveMonthId,
  getBaseDeals,
  getFormulas,
  getMonthRecords,
  getMonths,
  propagateSnapshotForward,
  saveBaseDeals,
  saveBaseDeal,
  saveMonthRecord,
  saveMonthRecords,
  setActiveMonthId,
  setFormulas,
  deleteMonth
} from "./lib/api";
import { loadDealsFromExcel } from "./lib/excel";
import { DEFAULT_FORMULAS } from "./lib/formulas";
import type {
  BaseDeal,
  Deal,
  FormulaTemplates,
  MonthMeta,
  MonthRecord
} from "./lib/types";

const currency = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0
});

type ReceiptDraft = {
  amount: number;
  receivedAt: string;
  note: string;
  installments: number;
};

const emptyReceipt = (): ReceiptDraft => ({
  amount: 0,
  receivedAt: new Date().toISOString().slice(0, 10),
  note: "",
  installments: 1
});

const monthIdForDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const monthLabelForDate = (date: Date) =>
  date.toLocaleString("en-US", { month: "short", year: "numeric" });

export default function App() {
  const [baseDeals, setBaseDeals] = useState<BaseDeal[]>([]);
  const [monthRecords, setMonthRecords] = useState<MonthRecord[]>([]);
  const [months, setMonths] = useState<MonthMeta[]>([]);
  const [activeMonthId, setActiveMonthState] = useState<string | null>(null);
  const [formulas, setFormulaState] = useState<FormulaTemplates>(DEFAULT_FORMULAS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "closed">(
    "all"
  );
  const [referralFilter, setReferralFilter] = useState("all");
  const [receiptFilter, setReceiptFilter] = useState<
    "all" | "received" | "not-received"
  >("all");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"view" | "new">("view");
  const [drawerDealId, setDrawerDealId] = useState<string | null>(null);

  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptDealId, setReceiptDealId] = useState<string | null>(null);
  const [receiptDraft, setReceiptDraft] = useState<ReceiptDraft>(emptyReceipt());

  const [formWarning, setFormWarning] = useState<string | null>(null);

  const { detailDealId, detailMonthId } = useMemo(() => {
    if (typeof window === "undefined") {
      return { detailDealId: null, detailMonthId: null } as const;
    }
    const params = new URLSearchParams(window.location.search);
    return {
      detailDealId: params.get("dealId"),
      detailMonthId: params.get("monthId")
    } as const;
  }, []);

  const detailMode = Boolean(detailDealId);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const storedFormulas = await getFormulas();
        if (storedFormulas) {
          setFormulaState({ ...DEFAULT_FORMULAS, ...storedFormulas });
        }

        let monthId = detailMonthId || (await getActiveMonthId()) || null;
        let monthList = await getMonths();
        if (!monthId) {
          const now = new Date();
          monthId = monthIdForDate(now);
          if (!monthList.find((month) => month.id === monthId)) {
            await createNextMonth("", monthId, monthLabelForDate(now));
            monthList = await getMonths();
          }
          await setActiveMonthId(monthId);
        }

        const storedBaseDeals = await getBaseDeals();
        if (storedBaseDeals.length === 0 && monthId) {
          if (!monthList.find((month) => month.id === monthId)) {
            await createNextMonth("", monthId, monthLabelForDate(new Date()));
            monthList = await getMonths();
          }

          const {
            baseDeals: seededBase,
            monthRecords: seededRecords,
            formulas: seededFormulas
          } = await loadDealsFromExcel("/Deals Manager.xlsx", monthId);
          await saveBaseDeals(seededBase);
          await saveMonthRecords(seededRecords);
          await setFormulas(seededFormulas);
          if (!cancelled) {
            setFormulaState({ ...DEFAULT_FORMULAS, ...seededFormulas });
            setBaseDeals(seededBase);
            setMonthRecords(seededRecords);
          }
        } else if (monthId) {
          const records = await getMonthRecords(monthId);
          if (!cancelled) {
            setBaseDeals(storedBaseDeals);
            setMonthRecords(records);
          }
        }

        if (!cancelled) {
          setMonths(monthList);
          setActiveMonthState(monthId);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load the local database."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [detailMonthId]);

  useEffect(() => {
    if (!activeMonthId) {
      return;
    }

    const refreshFromDb = async () => {
      try {
        const [storedBaseDeals, records, monthList] = await Promise.all([
          getBaseDeals(),
          getMonthRecords(activeMonthId),
          getMonths()
        ]);
        setBaseDeals(storedBaseDeals);
        setMonthRecords(records);
        setMonths(monthList);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to refresh the local database."
        );
      }
    };

    const handleFocus = () => {
      void refreshFromDb();
    };

    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [activeMonthId]);

  const persistBaseDeals = async (
    nextBaseDeals: BaseDeal[],
    nextMonthRecords: MonthRecord[]
  ) => {
    const recordMap = new Map(
      nextMonthRecords.map((record) => [record.dealId, record])
    );
    const nextDeals = nextBaseDeals.map((deal) => {
      const record = recordMap.get(deal.id);
      return {
        ...deal,
        received: record?.received ?? 0,
        receipts: record?.receipts ?? [],
        snapshotRecovered: record?.snapshotRecovered ?? null,
        snapshotRemaining: record?.snapshotRemaining ?? null
      };
    });
    const recalculated = recalculateDeals(nextDeals, formulas);
    const sanitized = recalculated.map(({ received, receipts, snapshotRecovered, snapshotRemaining, ...deal }) => deal);
    setBaseDeals(sanitized);
    await saveBaseDeals(sanitized);
  };

  const deals = useMemo(() => {
    const recordMap = new Map(
      monthRecords.map((record) => [record.dealId, record])
    );
    const mergedDeals = baseDeals.map((deal) => {
      const record = recordMap.get(deal.id);
      return {
        ...deal,
        received: record?.received ?? 0,
        receipts: record?.receipts ?? [],
        snapshotRecovered: record?.snapshotRecovered ?? null,
        snapshotRemaining: record?.snapshotRemaining ?? null
      };
    });
    return recalculateDeals(mergedDeals, formulas);
  }, [baseDeals, monthRecords, formulas]);

  const referralOptions = useMemo(() => {
    const values = new Set(
      deals.map((deal) => deal.referral).filter((value) => value)
    );
    return ["all", ...Array.from(values)];
  }, [deals]);

  const filteredDeals = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    return deals
      .filter((deal) => {
        if (statusFilter === "active" && deal.remainingAmount <= 0) {
          return false;
        }
        if (statusFilter === "closed" && deal.remainingAmount > 0) {
          return false;
        }
        const receivedThisMonth =
          deal.received > 0 || deal.receipts.length > 0;
        if (receiptFilter === "received" && !receivedThisMonth) {
          return false;
        }
        if (receiptFilter === "not-received" && receivedThisMonth) {
          return false;
        }
        if (referralFilter !== "all" && deal.referral !== referralFilter) {
          return false;
        }
        if (!lowered) {
          return true;
        }
        const haystack = [
          deal.customer,
          deal.dealNo,
          deal.mobileNo,
          deal.referral
        ]
          .map((value) => String(value).toLowerCase())
          .join(" ");
        return haystack.includes(lowered);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [deals, query, receiptFilter, referralFilter, statusFilter]);

  const totals = useMemo(() => {
    const invested = deals.reduce((sum, deal) => sum + deal.invested, 0);
    const recovered = deals.reduce(
      (sum, deal) => sum + deal.recoveredAmount,
      0
    );
    const remaining = deals.reduce(
      (sum, deal) => sum + Math.max(0, deal.remainingAmount),
      0
    );
    const active = deals.filter((deal) => deal.remainingAmount > 0).length;
    return { invested, recovered, remaining, active };
  }, [deals]);

  const selectedDeal = useMemo(() => {
    if (!drawerDealId) {
      return null;
    }
    return deals.find((deal) => deal.id === drawerDealId) || null;
  }, [deals, drawerDealId]);

  const activeMonthLabel = useMemo(() => {
    if (!activeMonthId) {
      return "";
    }
    return months.find((month) => month.id === activeMonthId)?.label ?? "";
  }, [activeMonthId, months]);

  const openDealWindow = (id: string) => {
    if (!activeMonthId || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("detail", "1");
    url.searchParams.set("dealId", id);
    url.searchParams.set("monthId", activeMonthId);
    window.location.href = url.toString();
  };

  const openDrawerForNew = () => {
    setDrawerDealId(null);
    setDrawerMode("new");
    setDrawerOpen(true);
    setFormWarning(null);
  };

  const handleSaveDeal = async (deal: Deal) => {
    if (!activeMonthId) {
      setFormWarning("Select a month before saving.");
      return;
    }
    if (!deal.customer || !deal.dealNo) {
      setFormWarning("Deal number and customer are required.");
      return;
    }

    const normalizedDate = deal.dealDate
      ? new Date(deal.dealDate).toISOString()
      : "";
    const useManualBalance = deal.useManualBalance === true;
    const now = new Date().toISOString();
    const { received, receipts, ...baseFields } = deal;
    const nextBaseDeal: BaseDeal = {
      ...baseFields,
      dealDate: normalizedDate,
      useManualBalance,
      manualRecovered: useManualBalance
        ? deal.manualRecovered ?? deal.recoveredAmount
        : null,
      manualRemaining: useManualBalance
        ? deal.manualRemaining ?? deal.remainingAmount
        : null,
      createdAt: deal.createdAt || now,
      updatedAt: now
    };

    const dealNoKey = String(nextBaseDeal.dealNo);
    const duplicate = baseDeals.find(
      (item) => item.id !== nextBaseDeal.id && String(item.dealNo) === dealNoKey
    );

    if (duplicate) {
      setFormWarning("Deal number already exists.");
      return;
    }

    const nextBaseDeals =
      drawerMode === "new"
        ? [nextBaseDeal, ...baseDeals]
        : baseDeals.map((item) =>
            item.id === nextBaseDeal.id ? nextBaseDeal : item
          );

    const existingRecord = monthRecords.find(
      (record) => record.dealId === nextBaseDeal.id
    );
    const nextRecord: MonthRecord = {
      id: existingRecord?.id ?? `${activeMonthId}:${nextBaseDeal.id}`,
      monthId: activeMonthId,
      dealId: nextBaseDeal.id,
      received: Number.isFinite(received) ? received : 0,
      receipts: Array.isArray(receipts) ? receipts : [],
      snapshotRecovered: existingRecord?.snapshotRecovered ?? null,
      snapshotRemaining: existingRecord?.snapshotRemaining ?? null,
      createdAt: existingRecord?.createdAt ?? now,
      updatedAt: now
    };
    const nextMonthRecords = existingRecord
      ? monthRecords.map((record) =>
          record.dealId === nextBaseDeal.id ? nextRecord : record
        )
      : [nextRecord, ...monthRecords];

    setMonthRecords(nextMonthRecords);
    await saveMonthRecord(nextRecord);
    await persistBaseDeals(nextBaseDeals, nextMonthRecords);
    setDrawerOpen(false);
    setFormWarning(null);
  };

  const handleOpenReceipt = (id: string) => {
    setReceiptDealId(id);
    setReceiptDraft(emptyReceipt());
    setReceiptOpen(true);
  };

  const handleSaveReceipt = async () => {
    if (!activeMonthId || !receiptDealId) return;
    const targetBase = baseDeals.find((deal) => deal.id === receiptDealId);
    if (!targetBase) return;

    const existingRecord = monthRecords.find((r) => r.dealId === receiptDealId);
    const now = new Date().toISOString();

    const newReceipt = {
      id: crypto.randomUUID(),
      dealId: receiptDealId,
      amount: receiptDraft.amount,
      receivedAt: new Date(receiptDraft.receivedAt).toISOString(),
      note: receiptDraft.note,
      installments: receiptDraft.installments
    };

    const nextRecord: MonthRecord = {
      id: existingRecord?.id ?? `${activeMonthId}:${receiptDealId}`,
      monthId: activeMonthId,
      dealId: receiptDealId,
      received: (existingRecord?.received ?? 0) + receiptDraft.amount,
      receipts: [...(existingRecord?.receipts ?? []), newReceipt],
      snapshotRecovered: existingRecord?.snapshotRecovered ?? null,
      snapshotRemaining: existingRecord?.snapshotRemaining ?? null,
      createdAt: existingRecord?.createdAt ?? now,
      updatedAt: now
    };

    const nextMonthRecords = existingRecord
      ? monthRecords.map((r) => (r.dealId === receiptDealId ? nextRecord : r))
      : [nextRecord, ...monthRecords];

    // ── Balance calculation ──────────────────────────────────────
    // Opening balance for this month = snapshot (carried from previous month)
    // If no snapshot yet (first month), use the deal's total as opening remaining
    const effectiveInstalment = targetBase.instalment > 0
      ? targetBase.instalment
      : calcInstalment(targetBase.invested, targetBase.months);
    const dealTotal = targetBase.total > 0
      ? targetBase.total
      : effectiveInstalment * targetBase.months;

    const openingRemaining =
      existingRecord?.snapshotRemaining !== null && existingRecord?.snapshotRemaining !== undefined
        ? existingRecord.snapshotRemaining
        : targetBase.remainingAmount > 0
          ? targetBase.remainingAmount
          : dealTotal;

    // Total received this month AFTER adding this receipt
    const totalReceivedThisMonth = (existingRecord?.received ?? 0) + receiptDraft.amount;

    // Remaining = opening balance − total received this month (floor 0)
    const newRemaining = Math.max(0, openingRemaining - totalReceivedThisMonth);
    const newRecovered = Math.max(0, dealTotal - newRemaining);

    // instalRcvd: cumulative count across all months
    const newInstalRcvd = targetBase.instalRcvd + receiptDraft.installments;

    const updatedBase: typeof targetBase = {
      ...targetBase,
      instalRcvd: newInstalRcvd,
      recoveredAmount: newRecovered,
      remainingAmount: newRemaining,
      manualRecovered: targetBase.useManualBalance ? newRecovered : targetBase.manualRecovered,
      manualRemaining: targetBase.useManualBalance ? newRemaining : targetBase.manualRemaining,
      updatedAt: now
    };

    const nextBaseDeals = baseDeals.map((d) => (d.id === receiptDealId ? updatedBase : d));

    // persist month record + base deal
    setMonthRecords(nextMonthRecords);
    setBaseDeals(nextBaseDeals);
    await saveMonthRecord(nextRecord);
    await saveBaseDeal(updatedBase);

    // propagate closing balance to all later months
    await propagateSnapshotForward(receiptDealId, activeMonthId, newRecovered, newRemaining);

    setReceiptOpen(false);
  };

  const handleDeleteDeal = async (dealId: string) => {
    const confirmDelete = window.confirm(
      "Delete this deal from all months? This cannot be undone."
    );
    if (!confirmDelete) {
      return;
    }

    await deleteDealEverywhere(dealId);
    const nextBaseDeals = baseDeals.filter((deal) => deal.id !== dealId);
    const nextMonthRecords = monthRecords.filter(
      (record) => record.dealId !== dealId
    );
    setBaseDeals(nextBaseDeals);
    setMonthRecords(nextMonthRecords);

    if (detailMode) {
      window.history.back();
    } else {
      setDrawerOpen(false);
    }
  };

  const handleSelectMonth = async (monthId: string) => {
    setActiveMonthState(monthId);
    await setActiveMonthId(monthId);
    const records = await getMonthRecords(monthId);
    setMonthRecords(records);
  };

  const handleCreateMonth = async () => {
    // Ask user for the month they want to create
    const input = window.prompt(
      "Enter month (YYYY-MM), e.g. 2025-07:",
      (() => {
        // default = next month after latest existing
        const sorted = [...months].sort((a, b) => b.id.localeCompare(a.id));
        if (sorted.length > 0) {
          const [y, m] = sorted[0].id.split("-").map(Number);
          const next = new Date(y, m); // m is already 1-based, Date month is 0-based so this is +1
          return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
        }
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      })()
    );
    if (!input) return;
    const trimmed = input.trim();
    if (!/^\d{4}-\d{2}$/.test(trimmed)) {
      alert("Invalid format. Use YYYY-MM (e.g. 2025-07).");
      return;
    }
    if (months.find((m) => m.id === trimmed)) {
      alert("That month already exists.");
      await handleSelectMonth(trimmed);
      return;
    }
    // label from the date
    const [y, mo] = trimmed.split("-").map(Number);
    const label = new Date(y, mo - 1).toLocaleString("en-US", { month: "short", year: "numeric" });
    // create from active month as source
    await createNextMonth(activeMonthId ?? "", trimmed, label);
    const monthList = await getMonths();
    setMonths(monthList);
    await handleSelectMonth(trimmed);
  };

  const handleDeleteMonth = async (monthId: string) => {
    if (months.length <= 1) {
      alert("Cannot delete the only month.");
      return;
    }
    const month = months.find((m) => m.id === monthId);
    if (!window.confirm(`Delete "${month?.label ?? monthId}" and all its receipts? This cannot be undone.`)) return;
    await deleteMonth(monthId);
    const monthList = await getMonths();
    setMonths(monthList);
    if (activeMonthId === monthId) {
      const next = [...monthList].sort((a, b) => b.id.localeCompare(a.id))[0];
      if (next) await handleSelectMonth(next.id);
    }
  };

  useEffect(() => {
    if (!detailMode || !detailDealId) {
      return;
    }
    setDrawerDealId(detailDealId);
    setDrawerMode("view");
    setDrawerOpen(true);
  }, [detailDealId, detailMode]);

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        <p>Loading deals database...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="loading">
        <h2>Something went wrong</h2>
        <p>{error}</p>
      </div>
    );
  }

  const drawerIsOpen = detailMode ? Boolean(selectedDeal) : drawerOpen;

  return (
    <div className={`app ${detailMode ? "app--detail" : ""}`}>
      {!detailMode && (
        <aside className="sidebar">
          <div className="sidebar__header">
            <p className="sidebar__eyebrow">Databases</p>
            <h2>Months</h2>
            {activeMonthLabel && (
              <p className="sidebar__active">Active: {activeMonthLabel}</p>
            )}
          </div>
          <div className="sidebar__months">
            {[...months]
              .sort((a, b) => b.id.localeCompare(a.id))
              .map((month) => (
                <div
                  key={month.id}
                  className={`sidebar__month ${
                    month.id === activeMonthId ? "sidebar__month--active" : ""
                  }`}
                >
                  <button
                    className="sidebar__month-label"
                    onClick={() => handleSelectMonth(month.id)}
                  >
                    <span>{month.label}</span>
                    <span className="sidebar__month-id">{month.id}</span>
                  </button>
                  <button
                    className="sidebar__month-delete"
                    title="Delete month"
                    onClick={(e) => { e.stopPropagation(); void handleDeleteMonth(month.id); }}
                  >
                    ×
                  </button>
                </div>
              ))}
          </div>
          <button className="btn btn--primary" onClick={handleCreateMonth}>
            + Add month
          </button>
        </aside>
      )}

      <main className="main">
        {!detailMode && (
          <>
            <header className="hero">
              <div>
                <p className="hero__eyebrow">Deal Manager</p>
                <h1>Track every deal without the spreadsheet.</h1>
                <p className="hero__subtitle">
                  Live formulas stay intact, receipts stay attached, and
                  everything stays on your machine.
                </p>
              </div>
              <div className="hero__actions">
                <button className="btn btn--primary" onClick={openDrawerForNew}>
                  Add new deal
                </button>
              </div>
            </header>

            <section className="stats">
              <div>
                <p className="deal-card__label">Total invested</p>
                <p className="stats__value">{currency.format(totals.invested)}</p>
              </div>
              <div>
                <p className="deal-card__label">Recovered</p>
                <p className="stats__value">{currency.format(totals.recovered)}</p>
              </div>
              <div>
                <p className="deal-card__label">Remaining</p>
                <p className="stats__value">{currency.format(totals.remaining)}</p>
              </div>
              <div>
                <p className="deal-card__label">Active deals</p>
                <p className="stats__value">{totals.active}</p>
              </div>
            </section>

            {(() => {
                const total = deals.filter(d => d.remainingAmount > 0).length;
                const rcvd = deals.filter(d => d.remainingAmount > 0 && (d.received > 0 || d.receipts.length > 0)).length;
                const pending = total - rcvd;
                return (
                  <div className="checker">
                    <p className="checker__label">This month — {activeMonthLabel || "current"}</p>
                    <p className="checker__counts">
                      <span>{rcvd}</span>/{total} received &nbsp;·&nbsp; <span style={{color: pending > 0 ? '#991b1b' : 'inherit'}}>{pending}</span> pending
                    </p>
                  </div>
                );
              })()}

            <section className="toolbar">
              <div className="search">
                <input
                  placeholder="Search by name, deal number, referral, or mobile"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="toolbar__filters">
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(
                      event.target.value as "all" | "active" | "closed"
                    )
                  }
                >
                  <option value="all">All deals</option>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </select>
                <select
                  value={receiptFilter}
                  onChange={(event) =>
                    setReceiptFilter(
                      event.target.value as
                        | "all"
                        | "received"
                        | "not-received"
                    )
                  }
                >
                  <option value="all">All receipt status</option>
                  <option value="received">Received this month</option>
                  <option value="not-received">Not received</option>
                </select>
                <select
                  value={referralFilter}
                  onChange={(event) => setReferralFilter(event.target.value)}
                >
                  {referralOptions.map((option) => (
                    <option key={option} value={option}>
                      {option === "all" ? "All referrals" : option}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            {filteredDeals.length === 0 ? (
              <section className="empty">
                <h2>No deals match the filters.</h2>
                <p>Try another search or add a new deal.</p>
              </section>
            ) : (
              <section className="deal-list">
                {filteredDeals.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    onSelect={openDealWindow}
                    onReceive={handleOpenReceipt}
                  />
                ))}
              </section>
            )}
          </>
        )}

        {detailMode && !selectedDeal && (
          <section className="empty">
            <h2>Deal not found.</h2>
            <p>The deal may have been deleted or moved to another month.</p>
          </section>
        )}
      </main>

      <DealDrawer
        mode={drawerMode}
        open={drawerIsOpen}
        variant={detailMode ? "page" : "panel"}
        deal={drawerMode === "view" ? selectedDeal : null}
        formulas={formulas}
        onClose={() => {
          if (detailMode) {
            window.history.back();
            return;
          }
          setDrawerOpen(false);
        }}
        onSave={handleSaveDeal}
        onAddReceipt={handleOpenReceipt}
        onDelete={handleDeleteDeal}
      />

      <Modal
        open={receiptOpen}
        title="Add receipt"
        onClose={() => setReceiptOpen(false)}
      >
        <div className="modal__form">
          <label>
            Amount received
            <input
              type="number"
              value={receiptDraft.amount}
              onChange={(event) =>
                setReceiptDraft((current) => ({
                  ...current,
                  amount: Number(event.target.value)
                }))
              }
            />
          </label>
          <label>
            Received date
            <input
              type="date"
              value={receiptDraft.receivedAt}
              onChange={(event) =>
                setReceiptDraft((current) => ({
                  ...current,
                  receivedAt: event.target.value
                }))
              }
            />
          </label>
          <label>
            Instalments counted
            <input
              type="number"
              value={receiptDraft.installments}
              onChange={(event) =>
                setReceiptDraft((current) => ({
                  ...current,
                  installments: Number(event.target.value)
                }))
              }
            />
          </label>
          <label>
            Note
            <textarea
              value={receiptDraft.note}
              onChange={(event) =>
                setReceiptDraft((current) => ({
                  ...current,
                  note: event.target.value
                }))
              }
              placeholder="Optional detail"
            />
          </label>
          <div className="modal__actions">
            <button
              className="btn btn--ghost"
              onClick={() => setReceiptOpen(false)}
            >
              Cancel
            </button>
            <button className="btn btn--primary" onClick={handleSaveReceipt}>
              Save receipt
            </button>
          </div>
        </div>
      </Modal>

      {formWarning && (
        <div className="toast" role="status">
          {formWarning}
        </div>
      )}
    </div>
  );
}
