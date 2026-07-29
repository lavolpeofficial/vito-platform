import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Legt den initialen Owner-User für ATERIMA an — ausschließlich aus
 * Environment-Variablen, niemals aus hart codierten Zugangsdaten (Sprint-2-
 * Anforderung 8):
 *
 *   SEED_OWNER_EMAIL
 *   SEED_OWNER_PASSWORD
 *
 * Fehlt eine der beiden Variablen, wird das Anlegen des Owners bewusst
 * übersprungen (mit deutlicher Warnung) statt eines unsicheren
 * Default-Passworts. Das Basis-Seed (Organization, TIMO, Capabilities)
 * läuft davon unabhängig weiter durch, damit lokale/CI-Läufe ohne
 * Login-Bedarf nicht künstlich blockiert werden.
 */
async function seedOwner(organizationId: string): Promise<void> {
  const rawEmail = process.env.SEED_OWNER_EMAIL;
  const password = process.env.SEED_OWNER_PASSWORD;

  if (!rawEmail || !password) {
    console.warn(
      'SEED_OWNER_EMAIL/SEED_OWNER_PASSWORD nicht gesetzt — es wird kein initialer Owner-User angelegt. ' +
        'Ohne einen User mit passwordHash ist kein Login über POST /auth/login möglich.',
    );
    return;
  }

  // Sprint 3A: dieselbe Normalisierung (trim + lowercase) wie
  // apps/api/src/common/utils/normalize-email.ts — hier bewusst inline
  // dupliziert, da prisma/seed.ts außerhalb des apps/api-Workspace läuft
  // und keinen direkten Import von dort erlaubt.
  const email = rawEmail.trim().toLowerCase();

  if (password.length < 12) {
    console.warn(
      'SEED_OWNER_PASSWORD ist kürzer als 12 Zeichen — es wird kein initialer Owner-User angelegt. ' +
        'Bitte ein stärkeres Passwort setzen und den Seed erneut ausführen.',
    );
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const owner = await prisma.user.upsert({
    where: { organizationId_email: { organizationId, email } },
    update: { passwordHash, role: 'OWNER', status: 'ACTIVE' },
    create: {
      organizationId,
      email,
      firstName: 'ATERIMA',
      lastName: 'Owner',
      role: 'OWNER',
      status: 'ACTIVE',
      passwordHash,
    },
  });

  console.log(`Seed: Owner-User "${owner.email}" für ATERIMA angelegt/aktualisiert.`);
}

async function main() {
  const organization = await prisma.organization.upsert({
    where: { slug: 'aterima' },
    update: {},
    create: {
      name: 'ATERIMA',
      slug: 'aterima',
      status: 'ACTIVE',
    },
  });

  const timo = await prisma.digitalEmployee.upsert({
    where: {
      organizationId_code: {
        organizationId: organization.id,
        code: 'timo',
      },
    },
    update: {},
    create: {
      organizationId: organization.id,
      name: 'TIMO',
      code: 'timo',
      employeeType: 'ORCHESTRATOR',
      status: 'ACTIVE',
      version: '0.1.0',
    },
  });

  const capabilityDefinitions = [
    { code: 'lead.read', name: 'Lead lesen', riskLevel: 'LOW' as const },
    { code: 'lead.evaluate', name: 'Lead bewerten', riskLevel: 'MEDIUM' as const },
    { code: 'task.create', name: 'Aufgabe erstellen', riskLevel: 'LOW' as const },
    { code: 'email.prepare', name: 'E-Mail vorbereiten', riskLevel: 'MEDIUM' as const },
  ];

  for (const def of capabilityDefinitions) {
    await prisma.capability.upsert({
      where: {
        organizationId_code: {
          organizationId: organization.id,
          code: def.code,
        },
      },
      update: {},
      create: {
        organizationId: organization.id,
        code: def.code,
        name: def.name,
        riskLevel: def.riskLevel,
        requiresApproval: false,
      },
    });
  }

  await seedOwner(organization.id);

  console.log(`Seed abgeschlossen: Organization "${organization.slug}", DigitalEmployee "${timo.code}".`);
}

main()
  .catch((error) => {
    console.error('Seed fehlgeschlagen:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
