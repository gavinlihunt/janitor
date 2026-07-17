import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Database,
  Flame,
  Ghost,
  Globe,
  HardDrive,
  PiggyBank,
  RefreshCw,
  Server,
  Skull,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Header } from '@/components/Header';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { formatMoney, formatMoneyWhole, useCurrency, type Currency } from '@/lib/currency';
import { api, type DailyCostPoint, type DashboardData } from '@/lib/api';

/* Chart series colours, validated for the dark surface with the palette
 * validator (CVD ΔE 23.4, contrast >= 3:1). Marks only; text uses text tokens. */
const WEEKDAY_BAR = '#0284c7';
const WEEKEND_BAR = '#d97706';

/** Round a value up to a clean axis maximum (1/2/5 × 10^n). */
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 2, 5, 10]) {
    if (value <= step * power) return step * power;
  }
  return 10 * power;
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** Daily cost bars, weekday vs weekend, with a per-bar hover tooltip. */
function DailyCostChart({ points, currency }: { points: DailyCostPoint[]; currency: Currency }) {
  const maxCost = niceCeil(Math.max(...points.map((p) => p.costUsd)));
  const ticks = [maxCost, maxCost / 2];

  return (
    <div>
      <div className="relative mt-2 h-40" role="img" aria-label="Daily cost for the last 30 days, split into weekday and weekend spend">
        {/* Hairline gridlines with axis tick values. */}
        {ticks.map((t) => (
          <div
            key={t}
            className="absolute inset-x-0 border-t border-border"
            style={{ bottom: `${(t / maxCost) * 100}%` }}
          >
            <span className="absolute -top-2 right-0 text-[10px] tabular-nums text-muted-foreground">
              {formatMoneyWhole(t, currency)}
            </span>
          </div>
        ))}
        <div className="absolute inset-x-0 bottom-0 border-t border-border" />

        <div className="absolute inset-0 flex items-end gap-[2px]">
          {points.map((p) => (
            <div key={p.date} className="group relative flex h-full flex-1 items-end">
              <div
                className="w-full rounded-t-[4px]"
                style={{
                  height: `${Math.max((p.costUsd / maxCost) * 100, 1)}%`,
                  backgroundColor: p.isWeekend ? WEEKEND_BAR : WEEKDAY_BAR,
                }}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow group-hover:block">
                <p className="font-medium">{shortDate(p.date)}</p>
                <p className="tabular-nums text-muted-foreground">
                  {formatMoney(p.costUsd, currency)} · {p.isWeekend ? 'weekend' : 'weekday'}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{shortDate(points[0].date)}</span>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: WEEKDAY_BAR }} />
            Weekday
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: WEEKEND_BAR }} />
            Weekend
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">{shortDate(points[points.length - 1].date)}</span>
      </div>
    </div>
  );
}

function HeroSkeletons() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-36 rounded-xl" />
      ))}
    </div>
  );
}

/** A finding row: identity on the left, one figure on the right. */
function LeakRow({
  name,
  detail,
  stat,
  statClass = 'text-amber-400',
  subStat,
}: {
  name: string;
  detail: string;
  stat: string;
  statClass?: string;
  subStat?: string;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate font-mono text-sm">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className={`text-sm font-medium tabular-nums ${statClass}`}>{stat}</p>
        {subStat && <p className="text-xs text-muted-foreground">{subStat}</p>}
      </div>
    </li>
  );
}

function EmptyLeak({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-4 text-sm text-muted-foreground">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
      {message}
    </div>
  );
}

function LeakCard({
  icon: Icon,
  iconClass,
  title,
  count,
  description,
  emptyMessage,
  children,
}: {
  icon: typeof Ghost;
  iconClass: string;
  title: string;
  count: number;
  description: string;
  emptyMessage: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className={`h-4 w-4 ${iconClass}`} />
          {title}
          <span className="ml-auto rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {count}
          </span>
        </CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {count === 0 ? <EmptyLeak message={emptyMessage} /> : <ul className="divide-y">{children}</ul>}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const currency = useCurrency();

  const load = useCallback(async () => {
    try {
      setData(await api.dashboard());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load the dashboard');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await api.sync();
      await load();
      toast.success('Imported the latest data from Azure');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const totals = useMemo(() => {
    if (!data) return null;
    return {
      ghostVmDaily: data.ghostVms.reduce((sum, v) => sum + v.estDailyCostUsd, 0),
      diskMonthly: data.orphanedDisks.reduce((sum, d) => sum + d.estMonthlyCostUsd, 0),
      planDaily: data.ghostTownPlans.reduce((sum, p) => sum + p.estDailyCostUsd, 0),
      cosmosDaily: data.cosmosFlags.reduce((sum, c) => sum + c.estDailyCostUsd, 0),
    };
  }, [data]);

  return (
    <div className="min-h-screen">
      <Header
        title="Dashboard"
        subscriptionName={data?.hero.subscriptionName ?? null}
        mockMode={data?.hero.mockMode ?? false}
      />
      <main className="mx-auto max-w-7xl space-y-8 px-6 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {data?.hero.estimatesOnly
              ? 'All figures are estimates from a static price map'
              : 'Figures from the Azure Cost Management API'}
          </p>
          <Button variant="outline" size="sm" onClick={() => void handleRefresh()} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>

        {/* Hero stats */}
        {!data ? (
          <HeroSkeletons />
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="border-emerald-500/30 bg-gradient-to-b from-emerald-500/10 to-transparent ring-1 ring-emerald-500/20">
              <CardContent className="flex h-full flex-col justify-center gap-1 p-6">
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <PiggyBank className="h-4 w-4 text-emerald-400" /> Potential monthly savings
                </p>
                <p className="text-5xl font-bold text-emerald-400">
                  <AnimatedNumber
                    value={data.hero.potentialMonthlySavingsUsd}
                    format={(n) => formatMoneyWhole(n, currency)}
                  />
                </p>
                <p className="text-xs text-muted-foreground">
                  if every flagged resource were hibernated or removed · estimate
                </p>
              </CardContent>
            </Card>

            <Card className="border-red-500/30 bg-gradient-to-b from-red-500/10 to-transparent ring-1 ring-red-500/20">
              <CardContent className="flex h-full flex-col justify-center gap-1 p-6">
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Skull className="h-4 w-4 text-red-400" /> Zombie count
                </p>
                <p className="text-4xl font-bold text-red-400">
                  <AnimatedNumber value={data.hero.zombieCount} format={(n) => String(Math.round(n))} />
                </p>
                <p className="text-xs text-muted-foreground">
                  abandoned or idle resources still running right now
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex h-full flex-col justify-center gap-1 p-6">
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Flame className="h-4 w-4 text-amber-400" /> Active daily burn rate
                </p>
                <p className="text-4xl font-bold text-amber-400">
                  <AnimatedNumber
                    value={data.hero.dailyBurnRateUsd}
                    format={(n) => formatMoney(n, currency)}
                  />
                </p>
                <p className="text-xs text-muted-foreground">
                  per day across all resources · heading for{' '}
                  {formatMoneyWhole(data.hero.monthlyWasteEstimateUsd, currency)} of monthly waste
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Compute cost leaks */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Compute cost leaks</h2>
            <p className="text-xs text-muted-foreground">
              Virtual machines and disks that bill in full while doing nothing
            </p>
          </div>
          {!data ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Skeleton className="h-56 rounded-xl" />
              <Skeleton className="h-56 rounded-xl" />
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <LeakCard
                icon={Ghost}
                iconClass="text-red-400"
                title="Ghost VMs"
                count={data.ghostVms.length}
                description={`Running with average CPU under 2% over the last 24 hours · ${formatMoney(totals?.ghostVmDaily ?? 0, currency)}/day at stake`}
                emptyMessage="No running VMs are sitting idle."
              >
                {data.ghostVms.map((vm) => (
                  <LeakRow
                    key={vm.id}
                    name={vm.name}
                    detail={`${vm.resourceGroup} · ${vm.sku}`}
                    stat={`${formatMoney(vm.estDailyCostUsd, currency)}/day`}
                    subStat={`${vm.avgCpuPercent}% avg CPU`}
                  />
                ))}
              </LeakCard>

              <LeakCard
                icon={HardDrive}
                iconClass="text-amber-400"
                title="Orphaned managed disks"
                count={data.orphanedDisks.length}
                description={`Unattached to any VM but still billed · about ${formatMoney(totals?.diskMonthly ?? 0, currency)}/month`}
                emptyMessage="Every managed disk is attached to a VM."
              >
                {data.orphanedDisks.map((disk) => (
                  <LeakRow
                    key={disk.id}
                    name={disk.name}
                    detail={`${disk.resourceGroup} · ${disk.sku} · ${disk.sizeGb} GB`}
                    stat={`${formatMoney(disk.estMonthlyCostUsd, currency)}/mo`}
                    subStat="est. storage"
                  />
                ))}
              </LeakCard>
            </div>
          )}
        </section>

        {/* Database and out-of-hours */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Provisioning and timing leaks</h2>
            <p className="text-xs text-muted-foreground">
              Fixed throughput that never flexes down, and spend that continues after hours
            </p>
          </div>
          {!data ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Skeleton className="h-64 rounded-xl" />
              <Skeleton className="h-64 rounded-xl" />
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <LeakCard
                icon={Database}
                iconClass="text-red-400"
                title="Cosmos DB over-provisioning"
                count={data.cosmosFlags.length}
                description={`Fixed manual throughput in non-production groups · ${formatMoney(totals?.cosmosDaily ?? 0, currency)}/day at stake`}
                emptyMessage="No manually provisioned throughput found outside production."
              >
                {data.cosmosFlags.map((flag) => (
                  <LeakRow
                    key={flag.id}
                    name={flag.name}
                    detail={`${flag.resourceGroup} · consider autoscale or serverless`}
                    stat={`${flag.provisionedRUs.toLocaleString()} RU/s`}
                    statClass="text-red-400"
                    subStat={`${formatMoney(flag.estDailyCostUsd, currency)}/day`}
                  />
                ))}
              </LeakCard>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CalendarClock className="h-4 w-4 text-amber-400" />
                    Out-of-hours spend
                    {data.outOfHours && (
                      <span className="ml-auto rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                        {data.outOfHours.outOfHoursSharePct}%
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {data.outOfHours
                      ? `About ${formatMoney(data.outOfHours.outOfHoursCostUsd, currency)} of the last ${data.outOfHours.windowDays} days went to nights (19:00 to 07:00) and weekends · estimate`
                      : 'Daily cost over the last 30 days, weekday against weekend'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {data.outOfHours ? (
                    <DailyCostChart points={data.outOfHours.dailyCosts} currency={currency} />
                  ) : (
                    <div className="rounded-lg border py-10 text-center text-sm text-muted-foreground">
                      No cost series captured yet. Use Refresh to import from Azure.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </section>

        {/* App Service drain */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">App Service drain</h2>
            <p className="text-xs text-muted-foreground">
              Plans bill for the instance size whether or not any code is running
            </p>
          </div>
          {!data ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Skeleton className="h-56 rounded-xl" />
              <Skeleton className="h-56 rounded-xl" />
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <LeakCard
                icon={Server}
                iconClass="text-red-400"
                title="Ghost town App Service Plans"
                count={data.ghostTownPlans.length}
                description={`Standard tier or above with no active apps · ${formatMoney(totals?.planDaily ?? 0, currency)}/day at stake`}
                emptyMessage="Every paid plan is hosting active apps."
              >
                {data.ghostTownPlans.map((plan) => (
                  <LeakRow
                    key={plan.id}
                    name={plan.name}
                    detail={`${plan.resourceGroup} · ${plan.sku} · ${plan.reason.toLowerCase()}`}
                    stat={`${formatMoney(plan.estDailyCostUsd, currency)}/day`}
                    subStat={`${plan.hostedAppCount} app${plan.hostedAppCount === 1 ? '' : 's'}, ${plan.hostedStoppedCount} stopped`}
                  />
                ))}
              </LeakCard>

              <LeakCard
                icon={Globe}
                iconClass="text-amber-400"
                title="Zero-traffic App Services"
                count={data.zeroTrafficApps.length}
                description="Running apps that have not received a single HTTP request"
                emptyMessage="Every running app is receiving traffic."
              >
                {data.zeroTrafficApps.map((app) => (
                  <LeakRow
                    key={app.id}
                    name={app.name}
                    detail={`${app.resourceGroup} · billed through its plan`}
                    stat={`${app.totalRequests} requests`}
                    statClass="text-red-400"
                    subStat={`in ${app.windowDays} days`}
                  />
                ))}
              </LeakCard>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
