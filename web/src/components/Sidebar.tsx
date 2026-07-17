import { Home, Package2 } from 'lucide-react';

interface NavLink {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_LINKS: NavLink[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: <Home className="h-5 w-5" />,
  },
  {
    id: 'resources',
    label: 'Resources',
    icon: <Package2 className="h-5 w-5" />,
  },
];

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-slate-50 p-4">
      <div className="mb-8 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-blue-600 text-white font-bold">
          J
        </div>
        <h1 className="font-bold text-lg">Janitor</h1>
      </div>
      
      <nav className="flex-1 space-y-2">
        {NAV_LINKS.map((link) => {
          const isActive = currentPage === link.id;
          return (
            <button
              key={link.id}
              onClick={() => onNavigate(link.id)}
              className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 transition-colors text-left ${
                isActive
                  ? 'bg-blue-100 text-blue-700 font-medium'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {link.icon}
              <span>{link.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="border-t pt-4 text-xs text-slate-500">
        <p className="px-3">Azure Cost Management</p>
      </div>
    </aside>
  );
}
