import { Module } from '@nestjs/common';

import { ExecutionCancellationRegistry } from './execution-cancellation.registry';

@Module({
  providers: [ExecutionCancellationRegistry],
  exports: [ExecutionCancellationRegistry],
})
export class ExecutionCancellationModule {}
