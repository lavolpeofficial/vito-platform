import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { TenantContext } from '../../common/tenant/tenant-context';
import {
  LEARNING_RETRIEVAL_REPOSITORY,
  LearningRetrievalQuery,
  LearningRetrievalRepository,
  RetrievedLearningItem,
} from './learning-retrieval.types';

@Injectable()
export class LearningRetrievalService {
  constructor(
    private readonly tenantContext: TenantContext,
    @Inject(LEARNING_RETRIEVAL_REPOSITORY)
    private readonly repository: LearningRetrievalRepository,
  ) {}

  retrieve(query: LearningRetrievalQuery): Promise<readonly RetrievedLearningItem[]> {
    const organizationId = this.tenantContext.getOrThrow();
    if (!query.query?.trim()) throw new BadRequestException('query is required.');
    if (query.limit != null && (query.limit < 1 || query.limit > 50)) {
      throw new BadRequestException('limit must be between 1 and 50.');
    }
    return this.repository.retrieve(organizationId, { ...query, query: query.query.trim() });
  }
}
