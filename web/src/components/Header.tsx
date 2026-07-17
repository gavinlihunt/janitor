import { Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CURRENCIES, formatMoney, setCurrency, useCurrency } from '@/lib/currency';
import { useReclaimed } from '@/lib/session';
import type { Summary } from '@/lib/api';

export function Header({ summary }: { summary: Summary | null }) {
  const sessionDailyUsd = useReclaimed();
  const currency = useCurrency();

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

      <div className="flex items-center gap-5">
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              role="group"
              aria-label="Display currency"
              className="flex items-center gap-0.5 rounded-lg border bg-background p-0.5"
            >
              {CURRENCIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCurrency(c)}
                  aria-pressed={currency === c}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                    currency === c
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </TooltipTrigger>
          <TooltipContent>Amounts are converted from USD at approximate static rates</TooltipContent>
        </Tooltip>

        <div className="text-right">
          <p className="text-xs text-muted-foreground">Reclaimed this session</p>
          <p className="text-lg font-semibold tabular-nums text-emerald-400">
            {formatMoney(sessionDailyUsd, currency)}/day
          </p>
        </div>
      </div>
    </header>
  );
}
