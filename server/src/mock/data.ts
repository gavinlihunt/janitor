import {
  ActivityEntry,
  DailyCostPoint,
  JanitorResource,
  OrphanedDisk,
  ProviderInsights,
  ResourceKind,
} from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const SUB = '00000000-0000-0000-0000-000000000000';

const daysAgo = (days: number): string => new Date(Date.now() - days * DAY_MS).toISOString();

function mk(
  rg: string,
  type: string,
  name: string,
  kind: ResourceKind,
  sku: string,
  state: string,
  lastActivityDays: number | null,
  tags: Record<string, string>,
  extra: Partial<JanitorResource> = {}
): JanitorResource {
  return {
    id: `/subscriptions/${SUB}/resourceGroups/${rg}/providers/${type}/${name}`,
    name,
    kind,
    azureType: type,
    resourceGroup: rg,
    location: 'uksouth',
    sku,
    tags,
    state,
    lastActivity: lastActivityDays === null ? null : daysAgo(lastActivityDays),
    idleSignals: [],
    hoursRunningPerDay: state === 'deallocated' ? 0 : 24,
    ...extra,
  };
}

/** 18 synthetic resources across 4 resource groups. */
export function seedResources(): JanitorResource[] {
  return [
    // rg-payments-dev
    mk('rg-payments-dev', 'Microsoft.Compute/virtualMachines', 'vm-build-agent-01', 'vm', 'Standard_D4s_v3', 'running', 62, { env: 'dev' }, {
      idleSignals: ['Power state is running with no activity entries for two months'],
    }),
    mk('rg-payments-dev', 'Microsoft.Compute/virtualMachines', 'vm-jm-sandbox', 'vm', 'Standard_D2s_v3', 'running', 45, {}, {
      idleSignals: ['Power state is running with no recent activity'],
    }),
    mk('rg-payments-dev', 'Microsoft.Web/serverfarms', 'plan-payments-dev', 'appServicePlan', 'S1', 'running', 30, { env: 'dev', owner: 'payments-team' }, {
      hostedAppCount: 1,
      hostedStoppedCount: 1,
      idleSignals: ['All hosted apps are stopped'],
    }),
    mk('rg-payments-dev', 'Microsoft.Web/sites', 'app-payments-api-dev', 'appService', 'via plan-payments-dev', 'stopped', 30, { env: 'dev' }, {
      idleSignals: ['App is stopped'],
    }),
    // rg-data-platform-poc
    mk('rg-data-platform-poc', 'Microsoft.Compute/virtualMachines', 'vm-old-jenkins', 'vm', 'Standard_D2s_v3', 'deallocated', 88, { env: 'old' }, {
      idleSignals: ['Deallocated, only disks are billed'],
    }),
    mk('rg-data-platform-poc', 'Microsoft.Compute/virtualMachines', 'vm-poc-ml-train', 'vm', 'Standard_NC6', 'running', 38, { env: 'poc' }, {
      idleSignals: ['GPU VM running with no activity for over a month'],
    }),
    mk('rg-data-platform-poc', 'Microsoft.Web/serverfarms', 'plan-orphaned-poc', 'appServicePlan', 'S1', 'running', 47, {}, {
      hostedAppCount: 0,
      hostedStoppedCount: 0,
      idleSignals: ['Standard-tier plan hosts zero apps'],
    }),
    mk('rg-data-platform-poc', 'Microsoft.DocumentDB/databaseAccounts', 'cosmos-poc-orders', 'cosmos', '4000 RU/s', 'online', 70, { env: 'poc' }, {
      provisionedRUs: 4000,
      throughputMode: 'manual',
      idleSignals: ['Provisioned at 4000 RU/s with no recent data-plane operations'],
    }),
    mk('rg-data-platform-poc', 'Microsoft.Sql/servers/databases', 'sqldb-tmp-migration', 'sql', 'GP_S_Gen5_2', 'online', 55, {}, {
      idleSignals: ['No queries observed recently'],
    }),
    mk('rg-data-platform-poc', 'Microsoft.Storage/storageAccounts', 'sttmpexports001', 'storage', 'Standard_LRS', 'available', 66, {}),
    // rg-web-uat
    mk('rg-web-uat', 'Microsoft.Compute/virtualMachines', 'vm-loadtest-uat', 'vm', 'Standard_E8s_v3', 'running', 21, { env: 'uat', owner: 'qa-team' }, {
      idleSignals: ['Large VM running since the last load test three weeks ago'],
    }),
    mk('rg-web-uat', 'Microsoft.Web/serverfarms', 'plan-demo-portal', 'appServicePlan', 'P1v3', 'running', 51, { env: 'demo' }, {
      hostedAppCount: 2,
      hostedStoppedCount: 1,
      idleSignals: ['Hosts one stopped app and one app receiving no traffic'],
    }),
    mk('rg-web-uat', 'Microsoft.Web/sites', 'app-demo-portal', 'appService', 'via plan-demo-portal', 'stopped', 51, { env: 'demo' }, {
      idleSignals: ['App is stopped'],
    }),
    mk('rg-web-uat', 'Microsoft.Web/sites', 'app-uat-notify', 'appService', 'via plan-demo-portal', 'running', 40, { env: 'uat' }, {
      idleSignals: ['No HTTP requests in the last 3 days'],
    }),
    mk('rg-web-uat', 'Microsoft.DocumentDB/databaseAccounts', 'cosmos-uat-catalog', 'cosmos', '1000 RU/s', 'online', 12, { env: 'uat', owner: 'web-team' }, {
      provisionedRUs: 1000,
      throughputMode: 'autoscale',
    }),
    mk('rg-web-uat', 'Microsoft.Storage/storageAccounts', 'stwebassets', 'storage', 'Standard_GRS', 'available', 2, { env: 'uat', owner: 'web-team' }),
    // rg-core-prod (safety rails demo: everything here must refuse actions)
    mk('rg-core-prod', 'Microsoft.Compute/virtualMachines', 'vm-prod-gateway', 'vm', 'Standard_D4s_v3', 'running', 0, { env: 'prod', owner: 'platform-team' }),
    mk('rg-core-prod', 'Microsoft.DocumentDB/databaseAccounts', 'cosmos-core-ledger', 'cosmos', '10000 RU/s', 'online', 1, { owner: 'platform-team', protected: 'true' }, {
      provisionedRUs: 10000,
      throughputMode: 'manual',
    }),
    mk('rg-core-prod', 'Microsoft.Web/serverfarms', 'plan-core-api', 'appServicePlan', 'P1v3', 'running', 1, { owner: 'platform-team' }, {
      hostedAppCount: 3,
      hostedStoppedCount: 0,
    }),
  ];
}

/** Synthetic 24-hour average CPU per running dev VM; prod VMs are deliberately absent. */
const GHOST_CPU_BY_NAME: Record<string, number> = {
  'vm-build-agent-01': 0.8,
  'vm-jm-sandbox': 1.3,
  'vm-poc-ml-train': 0.4,
  'vm-loadtest-uat': 1.7,
};

function mkDisk(rg: string, name: string, sku: string, sizeGb: number, usdPerGbMonth: number): OrphanedDisk {
  return {
    id: `/subscriptions/${SUB}/resourceGroups/${rg}/providers/Microsoft.Compute/disks/${name}`,
    name,
    resourceGroup: rg,
    sku,
    sizeGb,
    estMonthlyCostUsd: Math.round(sizeGb * usdPerGbMonth * 100) / 100,
  };
}

/** Deterministic 30-day daily cost series with a visible weekday/weekend rhythm. */
function seedDailyCosts(): DailyCostPoint[] {
  const out: DailyCostPoint[] = [];
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * DAY_MS);
    const date = d.toISOString().slice(0, 10);
    const day = d.getUTCDay();
    const isWeekend = day === 0 || day === 6;
    const base = isWeekend ? 74 : 96;
    const wobble = Math.sin(i * 1.7) * 7;
    out.push({ date, costUsd: Math.round((base + wobble) * 100) / 100, isWeekend });
  }
  return out;
}

/** Synthetic dashboard insights derived from the current mock resource set. */
export function seedInsights(resources: JanitorResource[]): ProviderInsights {
  const ghostVms = resources
    .filter((r) => r.kind === 'vm' && r.state === 'running' && r.name in GHOST_CPU_BY_NAME)
    .map((r) => ({
      id: r.id,
      name: r.name,
      resourceGroup: r.resourceGroup,
      sku: r.sku,
      avgCpuPercent: GHOST_CPU_BY_NAME[r.name],
      windowHours: 24,
    }));
  const zeroTrafficApps = resources
    .filter((r) => r.kind === 'appService' && r.state === 'running')
    .map((r) => ({
      id: r.id,
      name: r.name,
      resourceGroup: r.resourceGroup,
      state: r.state,
      totalRequests: 0,
      windowDays: 3,
    }));
  const orphanedDisks = [
    mkDisk('rg-payments-dev', 'md-vm-deleted-data', 'StandardSSD_LRS', 512, 0.075),
    mkDisk('rg-data-platform-poc', 'disk-old-jenkins-os', 'Premium_LRS', 128, 0.132),
    mkDisk('rg-data-platform-poc', 'disk-ml-scratch', 'Standard_LRS', 1024, 0.045),
  ].sort((a, b) => b.estMonthlyCostUsd - a.estMonthlyCostUsd);
  return {
    ghostVms,
    orphanedDisks,
    zeroTrafficApps,
    dailyCosts: seedDailyCosts(),
    capturedAt: new Date().toISOString(),
  };
}

const OPS_BY_KIND: Record<string, string[]> = {
  vm: [
    'Microsoft.Compute/virtualMachines/start/action',
    'Microsoft.Compute/virtualMachines/write',
    'Microsoft.Compute/virtualMachines/restart/action',
  ],
  appServicePlan: ['Microsoft.Web/serverfarms/write'],
  appService: ['Microsoft.Web/sites/write', 'Microsoft.Web/sites/stop/action'],
  cosmos: ['Microsoft.DocumentDB/databaseAccounts/write'],
  sql: ['Microsoft.Sql/servers/databases/write'],
  storage: ['Microsoft.Storage/storageAccounts/write'],
  other: ['Microsoft.Resources/deployments/write'],
};

// Synthetic identities only. No real people or accounts.
const CALLERS = ['svc-deploy-pipeline', 'iac-terraform-sp', 'portal-operator'];

/** Deterministic fake activity log entries anchored to the resource's last activity. */
export function mockActivityFor(r: JanitorResource): ActivityEntry[] {
  if (!r.lastActivity) return [];
  const last = new Date(r.lastActivity).getTime();
  const ops = OPS_BY_KIND[r.kind] ?? OPS_BY_KIND.other;
  const offsetsDays = [0, 2, 6, 13, 27];
  return offsetsDays
    .map((offset, i) => ({
      timestamp: new Date(last - offset * DAY_MS).toISOString(),
      operationName: ops[i % ops.length],
      caller: CALLERS[i % CALLERS.length],
      status: 'Succeeded',
      category: 'Administrative',
    }))
    .filter((e) => Date.now() - new Date(e.timestamp).getTime() < 90 * DAY_MS);
}
