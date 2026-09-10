import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EXPERIENCE_REPOSITORY } from './experience-store.types';
import { ExperienceStoreService } from './experience-store.service';
import { OUTCOME_REPOSITORY } from './outcome-evaluation.types';
import { OutcomeEvaluationService } from './outcome-evaluation.service';
import { PrismaExperienceRepository } from './prisma-experience.repository';
import { PrismaOutcomeRepository } from './prisma-outcome.repository';

@Module({
  imports: [AuditModule],
  providers: [
    PrismaExperienceRepository,
    ExperienceStoreService,
    PrismaOutcomeRepository,
    OutcomeEvaluationService,
    {
      provide: EXPERIENCE_REPOSITORY,
      useExisting: PrismaExperienceRepository,
    },
    {
      provide: OUTCOME_REPOSITORY,
      useExisting: PrismaOutcomeRepository,
    },
  ],
  exports: [ExperienceStoreService, OutcomeEvaluationService],
})
export class LearningModule {}
