import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ExecutiveReceiptsService } from './executive-receipts.service';

@ApiTags('executive')
@ApiBearerAuth()
@Controller('executive')
@Roles(UserRole.OWNER)
export class ExecutiveReceiptsController {
  constructor(private readonly receipts: ExecutiveReceiptsService) {}

  /** Existing JWT guard, no user-provided organizationId. */
  @Get('receipts')
  @ApiOkResponse({ description: 'Bounded unsigned CONTROL BUS receipts; never execution proof.' })
  receiptsOverview() {
    return this.receipts.overview();
  }
}
