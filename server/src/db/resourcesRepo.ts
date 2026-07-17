import { db } from './database';
import { JanitorResource, ProviderInsights, ResourceKind, StoredResource } from '../types';

/** A resource ready to persist: raw Azure fields plus the cost resolved at sync time. */
export type ResourceUpsert = JanitorResource & { estDailyCostUsd: number };

export interface SyncMeta {
  subscriptionName: string | null;
  mockMode: boolean;
  estimatesOnly: boolean;
  lastSyncedAt: string | null;
}

interface ResourceRow {
  id: string;
  name: string;
  kind: string;
  azure_type: string;
  resource_group: string;
  location: string;
  sku: string;
  tags: string;
  state: string;
  last_activity: string | null;
  idle_signals: string;
  hosted_app_count: number | null;
  hosted_stopped_count: number | null;
  provisioned_rus: number | null;
  throughput_mode: string | null;
  hours_running_per_day: number;
  est_daily_cost_usd: number;
  in_use: number;
  last_synced_at: string;
}

function rowToStored(row: ResourceRow): StoredResource {
  const stored: StoredResource = {
    id: row.id,
    name: row.name,
    kind: row.kind as ResourceKind,
    azureType: row.azure_type,
    resourceGroup: row.resource_group,
    location: row.location,
    sku: row.sku,
    tags: JSON.parse(row.tags) as Record<string, string>,
    state: row.state,
    lastActivity: row.last_activity,
    idleSignals: JSON.parse(row.idle_signals) as string[],
    hoursRunningPerDay: row.hours_running_per_day,
    estDailyCostUsd: row.est_daily_cost_usd,
    inUse: row.in_use === 1,
  };
  // better-sqlite3 returns null for absent optional columns; only surface the
  // optional fields when present so the shape matches the provider output.
  if (row.hosted_app_count !== null) stored.hostedAppCount = row.hosted_app_count;
  if (row.hosted_stopped_count !== null) stored.hostedStoppedCount = row.hosted_stopped_count;
  if (row.provisioned_rus !== null) stored.provisionedRUs = row.provisioned_rus;
  if (row.throughput_mode !== null) {
    stored.throughputMode = row.throughput_mode as StoredResource['throughputMode'];
  }
  return stored;
}

// SQLite bindings reject `undefined`, so every optional value is coerced to null.
function toBind(r: ResourceUpsert, syncedAt: string): Record<string, string | number | null> {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    azure_type: r.azureType,
    resource_group: r.resourceGroup,
    location: r.location,
    sku: r.sku,
    tags: JSON.stringify(r.tags ?? {}),
    state: r.state,
    last_activity: r.lastActivity ?? null,
    idle_signals: JSON.stringify(r.idleSignals ?? []),
    hosted_app_count: r.hostedAppCount ?? null,
    hosted_stopped_count: r.hostedStoppedCount ?? null,
    provisioned_rus: r.provisionedRUs ?? null,
    throughput_mode: r.throughputMode ?? null,
    hours_running_per_day: r.hoursRunningPerDay,
    est_daily_cost_usd: r.estDailyCostUsd,
    last_synced_at: syncedAt,
  };
}

// in_use is deliberately excluded from the column list: on insert it takes the
// DEFAULT 0, and the ON CONFLICT clause never touches it, so the user's flag
// survives every re-sync.
const upsertStmt = db.prepare(`
  INSERT INTO resources (
    id, name, kind, azure_type, resource_group, location, sku, tags, state,
    last_activity, idle_signals, hosted_app_count, hosted_stopped_count,
    provisioned_rus, throughput_mode, hours_running_per_day, est_daily_cost_usd, last_synced_at
  ) VALUES (
    @id, @name, @kind, @azure_type, @resource_group, @location, @sku, @tags, @state,
    @last_activity, @idle_signals, @hosted_app_count, @hosted_stopped_count,
    @provisioned_rus, @throughput_mode, @hours_running_per_day, @est_daily_cost_usd, @last_synced_at
  )
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    kind = excluded.kind,
    azure_type = excluded.azure_type,
    resource_group = excluded.resource_group,
    location = excluded.location,
    sku = excluded.sku,
    tags = excluded.tags,
    state = excluded.state,
    last_activity = excluded.last_activity,
    idle_signals = excluded.idle_signals,
    hosted_app_count = excluded.hosted_app_count,
    hosted_stopped_count = excluded.hosted_stopped_count,
    provisioned_rus = excluded.provisioned_rus,
    throughput_mode = excluded.throughput_mode,
    hours_running_per_day = excluded.hours_running_per_day,
    est_daily_cost_usd = excluded.est_daily_cost_usd,
    last_synced_at = excluded.last_synced_at
`);

const deleteStaleStmt = db.prepare('DELETE FROM resources WHERE last_synced_at != ?');

/**
 * Upsert the full current resource set and drop rows that were not part of this
 * sync (their last_synced_at no longer matches), in a single transaction.
 */
export function replaceResources(rows: ResourceUpsert[], syncedAt: string): void {
  const tx = db.transaction(() => {
    for (const r of rows) upsertStmt.run(toBind(r, syncedAt));
    deleteStaleStmt.run(syncedAt);
  });
  tx();
}

/** Reconcile a single resource after a live action (preserves in_use). */
export function upsertOne(row: ResourceUpsert, syncedAt: string): void {
  upsertStmt.run(toBind(row, syncedAt));
}

const deleteOneStmt = db.prepare('DELETE FROM resources WHERE id = ?');

export function deleteOne(id: string): void {
  deleteOneStmt.run(id);
}

const getAllStmt = db.prepare('SELECT * FROM resources');

export function getAll(): StoredResource[] {
  return (getAllStmt.all() as ResourceRow[]).map(rowToStored);
}

const getByIdStmt = db.prepare('SELECT * FROM resources WHERE id = ?');

export function getById(id: string): StoredResource | null {
  const row = getByIdStmt.get(id) as ResourceRow | undefined;
  return row ? rowToStored(row) : null;
}

const setInUseStmt = db.prepare('UPDATE resources SET in_use = ? WHERE id = ?');

/** Set the user flag; returns false if no such resource exists. */
export function setInUse(id: string, inUse: boolean): boolean {
  return setInUseStmt.run(inUse ? 1 : 0, id).changes > 0;
}

const getMetaStmt = db.prepare('SELECT * FROM sync_meta WHERE id = 1');

export function getSyncMeta(): SyncMeta | null {
  const row = getMetaStmt.get() as
    | { subscription_name: string | null; mock_mode: number; estimates_only: number; last_synced_at: string | null }
    | undefined;
  if (!row) return null;
  return {
    subscriptionName: row.subscription_name,
    mockMode: row.mock_mode === 1,
    estimatesOnly: row.estimates_only === 1,
    lastSyncedAt: row.last_synced_at,
  };
}

const setMetaStmt = db.prepare(`
  INSERT INTO sync_meta (id, subscription_name, mock_mode, estimates_only, last_synced_at)
  VALUES (1, @subscription_name, @mock_mode, @estimates_only, @last_synced_at)
  ON CONFLICT(id) DO UPDATE SET
    subscription_name = excluded.subscription_name,
    mock_mode = excluded.mock_mode,
    estimates_only = excluded.estimates_only,
    last_synced_at = excluded.last_synced_at
`);

export function setSyncMeta(meta: SyncMeta): void {
  setMetaStmt.run({
    subscription_name: meta.subscriptionName,
    mock_mode: meta.mockMode ? 1 : 0,
    estimates_only: meta.estimatesOnly ? 1 : 0,
    last_synced_at: meta.lastSyncedAt,
  });
}

const getInsightsStmt = db.prepare('SELECT json FROM insights WHERE id = 1');

/** Metric-based findings captured at the last sync, or null before the first sync. */
export function getInsights(): ProviderInsights | null {
  const row = getInsightsStmt.get() as { json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.json) as ProviderInsights;
  } catch {
    return null;
  }
}

const setInsightsStmt = db.prepare(`
  INSERT INTO insights (id, json, captured_at) VALUES (1, @json, @captured_at)
  ON CONFLICT(id) DO UPDATE SET json = excluded.json, captured_at = excluded.captured_at
`);

export function setInsights(insights: ProviderInsights): void {
  setInsightsStmt.run({ json: JSON.stringify(insights), captured_at: insights.capturedAt });
}
