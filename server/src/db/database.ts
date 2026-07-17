import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

/**
 * Single SQLite connection for the app. The database is the read source for every
 * API endpoint; Azure is only contacted during a sync or a destructive action.
 * Location is overridable with DB_PATH, defaulting to <cwd>/data/janitor.db.
 */
const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'janitor.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    azure_type TEXT NOT NULL,
    resource_group TEXT NOT NULL,
    location TEXT NOT NULL,
    sku TEXT NOT NULL,
    tags TEXT NOT NULL,
    state TEXT NOT NULL,
    last_activity TEXT,
    idle_signals TEXT NOT NULL,
    hosted_app_count INTEGER,
    hosted_stopped_count INTEGER,
    provisioned_rus INTEGER,
    hours_running_per_day REAL NOT NULL,
    est_daily_cost_usd REAL NOT NULL,
    in_use INTEGER NOT NULL DEFAULT 0,
    last_synced_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    subscription_name TEXT,
    mock_mode INTEGER NOT NULL DEFAULT 0,
    estimates_only INTEGER NOT NULL DEFAULT 1,
    last_synced_at TEXT
  );
`);
