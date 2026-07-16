import { useEffect, useState } from 'react';
import { Flame, MoonStar } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtUsd } from '@/lib/format';
import type { Summary } from '@/lib/api';

/**
 * Count-up on load, then ticks upward in real time at the idle daily burn
 * divided by 86,400 per second.
 */
function MoneyWasted({ base, perSecond }: { base: number; perSecond: number }) {
  const [text, setText] = useState(fmtUsd(0));

  useEffect(() => {
    const start = performance.now();
    let raf: number;
    const tick = (t: number) => {
      const elapsed = (t - start) / 1000;
      const easeP = Math.min(1, elapsed / 1.5);
      const ease = 1 - Math.pow(1 - easeP, 3);
      setText(fmtUsd((base + perSecond * elapsed) * ease));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [base, perSecond]);

  return <span className="tabular-nums">{text}</span>;
}

export function HeroStrip({ summary }: { summary: Summary | null }) {
  if (!summary) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardContent className="flex h-full flex-col justify-center gap-1 p-6">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Flame className="h-4 w-4 text-amber-400" /> Daily burn rate
          </p>
          <p className="text-3xl font-semibold tabular-nums text-amber-400">
            {fmtUsd(summary.dailyBurnRateUsd)}
          </p>
          <p className="text-xs text-muted-foreground">
            across all resources{summary.estimatesOnly ? ', estimated' : ''}
          </p>
        </CardContent>
      </Card>

      <Card className="border-red-500/30 bg-gradient-to-b from-red-500/10 to-transparent ring-1 ring-red-500/20">
        <CardContent className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
          <p className="text-sm text-muted-foreground">Money wasted this month</p>
          <p className="text-4xl font-bold text-red-400">
            <MoneyWasted base={summary.wasteThisMonthSoFarUsd} perSecond={summary.idleDailyBurnUsd / 86400} />
          </p>
          <p className="text-xs text-muted-foreground">
            heading for {fmtUsd(summary.monthlyWasteEstimateUsd)} over 30 days · estimate
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex h-full flex-col justify-center gap-1 p-6">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MoonStar className="h-4 w-4 text-emerald-400" /> Idle resources
          </p>
          <p className="text-3xl font-semibold tabular-nums">{summary.idleResourceCount}</p>
          <p className="text-xs text-muted-foreground">
            potential savings {fmtUsd(summary.potentialDailySavingsUsd)}/day
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
