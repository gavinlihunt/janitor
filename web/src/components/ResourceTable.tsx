import { useMemo, useState } from 'react';
import { ArrowDown, ChevronRight, Lock, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { RiskBadge } from '@/components/RiskBadge';
import { TypeIcon } from '@/components/TypeIcon';
import { fmtUsd, relativeTime } from '@/lib/format';
import type { ResourceGroupSummary, RiskLevel, ScoredResource } from '@/lib/api';

export type SortKey = 'score' | 'cost';

const COLUMN_COUNT = 8;

const DOT: Record<RiskLevel, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  healthy: 'bg-emerald-500',
};

function isHibernated(r: ScoredResource): boolean {
  if (r.kind === 'vm') return r.state === 'deallocated';
  if (r.kind === 'appServicePlan') return r.sku === 'B1' || r.sku === 'F1';
  if (r.kind === 'cosmos') return (r.provisionedRUs ?? 0) <= 400;
  return false;
}

function HibernateCell({
  resource,
  onHibernate,
}: {
  resource: ScoredResource;
  onHibernate: (r: ScoredResource) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const hibernated = isHibernated(resource);
  const disabled = !resource.canHibernate || resource.isProtected || hibernated || busy;
  const reason = resource.isProtected
    ? resource.protectedReason
    : !resource.canHibernate
      ? 'This resource kind cannot be hibernated'
      : hibernated
        ? 'Already hibernated'
        : `Scale down to save ${fmtUsd(Math.max(resource.estDailyCostUsd - resource.estHibernatedDailyCostUsd, 0))}/day`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={hibernated}
            disabled={disabled}
            aria-label={`Hibernate ${resource.name}`}
            onCheckedChange={async (checked) => {
              if (!checked) return;
              setBusy(true);
              try {
                await onHibernate(resource);
              } finally {
                setBusy(false);
              }
            }}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

function InUseCell({
  resource,
  onSetInUse,
}: {
  resource: ScoredResource;
  onSetInUse: (r: ScoredResource, inUse: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={resource.inUse}
            disabled={busy}
            aria-label={`Mark ${resource.name} as in use`}
            onCheckedChange={async (checked) => {
              setBusy(true);
              try {
                await onSetInUse(resource, checked);
              } finally {
                setBusy(false);
              }
            }}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {resource.inUse
          ? 'Marked in use: excluded from waste and protected from actions'
          : 'Mark as in use to exclude it from waste and protect it'}
      </TooltipContent>
    </Tooltip>
  );
}

function TeardownCell({
  resource,
  onTeardown,
}: {
  resource: ScoredResource;
  onTeardown: (r: ScoredResource, confirm: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  if (resource.isProtected) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" disabled>
              <Lock className="h-4 w-4 text-muted-foreground" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{resource.protectedReason}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setText('');
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-red-400 hover:bg-red-500/15 hover:text-red-300"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Tear down ${resource.name}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Tear down {resource.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the resource and reclaims an estimated{' '}
            <span className="font-medium text-red-400">{fmtUsd(resource.estDailyCostUsd)}/day</span>. Type{' '}
            <span className="font-mono text-foreground">{resource.name}</span> to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={resource.name}
          autoFocus
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={text !== resource.name || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onTeardown(resource, text);
                setOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Deleting…' : 'Delete resource'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ResourceRow({
  resource,
  removing,
  onHibernate,
  onTeardown,
  onSetInUse,
  onSelect,
}: {
  resource: ScoredResource;
  removing: boolean;
  onHibernate: (r: ScoredResource) => Promise<void>;
  onTeardown: (r: ScoredResource, confirm: string) => Promise<void>;
  onSetInUse: (r: ScoredResource, inUse: boolean) => Promise<void>;
  onSelect: (r: ScoredResource) => void;
}) {
  return (
    <TableRow
      className={`cursor-pointer ${removing ? 'animate-row-out' : ''}`}
      onClick={() => onSelect(resource)}
    >
      <TableCell className="font-medium">
        <span className="inline-flex items-center gap-1.5 pl-6">
          {resource.name}
          {resource.isProtected && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Lock className="h-3 w-3 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>{resource.protectedReason}</TooltipContent>
            </Tooltip>
          )}
        </span>
      </TableCell>
      <TableCell>
        <TypeIcon kind={resource.kind} azureType={resource.azureType} />
      </TableCell>
      <TableCell className="text-muted-foreground">{resource.sku || '–'}</TableCell>
      <TableCell className="text-right font-medium">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <AnimatedNumber value={resource.estDailyCostUsd} format={fmtUsd} />
            </span>
          </TooltipTrigger>
          <TooltipContent>Estimated from a static price map</TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell className="text-muted-foreground">{relativeTime(resource.lastActivity)}</TableCell>
      <TableCell>
        <RiskBadge risk={resource.risk} score={resource.score} />
      </TableCell>
      <TableCell className="text-center">
        <InUseCell resource={resource} onSetInUse={onSetInUse} />
      </TableCell>
      <TableCell className="text-right">
        <span className="inline-flex items-center gap-2">
          <HibernateCell resource={resource} onHibernate={onHibernate} />
          <TeardownCell resource={resource} onTeardown={onTeardown} />
        </span>
      </TableCell>
    </TableRow>
  );
}

function GroupHeaderRow({
  group,
  count,
  open,
  onToggle,
}: {
  group: ResourceGroupSummary;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <TableRow
      role="button"
      tabIndex={0}
      aria-expanded={open}
      className="cursor-pointer bg-muted/30 hover:bg-muted/50"
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <TableCell colSpan={COLUMN_COUNT}>
        <div className="flex items-center gap-3">
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[group.worstRisk]}`} />
          <span className="font-medium">{group.name}</span>
          <span className="text-xs text-muted-foreground">
            {count} {count === 1 ? 'resource' : 'resources'}
          </span>
          <span className="ml-auto text-sm font-medium">{fmtUsd(group.estDailyCostUsd)}/day</span>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function ResourceTable({
  resources,
  groups,
  loading,
  sort,
  onSortChange,
  removingIds,
  onHibernate,
  onTeardown,
  onSetInUse,
  onSelect,
}: {
  resources: ScoredResource[];
  groups: ResourceGroupSummary[];
  loading: boolean;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  removingIds: Set<string>;
  onHibernate: (r: ScoredResource) => Promise<void>;
  onTeardown: (r: ScoredResource, confirm: string) => Promise<void>;
  onSetInUse: (r: ScoredResource, inUse: boolean) => Promise<void>;
  onSelect: (r: ScoredResource) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const byGroup = useMemo(() => {
    const map = new Map<string, ScoredResource[]>();
    for (const r of resources) {
      const list = map.get(r.resourceGroup);
      if (list) list.push(r);
      else map.set(r.resourceGroup, [r]);
    }
    return map;
  }, [resources]);

  const toggle = (name: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const sortButton = (key: SortKey, label: string) => (
    <button
      className={`inline-flex items-center gap-1 hover:text-foreground ${sort === key ? 'text-foreground' : ''}`}
      onClick={() => onSortChange(key)}
    >
      {label}
      {sort === key && <ArrowDown className="h-3 w-3" />}
    </button>
  );

  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead className="w-10">Type</TableHead>
            <TableHead>Tier / SKU</TableHead>
            <TableHead className="text-right">{sortButton('cost', 'Est. cost/day')}</TableHead>
            <TableHead>Last activity</TableHead>
            <TableHead>{sortButton('score', 'Risk')}</TableHead>
            <TableHead className="text-center">In use</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        {loading ? (
          <TableBody>
            {Array.from({ length: 8 }, (_, i) => (
              <TableRow key={i}>
                {Array.from({ length: COLUMN_COUNT }, (_, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        ) : (
          groups.map((g) => {
            const groupResources = byGroup.get(g.name) ?? [];
            const isOpen = open.has(g.name);
            return (
              <TableBody key={g.name}>
                <GroupHeaderRow
                  group={g}
                  count={g.resourceCount}
                  open={isOpen}
                  onToggle={() => toggle(g.name)}
                />
                {isOpen &&
                  groupResources.map((r) => (
                    <ResourceRow
                      key={r.id}
                      resource={r}
                      removing={removingIds.has(r.id)}
                      onHibernate={onHibernate}
                      onTeardown={onTeardown}
                      onSetInUse={onSetInUse}
                      onSelect={onSelect}
                    />
                  ))}
              </TableBody>
            );
          })
        )}
        {!loading && groups.length === 0 && (
          <TableBody>
            <TableRow>
              <TableCell colSpan={COLUMN_COUNT} className="py-10 text-center text-muted-foreground">
                No resources yet. Click Refresh to import from Azure.
              </TableCell>
            </TableRow>
          </TableBody>
        )}
      </Table>
    </div>
  );
}
