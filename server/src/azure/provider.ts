import { ActivityEntry, JanitorResource, ProviderInsights } from '../types';

/**
 * Every Azure SDK call sits behind this interface so the app can run
 * entirely against mock data (MOCK_MODE=true) or against a live subscription.
 */
export interface IAzureProvider {
  readonly isMock: boolean;
  getSubscriptionName(): Promise<string>;
  listResources(): Promise<JanitorResource[]>;
  getActivityLog(resourceId: string): Promise<ActivityEntry[]>;
  /**
   * Deallocate a VM, scale an App Service Plan down to B1/F1, or floor
   * Cosmos DB provisioned throughput. Returns the updated resource.
   */
  hibernate(resourceId: string): Promise<JanitorResource>;
  /** Delete the resource. */
  teardown(resourceId: string): Promise<void>;
  /**
   * Optional: real per-resource daily cost from the Consumption API,
   * keyed by lower-cased resource id. Used when USE_CONSUMPTION_API=true.
   */
  getUsageDailyCosts?(): Promise<Map<string, number>>;
  /**
   * Metric-based dashboard findings: idle-CPU VMs, orphaned disks, zero-traffic
   * apps and a daily cost series. Captured at sync time and persisted to SQLite.
   */
  getDashboardInsights?(): Promise<ProviderInsights>;
}

let provider: IAzureProvider | null = null;

export function getProvider(): IAzureProvider {
  if (!provider) {
    if (process.env.MOCK_MODE === 'true') {
      const { MockAzureProvider } = require('../mock/mockProvider') as typeof import('../mock/mockProvider');
      provider = new MockAzureProvider();
    } else {
      const { LiveAzureProvider } = require('./liveProvider') as typeof import('./liveProvider');
      provider = new LiveAzureProvider();
    }
  }
  return provider;
}
