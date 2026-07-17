import fs from 'fs';
import path from 'path';
import { JanitorResource } from '../types';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

const LOG_PATH = path.join(process.cwd(), 'actions.log');

/**
 * Safety rails: refuse destructive actions on anything tagged
 * protected: true or living in a resource group whose name contains "prod".
 */
export function assertActionAllowed(r: JanitorResource & { inUse?: boolean }): void {
  if (r.inUse) {
    throw new HttpError(403, `Refused: ${r.name} is marked in use`);
  }
  if ((r.tags['protected'] ?? '').toLowerCase() === 'true') {
    throw new HttpError(403, `Refused: ${r.name} is tagged protected: true`);
  }
  if (r.resourceGroup.toLowerCase().includes('prod')) {
    throw new HttpError(403, `Refused: resource group "${r.resourceGroup}" looks like production`);
  }
}

/** Every destructive action is appended to a local actions.log. */
export function logDestructiveAction(action: 'hibernate' | 'teardown', resourceId: string): void {
  const line = `${new Date().toISOString()}\t${action}\t${resourceId}\n`;
  try {
    fs.appendFileSync(LOG_PATH, line, 'utf8');
  } catch (err) {
    console.error('[azure-janitor] failed to write actions.log:', err);
  }
}
