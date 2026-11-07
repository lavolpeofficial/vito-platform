import { Module } from '@nestjs/common';
import { ExecutiveReceiptsController } from './executive-receipts.controller';
import { ExecutiveReceiptsService } from './executive-receipts.service';

@Module({
  controllers: [ExecutiveReceiptsController],
  providers: [ExecutiveReceiptsService],
})
export class ExecutiveReceiptsModule {}
