import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import GroupModal from '@/components/GroupModal';
import Dashboard from '@/pages/Dashboard';
import { navigate, useRoute } from '@/lib/router';

export default function App() {
  const route = useRoute();

  return (
    <TooltipProvider delayDuration={200}>
      <Dashboard />
      <GroupModal
        groupName={route.name === 'group' ? route.group : null}
        onClose={() => navigate({ name: 'dashboard' })}
      />
      <Toaster position="bottom-right" richColors />
    </TooltipProvider>
  );
}
