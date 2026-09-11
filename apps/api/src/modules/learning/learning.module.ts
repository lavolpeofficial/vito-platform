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
import { PrismaSkillCandidateRepository } from './prisma-skill-candidate.repository';
import { REFLECTION_REPOSITORY } from './reflection.types';
import { ReflectionService } from './reflection.service';
import { RuntimeExperienceCaptureService } from './runtime-experience-capture.service';
import { RuntimeOutcomeEvaluationService } from './runtime-outcome-evaluation.service';
import { RuntimeReflectionLearningService } from './runtime-reflection-learning.service';
import { SKILL_CANDIDATE_REPOSITORY } from './skill-candidate.types';
import { SkillCandidateService } from './skill-candidate.service';

@Module({
  imports: [AuditModule],
  providers: [
    PrismaExperienceRepository,
    ExperienceStoreService,
    RuntimeExperienceCaptureService,
    PrismaOutcomeRepository,
    OutcomeEvaluationService,
    RuntimeOutcomeEvaluationService,
    PrismaReflectionRepository,
    ReflectionService,
    PrismaLearningMaturityRepository,
    LearningMaturityService,
    RuntimeReflectionLearningService,
    PrismaFailurePatternRepository,
    FailurePatternService,
    PrismaLearningRetrievalRepository,
    LearningRetrievalService,
    PrismaSkillCandidateRepository,
    SkillCandidateService,
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
    {
      provide: SKILL_CANDIDATE_REPOSITORY,
      useExisting: PrismaSkillCandidateRepository,
    },
  ],
  exports: [
    ExperienceStoreService,
    RuntimeExperienceCaptureService,
    OutcomeEvaluationService,
    RuntimeOutcomeEvaluationService,
    RuntimeReflectionLearningService,
    ReflectionService,
    LearningMaturityService,
    FailurePatternService,
    LearningRetrievalService,
    SkillCandidateService,
  ],
})
export class LearningModule {}
