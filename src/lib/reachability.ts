/**
 * reachability.ts — removed (online-only mode)
 *
 * Server reachability probing is no longer needed.
 * Network errors propagate naturally from fetch() to the UI.
 */

export function resetReachabilityCache(): void {}

export async function isServerReachable(): Promise<boolean> {
  return true;
}
