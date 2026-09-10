import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EXPERIENCE_REPOSITORY } from './experience-store.types';
import { ExperienceStoreService } from './experience-store.service';
import { OUTCOME_REPOSITORY } from './outcome-evaluation.types';
import { OutcomeEvaluationService } from './outcome-evaluation.service';
import { PrismaExperienceRepository } from './prisma-experience.repository';
import { PrismaOutcomeRepository } from './prisma-outcome.repository';
import { PrismaReflectionRepository } from './prisma-reflection.repository';
import { REFLECTION_REPOSITORY } from './reflection.types';
import { ReflectionService } from './reflection.service';

@Module({
  imports: [AuditModule],
  providers: [
    PrismaExperienceRepository,
    ExperienceStoreService,
    PrismaOutcomeRepository,
    OutcomeEvaluationService,
    PrismaReflectionRepository,
    ReflectionService,
    {
      provide: EXPERIENCE_REPOSITORY,
      useExisting: PrismaExperienceRepository,
    },
    {
      provide: OUTCOME_REPOSITORY,
      useExisting: PrismaOutcomeRepository,
    },
    {
      provide: REFLECTION_REPOSITORY,
      useExisting: PrismaReflectionRepository,
    },
  ],
  exports: [ExperienceStoreService, OutcomeEvaluationService, ReflectionService],
})
export class LearningModule {}
