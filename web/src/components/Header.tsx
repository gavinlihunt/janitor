import { Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { fmtUsd } from '@/lib/format';
import type { Summary } from '@/lib/api';

export function Header({ summary, sessionDailyUsd }: { summary: Summary | null; sessionDailyUsd: number }) {
  return (
    <header className="flex items-center justify-between border-b bg-card/40 px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/15">
          <Trash2 className="h-5 w-5 text-red-400" />
        </div>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Azure Janitor</h1>
          <p className="text-xs text-muted-foreground">
            {summary ? summary.subscriptionName : 'Loading subscription…'}
          </p>
        </div>
        {summary?.mockMode && (
          <Badge variant="outline" className="ml-2 border-amber-500/40 bg-amber-500/10 text-amber-400">
            Demo data
          </Badge>
        )}
      </div>
      <div className="text-right">
        <p className="text-xs text-muted-foreground">Reclaimed this session</p>
        <p className="text-lg font-semibold tabular-nums text-emerald-400">{fmtUsd(sessionDailyUsd)}/day</p>
      </div>
    </header>
  );
}
