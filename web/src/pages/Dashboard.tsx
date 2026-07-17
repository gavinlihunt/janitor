import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DetailSheet } from '@/components/DetailSheet';
import { Header } from '@/components/Header';
import { HeroStrip } from '@/components/HeroStrip';
import { ResourceTable, type SortKey } from '@/components/ResourceTable';
import {
  api,
  type ResourceGroupSummary,
  type RiskLevel,
  type ScoredResource,
  type Summary,
} from '@/lib/api';
import { fmtUsd } from '@/lib/format';

const DOT: Record<RiskLevel, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  healthy: 'bg-emerald-500',
};

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [groups, setGroups] = useState<ResourceGroupSummary[]>([]);
  const [resources, setResources] = useState<ScoredResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>('score');
  const [rg, setRg] = useState<string | null>(null);
  const [selected, setSelected] = useState<ScoredResource | null>(null);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [sessionDailyUsd, setSessionDailyUsd] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const refreshTotals = useCallback(async () => {
    try {
      const [s, g] = await Promise.all([api.summary(), api.resourceGroups()]);
      setSummary(s);
      setGroups(g);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to refresh totals');
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, g, r] = await Promise.all([
        api.summary(),
        api.resourceGroups(),
        api.resources({ sort, rg }),
      ]);
      setSummary(s);
      setGroups(g);
      setResources(r);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [sort, rg]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await api.sync();
      await loadAll();
      toast.success('Imported the latest data from Azure');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [loadAll]);

  const handleSetInUse = useCallback(
    async (r: ScoredResource, inUse: boolean) => {
      try {
        const { resource } = await api.setInUse(r.id, inUse);
        setResources((prev) => prev.map((x) => (x.id === r.id ? resource : x)));
        void refreshTotals();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update the in-use flag');
      }
    },
    [refreshTotals]
  );

  const handleHibernate = useCallback(
    async (r: ScoredResource) => {
      try {
        const { resource, reclaimedDailyUsd } = await api.hibernate(r.id);
        setResources((prev) => prev.map((x) => (x.id === r.id ? resource : x)));
        setSessionDailyUsd((v) => v + reclaimedDailyUsd);
        toast.success(`Hibernated ${r.name}`, {
          description: `${fmtUsd(reclaimedDailyUsd)}/day reclaimed`,
        });
        void refreshTotals();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Hibernate failed');
      }
    },
    [refreshTotals]
  );

  const handleTeardown = useCallback(
    async (r: ScoredResource, confirm: string) => {
      try {
        const { reclaimedDailyUsd } = await api.teardown(r.id, confirm);
        setSessionDailyUsd((v) => v + reclaimedDailyUsd);
        setRemoving((prev) => new Set(prev).add(r.id));
        toast.success(`${r.name} deleted`, {
          description: `${fmtUsd(reclaimedDailyUsd)}/day reclaimed`,
        });
        window.setTimeout(() => {
          setResources((prev) => prev.filter((x) => x.id !== r.id));
          setRemoving((prev) => {
            const next = new Set(prev);
            next.delete(r.id);
            return next;
          });
        }, 420);
        void refreshTotals();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Teardown failed');
        throw err;
      }
    },
    [refreshTotals]
  );

  return (
    <div className="min-h-screen">
      <Header summary={summary} sessionDailyUsd={sessionDailyUsd} />
      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <HeroStrip summary={summary} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={rg ?? 'all'} onValueChange={(v) => setRg(v === 'all' ? null : v)}>
            <TabsList>
              <TabsTrigger value="all">All groups</TabsTrigger>
              {groups.map((g) => (
                <TabsTrigger key={g.name} value={g.name}>
                  <span className={`h-2 w-2 rounded-full ${DOT[g.worstRisk]}`} />
                  {g.name}
                  <span className="text-xs text-muted-foreground">{fmtUsd(g.estDailyCostUsd)}/d</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-3">
            <p className="text-xs text-muted-foreground">
              {summary?.estimatesOnly
                ? 'All figures are estimates from a static price map'
                : 'Figures from the Azure Consumption API'}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        </div>

        <ResourceTable
          resources={resources}
          loading={loading}
          sort={sort}
          onSortChange={setSort}
          removingIds={removing}
          onHibernate={handleHibernate}
          onTeardown={handleTeardown}
          onSetInUse={handleSetInUse}
          onSelect={setSelected}
        />
      </main>
      <DetailSheet resource={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
