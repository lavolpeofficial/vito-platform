import { Controller, Get, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TenantContext } from '../../common/tenant/tenant-context';
import { OrganizationsService } from './organizations.service';

/**
 * Sprint-2.1-Sicherheitsentscheidung (siehe ADR-001, Abschnitt
 * "Deaktivierung von POST /organizations", und ADR-003): Es gibt in
 * diesem MVP KEINEN Endpunkt zum Anlegen neuer Organizations mehr — auch
 * nicht hinter Authentifizierung. Neue Organizations entstehen
 * ausschließlich über:
 *
 *   - den Seed-Prozess (`pnpm prisma:seed`),
 *   - einen Bootstrap-/Ops-Prozess (direkter DB-Zugriff),
 *   - ein zukünftiges, noch nicht existierendes Platform-Admin-Modul.
 *
 * `POST /organizations` existiert daher bewusst nicht mehr in diesem
 * Controller; ein Aufruf liefert die Standard-Nest-404-Antwort für
 * unbekannte Routen.
 */
@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Get(':id')
  @ApiOkResponse({ description: 'Organization gefunden.' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    const organizationId = this.tenantContext.getOrThrow();
    if (id !== organizationId) {
      // Ein User darf niemals auf eine andere Organization zugreifen,
      // auch nicht lesend.
      throw new NotFoundException('Organization nicht gefunden.');
    }
    return this.organizationsService.findById(id);
  }
}
