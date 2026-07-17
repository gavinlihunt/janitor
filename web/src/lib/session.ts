import { useSyncExternalStore } from 'react';

/**
 * Tiny in-memory store for the "reclaimed this session" total shown in the
 * header. It lives outside React state so the figure survives navigation
 * between the dashboard and a resource group page. It resets on page reload,
 * which is the intended "session" scope.
 */
let reclaimedDailyUsd = 0;
const listeners = new Set<() => void>();

export function addReclaimed(amount: number): void {
  reclaimedDailyUsd += amount;
  for (const listener of listeners) listener();
}

export function useReclaimed(): number {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => reclaimedDailyUsd,
    () => 0
  );
}
