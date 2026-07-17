import { Boxes, LayoutDashboard, Trash2 } from 'lucide-react';
import { navigate, type Route } from '@/lib/router';

type PageKey = 'dashboard' | 'resources';

const NAV_ITEMS: Array<{
  key: PageKey;
  label: string;
  icon: typeof LayoutDashboard;
  route: Route;
}> = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, route: { name: 'dashboard' } },
  { key: 'resources', label: 'Resources', icon: Boxes, route: { name: 'resources' } },
];

/** Fixed left navigation. The active page is derived from the current route. */
export function Sidebar({ active }: { active: PageKey }) {
  return (
    <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r bg-card/40">
      <div className="flex h-20 items-center gap-3 border-b px-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/15">
          <Trash2 className="h-5 w-5 text-red-400" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight">Azure Janitor</p>
          <p className="text-xs text-muted-foreground">Cost leak finder</p>
        </div>
      </div>

      <nav className="flex flex-col gap-1 p-3" aria-label="Main navigation">
        {NAV_ITEMS.map(({ key, label, icon: Icon, route }) => (
          <button
            key={key}
            type="button"
            onClick={() => navigate(route)}
            aria-current={active === key ? 'page' : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active === key
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </button>
        ))}
      </nav>

      <p className="mt-auto px-4 py-4 text-[11px] leading-relaxed text-muted-foreground">
        Figures are estimates for development use, not billing statements.
      </p>
    </aside>
  );
}
