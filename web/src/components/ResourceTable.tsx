import { useState } from 'react';
import { ArrowDown, ArrowUp, Lock, Trash2 } from 'lucide-react';
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
import { formatMoney, useCurrency } from '@/lib/currency';
import { relativeTime } from '@/lib/format';
import type { ScoredResource } from '@/lib/api';

export type SortKey = 'name' | 'type' | 'cost' | 'lastActivity' | 'risk';
export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

/** Numeric fields read best highest-first; text and dates default ascending. */
export function defaultDir(key: SortKey): 'asc' | 'desc' {
  return key === 'cost' || key === 'risk' ? 'desc' : 'asc';
}

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
  const currency = useCurrency();
  const hibernated = isHibernated(resource);
  const disabled = !resource.canHibernate || resource.isProtected || hibernated || busy;
  const reason = resource.isProtected
    ? resource.protectedReason
    : !resource.canHibernate
      ? 'This resource kind cannot be hibernated'
      : hibernated
        ? 'Already hibernated'
        : `Scale down to save ${formatMoney(Math.max(resource.estDailyCostUsd - resource.estHibernatedDailyCostUsd, 0), currency)}/day`;

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
  const currency = useCurrency();

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
            <span className="font-medium text-red-400">
              {formatMoney(resource.estDailyCostUsd, currency)}/day
            </span>
            . Type <span className="font-mono text-foreground">{resource.name}</span> to confirm.
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

export function ResourceTable({
  resources,
  loading,
  sort,
  onSortChange,
  removingIds,
  onHibernate,
  onTeardown,
  onSetInUse,
  onSelect,
  readOnly = false,
}: {
  resources: ScoredResource[];
  loading: boolean;
  sort: SortState;
  onSortChange: (s: SortState) => void;
  removingIds?: Set<string>;
  onHibernate?: (r: ScoredResource) => Promise<void>;
  onTeardown?: (r: ScoredResource, confirm: string) => Promise<void>;
  onSetInUse?: (r: ScoredResource, inUse: boolean) => Promise<void>;
  onSelect: (r: ScoredResource) => void;
  /** Hide the In-use, Hibernate, and Actions columns. */
  readOnly?: boolean;
}) {
  const currency = useCurrency();
  // Action columns need their handlers; drop them (and their columns) in read-only mode.
  const showActions = !readOnly && !!onSetInUse && !!onHibernate && !!onTeardown;
  const colCount = 7 + (showActions ? 3 : 0);

  const sortButton = (key: SortKey, label: string) => {
    const active = sort.key === key;
    return (
      <button
        className={`inline-flex items-center gap-1 hover:text-foreground ${active ? 'text-foreground' : ''}`}
        onClick={() =>
          onSortChange(active ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: defaultDir(key) })
        }
      >
        {label}
        {active && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    );
  };

  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{sortButton('name', 'Name')}</TableHead>
            <TableHead className="w-10">{sortButton('type', 'Type')}</TableHead>
            <TableHead>Resource group</TableHead>
            <TableHead>Tier / SKU</TableHead>
            <TableHead className="text-right">{sortButton('cost', 'Est. cost/day')}</TableHead>
            <TableHead>{sortButton('lastActivity', 'Last activity')}</TableHead>
            <TableHead>{sortButton('risk', 'Risk')}</TableHead>
            {showActions && <TableHead className="text-center">In use</TableHead>}
            {showActions && <TableHead className="text-center">Hibernate</TableHead>}
            {showActions && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading
            ? Array.from({ length: 8 }, (_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: colCount }, (_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : resources.map((r) => (
                <TableRow
                  key={r.id}
                  className={`cursor-pointer ${removingIds?.has(r.id) ? 'animate-row-out' : ''}`}
                  onClick={() => onSelect(r)}
                >
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {r.name}
                      {r.isProtected && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Lock className="h-3 w-3 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent>{r.protectedReason}</TooltipContent>
                        </Tooltip>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <TypeIcon kind={r.kind} azureType={r.azureType} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.resourceGroup}</TableCell>
                  <TableCell className="text-muted-foreground">{r.sku || '–'}</TableCell>
                  <TableCell className="text-right font-medium">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <AnimatedNumber
                            value={r.estDailyCostUsd}
                            format={(v) => formatMoney(v, currency)}
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Estimated from a static price map</TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{relativeTime(r.lastActivity)}</TableCell>
                  <TableCell>
                    <RiskBadge risk={r.risk} score={r.score} />
                  </TableCell>
                  {showActions && (
                    <TableCell className="text-center">
                      <InUseCell resource={r} onSetInUse={onSetInUse!} />
                    </TableCell>
                  )}
                  {showActions && (
                    <TableCell className="text-center">
                      <HibernateCell resource={r} onHibernate={onHibernate!} />
                    </TableCell>
                  )}
                  {showActions && (
                    <TableCell className="text-right">
                      <TeardownCell resource={r} onTeardown={onTeardown!} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
          {!loading && resources.length === 0 && (
            <TableRow>
              <TableCell colSpan={colCount} className="py-10 text-center text-muted-foreground">
                No resources yet. Click Refresh to import from Azure, or the filter may be too narrow.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
