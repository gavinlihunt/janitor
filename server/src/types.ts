export type ResourceKind =
  | 'vm'
  | 'appServicePlan'
  | 'appService'
  | 'cosmos'
  | 'sql'
  | 'storage'
  | 'other';

export type RiskLevel = 'critical' | 'warning' | 'healthy';

/** A normalised Azure resource, as returned by both providers. */
export interface JanitorResource {
  id: string;
  name: string;
  kind: ResourceKind;
  azureType: string;
  resourceGroup: string;
  location: string;
  sku: string;
  tags: Record<string, string>;
  /** running | deallocated | stopped | online | available | unknown */
  state: string;
  /** ISO timestamp of the last Activity Log write operation, null if none within 90 days. */
  lastActivity: string | null;
  /** Provider-observed idle evidence, for example "Plan hosts zero apps". */
  idleSignals: string[];
  /** App Service Plans only: number of apps hosted by the plan. */
  hostedAppCount?: number;
  /** App Service Plans only: how many of the hosted apps are stopped. */
  hostedStoppedCount?: number;
  /** Cosmos DB only: provisioned RU/s. */
  provisionedRUs?: number;
  /** Cosmos DB only: how throughput is billed. */
  throughputMode?: 'manual' | 'autoscale' | 'serverless';
  /** Hours per day the resource is billed as running (24 unless deallocated). */
  hoursRunningPerDay: number;
}

export interface ActivityEntry {
  timestamp: string;
  operationName: string;
  caller: string;
  status: string;
  category: string;
}

export interface ScoreBreakdown {
  daysSinceActivity: number | null;
  /** Weighted contribution, 0 to 50. */
  activityScore: number;
  /** Weighted contribution, 0 to 30. */
  idleScore: number;
  idleReasons: string[];
  /** Weighted contribution, 0 to 20. */
  namingScore: number;
  namingReasons: string[];
  total: number;
}

/**
 * A resource as persisted in SQLite: the raw Azure fields plus the cost resolved
 * at sync time and the user-managed inUse flag. This is the read source for the
 * API layer, which scores and enriches it into a ScoredResource.
 */
export interface StoredResource extends JanitorResource {
  estDailyCostUsd: number;
  /** User-set: true means "this is genuinely in use", excluding it from waste and protecting it. */
  inUse: boolean;
}

export interface ScoredResource extends StoredResource {
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

/** Running VM whose average CPU stayed below the ghost threshold over the window. */
export interface GhostVm {
  id: string;
  name: string;
  resourceGroup: string;
  sku: string;
  avgCpuPercent: number;
  windowHours: number;
}

/** Managed disk that is not attached to any VM but is still billed. */
export interface OrphanedDisk {
  id: string;
  name: string;
  resourceGroup: string;
  sku: string;
  sizeGb: number;
  estMonthlyCostUsd: number;
}

/** Running app that received no HTTP requests over the window. */
export interface ZeroTrafficApp {
  id: string;
  name: string;
  resourceGroup: string;
  state: string;
  totalRequests: number;
  windowDays: number;
}

export interface DailyCostPoint {
  /** ISO date, yyyy-mm-dd. */
  date: string;
  costUsd: number;
  isWeekend: boolean;
}

/** Metric-based findings captured from the provider at sync time. */
export interface ProviderInsights {
  ghostVms: GhostVm[];
  orphanedDisks: OrphanedDisk[];
  zeroTrafficApps: ZeroTrafficApp[];
  dailyCosts: DailyCostPoint[];
  capturedAt: string;
}

/** Standard-or-above App Service Plan with no active apps. */
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

/** Cosmos DB account on fixed manual throughput in a non-production group. */
export interface CosmosFlag {
  id: string;
  name: string;
  resourceGroup: string;
  provisionedRUs: number;
  estDailyCostUsd: number;
  reason: string;
}

export interface OutOfHoursBreakdown {
  dailyCosts: DailyCostPoint[];
  weekdayCostUsd: number;
  weekendCostUsd: number;
  /** Weekend spend plus the estimated overnight share of weekday spend. */
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
  ghostVms: Array<GhostVm & { estDailyCostUsd: number }>;
  orphanedDisks: OrphanedDisk[];
  ghostTownPlans: GhostTownPlan[];
  zeroTrafficApps: ZeroTrafficApp[];
  cosmosFlags: CosmosFlag[];
  outOfHours: OutOfHoursBreakdown | null;
  insightsCapturedAt: string | null;
}

export interface Summary {
  subscriptionName: string;
  mockMode: boolean;
  /** True when figures come from the static price map rather than the Consumption API. */
  estimatesOnly: boolean;
  dailyBurnRateUsd: number;
  idleResourceCount: number;
  /** Daily burn attributable to idle (warning or critical) resources. */
  idleDailyBurnUsd: number;
  /** Idle burn multiplied by days elapsed this month. */
  wasteThisMonthSoFarUsd: number;
  /** Idle burn projected over thirty days. */
  monthlyWasteEstimateUsd: number;
  potentialDailySavingsUsd: number;
  potentialMonthlySavingsUsd: number;
}
