import { ForbiddenException, Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TenantContext } from '../../common/tenant/tenant-context';
import { isAuthorizedOwnerBusReader, isRestrictedBusReader, normalizeOwnerReceipts, type OwnerBusRow } from './owner-bus.contract';

type PrivilegeRow = Readonly<{
  can_select_view: boolean;
  can_select_table: boolean;
  can_insert_table: boolean;
  can_update_table: boolean;
  can_delete_table: boolean;
}>;

/**
 * Isolated PostgreSQL connection with dedicated SELECT-only role.
 * No use of VITO's main PrismaService for the CONTROL BUS Neon database.
 * Disabled by default. A recipient label is NOT an authenticated agent.
 */
@Injectable()
export class ExecutiveReceiptsService implements OnModuleDestroy {
  private reader: PrismaClient | null = null;

  // Singleton service: no per-request database pool; tenant is passed by the guarded controller.
  async overview(tenant: TenantContext) {
    const organizationId = tenant.getOrThrow();
    if (!isAuthorizedOwnerBusReader({
      organizationId,
      role: tenant.getRole(),
      userId: tenant.getUserId(),
      authenticationMethod: tenant.getAuthenticationMethod(),
    }, process.env.VITO_CONTROL_BUS_OWNER_ORGANIZATION_ID ?? '')) {
      throw new ForbiddenException('CONTROL_BUS_OWNER_TENANT_DENIED');
    }
    if (process.env.VITO_CONTROL_BUS_READER_ENABLED !== 'true') {
      throw new ServiceUnavailableException('CONTROL_BUS_READER_DISABLED');
    }
    const connection = process.env.VITO_CONTROL_BUS_READONLY_DATABASE_URL;
    if (!connection || !/^postgres(?:ql)?:\/\//.test(connection)) {
      throw new ServiceUnavailableException('CONTROL_BUS_READER_UNCONFIGURED');
    }
    try {
      const db = this.getReader(connection);
      const privilege = await db.$queryRaw<PrivilegeRow[]>(Prisma.sql`
        SELECT
          has_table_privilege(current_user, 'vito_control_bus_v1.owner_receipts_projection_v1', 'SELECT') AS can_select_view,
          has_table_privilege(current_user, 'vito_control_bus_v1.messages', 'SELECT') AS can_select_table,
          has_table_privilege(current_user, 'vito_control_bus_v1.messages', 'INSERT') AS can_insert_table,
          has_table_privilege(current_user, 'vito_control_bus_v1.messages', 'UPDATE') AS can_update_table,
          has_table_privilege(current_user, 'vito_control_bus_v1.messages', 'DELETE') AS can_delete_table
      `);
      if (privilege.length !== 1 || !isRestrictedBusReader(privilege[0])) {
        throw new Error('CONTROL_BUS_READER_PRIVILEGE_DENIED');
      }
      const rows = await db.$queryRaw<OwnerBusRow[]>(Prisma.sql`
        SELECT dispatch_id, recipient, topic, subject, dispatched_at, receipt_id
        FROM vito_control_bus_v1.owner_receipts_projection_v1
        ORDER BY dispatch_id DESC
        LIMIT 100
      `);
      return {
        organizationId,
        authority: 'READ_ONLY' as const,
        sourceHealth: 'HEALTHY' as const,
        observedAt: new Date().toISOString(),
        items: normalizeOwnerReceipts(rows),
      };
    } catch {
      // Never leak credentials, SQL errors or database hostnames to UI/logs.
      throw new ServiceUnavailableException('CONTROL_BUS_SOURCE_UNAVAILABLE');
    }
  }

  private getReader(url: string): PrismaClient {
    if (this.reader) return this.reader;
    this.reader = new PrismaClient({ datasources: { db: { url } } });
    return this.reader;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.reader) await this.reader.$disconnect();
  }
}
