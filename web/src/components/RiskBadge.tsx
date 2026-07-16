import { Badge } from '@/components/ui/badge';
import type { RiskLevel } from '@/lib/api';

const STYLES: Record<RiskLevel, string> = {
  critical: 'border-red-500/40 bg-red-500/15 text-red-400',
  warning: 'border-amber-500/40 bg-amber-500/15 text-amber-400',
  healthy: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400',
};

const LABELS: Record<RiskLevel, string> = {
  critical: 'Critical',
  warning: 'Warning',
  healthy: 'Healthy',
};

export function RiskBadge({ risk, score }: { risk: RiskLevel; score?: number }) {
  return (
    <Badge variant="outline" className={`${STYLES[risk]} transition-colors duration-500`}>
      {score !== undefined ? `${score} · ` : ''}
      {LABELS[risk]}
    </Badge>
  );
}
