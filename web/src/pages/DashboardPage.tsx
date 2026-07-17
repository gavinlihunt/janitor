import { useEffect, useState } from 'react';
import { TrendingUp, AlertCircle, Zap, Database, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Summary } from '@/lib/api';
import { fmtUsd } from '@/lib/format';
import { StatCard, DashboardSection } from '@/components/DashboardCards';
import { Button } from '@/components/ui/button';

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadSummary();
  }, []);

  const loadSummary = async () => {
    try {
      setLoading(true);
      const data = await api.summary();
      setSummary(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load summary');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await api.sync();
      await loadSummary();
      toast.success('Data refreshed from Azure');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-slate-500">Loading dashboard...</div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-slate-500">No data available</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        {/* Header with refresh */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Cost Dashboard</h1>
            <p className="mt-1 text-slate-600">
              {summary.subscriptionName}
              {summary.mockMode && ' (Mock Mode)'}
            </p>
          </div>
          <Button
            onClick={handleRefresh}
            disabled={refreshing}
            variant="outline"
          >
            {refreshing ? 'Refreshing...' : 'Refresh Data'}
          </Button>
        </div>

        {/* Hero Stats - Top Section */}
        <div className="grid gap-6 grid-cols-1 md:grid-cols-3">
          <div className="rounded-xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100 p-8">
            <p className="text-sm font-medium text-blue-600">Potential Monthly Savings</p>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-5xl font-bold text-blue-900">
                {fmtUsd(summary.potentialMonthlySavingsUsd)}
              </span>
            </div>
            <p className="mt-2 text-xs text-blue-700">
              If you turned off all {summary.idleResourceCount} flagged resources
            </p>
          </div>

          <div className="rounded-xl border-2 border-red-200 bg-gradient-to-br from-red-50 to-red-100 p-8">
            <p className="text-sm font-medium text-red-600">"Zombie" Count</p>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-5xl font-bold text-red-900">{summary.idleResourceCount}</span>
              <span className="text-lg text-red-700">abandoned</span>
            </div>
            <p className="mt-2 text-xs text-red-700">
              Resources costing {fmtUsd(summary.idleDailyBurnUsd)}/day
            </p>
          </div>

          <div className="rounded-xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100 p-8">
            <p className="text-sm font-medium text-amber-600">Active Daily Burn Rate</p>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-5xl font-bold text-amber-900">
                {fmtUsd(summary.dailyBurnRateUsd)}
              </span>
              <span className="text-lg text-amber-700">/day</span>
            </div>
            <p className="mt-2 text-xs text-amber-700">
              Current subscription spend
            </p>
          </div>
        </div>

        {/* Additional Summary Stats */}
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Waste This Month"
            value={<span className="text-2xl font-bold text-slate-900">{fmtUsd(summary.wasteThisMonthSoFarUsd)}</span>}
            icon={<AlertCircle className="h-6 w-6" />}
          />
          <StatCard
            title="Estimated Monthly Waste"
            value={<span className="text-2xl font-bold text-slate-900">{fmtUsd(summary.monthlyWasteEstimateUsd)}</span>}
            icon={<TrendingUp className="h-6 w-6" />}
          />
          <StatCard
            title="Daily Idle Burn"
            value={<span className="text-2xl font-bold text-slate-900">{fmtUsd(summary.idleDailyBurnUsd)}</span>}
            icon={<Zap className="h-6 w-6" />}
          />
          <StatCard
            title="Potential Daily Savings"
            value={<span className="text-2xl font-bold text-slate-900">{fmtUsd(summary.potentialDailySavingsUsd)}</span>}
            icon={<TrendingUp className="h-6 w-6" />}
          />
        </div>

        {/* Compute Cost Leaks */}
        <DashboardSection
          title="💻 Compute Cost Leaks"
          subtitle="VMs and storage that are wasting money silently"
        >
          <StatCard
            title='"Ghost" VMs (Running but Idle)'
            value={
              <div>
                <p className="text-2xl font-bold text-slate-900">Scanning...</p>
              </div>
            }
            subtitle="VMs with PowerState Running but <2% CPU for 24h"
          />
          <StatCard
            title="Orphaned Managed Disks"
            value={
              <div>
                <p className="text-2xl font-bold text-slate-900">Scanning...</p>
              </div>
            }
            subtitle="Disks with no VM attached (silent killer)"
          />
          <StatCard
            title="Idle Storage Accounts"
            value={
              <div>
                <p className="text-2xl font-bold text-slate-900">Scanning...</p>
              </div>
            }
            subtitle="Storage with no recent activity"
          />
        </DashboardSection>

        {/* App Service Drain */}
        <DashboardSection
          title="🌐 App Service Drain"
          subtitle="App Service Plans charging whether apps are running or not"
        >
          <StatCard
            title='"Ghost Town" App Service Plans'
            value={
              <div>
                <p className="text-2xl font-bold text-slate-900">Scanning...</p>
              </div>
            }
            subtitle="Premium/Standard ASPs with zero active apps"
          />
          <StatCard
            title="Zero-Traffic App Services"
            value={
              <div>
                <p className="text-2xl font-bold text-slate-900">Scanning...</p>
              </div>
            }
            subtitle="Web apps with 0 requests in last 7 days"
          />
          <StatCard
            title="Stopped App Services"
            value={
              <div>
                <p className="text-2xl font-bold text-slate-900">Scanning...</p>
              </div>
            }
            subtitle="Apps in stopped state but still charged"
          />
        </DashboardSection>

        {/* Cosmos DB Over-Provisioning */}
        <DashboardSection
          title="🗄️ Cosmos DB Over-Provisioning"
          subtitle="Databases with manual throughput limits instead of serverless"
        >
          <StatCard
            title="Manual Throughput Red Flags"
            value={
              <div>
                <p className="text-2xl font-bold text-slate-900">Scanning...</p>
              </div>
            }
            subtitle="Fixed RUs instead of autoscale/serverless"
          />
          <StatCard
            title="High RU Allocations"
            value={
              <div>
                <p className="text-2xl font-bold text-slate-900">Scanning...</p>
              </div>
            }
            subtitle="Databases with excessive provisioned capacity"
          />
          <StatCard
            title="Serverless Candidates"
            value={
              <div>
                <p className="text-2xl font-bold text-slate-900">Scanning...</p>
              </div>
            }
            subtitle="Databases suitable for cost savings"
          />
        </DashboardSection>

        {/* Weekend / Out-of-Hours Leak */}
        <DashboardSection
          title="🕐 Weekend & Out-of-Hours Leak"
          subtitle="Development infrastructure running when no one is coding"
        >
          <StatCard
            title="Overnight Spending (7 PM - 7 AM)"
            value={
              <div>
                <p className="text-2xl font-bold text-slate-900">Scanning...</p>
              </div>
            }
            subtitle="Daily cost during off-hours"
            icon={<Clock className="h-6 w-6" />}
          />
          <StatCard
            title="Weekend Costs"
            value={
              <div>
                <p className="text-2xl font-bold text-slate-900">Scanning...</p>
              </div>
            }
            subtitle="Saturday & Sunday spending"
          />
          <StatCard
            title="Schedule Optimization Savings"
            value={
              <div>
                <p className="text-2xl font-bold text-slate-900">Scanning...</p>
              </div>
            }
            subtitle="Potential savings from auto-shutdown"
          />
        </DashboardSection>
      </div>
    </div>
  );
}
