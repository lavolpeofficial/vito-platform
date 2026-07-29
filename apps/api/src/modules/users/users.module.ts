import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  // AuthModule: UsersService.changeOwnPassword() nutzt
  // AuthService.issueTokenFor() wieder (Sprint 3A), statt eine zweite
  // Token-Ausstellungslogik zu bauen.
  imports: [AuditModule, AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
