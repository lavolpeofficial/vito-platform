import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  ProposeSkillPromotionDto,
  ReviewSkillPromotionDto,
  SkillPromotionListQueryDto,
} from './dto/skill-promotion.dto';
import { SkillPromotionService } from './skill-promotion.service';

@ApiTags('skill-promotion')
@ApiBearerAuth()
@Controller('skill-promotion')
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class SkillPromotionController {
  constructor(private readonly service: SkillPromotionService) {}

  @Post(':skillCandidateId/proposals')
  @ApiOkResponse({ description: 'Creates a non-executable human-governed skill promotion review.' })
  propose(
    @Param('skillCandidateId') skillCandidateId: string,
    @Body() dto: ProposeSkillPromotionDto,
  ) {
    return this.service.propose(skillCandidateId, dto.targetCapabilityCode);
  }

  @Post('reviews/:id/approve-registration')
  @ApiOkResponse({ description: 'Approves a proposal for capability registration review only; grants no execution authority.' })
  approve(@Param('id') id: string, @Body() dto: ReviewSkillPromotionDto) {
    return this.service.approveForRegistration(id, dto.rationale);
  }

  @Post('reviews/:id/reject')
  @ApiOkResponse({ description: 'Rejects a pending skill promotion review.' })
  reject(@Param('id') id: string, @Body() dto: ReviewSkillPromotionDto) {
    return this.service.reject(id, dto.rationale);
  }

  @Get('reviews/:id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Get('reviews')
  list(@Query() query: SkillPromotionListQueryDto, @Query('limit') limit?: string) {
    return this.service.list(query.status, limit ? Number(limit) : 50);
  }
}
