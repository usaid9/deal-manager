import { useState, useEffect } from "react";
import { getSyncInfo, forcePullFromRemote, forcePushToRemote } from "../lib/store";
import type { SyncStatus } from "../lib/syncEngine";

interface SyncPanelProps {
  open: boolean;
  onClose: () => void;
  syncStatus: SyncStatus;
  pendingCount: number;
  onRefresh: () => void;
}

type SyncInfo = {
  localNewest: string;
  remoteNewest: string;
  localCount: number;
  remoteCount: number;
  reachable: boolean;
};

function fmtDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });
}

function newer(a: string, b: string): "a" | "b" | "same" {
  if (!a && !b) return "same";
  if (!a) return "b";
  if (!b) return "a";
  return a > b ? "a" : a < b ? "b" : "same";
}

export default function SyncPanel({ open, onClose, syncStatus, pendingCount, onRefresh }: SyncPanelProps) {
  const [info, setInfo] = useState<SyncInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"pull" | "push" | null>(null);
  const [result, setResult] = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  useEffect(() => {
    if (!open) { setResult(null); setInfo(null); return; }
    setLoading(true);
    getSyncInfo().then(setInfo).finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const who = info ? newer(info.localNewest, info.remoteNewest) : "same";
  const localIsNewer = who === "a";
  const remoteIsNewer = who === "b";
  const inSync = who === "same";

  const doPull = async () => {
    setBusy("pull"); setResult(null);
    try {
      await forcePullFromRemote();
      setResult({ type: "ok", msg: "Remote data pulled — refreshing…" });
      setTimeout(() => { onRefresh(); onClose(); }, 800);
    } catch (e) {
      setResult({ type: "err", msg: `Pull failed: ${e instanceof Error ? e.message : "network error"}` });
    } finally { setBusy(null); }
  };

  const doPush = async () => {
    setBusy("push"); setResult(null);
    try {
      await forcePushToRemote();
      setResult({ type: "ok", msg: "Local data pushed to server ✓" });
      setTimeout(() => { onRefresh(); onClose(); }, 800);
    } catch (e) {
      setResult({ type: "err", msg: `Push failed: ${e instanceof Error ? e.message : "network error"}` });
    } finally { setBusy(null); }
  };

  return (
    <div className="sync-overlay" onClick={onClose}>
      <div className="sync-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sync-panel__header">
          <h2 className="sync-panel__title">Sync Manager</h2>
          <button className="sync-panel__close" onClick={onClose}>×</button>
        </div>

        {/* Status strip */}
        <div className={`sync-panel__status sync-panel__status--${syncStatus}`}>
          <span className="sync-panel__status-dot" />
          <span>
            {syncStatus === "syncing" ? "Syncing…" :
             syncStatus === "offline" ? `Offline — ${pendingCount} change(s) queued` :
             syncStatus === "error" ? "Sync error — will retry" :
             "Auto-sync active"}
          </span>
          {pendingCount > 0 && <span className="sync-panel__badge">{pendingCount}</span>}
        </div>

        {/* Comparison table */}
        <div className="sync-panel__compare">
          {loading ? (
            <div className="sync-panel__loading">Comparing local vs server…</div>
          ) : info ? (
            <>
              <div className={`sync-panel__side${localIsNewer ? " sync-panel__side--winner" : ""}`}>
                <div className="sync-panel__side-icon">📱</div>
                <div className="sync-panel__side-label">This Device (Local)</div>
                <div className="sync-panel__side-count">{info.localCount} deals</div>
                <div className="sync-panel__side-time">{fmtDate(info.localNewest)}</div>
                {localIsNewer && <div className="sync-panel__badge-newer">NEWER</div>}
              </div>
              <div className="sync-panel__vs">
                {inSync ? "=" : localIsNewer ? "›" : "‹"}
              </div>
              <div className={`sync-panel__side${remoteIsNewer ? " sync-panel__side--winner" : ""}${!info.reachable ? " sync-panel__side--offline" : ""}`}>
                <div className="sync-panel__side-icon">☁</div>
                <div className="sync-panel__side-label">Server (MongoDB)</div>
                {info.reachable ? (
                  <>
                    <div className="sync-panel__side-count">{info.remoteCount} deals</div>
                    <div className="sync-panel__side-time">{fmtDate(info.remoteNewest)}</div>
                    {remoteIsNewer && <div className="sync-panel__badge-newer">NEWER</div>}
                  </>
                ) : (
                  <div className="sync-panel__side-offline-msg">Unreachable</div>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* Smart recommendation */}
        {info && info.reachable && !loading && (
          <div className={`sync-panel__rec sync-panel__rec--${inSync ? "ok" : "warn"}`}>
            {inSync
              ? "✓ Both sides are in sync. No action needed."
              : localIsNewer
              ? "⚠ Your local data is newer. Push to update the server."
              : "⚠ Server has newer data (edited from another device). Pull to update this device."}
          </div>
        )}

        {result && (
          <div className={`sync-panel__result sync-panel__result--${result.type}`}>
            {result.msg}
          </div>
        )}

        {/* Action buttons */}
        <div className="sync-panel__actions">
          <div className="sync-panel__action-group">
            <button
              className={`sync-panel__action-btn sync-panel__action-btn--pull${remoteIsNewer && info?.reachable ? " sync-panel__action-btn--recommended" : ""}`}
              onClick={doPull}
              disabled={busy !== null || !info?.reachable}
            >
              {busy === "pull" ? <span className="sync-spin">⟳</span> : "↓"}
              <span>
                <strong>Pull from Server</strong>
                <small>Replace local data with server's latest</small>
              </span>
            </button>
            <button
              className={`sync-panel__action-btn sync-panel__action-btn--push${localIsNewer && info?.reachable ? " sync-panel__action-btn--recommended" : ""}`}
              onClick={doPush}
              disabled={busy !== null || !info?.reachable}
            >
              {busy === "push" ? <span className="sync-spin">⟳</span> : "↑"}
              <span>
                <strong>Push to Server</strong>
                <small>Overwrite server with this device's data</small>
              </span>
            </button>
          </div>
          <p className="sync-panel__warning">
            ⚠ These are manual overrides. Both actions overwrite the other side completely.
          </p>
        </div>

        {/* How it works note */}
        <details className="sync-panel__info">
          <summary>How auto-sync works</summary>
          <ul>
            <li>Every save goes to local storage immediately (works offline).</li>
            <li>Changes are queued and pushed to the server when online.</li>
            <li>On startup, timestamps are compared — the newer side wins automatically.</li>
            <li>If you edited on mobile while offline, local will be newer → auto-pushed on next open.</li>
            <li>Use manual controls only when auto-sync chose wrong.</li>
          </ul>
        </details>
      </div>
    </div>
  );
}
