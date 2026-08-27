import { Module } from '@nestjs/common';

import { parseGovernedWorkspaceRoot } from './resolvers/governed-workspace.resolvers';
import { GOVERNED_WORKSPACE_ROOT } from './governed-runtime.tokens';

@Module({
  providers: [
    {
      provide: GOVERNED_WORKSPACE_ROOT,
      useFactory: () => parseGovernedWorkspaceRoot(process.env.GOVERNED_WORKSPACE_ROOT),
    },
  ],
  exports: [GOVERNED_WORKSPACE_ROOT],
})
export class GovernedWorkspaceConfigModule {}
