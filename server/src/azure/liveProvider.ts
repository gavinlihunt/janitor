import { DefaultAzureCredential } from '@azure/identity';
import { ResourceManagementClient } from '@azure/arm-resources';
import { MonitorClient } from '@azure/arm-monitor';
import { ComputeManagementClient } from '@azure/arm-compute';
import { WebSiteManagementClient } from '@azure/arm-appservice';
import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { ConsumptionManagementClient } from '@azure/arm-consumption';
import { IAzureProvider } from './provider';
import { HttpError } from '../services/actions';
import { ActivityEntry, JanitorResource, ResourceKind } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_WINDOW_DAYS = 90;
const MAX_ACTIVITY_EVENTS = 2000;
const MAX_USAGE_ITEMS = 5000;

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
    const [generic, activityIndex, vmDetails, webDetails] = await Promise.all([
      this.listGenericResources(),
      this.buildActivityIndex(),
      this.getVmDetails(),
      this.getWebDetails(),
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
          case 'cosmos':
            base.state = 'online';
            break;
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

  /** Real figures via the Consumption API (USE_CONSUMPTION_API=true). */
  async getUsageDailyCosts(): Promise<Map<string, number>> {
    const consumption = new ConsumptionManagementClient(this.credential, this.subscriptionId);
    const scope = `/subscriptions/${this.subscriptionId}`;
    const windowDays = 30;
    const since = new Date(Date.now() - windowDays * DAY_MS).toISOString().slice(0, 10);
    const totals = new Map<string, number>();
    let count = 0;
    for await (const item of consumption.usageDetails.list(scope, {
      filter: `properties/usageStart ge '${since}'`,
      top: 1000,
    })) {
      if (++count > MAX_USAGE_ITEMS) break;
      const u = item as Record<string, any>;
      const rid = String(u.instanceId ?? u.resourceId ?? '').toLowerCase();
      const cost = Number(u.costInBillingCurrency ?? u.cost ?? u.pretaxCost ?? 0);
      if (!rid || !Number.isFinite(cost)) continue;
      totals.set(rid, (totals.get(rid) ?? 0) + cost);
    }
    const daily = new Map<string, number>();
    for (const [rid, total] of totals) daily.set(rid, total / windowDays);
    return daily;
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
