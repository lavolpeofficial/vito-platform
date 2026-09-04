import { Module } from '@nestjs/common';
import { OrganizationChartController } from './organization-chart.controller';
import { OrganizationChartService } from './organization-chart.service';

@Module({
  controllers: [OrganizationChartController],
  providers: [OrganizationChartService],
})
export class OrganizationChartModule {}
