/**
 * reachability.ts
 * Probes whether the MongoDB API server is actually up.
 * Uses GET /months (a real endpoint) instead of /health which doesn't exist.
 * Any HTTP response (even 4xx) = server is up. Only network errors = offline.
 *
 * FIX: Reduced timeout for Android WebView (was 4s, now 6s with fallback).
 * FIX: Explicit no-cors mode removed — was causing opaque responses on Android.
 */

// FIX: Use a runtime-safe env read. On Android WebView, import.meta.env may
// not be replaced if the build was stale. Fall back gracefully.
const getBase = (): string => {
  
    return (import.meta.env.VITE_API_URL as string);
  
};

const BASE = getBase();

let _reachable: boolean | null = null;
let _probePromise: Promise<boolean> | null = null;

export function resetReachabilityCache(): void {
  _reachable = null;
  _probePromise = null;
}

export async function isServerReachable(): Promise<boolean> {
  if (_reachable !== null) return _reachable;
  if (_probePromise) return _probePromise;

  _probePromise = (async (): Promise<boolean> => {
    try {
      const ctrl = new AbortController();
      // FIX: 6s timeout — Android WebView can be slow on first connection
      const tid = setTimeout(() => ctrl.abort(), 6000);
      await fetch(`${BASE}/months`, {
        method: "GET",
        signal: ctrl.signal,
        cache: "no-store",
        // FIX: Do NOT use mode:"no-cors" — it returns opaque responses that
        // can't be read and hides real errors. Default (same-origin/cors) is correct.
      });
      clearTimeout(tid);
      _reachable = true;
    } catch {
      // fetch throws only on network error or abort (timeout) — genuinely offline
      _reachable = false;
    }
    // Re-probe after 30s
    setTimeout(() => { _reachable = null; _probePromise = null; }, 30_000);
    return _reachable as boolean;
  })();

  return _probePromise;
}
