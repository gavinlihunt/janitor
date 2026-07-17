import { DefaultAzureCredential } from '@azure/identity';
import { ResourceManagementClient } from '@azure/arm-resources';
import { MonitorClient } from '@azure/arm-monitor';
import { ComputeManagementClient } from '@azure/arm-compute';
import { WebSiteManagementClient } from '@azure/arm-appservice';
import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { CostManagementClient } from '@azure/arm-costmanagement';
import { IAzureProvider } from './provider';
import { HttpError } from '../services/actions';
import {
  ActivityEntry,
  DailyCostPoint,
  GhostVm,
  JanitorResource,
  OrphanedDisk,
  ProviderInsights,
  ResourceKind,
  ZeroTrafficApp,
} from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_WINDOW_DAYS = 90;
const MAX_ACTIVITY_EVENTS = 2000;
/** Running VMs averaging below this CPU percentage over 24 hours count as ghosts. */
const GHOST_CPU_THRESHOLD = 2;
const GHOST_CPU_WINDOW_HOURS = 24;
/** Window for the zero-traffic Requests check. */
const ZERO_TRAFFIC_WINDOW_DAYS = 3;
const COST_SERIES_WINDOW_DAYS = 30;

/**
 * Rough estimated storage price per GB-month by managed disk SKU prefix.
 * Deliberately approximate, in line with the price-map approach elsewhere.
 */
const DISK_USD_PER_GB_MONTH: Record<string, number> = {
  UltraSSD: 0.3,
  PremiumV2: 0.095,
  Premium: 0.132,
  StandardSSD: 0.075,
  Standard: 0.045,
};

function estimateDiskMonthlyCost(skuName: string, sizeGb: number): number {
  const prefix = Object.keys(DISK_USD_PER_GB_MONTH).find((p) => skuName.startsWith(p));
  const rate = prefix ? DISK_USD_PER_GB_MONTH[prefix] : DISK_USD_PER_GB_MONTH.Standard;
  return Math.round(sizeGb * rate * 100) / 100;
}

function isWeekendDate(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

// Child/noise resource types that would clutter the dashboard.
const EXCLUDED_TYPES = new Set([
  'microsoft.network/networkinterfaces',
  'microsoft.network/networksecuritygroups',
  'microsoft.network/publicipaddresses',
  'microsoft.network/virtualnetworks',
  'microsoft.compute/disks',
  'microsoft.compute/virtualmachines/extensions',
  'microsoft.insights/components',
  'microsoft.operationalinsights/workspaces',
]);

function kindFromType(type: string): ResourceKind {
  const t = type.toLowerCase();
  if (t === 'microsoft.compute/virtualmachines') return 'vm';
  if (t === 'microsoft.web/serverfarms') return 'appServicePlan';
  if (t === 'microsoft.web/sites') return 'appService';
  if (t === 'microsoft.documentdb/databaseaccounts') return 'cosmos';
  if (t === 'microsoft.sql/servers/databases') return 'sql';
  if (t === 'microsoft.storage/storageaccounts') return 'storage';
  return 'other';
}

function kindFromId(id: string): ResourceKind {
  const m = id.match(/\/providers\/([^/]+\/[^/]+)/i);
  return kindFromType(m ? m[1] : '');
}

function rgFromId(id: string): string {
  const m = id.match(/\/resourceGroups\/([^/]+)/i);
  return m ? m[1] : '';
}

function parseResourceId(id: string): { resourceGroup: string; name: string } {
  const m = id.match(/\/resourceGroups\/([^/]+)\/providers\/[^/]+\/[^/]+\/([^/]+)/i);
  if (!m) throw new HttpError(400, `Unrecognised resource id: ${id}`);
  return { resourceGroup: m[1], name: m[2] };
}

/**
 * Live implementation against a real subscription via DefaultAzureCredential
 * (Azure CLI session or AZURE_CLIENT_ID / AZURE_CLIENT_SECRET / AZURE_TENANT_ID).
 * All enrichment is best effort: a failure in one detail lookup degrades that
 * resource's signal rather than failing the whole listing.
 */
export class LiveAzureProvider implements IAzureProvider {
  readonly isMock = false;
  private readonly subscriptionId: string;
  private readonly credential: DefaultAzureCredential;
  private readonly resources: ResourceManagementClient;
  private readonly monitor: MonitorClient;
  private readonly compute: ComputeManagementClient;
  private readonly web: WebSiteManagementClient;
  private readonly cosmos: CosmosDBManagementClient;

  constructor() {
    const sub = process.env.AZURE_SUBSCRIPTION_ID;
    if (!sub) {
      throw new Error('AZURE_SUBSCRIPTION_ID is required when MOCK_MODE is not true');
    }
    this.subscriptionId = sub;
    this.credential = new DefaultAzureCredential();
    this.resources = new ResourceManagementClient(this.credential, sub);
    this.monitor = new MonitorClient(this.credential, sub);
    this.compute = new ComputeManagementClient(this.credential, sub);
    this.web = new WebSiteManagementClient(this.credential, sub);
    this.cosmos = new CosmosDBManagementClient(this.credential, sub);
  }

  async getSubscriptionName(): Promise<string> {
    return this.subscriptionId;
  }

  async listResources(): Promise<JanitorResource[]> {
    const [generic, activityIndex, vmDetails, webDetails, cosmosDetails] = await Promise.all([
      this.listGenericResources(),
      this.buildActivityIndex(),
      this.getVmDetails(),
      this.getWebDetails(),
      this.getCosmosDetails(),
    ]);

    return generic
      .filter((res) => !EXCLUDED_TYPES.has(String(res.type ?? '').toLowerCase()))
      .map((res) => {
        const id = String(res.id ?? '');
        const idLower = id.toLowerCase();
        const kind = kindFromType(String(res.type ?? ''));
        const base: JanitorResource = {
          id,
          name: String(res.name ?? ''),
          kind,
          azureType: String(res.type ?? ''),
          resourceGroup: rgFromId(id),
          location: String(res.location ?? ''),
          sku: String(res.sku?.name ?? ''),
          tags: (res.tags ?? {}) as Record<string, string>,
          state: 'unknown',
          lastActivity: activityIndex.get(idLower) ?? null,
          idleSignals: [],
          hoursRunningPerDay: 24,
        };
        switch (kind) {
          case 'vm': {
            const d = vmDetails.get(idLower);
            if (d) {
              base.sku = d.size || base.sku;
              base.state = d.powerState || 'unknown';
              if (base.state === 'deallocated') base.hoursRunningPerDay = 0;
              if (base.state === 'running' && !base.lastActivity) {
                base.idleSignals.push('Running with no activity log entries in the last 90 days');
              }
            }
            break;
          }
          case 'appServicePlan': {
            const d = webDetails.plans.get(idLower);
            if (d) {
              base.sku = d.sku || base.sku;
              base.state = 'running';
              base.hostedAppCount = d.total;
              base.hostedStoppedCount = d.stopped;
              if (/^[SP]/i.test(base.sku) && d.total === 0) {
                base.idleSignals.push('Standard tier or above hosting zero apps');
              } else if (d.total > 0 && d.stopped === d.total) {
                base.idleSignals.push('All hosted apps are stopped');
              }
            }
            break;
          }
          case 'appService': {
            const d = webDetails.apps.get(idLower);
            if (d) {
              base.state = d.state;
              if (d.state === 'stopped') base.idleSignals.push('App is stopped');
            }
            break;
          }
          case 'cosmos': {
            base.state = 'online';
            const d = cosmosDetails.get(idLower);
            if (d) {
              base.throughputMode = d.mode;
              if (d.rus > 0) {
                base.provisionedRUs = d.rus;
                base.sku = `${d.rus} RU/s`;
              }
            }
            break;
          }
          default:
            break;
        }
        return base;
      });
  }

  async getActivityLog(resourceId: string): Promise<ActivityEntry[]> {
    const since = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * DAY_MS).toISOString();
    const filter = `eventTimestamp ge '${since}' and resourceUri eq '${resourceId}'`;
    const out: ActivityEntry[] = [];
    try {
      for await (const event of this.monitor.activityLogs.list(filter)) {
        const e = event as Record<string, any>;
        out.push({
          timestamp: e.eventTimestamp ? new Date(e.eventTimestamp).toISOString() : '',
          operationName: e.operationName?.localizedValue ?? e.operationName?.value ?? '',
          caller: e.caller ?? '',
          status: e.status?.value ?? '',
          category: e.category?.value ?? '',
        });
        if (out.length >= 25) break;
      }
    } catch (err) {
      console.warn('[azure-janitor] activity log query failed:', err);
    }
    return out;
  }

  async hibernate(resourceId: string): Promise<JanitorResource> {
    const kind = kindFromId(resourceId);
    const { resourceGroup, name } = parseResourceId(resourceId);
    if (kind === 'vm') {
      await this.compute.virtualMachines.beginDeallocateAndWait(resourceGroup, name);
    } else if (kind === 'appServicePlan') {
      const plan = (await this.web.appServicePlans.get(resourceGroup, name)) as Record<string, any>;
      const target = /^[BDF]/i.test(String(plan?.sku?.name ?? ''))
        ? { name: 'F1', tier: 'Free', size: 'F1', capacity: 1 }
        : { name: 'B1', tier: 'Basic', size: 'B1', capacity: 1 };
      await this.web.appServicePlans.beginCreateOrUpdateAndWait(resourceGroup, name, {
        ...plan,
        sku: target,
      } as any);
    } else if (kind === 'cosmos') {
      // Best effort: floor provisioned throughput on every SQL database in the account.
      for await (const db of this.cosmos.sqlResources.listSqlDatabases(resourceGroup, name)) {
        try {
          await this.cosmos.sqlResources.beginUpdateSqlDatabaseThroughputAndWait(
            resourceGroup,
            name,
            String(db.name ?? ''),
            { resource: { throughput: 400 } } as any
          );
        } catch (err) {
          console.warn(`[azure-janitor] could not floor throughput on ${db.name}:`, err);
        }
      }
    } else {
      throw new HttpError(400, `Hibernate is not supported for resource kind "${kind}"`);
    }
    const updated = (await this.listResources()).find(
      (r) => r.id.toLowerCase() === resourceId.toLowerCase()
    );
    if (!updated) throw new HttpError(404, 'Resource not found after hibernate');
    return updated;
  }

  async teardown(resourceId: string): Promise<void> {
    const kind = kindFromId(resourceId);
    const { resourceGroup, name } = parseResourceId(resourceId);
    switch (kind) {
      case 'vm':
        await this.compute.virtualMachines.beginDeleteAndWait(resourceGroup, name);
        return;
      case 'appService':
        await this.web.webApps.delete(resourceGroup, name);
        return;
      case 'appServicePlan':
        await this.web.appServicePlans.delete(resourceGroup, name);
        return;
      case 'cosmos':
        await this.cosmos.databaseAccounts.beginDeleteAndWait(resourceGroup, name);
        return;
      default:
        // Generic delete needs an api-version. 2021-04-01 covers common cases;
        // uncommon types may need a specific version and will report an error.
        await this.resources.resources.beginDeleteByIdAndWait(resourceId, '2021-04-01');
    }
  }

  /**
   * Real figures via the Cost Management Query API (USE_CONSUMPTION_API=true).
   *
   * The query aggregates cost server-side, grouped by resource id, so it returns
   * one compact row per resource rather than the tens of thousands of raw
   * usage-detail line items the Consumption API emits. That removes the previous
   * 5000-item truncation, which combined with Azure's unstable page ordering made
   * the per-resource totals jump between calls. Cost is summed over the trailing
   * window and divided by the window length, so the map holds a trailing-window
   * average daily cost keyed by lower-cased resource id.
   */
  async getUsageDailyCosts(): Promise<Map<string, number>> {
    const client = new CostManagementClient(this.credential);
    const scope = `/subscriptions/${this.subscriptionId}`;
    const windowDays = 30;
    const to = new Date();
    const from = new Date(to.getTime() - windowDays * DAY_MS);

    const result = await client.query.usage(scope, {
      type: 'ActualCost',
      timeframe: 'Custom',
      timePeriod: { from, to },
      dataset: {
        granularity: 'None',
        // Prefer CostUSD so the figure is in USD regardless of the billing
        // currency; the actual column is resolved by name below.
        aggregation: { totalCost: { name: 'CostUSD', function: 'Sum' } },
        grouping: [{ type: 'Dimension', name: 'ResourceId' }],
      },
    });
    if (!result) return new Map();

    // Grouping by ResourceId yields one row per resource, so results comfortably
    // fit a single page for normal subscriptions. Flag rather than silently drop
    // data if a very large subscription still paginates.
    if (result.nextLink) {
      console.warn(
        '[azure-janitor] cost query returned more rows than one page; some resource costs may be incomplete'
      );
    }

    const columns = (result.columns ?? []).map((c) => String(c.name ?? ''));
    const idIdx = columns.findIndex((n) => /^resourceid$/i.test(n));
    const costIdx = columns.findIndex((n) => /^costusd$/i.test(n));
    const fallbackCostIdx = columns.findIndex((n) => /^(cost|pretaxcost)$/i.test(n));
    const useCostIdx = costIdx >= 0 ? costIdx : fallbackCostIdx;

    const daily = new Map<string, number>();
    if (idIdx < 0 || useCostIdx < 0) {
      console.warn('[azure-janitor] cost query response missing expected columns:', columns);
      return daily;
    }
    for (const row of result.rows ?? []) {
      const rid = String(row[idIdx] ?? '').toLowerCase();
      const total = Number(row[useCostIdx] ?? 0);
      if (!rid || !Number.isFinite(total)) continue;
      daily.set(rid, (daily.get(rid) ?? 0) + total / windowDays);
    }
    return daily;
  }

  /**
   * Metric-based dashboard findings. Each section is best effort: a failure in
   * one lookup yields an empty section rather than failing the whole capture.
   */
  async getDashboardInsights(): Promise<ProviderInsights> {
    const [ghostVms, orphanedDisks, zeroTrafficApps, dailyCosts] = await Promise.all([
      this.findGhostVms(),
      this.findOrphanedDisks(),
      this.findZeroTrafficApps(),
      this.getDailyCostSeries(),
    ]);
    return { ghostVms, orphanedDisks, zeroTrafficApps, dailyCosts, capturedAt: new Date().toISOString() };
  }

  /** Average of a platform metric over the trailing window, or null when unavailable. */
  private async metricAverage(resourceId: string, metricName: string, hours: number): Promise<number | null> {
    try {
      const to = new Date();
      const from = new Date(to.getTime() - hours * 60 * 60 * 1000);
      const result = await this.monitor.metrics.list(resourceId, {
        timespan: `${from.toISOString()}/${to.toISOString()}`,
        interval: 'PT1H',
        metricnames: metricName,
        aggregation: 'Average',
      });
      const points = result.value?.[0]?.timeseries?.[0]?.data ?? [];
      const values = points
        .map((p) => p.average)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      if (values.length === 0) return null;
      return values.reduce((sum, v) => sum + v, 0) / values.length;
    } catch {
      return null;
    }
  }

  /** Sum of a platform metric's Total aggregation over the trailing window, or null. */
  private async metricTotal(resourceId: string, metricName: string, hours: number): Promise<number | null> {
    try {
      const to = new Date();
      const from = new Date(to.getTime() - hours * 60 * 60 * 1000);
      const result = await this.monitor.metrics.list(resourceId, {
        timespan: `${from.toISOString()}/${to.toISOString()}`,
        interval: 'PT1H',
        metricnames: metricName,
        aggregation: 'Total',
      });
      const points = result.value?.[0]?.timeseries?.[0]?.data ?? [];
      let saw = false;
      let sum = 0;
      for (const p of points) {
        if (typeof p.total === 'number' && Number.isFinite(p.total)) {
          saw = true;
          sum += p.total;
        }
      }
      return saw ? sum : null;
    } catch {
      return null;
    }
  }

  /** Running VMs whose average CPU sat under the ghost threshold for the window. */
  private async findGhostVms(): Promise<GhostVm[]> {
    try {
      const vmDetails = await this.getVmDetails();
      const running = [...vmDetails.entries()].filter(([, d]) => d.powerState === 'running');
      const checks = await Promise.all(
        running.map(async ([idLower, d]) => {
          const avg = await this.metricAverage(idLower, 'Percentage CPU', GHOST_CPU_WINDOW_HOURS);
          if (avg === null || avg >= GHOST_CPU_THRESHOLD) return null;
          const { resourceGroup, name } = parseResourceId(idLower);
          const ghost: GhostVm = {
            id: idLower,
            name,
            resourceGroup,
            sku: d.size,
            avgCpuPercent: Math.round(avg * 100) / 100,
            windowHours: GHOST_CPU_WINDOW_HOURS,
          };
          return ghost;
        })
      );
      return checks.filter((g): g is GhostVm => g !== null);
    } catch (err) {
      console.warn('[azure-janitor] ghost VM detection failed:', err);
      return [];
    }
  }

  /** Managed disks whose managedBy is empty: unattached but still billed. */
  private async findOrphanedDisks(): Promise<OrphanedDisk[]> {
    const out: OrphanedDisk[] = [];
    try {
      for await (const disk of this.compute.disks.list()) {
        const d = disk as Record<string, any>;
        if (d.managedBy) continue;
        const id = String(d.id ?? '');
        const sku = String(d.sku?.name ?? 'Standard_LRS');
        const sizeGb = Number(d.diskSizeGB ?? 0);
        out.push({
          id,
          name: String(d.name ?? ''),
          resourceGroup: rgFromId(id),
          sku,
          sizeGb,
          estMonthlyCostUsd: estimateDiskMonthlyCost(sku, sizeGb),
        });
      }
    } catch (err) {
      console.warn('[azure-janitor] orphaned disk scan failed:', err);
    }
    return out.sort((a, b) => b.estMonthlyCostUsd - a.estMonthlyCostUsd);
  }

  /** Running web apps with zero Requests over the window. */
  private async findZeroTrafficApps(): Promise<ZeroTrafficApp[]> {
    try {
      const apps: Array<{ id: string; name: string; state: string }> = [];
      for await (const site of this.web.webApps.list()) {
        const s = site as Record<string, any>;
        const state = String(s.state ?? 'unknown').toLowerCase();
        if (state !== 'running') continue;
        apps.push({ id: String(s.id ?? ''), name: String(s.name ?? ''), state });
      }
      const checks = await Promise.all(
        apps.map(async (app) => {
          const total = await this.metricTotal(app.id, 'Requests', ZERO_TRAFFIC_WINDOW_DAYS * 24);
          if (total === null || total > 0) return null;
          const flagged: ZeroTrafficApp = {
            id: app.id,
            name: app.name,
            resourceGroup: rgFromId(app.id),
            state: app.state,
            totalRequests: 0,
            windowDays: ZERO_TRAFFIC_WINDOW_DAYS,
          };
          return flagged;
        })
      );
      return checks.filter((a): a is ZeroTrafficApp => a !== null);
    } catch (err) {
      console.warn('[azure-janitor] zero-traffic app scan failed:', err);
      return [];
    }
  }

  /** Daily subscription cost over the trailing window via the Cost Management query API. */
  private async getDailyCostSeries(): Promise<DailyCostPoint[]> {
    try {
      const client = new CostManagementClient(this.credential);
      const scope = `/subscriptions/${this.subscriptionId}`;
      const to = new Date();
      const from = new Date(to.getTime() - COST_SERIES_WINDOW_DAYS * DAY_MS);
      const result = await client.query.usage(scope, {
        type: 'ActualCost',
        timeframe: 'Custom',
        timePeriod: { from, to },
        dataset: {
          granularity: 'Daily',
          aggregation: { totalCost: { name: 'CostUSD', function: 'Sum' } },
        },
      });
      if (!result) return [];
      const columns = (result.columns ?? []).map((c) => String(c.name ?? ''));
      const dateIdx = columns.findIndex((n) => /^usagedate$/i.test(n));
      const costIdx = columns.findIndex((n) => /^costusd$/i.test(n));
      const fallbackCostIdx = columns.findIndex((n) => /^(cost|pretaxcost)$/i.test(n));
      const useCostIdx = costIdx >= 0 ? costIdx : fallbackCostIdx;
      if (dateIdx < 0 || useCostIdx < 0) return [];

      const byDate = new Map<string, number>();
      for (const row of result.rows ?? []) {
        // UsageDate arrives as a yyyymmdd number.
        const raw = String(row[dateIdx] ?? '');
        if (!/^\d{8}$/.test(raw)) continue;
        const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
        const cost = Number(row[useCostIdx] ?? 0);
        if (!Number.isFinite(cost)) continue;
        byDate.set(date, (byDate.get(date) ?? 0) + cost);
      }
      return [...byDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, costUsd]) => ({
          date,
          costUsd: Math.round(costUsd * 100) / 100,
          isWeekend: isWeekendDate(date),
        }));
    } catch (err) {
      console.warn('[azure-janitor] daily cost series unavailable:', err);
      return [];
    }
  }

  /**
   * Best effort Cosmos throughput details keyed by lower-cased account id:
   * summed RU/s across SQL databases plus how throughput is billed.
   */
  private async getCosmosDetails(): Promise<
    Map<string, { rus: number; mode: 'manual' | 'autoscale' | 'serverless' }>
  > {
    const map = new Map<string, { rus: number; mode: 'manual' | 'autoscale' | 'serverless' }>();
    try {
      const accounts: Array<Record<string, any>> = [];
      for await (const account of this.cosmos.databaseAccounts.list()) {
        accounts.push(account as Record<string, any>);
      }
      await Promise.all(
        accounts.map(async (account) => {
          const id = String(account.id ?? '').toLowerCase();
          const capabilities = (account.capabilities ?? []) as Array<{ name?: string }>;
          if (capabilities.some((c) => c.name === 'EnableServerless')) {
            map.set(id, { rus: 0, mode: 'serverless' });
            return;
          }
          try {
            const { resourceGroup, name } = parseResourceId(id);
            let rus = 0;
            let sawManual = false;
            let sawAutoscale = false;
            for await (const database of this.cosmos.sqlResources.listSqlDatabases(resourceGroup, name)) {
              try {
                const throughput = (await this.cosmos.sqlResources.getSqlDatabaseThroughput(
                  resourceGroup,
                  name,
                  String(database.name ?? '')
                )) as Record<string, any>;
                const resource = throughput?.resource ?? {};
                if (resource.autoscaleSettings?.maxThroughput) {
                  sawAutoscale = true;
                  rus += Number(resource.autoscaleSettings.maxThroughput);
                } else if (resource.throughput) {
                  sawManual = true;
                  rus += Number(resource.throughput);
                }
              } catch {
                // Database-level throughput not set (container-level or shared); skip.
              }
            }
            if (sawManual || sawAutoscale) {
              map.set(id, { rus, mode: sawManual ? 'manual' : 'autoscale' });
            }
          } catch (err) {
            console.warn('[azure-janitor] cosmos throughput lookup failed:', err);
          }
        })
      );
    } catch (err) {
      console.warn('[azure-janitor] could not enrich Cosmos accounts:', err);
    }
    return map;
  }

  private async listGenericResources(): Promise<Array<Record<string, any>>> {
    const out: Array<Record<string, any>> = [];
    for await (const r of this.resources.resources.list()) out.push(r as Record<string, any>);
    return out;
  }

  private async buildActivityIndex(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
      const since = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * DAY_MS).toISOString();
      const filter = `eventTimestamp ge '${since}'`;
      let count = 0;
      for await (const event of this.monitor.activityLogs.list(filter, {
        select: 'eventTimestamp,operationName,resourceId,category,status',
      })) {
        if (++count > MAX_ACTIVITY_EVENTS) break;
        const e = event as Record<string, any>;
        const op = String(e.operationName?.value ?? '');
        if (!/\/(write|delete|action)$/i.test(op)) continue;
        const rid = String(e.resourceId ?? '').toLowerCase();
        if (!rid || !e.eventTimestamp) continue;
        const ts = new Date(e.eventTimestamp).toISOString();
        const existing = map.get(rid);
        if (!existing || ts > existing) map.set(rid, ts);
      }
    } catch (err) {
      console.warn('[azure-janitor] could not build the activity index:', err);
    }
    return map;
  }

  private async getVmDetails(): Promise<Map<string, { size: string; powerState: string }>> {
    const map = new Map<string, { size: string; powerState: string }>();
    try {
      const vms: Array<Record<string, any>> = [];
      for await (const vm of this.compute.virtualMachines.listAll()) {
        vms.push(vm as Record<string, any>);
      }
      await Promise.all(
        vms.map(async (vm) => {
          const id = String(vm.id ?? '');
          let powerState = 'unknown';
          try {
            const { resourceGroup, name } = parseResourceId(id);
            const view = await this.compute.virtualMachines.instanceView(resourceGroup, name);
            const status = (view.statuses ?? []).find((s) => String(s.code ?? '').startsWith('PowerState/'));
            if (status?.code) powerState = status.code.split('/')[1];
          } catch {
            // best effort
          }
          map.set(id.toLowerCase(), {
            size: String(vm.hardwareProfile?.vmSize ?? ''),
            powerState,
          });
        })
      );
    } catch (err) {
      console.warn('[azure-janitor] could not enrich VMs:', err);
    }
    return map;
  }

  private async getWebDetails(): Promise<{
    plans: Map<string, { sku: string; total: number; stopped: number }>;
    apps: Map<string, { state: string; planId: string }>;
  }> {
    const plans = new Map<string, { sku: string; total: number; stopped: number }>();
    const apps = new Map<string, { state: string; planId: string }>();
    try {
      for await (const plan of this.web.appServicePlans.list()) {
        const p = plan as Record<string, any>;
        plans.set(String(p.id ?? '').toLowerCase(), {
          sku: String(p.sku?.name ?? ''),
          total: 0,
          stopped: 0,
        });
      }
      for await (const site of this.web.webApps.list()) {
        const s = site as Record<string, any>;
        const planId = String(s.serverFarmId ?? '').toLowerCase();
        const state = String(s.state ?? 'unknown').toLowerCase();
        apps.set(String(s.id ?? '').toLowerCase(), { state, planId });
        const p = plans.get(planId);
        if (p) {
          p.total += 1;
          if (state === 'stopped') p.stopped += 1;
        }
      }
    } catch (err) {
      console.warn('[azure-janitor] could not enrich App Service resources:', err);
    }
    return { plans, apps };
  }
}
