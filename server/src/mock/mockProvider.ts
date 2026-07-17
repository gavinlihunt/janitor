import { IAzureProvider } from '../azure/provider';
import { HttpError } from '../services/actions';
import { ActivityEntry, JanitorResource, ProviderInsights } from '../types';
import { mockActivityFor, seedInsights, seedResources } from './data';
import priceMap from '../services/priceMap.json';

/** In-memory provider. Fully demoable, never touches Azure. */
export class MockAzureProvider implements IAzureProvider {
  readonly isMock = true;
  private resources: JanitorResource[] = seedResources();

  async getSubscriptionName(): Promise<string> {
    return 'Contoso Dev Test Subscription';
  }

  async listResources(): Promise<JanitorResource[]> {
    return this.resources.map((r) => ({ ...r, tags: { ...r.tags }, idleSignals: [...r.idleSignals] }));
  }

  async getActivityLog(resourceId: string): Promise<ActivityEntry[]> {
    return mockActivityFor(this.require(resourceId));
  }

  async getDashboardInsights(): Promise<ProviderInsights> {
    return seedInsights(this.resources);
  }

  async hibernate(resourceId: string): Promise<JanitorResource> {
    const r = this.require(resourceId);
    switch (r.kind) {
      case 'vm':
        r.state = 'deallocated';
        r.hoursRunningPerDay = 0;
        r.idleSignals.push('Deallocated by Azure Janitor');
        break;
      case 'appServicePlan':
        r.sku = /^[BDF]/.test(r.sku) ? 'F1' : 'B1';
        r.idleSignals.push('Scaled down by Azure Janitor');
        break;
      case 'cosmos':
        r.provisionedRUs = priceMap.cosmosHibernateFloorRUs;
        r.sku = `${r.provisionedRUs} RU/s`;
        r.idleSignals.push('Throughput floored by Azure Janitor');
        break;
      default:
        throw new HttpError(400, `Hibernate is not supported for resource kind "${r.kind}"`);
    }
    return { ...r, tags: { ...r.tags }, idleSignals: [...r.idleSignals] };
  }

  async teardown(resourceId: string): Promise<void> {
    const index = this.resources.findIndex((r) => r.id === resourceId);
    if (index === -1) throw new HttpError(404, 'Resource not found');
    this.resources.splice(index, 1);
  }

  private require(resourceId: string): JanitorResource {
    const r = this.resources.find((x) => x.id === resourceId);
    if (!r) throw new HttpError(404, 'Resource not found');
    return r;
  }
}
