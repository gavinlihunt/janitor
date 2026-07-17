import { ReactNode } from 'react';

interface StatCardProps {
  title: string;
  value: ReactNode;
  subtitle?: string;
  icon?: ReactNode;
  className?: string;
}

export function StatCard({ title, value, subtitle, icon, className = '' }: StatCardProps) {
  return (
    <div className={`rounded-lg border bg-white p-6 ${className}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-600">{title}</p>
          <div className="mt-2">{value}</div>
          {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {icon && <div className="ml-4 text-slate-300">{icon}</div>}
      </div>
    </div>
  );
}

interface SectionProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function DashboardSection({ title, subtitle, children }: SectionProps) {
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {children}
      </div>
    </div>
  );
}
