import { NextFunction, Request, Response, Router } from 'express';
import { getProvider } from '../azure/provider';
import { assertActionAllowed, HttpError, logDestructiveAction } from '../services/actions';
import { canHibernate, estimateHibernatedDailyCost, resolveDailyCost, round2 } from '../services/burnRate';
import { protection, riskLevel, scoreResource } from '../services/scoring';
import { syncFromProvider } from '../services/sync';
import * as repo from '../db/resourcesRepo';
import { ResourceGroupSummary, RiskLevel, ScoredResource, StoredResource, Summary } from '../types';

export const apiRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

/** Score and enrich a stored resource. The cost was resolved at sync time. */
function enrich(r: StoredResource): ScoredResource {
  const breakdown = scoreResource(r);
  const prot = protection(r);
  return {
    ...r,
    estDailyCostUsd: round2(r.estDailyCostUsd),
    estHibernatedDailyCostUsd: round2(estimateHibernatedDailyCost(r)),
    canHibernate: canHibernate(r.kind),
    score: breakdown.total,
    risk: riskLevel(breakdown.total),
    breakdown,
    isProtected: prot.isProtected,
    protectedReason: prot.reason,
  };
}

/** All resources, read from SQLite (never live Azure). Empty until the first sync. */
function getScoredResources(): ScoredResource[] {
  return repo.getAll().map(enrich);
}

function findResource(id: string): ScoredResource {
  const stored = repo.getById(id);
  if (!stored) throw new HttpError(404, 'Resource not found');
  return enrich(stored);
}

function buildSummary(): Summary {
  const resources = getScoredResources();
  const meta = repo.getSyncMeta();
  // inUse resources are genuinely in use, so they are excluded from the idle set
  // and from waste, though their real cost still counts toward the total burn.
  const idle = resources.filter((r) => !r.inUse && r.risk !== 'healthy');
  const dailyBurn = resources.reduce((sum, r) => sum + r.estDailyCostUsd, 0);
  const idleDailyBurn = idle.reduce((sum, r) => sum + r.estDailyCostUsd, 0);
  const potentialDaily = idle.reduce(
    (sum, r) => sum + Math.max(r.estDailyCostUsd - r.estHibernatedDailyCostUsd, 0),
    0
  );
  const dayOfMonth = new Date().getDate();
  return {
    subscriptionName: meta?.subscriptionName ?? 'Not synced yet',
    mockMode: meta?.mockMode ?? process.env.MOCK_MODE === 'true',
    estimatesOnly: meta?.estimatesOnly ?? process.env.USE_CONSUMPTION_API !== 'true',
    dailyBurnRateUsd: round2(dailyBurn),
    idleResourceCount: idle.length,
    idleDailyBurnUsd: round2(idleDailyBurn),
    wasteThisMonthSoFarUsd: round2(idleDailyBurn * dayOfMonth),
    monthlyWasteEstimateUsd: round2(idleDailyBurn * 30),
    potentialDailySavingsUsd: round2(potentialDaily),
    potentialMonthlySavingsUsd: round2(potentialDaily * 30),
  };
}

const RISK_ORDER: Record<RiskLevel, number> = { healthy: 0, warning: 1, critical: 2 };

apiRouter.get(
  '/summary',
  wrap(async (_req, res) => {
    res.json(buildSummary());
  })
);

// Re-import the current resource set (and live costs) from Azure into SQLite.
apiRouter.post(
  '/sync',
  wrap(async (_req, res) => {
    await syncFromProvider();
    res.json(buildSummary());
  })
);

apiRouter.get(
  '/resource-groups',
  wrap(async (_req, res) => {
    const resources = getScoredResources();
    const groups = new Map<string, ResourceGroupSummary>();
    for (const r of resources) {
      const g =
        groups.get(r.resourceGroup) ??
        ({ name: r.resourceGroup, resourceCount: 0, estDailyCostUsd: 0, worstRisk: 'healthy' } as ResourceGroupSummary);
      g.resourceCount += 1;
      g.estDailyCostUsd = round2(g.estDailyCostUsd + r.estDailyCostUsd);
      if (RISK_ORDER[r.risk] > RISK_ORDER[g.worstRisk]) g.worstRisk = r.risk;
      groups.set(r.resourceGroup, g);
    }
    res.json([...groups.values()].sort((a, b) => b.estDailyCostUsd - a.estDailyCostUsd));
  })
);

apiRouter.get(
  '/resources',
  wrap(async (req, res) => {
    let resources = getScoredResources();
    const rg = typeof req.query.rg === 'string' ? req.query.rg : null;
    if (rg) resources = resources.filter((r) => r.resourceGroup.toLowerCase() === rg.toLowerCase());
    const sort = req.query.sort === 'cost' ? 'cost' : 'score';
    resources.sort((a, b) => (sort === 'cost' ? b.estDailyCostUsd - a.estDailyCostUsd : b.score - a.score));
    res.json(resources);
  })
);

// User toggle: mark a resource as in use (or clear it). Persisted in SQLite.
apiRouter.post(
  '/resources/:id/in-use',
  wrap(async (req, res) => {
    const inUse = Boolean(req.body?.inUse);
    if (!repo.setInUse(req.params.id, inUse)) throw new HttpError(404, 'Resource not found');
    res.json({ resource: findResource(req.params.id) });
  })
);

apiRouter.post(
  '/resources/:id/hibernate',
  wrap(async (req, res) => {
    const before = findResource(req.params.id);
    assertActionAllowed(before);
    if (!before.canHibernate) {
      throw new HttpError(400, `Hibernate is not supported for resource kind "${before.kind}"`);
    }
    const updated = await getProvider().hibernate(before.id);
    // Reconcile the single row; the post-action cost is a fresh estimate and the
    // repository preserves the user's inUse flag on upsert.
    repo.upsertOne({ ...updated, estDailyCostUsd: resolveDailyCost(updated, null) }, new Date().toISOString());
    const after = findResource(before.id);
    logDestructiveAction('hibernate', before.id);
    res.json({
      resource: after,
      reclaimedDailyUsd: round2(Math.max(before.estDailyCostUsd - after.estDailyCostUsd, 0)),
    });
  })
);

apiRouter.post(
  '/resources/:id/teardown',
  wrap(async (req, res) => {
    const before = findResource(req.params.id);
    const confirm = typeof req.body?.confirm === 'string' ? req.body.confirm : '';
    if (confirm !== before.name) {
      throw new HttpError(400, 'Confirmation text does not match the resource name');
    }
    assertActionAllowed(before);
    await getProvider().teardown(before.id);
    repo.deleteOne(before.id);
    logDestructiveAction('teardown', before.id);
    res.json({ ok: true, reclaimedDailyUsd: before.estDailyCostUsd });
  })
);

apiRouter.get(
  '/activity/:id',
  wrap(async (req, res) => {
    res.json(await getProvider().getActivityLog(req.params.id));
  })
);
