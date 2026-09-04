import { Controller, Get, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TenantContext } from '../../common/tenant/tenant-context';
import { OrganizationChartService } from './organization-chart.service';

@ApiTags('organization-chart')
@ApiBearerAuth()
@Controller('organization-chart')
export class OrganizationChartController {
  constructor(
    private readonly organizationChartService: OrganizationChartService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Get()
  @ApiQuery({
    name: 'workforceInstanceId',
    required: true,
    description: 'UUID der Workforce, deren Organigramm geladen werden soll.',
  })
  @ApiOkResponse({
    description:
      'Tenant-sicheres Read Model aus Workforce, Department-Hierarchie, Teams, Positionen, Occupants und Reporting-Linien.',
  })
  getChart(
    @Query('workforceInstanceId', ParseUUIDPipe) workforceInstanceId: string,
  ) {
    return this.organizationChartService.getChart(
      this.tenantContext.getOrThrow(),
      workforceInstanceId,
    );
  }
}
