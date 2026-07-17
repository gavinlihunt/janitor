import { getProvider } from '../azure/provider';
import { resolveDailyCost } from './burnRate';
import { ResourceUpsert, replaceResources, setSyncMeta, SyncMeta } from '../db/resourcesRepo';

export interface SyncResult {
  count: number;
  estimatesOnly: boolean;
  subscriptionName: string;
  lastSyncedAt: string;
}

/**
 * Pull the full resource set, and live costs when enabled, from the provider and
 * persist them to SQLite. The user's inUse flag is preserved by the repository.
 * This is the only place, besides destructive actions, that contacts Azure.
 */
export async function syncFromProvider(): Promise<SyncResult> {
  const provider = getProvider();
  const [subscriptionName, resources] = await Promise.all([
    provider.getSubscriptionName(),
    provider.listResources(),
  ]);

  let usage: Map<string, number> | null = null;
  if (process.env.USE_CONSUMPTION_API === 'true' && provider.getUsageDailyCosts) {
    try {
      usage = await provider.getUsageDailyCosts();
    } catch (err) {
      console.warn('[azure-janitor] cost query unavailable, falling back to the price map:', err);
    }
  }
  const estimatesOnly = usage === null;

  const syncedAt = new Date().toISOString();
  const rows: ResourceUpsert[] = resources.map((r) => ({
    ...r,
    estDailyCostUsd: resolveDailyCost(r, usage),
  }));
  replaceResources(rows, syncedAt);
  const meta: SyncMeta = { subscriptionName, mockMode: provider.isMock, estimatesOnly, lastSyncedAt: syncedAt };
  setSyncMeta(meta);

  return { count: rows.length, estimatesOnly, subscriptionName, lastSyncedAt: syncedAt };
}
