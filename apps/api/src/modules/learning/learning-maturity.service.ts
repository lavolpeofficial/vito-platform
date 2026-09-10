import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import { ExperienceStoreService } from './experience-store.service';
import { ReflectionService } from './reflection.service';
import {
  CreateLearningCandidateInput,
  LEARNING_MATURITY_REPOSITORY,
  LearningCandidateRecord,
  LearningMaturity,
  LearningMaturityRepository,
  PromoteLearningCandidateInput,
  PromotionRecord,
} from './learning-maturity.types';

const ORDER: readonly LearningMaturity[] = ['OBSERVATION', 'HYPOTHESIS', 'PATTERN', 'POLICY'];

@Injectable()
export class LearningMaturityService {
  constructor(
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
    private readonly experiences: ExperienceStoreService,
    private readonly reflections: ReflectionService,
    @Inject(LEARNING_MATURITY_REPOSITORY)
    private readonly repository: LearningMaturityRepository,
  ) {}

  async createCandidate(input: CreateLearningCandidateInput): Promise<LearningCandidateRecord> {
    const organizationId = this.tenantContext.getOrThrow();
    validateCandidate(input);

    const experience = await this.experiences.get(input.experienceId);
    if (experience.status !== 'REFLECTED') {
      throw new BadRequestException('experience must be reflected before creating a learning observation.');
    }

    const reflections = await this.reflections.listForExperience(input.experienceId);
    if (!reflections.some((reflection) => reflection.id === input.reflectionId)) {
      throw new BadRequestException('reflection must belong to the referenced experience.');
    }

    const candidate = await this.repository.createCandidate(organizationId, input);
    await this.audit.record({
      organizationId,
      actorType: 'SYSTEM',
      actorId: null,
      action: 'LEARNING_CANDIDATE_CREATED',
      entityType: 'LearningCandidate',
      entityId: candidate.id,
      metadata: {
        experienceId: candidate.experienceId,
        reflectionId: candidate.reflectionId,
        maturity: candidate.maturity,
        confidence: candidate.confidence,
      },
    });
    return candidate;
  }

  async promote(input: PromoteLearningCandidateInput): Promise<PromotionRecord> {
    const organizationId = this.tenantContext.getOrThrow();
    validatePromotion(input);

    const candidate = await this.repository.getCandidate(organizationId, input.candidateId);
    if (!candidate) throw new NotFoundException('Learning candidate not found.');
    if (candidate.status !== 'ACTIVE') throw new BadRequestException('Only active learning candidates can change maturity.');

    const fromIndex = ORDER.indexOf(candidate.maturity);
    const toIndex = ORDER.indexOf(input.toMaturity);
    if (toIndex !== fromIndex + 1 && toIndex !== fromIndex - 1) {
      throw new BadRequestException('Maturity changes must move exactly one governed step at a time.');
    }

    if (input.toMaturity === 'POLICY') {
      const userId = this.tenantContext.getUserId();
      if (this.tenantContext.getAuthenticationMethod() !== 'jwt' || !userId) {
        throw new BadRequestException('Policy promotion requires an authenticated human approval.');
      }
      if (!input.approvalRef?.trim()) {
        throw new BadRequestException('Policy promotion requires an approvalRef.');
      }
    }

    const changed = await this.repository.setMaturity(
      organizationId,
      candidate.id,
      candidate.maturity,
      input.toMaturity,
    );
    if (!changed) throw new ConflictException('Learning candidate changed concurrently; retry with current maturity.');

    const promotion = await this.repository.createPromotion(organizationId, candidate, {
      ...input,
      actorId: input.actorId ?? this.tenantContext.getUserId(),
    });

    await this.audit.record({
      organizationId,
      actorType: input.toMaturity === 'POLICY' ? 'USER' : 'SYSTEM',
      actorId: promotion.actorId,
      action: toIndex > fromIndex ? 'LEARNING_MATURITY_PROMOTED' : 'LEARNING_MATURITY_REVERTED',
      entityType: 'LearningCandidate',
      entityId: candidate.id,
      metadata: {
        fromMaturity: promotion.fromMaturity,
        toMaturity: promotion.toMaturity,
        promotionId: promotion.id,
        approvalRef: promotion.approvalRef,
      },
    });

    return promotion;
  }

  async get(candidateId: string): Promise<LearningCandidateRecord> {
    const organizationId = this.tenantContext.getOrThrow();
    const candidate = await this.repository.getCandidate(organizationId, candidateId);
    if (!candidate) throw new NotFoundException('Learning candidate not found.');
    return candidate;
  }

  async listPromotions(candidateId: string): Promise<readonly PromotionRecord[]> {
    const organizationId = this.tenantContext.getOrThrow();
    await this.get(candidateId);
    return this.repository.listPromotions(organizationId, candidateId);
  }
}

function validateCandidate(input: CreateLearningCandidateInput): void {
  if (!input.experienceId?.trim()) throw new BadRequestException('experienceId is required.');
  if (!input.reflectionId?.trim()) throw new BadRequestException('reflectionId is required.');
  if (!input.statement?.trim()) throw new BadRequestException('statement is required.');
  if (input.confidence != null && (input.confidence < 0 || input.confidence > 1)) {
    throw new BadRequestException('confidence must be between 0 and 1.');
  }
}

function validatePromotion(input: PromoteLearningCandidateInput): void {
  if (!input.candidateId?.trim()) throw new BadRequestException('candidateId is required.');
  if (!ORDER.includes(input.toMaturity)) throw new BadRequestException('invalid toMaturity.');
  if (!input.reason?.trim()) throw new BadRequestException('promotion reason is required.');
  if (!input.evidence || Object.keys(input.evidence).length === 0) {
    throw new BadRequestException('promotion evidence is required.');
  }
}
