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

export interface ScoredResource extends JanitorResource {
  estDailyCostUsd: number;
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
