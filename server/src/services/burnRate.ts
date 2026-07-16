import priceMapJson from './priceMap.json';
import { JanitorResource, ResourceKind } from '../types';

const priceMap = priceMapJson as {
  vmDailyUsd: Record<string, number>;
  appServicePlanDailyUsd: Record<string, number>;
  cosmosUsdPer100RuDay: number;
  cosmosDefaultRUs: number;
  cosmosHibernateFloorRUs: number;
  sqlDailyUsd: Record<string, number>;
  storageDailyUsd: Record<string, number>;
  otherDailyUsd: number;
};

function lookup(map: Record<string, number>, sku: string): number {
  return map[sku] ?? map['_default'] ?? 0;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Estimated daily USD cost from a hard-coded price map of common SKUs.
 * These are deliberately rough hackathon estimates, clearly labelled as
 * such in the UI. Swappable for the Consumption API via USE_CONSUMPTION_API.
 */
export function estimateDailyCost(r: JanitorResource): number {
  const runFactor = Math.min(Math.max(r.hoursRunningPerDay / 24, 0), 1);
  switch (r.kind) {
    case 'vm':
      if (r.state === 'deallocated') return priceMap.vmDailyUsd['_deallocatedDisk'] ?? 0.35;
      return round2(lookup(priceMap.vmDailyUsd, r.sku) * runFactor);
    case 'appServicePlan':
      return lookup(priceMap.appServicePlanDailyUsd, r.sku);
    case 'appService':
      return 0; // billed through its App Service Plan
    case 'cosmos':
      return round2(((r.provisionedRUs ?? priceMap.cosmosDefaultRUs) / 100) * priceMap.cosmosUsdPer100RuDay);
    case 'sql':
      return lookup(priceMap.sqlDailyUsd, r.sku);
    case 'storage':
      return lookup(priceMap.storageDailyUsd, r.sku);
    default:
      return priceMap.otherDailyUsd;
  }
}

export function canHibernate(kind: ResourceKind): boolean {
  return kind === 'vm' || kind === 'appServicePlan' || kind === 'cosmos';
}

/** What the resource would cost per day after a hibernate action. */
export function estimateHibernatedDailyCost(r: JanitorResource): number {
  const current = estimateDailyCost(r);
  switch (r.kind) {
    case 'vm':
      return Math.min(priceMap.vmDailyUsd['_deallocatedDisk'] ?? 0.35, current);
    case 'appServicePlan': {
      const target = /^[BDF]/.test(r.sku) ? 'F1' : 'B1';
      return Math.min(lookup(priceMap.appServicePlanDailyUsd, target), current);
    }
    case 'cosmos':
      return Math.min(round2((priceMap.cosmosHibernateFloorRUs / 100) * priceMap.cosmosUsdPer100RuDay), current);
    default:
      return current;
  }
}
