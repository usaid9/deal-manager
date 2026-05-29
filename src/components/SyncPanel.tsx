import { useState, useEffect } from "react";
import { getSyncInfo } from "../lib/store";
import type { SyncStatus } from "../lib/syncEngine";

interface SyncPanelProps {
  open: boolean;
  onClose: () => void;
  syncStatus: SyncStatus;
  pendingCount: number;
  onRefresh: () => void;
}

export default function SyncPanel({ open, onClose, onRefresh }: SyncPanelProps) {
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!open) { setReachable(null); setCount(null); return; }
    setLoading(true);
    getSyncInfo()
      .then((info) => { setReachable(info.reachable); setCount(info.remoteCount); })
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const doRefresh = async () => {
    setRefreshing(true);
    try { onRefresh(); onClose(); }
    finally { setRefreshing(false); }
  };

  return (
    <div className="sync-overlay" onClick={onClose}>
      <div className="sync-panel" onClick={(e) => e.stopPropagation()}>

        <div className="sync-panel__header">
          <h2 className="sync-panel__title">Connection Status</h2>
          <button className="sync-panel__close" onClick={onClose}>×</button>
        </div>

        <div className={`sync-panel__status sync-panel__status--${reachable === false ? "offline" : "idle"}`}>
          <span className="sync-panel__status-dot" />
          <span>
            {loading
              ? "Checking server…"
              : reachable === false
              ? "Server unreachable — check your network"
              : "Connected — all changes save directly to the server"}
          </span>
        </div>

        {!loading && reachable !== null && (
          <div className="sync-panel__compare">
            <div className={`sync-panel__side${reachable ? " sync-panel__side--winner" : " sync-panel__side--offline"}`}>
              <div className="sync-panel__side-icon">☁</div>
              <div className="sync-panel__side-label">Server (MongoDB)</div>
              {reachable
                ? <div className="sync-panel__side-count">{count} deals</div>
                : <div className="sync-panel__side-offline-msg">Unreachable</div>}
            </div>
          </div>
        )}

        {!loading && reachable !== null && (
          <div className={`sync-panel__rec sync-panel__rec--${reachable ? "ok" : "warn"}`}>
            {reachable
              ? "✓ Fully online. Every save goes straight to the server."
              : "✗ Cannot reach the server. Check your internet connection."}
          </div>
        )}

        <div className="sync-panel__actions">
          <div className="sync-panel__action-group">
            <button
              className="sync-panel__action-btn sync-panel__action-btn--pull sync-panel__action-btn--recommended"
              onClick={doRefresh}
              disabled={refreshing}
            >
              {refreshing ? <span className="sync-spin">⟳</span> : "↺"}
              <span>
                <strong>Reload Data</strong>
                <small>Re-fetch the latest data from the server</small>
              </span>
            </button>
          </div>
        </div>

        <details className="sync-panel__info">
          <summary>How it works</summary>
          <ul>
            <li>This is a fully online app — no local cache is used.</li>
            <li>Every save, edit, and delete goes directly to the server.</li>
            <li>Changes from any device are visible immediately on reload.</li>
            <li>An internet connection is required to use the app.</li>
          </ul>
        </details>

      </div>
    </div>
  );
}
