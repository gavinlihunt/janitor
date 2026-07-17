import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RiskBadge } from '@/components/RiskBadge';
import { api, type ActivityEntry, type ScoredResource } from '@/lib/api';
import { fmtUsd, relativeTime } from '@/lib/format';

function ScoreBar({
  label,
  value,
  max,
  reasons,
}: {
  label: string;
  value: number;
  max: number;
  reasons: string[];
}) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {value} / {max}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-500 to-red-500 transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      {reasons.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DetailSheet({ resource, onClose }: { resource: ScoredResource | null; onClose: () => void }) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);

  useEffect(() => {
    setEntries(null);
    if (!resource) return;
    let cancelled = false;
    api
      .activity(resource.id)
      .then((e) => {
        if (!cancelled) setEntries(e);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [resource?.id]);

  const mostRecentEntry =
    entries && entries.length > 0
      ? entries.reduce((latest, e) =>
          new Date(e.timestamp).getTime() > new Date(latest.timestamp).getTime() ? e : latest
        )
      : null;

  return (
    <Sheet open={!!resource} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        {resource && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {resource.name}
                <RiskBadge risk={resource.risk} score={resource.score} />
              </SheetTitle>
              <SheetDescription>
                {resource.azureType} · {resource.resourceGroup} · {fmtUsd(resource.estDailyCostUsd)}/day
                (estimated) · last activity {relativeTime(resource.lastActivity)}
              </SheetDescription>
            </SheetHeader>

            {mostRecentEntry?.caller && (
              <div className="mt-4 flex items-center justify-between rounded-lg border bg-background/50 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Most recent action by</span>
                <span className="font-medium">
                  {mostRecentEntry.caller}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    · {relativeTime(mostRecentEntry.timestamp)}
                  </span>
                </span>
              </div>
            )}

            <Tabs defaultValue="score" className="mt-6">
              <TabsList className="w-full">
                <TabsTrigger value="score" className="flex-1">
                  Why this score
                </TabsTrigger>
                <TabsTrigger value="activity" className="flex-1">
                  Activity log
                </TabsTrigger>
              </TabsList>

              <TabsContent value="score" className="mt-4 space-y-5">
                <ScoreBar
                  label="Activity recency (50%)"
                  value={resource.breakdown.activityScore}
                  max={50}
                  reasons={[
                    resource.breakdown.daysSinceActivity === null
                      ? 'No write operations in the last 90 days'
                      : `${resource.breakdown.daysSinceActivity} days since the last write operation`,
                  ]}
                />
                <ScoreBar
                  label="Idle signals (30%)"
                  value={resource.breakdown.idleScore}
                  max={30}
                  reasons={resource.breakdown.idleReasons}
                />
                <ScoreBar
                  label="Naming and tagging (20%)"
                  value={resource.breakdown.namingScore}
                  max={20}
                  reasons={resource.breakdown.namingReasons}
                />
              </TabsContent>

              <TabsContent value="activity" className="mt-4">
                {entries === null ? (
                  <div className="space-y-2">
                    {[0, 1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : entries.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No activity log entries in the last 90 days. That silence is exactly why this resource is
                    flagged.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {entries.map((e, i) => (
                      <li key={i} className="rounded-lg border bg-background/50 p-3 text-sm">
                        <p className="font-mono text-xs">{e.operationName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {new Date(e.timestamp).toLocaleString()} · {e.caller} · {e.status}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
