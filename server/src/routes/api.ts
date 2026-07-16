import { NextFunction, Request, Response, Router } from 'express';
import { getProvider } from '../azure/provider';
import { assertActionAllowed, HttpError, logDestructiveAction } from '../services/actions';
import { canHibernate, estimateDailyCost, estimateHibernatedDailyCost, round2 } from '../services/burnRate';
import { protection, riskLevel, scoreResource } from '../services/scoring';
import { JanitorResource, ResourceGroupSummary, RiskLevel, ScoredResource, Summary } from '../types';

export const apiRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

function enrich(r: JanitorResource, usage: Map<string, number> | null): ScoredResource {
  const breakdown = scoreResource(r);
  const prot = protection(r);
  return {
    ...r,
    estDailyCostUsd: round2(usage?.get(r.id.toLowerCase()) ?? estimateDailyCost(r)),
    estHibernatedDailyCostUsd: round2(estimateHibernatedDailyCost(r)),
    canHibernate: canHibernate(r.kind),
    score: breakdown.total,
    risk: riskLevel(breakdown.total),
    breakdown,
    isProtected: prot.isProtected,
    protectedReason: prot.reason,
  };
}

async function getScoredResources(): Promise<ScoredResource[]> {
  const provider = getProvider();
  const resources = await provider.listResources();
  let usage: Map<string, number> | null = null;
  if (process.env.USE_CONSUMPTION_API === 'true' && provider.getUsageDailyCosts) {
    try {
      usage = await provider.getUsageDailyCosts();
    } catch (err) {
      console.warn('[azure-janitor] Consumption API unavailable, falling back to the price map:', err);
    }
  }
  return resources.map((r) => enrich(r, usage));
}

async function findResource(id: string): Promise<ScoredResource> {
  const resources = await getScoredResources();
  const r = resources.find((x) => x.id.toLowerCase() === id.toLowerCase());
  if (!r) throw new HttpError(404, 'Resource not found');
  return r;
}

const RISK_ORDER: Record<RiskLevel, number> = { healthy: 0, warning: 1, critical: 2 };

apiRouter.get(
  '/summary',
  wrap(async (_req, res) => {
    const provider = getProvider();
    const [subscriptionName, resources] = await Promise.all([
      provider.getSubscriptionName(),
      getScoredResources(),
    ]);
    const idle = resources.filter((r) => r.risk !== 'healthy');
    const dailyBurn = resources.reduce((sum, r) => sum + r.estDailyCostUsd, 0);
    const idleDailyBurn = idle.reduce((sum, r) => sum + r.estDailyCostUsd, 0);
    const potentialDaily = idle.reduce(
      (sum, r) => sum + Math.max(r.estDailyCostUsd - r.estHibernatedDailyCostUsd, 0),
      0
    );
    const dayOfMonth = new Date().getDate();
    const summary: Summary = {
      subscriptionName,
      mockMode: provider.isMock,
      estimatesOnly: process.env.USE_CONSUMPTION_API !== 'true',
      dailyBurnRateUsd: round2(dailyBurn),
      idleResourceCount: idle.length,
      idleDailyBurnUsd: round2(idleDailyBurn),
      wasteThisMonthSoFarUsd: round2(idleDailyBurn * dayOfMonth),
      monthlyWasteEstimateUsd: round2(idleDailyBurn * 30),
      potentialDailySavingsUsd: round2(potentialDaily),
      potentialMonthlySavingsUsd: round2(potentialDaily * 30),
    };
    res.json(summary);
  })
);

apiRouter.get(
  '/resource-groups',
  wrap(async (_req, res) => {
    const resources = await getScoredResources();
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
    let resources = await getScoredResources();
    const rg = typeof req.query.rg === 'string' ? req.query.rg : null;
    if (rg) resources = resources.filter((r) => r.resourceGroup.toLowerCase() === rg.toLowerCase());
    const sort = req.query.sort === 'cost' ? 'cost' : 'score';
    resources.sort((a, b) => (sort === 'cost' ? b.estDailyCostUsd - a.estDailyCostUsd : b.score - a.score));
    res.json(resources);
  })
);

apiRouter.post(
  '/resources/:id/hibernate',
  wrap(async (req, res) => {
    const before = await findResource(req.params.id);
    assertActionAllowed(before);
    if (!before.canHibernate) {
      throw new HttpError(400, `Hibernate is not supported for resource kind "${before.kind}"`);
    }
    const after = enrich(await getProvider().hibernate(before.id), null);
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
    const before = await findResource(req.params.id);
    const confirm = typeof req.body?.confirm === 'string' ? req.body.confirm : '';
    if (confirm !== before.name) {
      throw new HttpError(400, 'Confirmation text does not match the resource name');
    }
    assertActionAllowed(before);
    await getProvider().teardown(before.id);
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
