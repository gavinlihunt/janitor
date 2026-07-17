import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import GroupModal from '@/components/GroupModal';
import { Sidebar } from '@/components/Sidebar';
import Dashboard from '@/pages/Dashboard';
import Resources from '@/pages/Resources';
import { navigate, useRoute } from '@/lib/router';

export default function App() {
  const route = useRoute();
  // Group detail opens as a modal over the resources page.
  const page = route.name === 'dashboard' ? 'dashboard' : 'resources';

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen">
        <Sidebar active={page} />
        <div className="min-w-0 flex-1">
          {page === 'dashboard' ? <Dashboard /> : <Resources />}
        </div>
      </div>
      <GroupModal
        groupName={route.name === 'group' ? route.group : null}
        onClose={() => navigate({ name: 'resources' })}
      />
      <Toaster position="bottom-right" richColors />
    </TooltipProvider>
  );
}
