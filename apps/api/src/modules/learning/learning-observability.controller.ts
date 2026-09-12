import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ExperienceStoreService } from './experience-store.service';
import { ExperienceStatus } from './experience-store.types';
import { OutcomeEvaluationService } from './outcome-evaluation.service';
import { ReflectionService } from './reflection.service';

const EXPERIENCE_STATUSES: readonly ExperienceStatus[] = [
  'OBSERVED',
  'EVALUATED',
  'REFLECTED',
  'LEARNING_CANDIDATE',
  'ARCHIVED',
];

@ApiTags('learning-observability')
@ApiBearerAuth()
@Controller('learning-observability')
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class LearningObservabilityController {
  constructor(
    private readonly experiences: ExperienceStoreService,
    private readonly outcomes: OutcomeEvaluationService,
    private readonly reflections: ReflectionService,
  ) {}

  @Get('experiences')
  @ApiOkResponse({ description: 'Lists tenant-scoped persisted learning experiences through the authoritative learning store.' })
  listExperiences(
    @Query('agentId') agentId?: string,
    @Query('status') status?: string | string[],
    @Query('limit') limit?: string,
  ) {
    return this.experiences.search({
      ...(agentId?.trim() ? { agentId: agentId.trim() } : {}),
      ...(status == null ? {} : { statuses: parseStatuses(status) }),
      ...(limit == null ? {} : { limit: parseLimit(limit) }),
    });
  }

  @Get('experiences/:experienceId')
  @ApiOkResponse({ description: 'Returns one tenant-scoped persisted learning experience.' })
  getExperience(@Param('experienceId') experienceId: string) {
    return this.experiences.get(requireId(experienceId, 'experienceId'));
  }

  @Get('experiences/:experienceId/outcomes')
  @ApiOkResponse({ description: 'Returns objective persisted outcomes for one tenant-scoped experience.' })
  listOutcomes(@Param('experienceId') experienceId: string) {
    return this.outcomes.listForExperience(requireId(experienceId, 'experienceId'));
  }

  @Get('experiences/:experienceId/reflections')
  @ApiOkResponse({ description: 'Returns persisted evidence-backed reflections for one tenant-scoped experience.' })
  listReflections(@Param('experienceId') experienceId: string) {
    return this.reflections.listForExperience(requireId(experienceId, 'experienceId'));
  }
}

export function parseStatuses(input: string | string[]): readonly ExperienceStatus[] {
  const raw = Array.isArray(input) ? input : input.split(',');
  const normalized = [...new Set(raw.map((value) => value.trim()).filter(Boolean))];
  if (normalized.length === 0) throw new BadRequestException('status must not be empty.');
  const invalid = normalized.find((value) => !EXPERIENCE_STATUSES.includes(value as ExperienceStatus));
  if (invalid) throw new BadRequestException(`unsupported experience status: ${invalid}`);
  return normalized as ExperienceStatus[];
}

export function parseLimit(input: string): number {
  if (!/^\d+$/.test(input.trim())) throw new BadRequestException('limit must be an integer between 1 and 100.');
  const value = Number(input);
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new BadRequestException('limit must be an integer between 1 and 100.');
  }
  return value;
}

function requireId(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new BadRequestException(`${field} is required.`);
  return normalized;
}
