import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  // Sprint 2.1: Rate-Limiting NUR für diesen Endpunkt (siehe AuthModule
  // für die ThrottlerModule-Konfiguration). Kein globaler APP_GUARD.
  @UseGuards(ThrottlerGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Login erfolgreich, liefert ein signiertes JWT.' })
  @ApiTooManyRequestsResponse({ description: 'Zu viele Login-Versuche — bitte später erneut versuchen.' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
