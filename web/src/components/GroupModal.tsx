import { useCallback, useEffect, useMemo, useState } from 'react';
import { Flame, MoonStar } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DetailSheet } from '@/components/DetailSheet';
import { ResourceTable, type SortKey, type SortState } from '@/components/ResourceTable';
import { api, type RiskLevel, type ScoredResource } from '@/lib/api';
import { formatMoney, useCurrency } from '@/lib/currency';
import { addReclaimed } from '@/lib/session';

const RISK_LABEL: Record<RiskLevel, string> = {
  critical: 'Critical',
  warning: 'Warning',
  healthy: 'Healthy',
};

const RISK_STYLE: Record<RiskLevel, string> = {
  critical: 'border-red-500/40 bg-red-500/10 text-red-400',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  healthy: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
};

/** Sort comparator in ascending order; the table flips it for descending. */
function compareResources(a: ScoredResource, b: ScoredResource, key: SortKey): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'type':
      return a.kind.localeCompare(b.kind) || a.azureType.localeCompare(b.azureType);
    case 'cost':
      return a.estDailyCostUsd - b.estDailyCostUsd;
    case 'risk':
      return a.score - b.score;
    case 'lastActivity': {
      const av = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
      const bv = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
      return av - bv;
    }
    default:
      return 0;
  }
}

/**
 * Modal showing every resource in one resource group plus scoped totals and
 * actions. Open state is driven by `groupName`: a non-null name opens it. The
 * route still backs this, so deep links and the browser Back button work.
 */
export default function GroupModal({
  groupName,
  onClose,
}: {
  groupName: string | null;
  onClose: () => void;
}) {
  const [resources, setResources] = useState<ScoredResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: 'cost', dir: 'desc' });
  const [selected, setSelected] = useState<ScoredResource | null>(null);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const currency = useCurrency();
  const open = groupName !== null;

  useEffect(() => {
    if (!groupName) return;
    let cancelled = false;
    setLoading(true);
    setSelected(null);
    api
      .resources({ rg: groupName })
      .then((r) => {
        if (!cancelled) setResources(r);
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load the resource group');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupName]);

  const handleSetInUse = useCallback(async (r: ScoredResource, inUse: boolean) => {
    try {
      const { resource } = await api.setInUse(r.id, inUse);
      setResources((prev) => prev.map((x) => (x.id === r.id ? resource : x)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update the in-use flag');
    }
  }, []);

  const handleHibernate = useCallback(async (r: ScoredResource) => {
    try {
      const { resource, reclaimedDailyUsd } = await api.hibernate(r.id);
      setResources((prev) => prev.map((x) => (x.id === r.id ? resource : x)));
      addReclaimed(reclaimedDailyUsd);
      toast.success(`Hibernated ${r.name}`, {
        description: `${formatMoney(reclaimedDailyUsd)}/day reclaimed`,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Hibernate failed');
    }
  }, []);

  const handleTeardown = useCallback(async (r: ScoredResource, confirm: string) => {
    try {
      const { reclaimedDailyUsd } = await api.teardown(r.id, confirm);
      addReclaimed(reclaimedDailyUsd);
      setRemoving((prev) => new Set(prev).add(r.id));
      toast.success(`${r.name} deleted`, {
        description: `${formatMoney(reclaimedDailyUsd)}/day reclaimed`,
      });
      window.setTimeout(() => {
        setResources((prev) => prev.filter((x) => x.id !== r.id));
        setRemoving((prev) => {
          const next = new Set(prev);
          next.delete(r.id);
          return next;
        });
      }, 420);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Teardown failed');
      throw err;
    }
  }, []);

  const sortedResources = useMemo(() => {
    const copy = [...resources];
    copy.sort((a, b) =>
      sort.dir === 'asc' ? compareResources(a, b, sort.key) : -compareResources(a, b, sort.key)
    );
    return copy;
  }, [resources, sort]);

  // Scoped aggregates. The idle rule matches the server: a resource counts as
  // idle when it is not marked in use and is not healthy.
  const stats = useMemo(() => {
    const idle = resources.filter((r) => !r.inUse && r.risk !== 'healthy');
    const dailyCost = resources.reduce((sum, r) => sum + r.estDailyCostUsd, 0);
    const potentialDaily = idle.reduce(
      (sum, r) => sum + Math.max(r.estDailyCostUsd - r.estHibernatedDailyCostUsd, 0),
      0
    );
    const byRisk: Record<RiskLevel, number> = { critical: 0, warning: 0, healthy: 0 };
    for (const r of resources) byRisk[r.risk] += 1;
    return { idleCount: idle.length, dailyCost, potentialDaily, byRisk };
  }, [resources]);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) {
            setSelected(null);
            onClose();
          }
        }}
      >
        <DialogContent className="max-h-[88vh] w-[95vw] max-w-6xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono">{groupName}</DialogTitle>
            <DialogDescription>
              Resource group · {resources.length} resource{resources.length === 1 ? '' : 's'} ·{' '}
              {formatMoney(stats.dailyCost, currency)}/day
            </DialogDescription>
          </DialogHeader>

          {!loading && resources.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {(['critical', 'warning', 'healthy'] as RiskLevel[])
                .filter((level) => stats.byRisk[level] > 0)
                .map((level) => (
                  <span
                    key={level}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${RISK_STYLE[level]}`}
                  >
                    {stats.byRisk[level]} {RISK_LABEL[level]}
                  </span>
                ))}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="flex h-full flex-col justify-center gap-1 p-4">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Flame className="h-4 w-4 text-amber-400" /> Daily cost
                </p>
                <p className="text-2xl font-semibold tabular-nums text-amber-400">
                  {formatMoney(stats.dailyCost, currency)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex h-full flex-col justify-center gap-1 p-4">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MoonStar className="h-4 w-4 text-emerald-400" /> Idle resources
                </p>
                <p className="text-2xl font-semibold tabular-nums">{stats.idleCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex h-full flex-col justify-center gap-1 p-4">
                <p className="text-xs text-muted-foreground">Potential savings</p>
                <p className="text-2xl font-semibold tabular-nums text-emerald-400">
                  {formatMoney(stats.potentialDaily, currency)}
                </p>
              </CardContent>
            </Card>
          </div>

          <ResourceTable
            resources={sortedResources}
            loading={loading}
            sort={sort}
            onSortChange={setSort}
            removingIds={removing}
            onHibernate={handleHibernate}
            onTeardown={handleTeardown}
            onSetInUse={handleSetInUse}
            onSelect={setSelected}
          />
        </DialogContent>
      </Dialog>
      <DetailSheet resource={selected} onClose={() => setSelected(null)} />
    </>
  );
}
