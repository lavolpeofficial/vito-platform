import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LearningModule } from '../learning/learning.module';
import { SkillPromotionController } from './skill-promotion.controller';
import { SkillPromotionService } from './skill-promotion.service';

@Module({
  imports: [AuditModule, LearningModule],
  controllers: [SkillPromotionController],
  providers: [SkillPromotionService],
  exports: [SkillPromotionService],
})
export class SkillPromotionModule {}
