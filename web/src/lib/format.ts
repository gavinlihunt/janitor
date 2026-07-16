const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

export const fmtUsd = (value: number): string => usd.format(value);

const DAY_MS = 24 * 60 * 60 * 1000;

export function relativeTime(iso: string | null): string {
  if (!iso) return 'none in 90+ days';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'a month ago' : `${months} months ago`;
}
