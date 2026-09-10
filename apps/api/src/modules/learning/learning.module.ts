import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EXPERIENCE_REPOSITORY } from './experience-store.types';
import { ExperienceStoreService } from './experience-store.service';
import { FAILURE_PATTERN_REPOSITORY } from './failure-pattern.types';
import { FailurePatternService } from './failure-pattern.service';
import { LEARNING_MATURITY_REPOSITORY } from './learning-maturity.types';
import { LearningMaturityService } from './learning-maturity.service';
import { LEARNING_RETRIEVAL_REPOSITORY } from './learning-retrieval.types';
import { LearningRetrievalService } from './learning-retrieval.service';
import { OUTCOME_REPOSITORY } from './outcome-evaluation.types';
import { OutcomeEvaluationService } from './outcome-evaluation.service';
import { PrismaExperienceRepository } from './prisma-experience.repository';
import { PrismaFailurePatternRepository } from './prisma-failure-pattern.repository';
import { PrismaLearningMaturityRepository } from './prisma-learning-maturity.repository';
import { PrismaLearningRetrievalRepository } from './prisma-learning-retrieval.repository';
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
    PrismaLearningMaturityRepository,
    LearningMaturityService,
    PrismaFailurePatternRepository,
    FailurePatternService,
    PrismaLearningRetrievalRepository,
    LearningRetrievalService,
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
    {
      provide: LEARNING_MATURITY_REPOSITORY,
      useExisting: PrismaLearningMaturityRepository,
    },
    {
      provide: FAILURE_PATTERN_REPOSITORY,
      useExisting: PrismaFailurePatternRepository,
    },
    {
      provide: LEARNING_RETRIEVAL_REPOSITORY,
      useExisting: PrismaLearningRetrievalRepository,
    },
  ],
  exports: [
    ExperienceStoreService,
    OutcomeEvaluationService,
    ReflectionService,
    LearningMaturityService,
    FailurePatternService,
    LearningRetrievalService,
  ],
})
export class LearningModule {}
