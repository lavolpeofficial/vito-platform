import { Module } from '@nestjs/common';

import { MissionContextController } from './mission-context.controller';
import { MissionContextService } from './mission-context.service';

@Module({
  controllers: [MissionContextController],
  providers: [MissionContextService],
  exports: [MissionContextService],
})
export class MissionContextModule {}
