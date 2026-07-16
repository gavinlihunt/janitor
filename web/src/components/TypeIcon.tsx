import { Box, Database, Globe, HardDrive, Layers, Server, Table2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ResourceKind } from '@/lib/api';

const ICONS: Record<ResourceKind, typeof Server> = {
  vm: Server,
  appServicePlan: Layers,
  appService: Globe,
  cosmos: Database,
  sql: Table2,
  storage: HardDrive,
  other: Box,
};

export function TypeIcon({ kind, azureType }: { kind: ResourceKind; azureType: string }) {
  const Icon = ICONS[kind] ?? Box;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{azureType}</TooltipContent>
    </Tooltip>
  );
}
