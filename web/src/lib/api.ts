export type ResourceKind =
  | 'vm'
  | 'appServicePlan'
  | 'appService'
  | 'cosmos'
  | 'sql'
  | 'storage'
  | 'other';

export type RiskLevel = 'critical' | 'warning' | 'healthy';

export interface ScoreBreakdown {
  daysSinceActivity: number | null;
  activityScore: number;
  idleScore: number;
  idleReasons: string[];
  namingScore: number;
  namingReasons: string[];
  total: number;
}

export interface ScoredResource {
  id: string;
  name: string;
  kind: ResourceKind;
  azureType: string;
  resourceGroup: string;
  location: string;
  sku: string;
  tags: Record<string, string>;
  state: string;
  lastActivity: string | null;
  idleSignals: string[];
  hostedAppCount?: number;
  hostedStoppedCount?: number;
  provisionedRUs?: number;
  hoursRunningPerDay: number;
  estDailyCostUsd: number;
  /** User-set: excluded from waste and protected from actions. */
  inUse: boolean;
  estHibernatedDailyCostUsd: number;
  canHibernate: boolean;
  score: number;
  risk: RiskLevel;
  breakdown: ScoreBreakdown;
  isProtected: boolean;
  protectedReason: string | null;
}

export interface ResourceGroupSummary {
  name: string;
  resourceCount: number;
  estDailyCostUsd: number;
  worstRisk: RiskLevel;
}

export interface Summary {
  subscriptionName: string;
  mockMode: boolean;
  estimatesOnly: boolean;
  dailyBurnRateUsd: number;
  idleResourceCount: number;
  idleDailyBurnUsd: number;
  wasteThisMonthSoFarUsd: number;
  monthlyWasteEstimateUsd: number;
  potentialDailySavingsUsd: number;
  potentialMonthlySavingsUsd: number;
}

export interface GhostVm {
  id: string;
  name: string;
  resourceGroup: string;
  sku: string;
  avgCpuPercent: number;
  windowHours: number;
  estDailyCostUsd: number;
}

export interface OrphanedDisk {
  id: string;
  name: string;
  resourceGroup: string;
  sku: string;
  sizeGb: number;
  estMonthlyCostUsd: number;
}

export interface ZeroTrafficApp {
  id: string;
  name: string;
  resourceGroup: string;
  state: string;
  totalRequests: number;
  windowDays: number;
}

export interface GhostTownPlan {
  id: string;
  name: string;
  resourceGroup: string;
  sku: string;
  hostedAppCount: number;
  hostedStoppedCount: number;
  estDailyCostUsd: number;
  reason: string;
}

export interface CosmosFlag {
  id: string;
  name: string;
  resourceGroup: string;
  provisionedRUs: number;
  estDailyCostUsd: number;
  reason: string;
}

export interface DailyCostPoint {
  date: string;
  costUsd: number;
  isWeekend: boolean;
}

export interface OutOfHoursBreakdown {
  dailyCosts: DailyCostPoint[];
  weekdayCostUsd: number;
  weekendCostUsd: number;
  outOfHoursCostUsd: number;
  outOfHoursSharePct: number;
  windowDays: number;
}

export interface DashboardData {
  hero: {
    subscriptionName: string;
    mockMode: boolean;
    estimatesOnly: boolean;
    potentialMonthlySavingsUsd: number;
    zombieCount: number;
    dailyBurnRateUsd: number;
    monthlyWasteEstimateUsd: number;
  };
  ghostVms: GhostVm[];
  orphanedDisks: OrphanedDisk[];
  ghostTownPlans: GhostTownPlan[];
  zeroTrafficApps: ZeroTrafficApp[];
  cosmosFlags: CosmosFlag[];
  outOfHours: OutOfHoursBreakdown | null;
  insightsCapturedAt: string | null;
}

export interface ActivityEntry {
  timestamp: string;
  operationName: string;
  caller: string;
  status: string;
  category: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the status text
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  summary: () => request<Summary>('/summary'),
  dashboard: () => request<DashboardData>('/dashboard'),
  resourceGroups: () => request<ResourceGroupSummary[]>('/resource-groups'),
  resources: (opts: { sort?: 'cost' | 'score'; rg?: string | null } = {}) => {
    const params = new URLSearchParams();
    if (opts.sort) params.set('sort', opts.sort);
    if (opts.rg) params.set('rg', opts.rg);
    const qs = params.toString();
    return request<ScoredResource[]>(`/resources${qs ? `?${qs}` : ''}`);
  },
  activity: (id: string) => request<ActivityEntry[]>(`/activity/${encodeURIComponent(id)}`),
  sync: () => request<Summary>('/sync', { method: 'POST' }),
  setInUse: (id: string, inUse: boolean) =>
    request<{ resource: ScoredResource }>(`/resources/${encodeURIComponent(id)}/in-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inUse }),
    }),
  hibernate: (id: string) =>
    request<{ resource: ScoredResource; reclaimedDailyUsd: number }>(
      `/resources/${encodeURIComponent(id)}/hibernate`,
      { method: 'POST' }
    ),
  teardown: (id: string, confirm: string) =>
    request<{ ok: true; reclaimedDailyUsd: number }>(`/resources/${encodeURIComponent(id)}/teardown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm }),
    }),
};
