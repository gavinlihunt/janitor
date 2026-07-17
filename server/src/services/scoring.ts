import { JanitorResource, RiskLevel, ScoreBreakdown } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_WINDOW_DAYS = 90;
const FLAG_WORDS = ['dev', 'test', 'uat', 'tmp', 'poc', 'demo', 'old'];
// Short name segments that are infrastructure prefixes, not personal initials.
const COMMON_PREFIXES = new Set([
  'vm', 'st', 'db', 'app', 'api', 'web', 'ui', 'fn', 'kv', 'sql', 'rg',
  'plan', 'log', 'nsg', 'pip', 'vnet', 'aks', 'acr', 'ml', 'ci', 'cd',
]);

export function daysSinceActivity(r: JanitorResource): number | null {
  if (!r.lastActivity) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(r.lastActivity).getTime()) / DAY_MS));
}

function idleAssessment(r: JanitorResource, days: number | null): { raw: number; reasons: string[] } {
  const d = days ?? ACTIVITY_WINDOW_DAYS;
  const reasons = [...r.idleSignals];
  let raw = 0;
  switch (r.kind) {
    case 'vm':
      if (r.state === 'running' && d >= 14) {
        raw = 1;
        reasons.push(`Running for ${d} days with no write operations`);
      } else if (r.state === 'running' && d >= 7) {
        raw = 0.7;
        reasons.push(`Running with no write operations for ${d} days`);
      } else if (r.state === 'deallocated') {
        raw = 0.15;
      }
      break;
    case 'appServicePlan': {
      const standardOrAbove = /^[SP]/i.test(r.sku);
      const apps = r.hostedAppCount ?? 0;
      if (standardOrAbove && apps === 0) {
        raw = 1;
        reasons.push('Standard tier or above hosting zero apps');
      } else if (apps > 0 && (r.hostedStoppedCount ?? 0) === apps) {
        raw = 0.85;
        reasons.push('Every hosted app is stopped');
      }
      break;
    }
    case 'appService':
      if (r.state === 'stopped') {
        raw = 0.8;
        reasons.push('App is stopped while its plan is still billed');
      }
      break;
    case 'cosmos': {
      const rus = r.provisionedRUs ?? 0;
      if (rus >= 1000 && d >= 14) {
        raw = 1;
        reasons.push(`${rus} RU/s provisioned with no recent data-plane operations`);
      } else if (rus >= 400 && d >= 30) {
        raw = 0.6;
        reasons.push(`${rus} RU/s provisioned and quiet for ${d} days`);
      }
      break;
    }
    case 'sql':
      if (d >= 30) {
        raw = 0.6;
        reasons.push(`Database untouched for ${d} days`);
      }
      break;
    case 'storage':
      if (d >= 45) {
        raw = 0.4;
        reasons.push(`Storage account untouched for ${d} days`);
      }
      break;
    default:
      if (d >= 30) {
        raw = 0.4;
        reasons.push(`No write operations for ${d} days`);
      }
  }
  if (raw === 0 && r.state === 'stopped') {
    raw = 0.5;
    reasons.push('Resource is stopped');
  }
  return { raw: Math.min(raw, 1), reasons };
}

function namingAssessment(r: JanitorResource): { raw: number; reasons: string[] } {
  const reasons: string[] = [];
  let raw = 0;
  const haystack = [r.name, ...Object.keys(r.tags), ...Object.values(r.tags)].join(' ').toLowerCase();
  const hits = FLAG_WORDS.filter((w) => haystack.includes(w));
  if (hits.length > 0) {
    raw += 0.5;
    reasons.push(`Name or tags contain: ${hits.join(', ')}`);
  }
  const segments = r.name.toLowerCase().split(/[-_]/).filter(Boolean);
  const initialLike = segments.filter(
    (s) => /^[a-z]{2,3}$/.test(s) && !COMMON_PREFIXES.has(s) && !FLAG_WORDS.includes(s)
  );
  if (initialLike.length > 0) {
    raw += 0.3;
    reasons.push(`Name segment looks like personal initials: ${initialLike.join(', ')}`);
  }
  if (!('owner' in r.tags)) {
    raw += 0.4;
    reasons.push('Missing an owner tag');
  }
  return { raw: Math.min(raw, 1), reasons };
}

/**
 * Inactivity score, 0 to 100, higher = more abandoned.
 * Weights: activity recency 50%, type-specific idle signals 30%, naming heuristics 20%.
 */
export function scoreResource(r: JanitorResource): ScoreBreakdown {
  const days = daysSinceActivity(r);
  const effectiveDays = Math.min(days ?? ACTIVITY_WINDOW_DAYS, ACTIVITY_WINDOW_DAYS);
  const activityScore = Math.round((effectiveDays / ACTIVITY_WINDOW_DAYS) * 50 * 10) / 10;
  const idle = idleAssessment(r, days);
  const idleScore = Math.round(idle.raw * 30 * 10) / 10;
  const naming = namingAssessment(r);
  const namingScore = Math.round(naming.raw * 20 * 10) / 10;
  const total = Math.min(100, Math.round(activityScore + idleScore + namingScore));
  return {
    daysSinceActivity: days,
    activityScore,
    idleScore,
    idleReasons: idle.reasons,
    namingScore,
    namingReasons: naming.reasons,
    total,
  };
}

export function riskLevel(score: number): RiskLevel {
  if (score >= 70) return 'critical';
  if (score >= 40) return 'warning';
  return 'healthy';
}

export function protection(
  r: JanitorResource & { inUse?: boolean }
): { isProtected: boolean; reason: string | null } {
  if (r.inUse) {
    return { isProtected: true, reason: 'Marked in use' };
  }
  if ((r.tags['protected'] ?? '').toLowerCase() === 'true') {
    return { isProtected: true, reason: 'Tagged protected: true' };
  }
  if (r.resourceGroup.toLowerCase().includes('prod')) {
    return { isProtected: true, reason: 'Resource group name contains "prod"' };
  }
  return { isProtected: false, reason: null };
}
