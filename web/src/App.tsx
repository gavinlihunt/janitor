import { useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { Layout } from '@/components/Layout';
import DashboardPage from '@/pages/DashboardPage';
import ResourcesPage from '@/pages/ResourcesPage';

export default function App() {
  const [currentPage, setCurrentPage] = useState('dashboard');

  return (
    <TooltipProvider delayDuration={200}>
      <Layout currentPage={currentPage} onNavigate={setCurrentPage}>
        {currentPage === 'dashboard' && <DashboardPage />}
        {currentPage === 'resources' && <ResourcesPage />}
      </Layout>
      <Toaster position="bottom-right" richColors />
    </TooltipProvider>
  );
}
