import { SetMetadata } from '@nestjs/common';

export const MACHINE_SCOPE_KEY = 'machineScope';
export const VITO_BRIDGE_MACHINE_SCOPE = 'vito-bridge';

export const MachineScope = (scope: string) => SetMetadata(MACHINE_SCOPE_KEY, scope);
