import { useSyncExternalStore } from 'react';

export type Currency = 'USD' | 'GBP' | 'ZAR';

export const CURRENCIES: Currency[] = ['USD', 'GBP', 'ZAR'];

/**
 * Approximate, static conversion rates from 1 USD. These are illustrative
 * defaults, not live market rates. Update them here in one place. The UI labels
 * converted amounts as approximate so the figures are never presented as
 * authoritative exchange rates.
 */
export const USD_RATES: Record<Currency, number> = {
  USD: 1,
  GBP: 0.79,
  ZAR: 18.4,
};

const formatters: Record<Currency, Intl.NumberFormat> = {
  USD: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }),
  GBP: new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }),
  ZAR: new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }),
};

const STORAGE_KEY = 'azure-janitor.currency';

function readInitial(): Currency {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'USD' || saved === 'GBP' || saved === 'ZAR') return saved;
  } catch {
    // Storage may be unavailable; fall back to the default.
  }
  return 'USD';
}

let current: Currency = readInitial();
const listeners = new Set<() => void>();

export function getCurrency(): Currency {
  return current;
}

export function setCurrency(next: Currency): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Ignore storage write failures; the in-memory value still updates.
  }
  for (const listener of listeners) listener();
}

export function useCurrency(): Currency {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => current,
    () => 'USD'
  );
}

/** Convert a USD amount into the given (or current) currency and format it. */
export function formatMoney(usd: number, currency: Currency = current): string {
  return formatters[currency].format(usd * USD_RATES[currency]);
}

const wholeFormatters: Record<Currency, Intl.NumberFormat> = {
  USD: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }),
  GBP: new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }),
  ZAR: new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }),
};

/** As formatMoney, but rounded to whole units for large display figures. */
export function formatMoneyWhole(usd: number, currency: Currency = current): string {
  return wholeFormatters[currency].format(usd * USD_RATES[currency]);
}
