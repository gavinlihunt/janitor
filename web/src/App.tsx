import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import Dashboard from '@/pages/Dashboard';

export default function App() {
  return (
    <TooltipProvider delayDuration={200}>
      <Dashboard />
      <Toaster position="bottom-right" richColors />
    </TooltipProvider>
  );
}
