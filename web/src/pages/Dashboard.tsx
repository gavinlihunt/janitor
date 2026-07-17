import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GroupList } from '@/components/GroupList';
import { Header } from '@/components/Header';
import { HeroStrip } from '@/components/HeroStrip';
import { api, type ResourceGroupSummary, type Summary } from '@/lib/api';

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [groups, setGroups] = useState<ResourceGroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, g] = await Promise.all([api.summary(), api.resourceGroups()]);
      setSummary(s);
      setGroups(g);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

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

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? groups.filter((g) => g.name.toLowerCase().includes(q)) : groups),
    [q, groups]
  );

  return (
    <div className="min-h-screen">
      <Header summary={summary} />
      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <HeroStrip summary={summary} />

        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">Resource groups</h2>
              <p className="text-xs text-muted-foreground">
                {summary?.estimatesOnly
                  ? 'All figures are estimates from a static price map'
                  : 'Figures from the Azure Consumption API'}
                {groups.length > 0 && ' · select a group to see its resources'}
              </p>
            </div>
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

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search resource groups…"
              className="pl-9"
              aria-label="Search resource groups by name"
            />
          </div>

          <GroupList
            groups={shown}
            loading={loading}
            emptyMessage={q ? `No resource groups match “${query.trim()}”.` : undefined}
          />
        </div>
      </main>
    </div>
  );
}
