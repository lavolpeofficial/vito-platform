import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser } from '../../common/auth/authenticated-user.interface';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'User wurde angelegt.' })
  async create(@Body() dto: CreateUserDto) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.usersService.create(organizationId, dto);
  }

  @Get()
  @ApiOkResponse({ description: 'Paginierte Liste der User der Organization.' })
  async findAll(@Query() query: ListUsersQueryDto) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.usersService.findAll(organizationId, query);
  }

  // WICHTIG: Diese Route muss VOR "@Get(':id')"/"@Patch(':id')" stehen,
  // da Nest/Express Routen in Deklarationsreihenfolge matcht — sonst
  // würde "me" fälschlich als ":id" interpretiert.
  @Patch('me/password')
  @ApiOkResponse({ description: 'Eigenes Passwort geändert, liefert ein neues JWT.' })
  async changeOwnPassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.usersService.changeOwnPassword(organizationId, user.userId, dto);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'User gefunden.' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.usersService.findByIdOrFail(organizationId, id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOkResponse({ description: 'User wurde aktualisiert.' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.usersService.update(organizationId, id, dto, currentUser.role, currentUser.userId);
  }

  @Delete(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOkResponse({ description: 'User wurde deaktiviert (Soft Delete).' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() currentUser: AuthenticatedUser) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.usersService.softDelete(organizationId, id, currentUser.userId);
  }
}
