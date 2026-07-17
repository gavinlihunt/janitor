import { ChevronRight } from 'lucide-react';
import { navigate } from '@/lib/router';
import { formatMoney, useCurrency } from '@/lib/currency';
import { Skeleton } from '@/components/ui/skeleton';
import type { ResourceGroupSummary, RiskLevel } from '@/lib/api';

const DOT: Record<RiskLevel, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  healthy: 'bg-emerald-500',
};

/**
 * Vertical list of resource groups (pre-sorted by daily cost). Each row opens
 * that group's detail page, where all of its resources are shown.
 */
export function GroupList({
  groups,
  loading,
  emptyMessage = 'No resource groups yet. Click Refresh to import from Azure.',
}: {
  groups: ResourceGroupSummary[];
  loading: boolean;
  emptyMessage?: string;
}) {
  const currency = useCurrency();

  if (loading) {
    return (
      <div className="divide-y rounded-xl border bg-card">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="px-4 py-3.5">
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border bg-card py-12 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="divide-y rounded-xl border bg-card">
      {groups.map((g) => (
        <button
          key={g.name}
          type="button"
          onClick={() => navigate({ name: 'group', group: g.name })}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
        >
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[g.worstRisk]}`} />
          <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium">{g.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {g.resourceCount} resource{g.resourceCount === 1 ? '' : 's'}
          </span>
          <span className="w-24 shrink-0 text-right text-sm font-medium tabular-nums text-amber-400">
            {formatMoney(g.estDailyCostUsd, currency)}/d
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      ))}
    </div>
  );
}
