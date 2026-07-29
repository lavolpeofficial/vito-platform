import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOkResponse({ description: 'Liveness-Check der API.' })
  check() {
    return { status: 'ok', service: 'vito-api', timestamp: new Date().toISOString() };
  }
}
