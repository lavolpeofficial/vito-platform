import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Zentraler Datenbankzugriff. Alle Module greifen ausschließlich über diesen
 * Service (bzw. injizierte Repositories/Services, die ihn nutzen) auf
 * PostgreSQL zu. Direkter DB-Zugriff außerhalb dieses Layers ist nicht
 * vorgesehen (Architekturregel 2).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
