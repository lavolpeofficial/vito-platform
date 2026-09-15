import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Creates the initial LA VOLPE platform owner exclusively from environment
 * variables. ATERIMA remains an independent business tenant and must never
 * become the identity boundary for the VITO Control Center.
 *
 *   SEED_OWNER_EMAIL
 *   SEED_OWNER_PASSWORD
 */
async function seedOwner(organizationId: string): Promise<void> {
  const rawEmail = process.env.SEED_OWNER_EMAIL;
  const password = process.env.SEED_OWNER_PASSWORD;

  if (!rawEmail || !password) {
    console.warn(
      'SEED_OWNER_EMAIL/SEED_OWNER_PASSWORD nicht gesetzt — es wird kein initialer LA-VOLPE-Owner angelegt. ' +
        'Ohne einen User mit passwordHash ist kein Login über POST /auth/login möglich.',
    );
    return;
  }

  const email = rawEmail.trim().toLowerCase();

  if (password.length < 12) {
    console.warn(
      'SEED_OWNER_PASSWORD ist kürzer als 12 Zeichen — es wird kein initialer LA-VOLPE-Owner angelegt. ' +
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
      firstName: 'LA VOLPE',
      lastName: 'Owner',
      role: 'OWNER',
      status: 'ACTIVE',
      passwordHash,
    },
  });

  console.log(`Seed: Owner-User "${owner.email}" für LA VOLPE angelegt/aktualisiert.`);
}

async function main() {
  const laVolpe = await prisma.organization.upsert({
    where: { slug: 'la-volpe' },
    update: {},
    create: {
      name: 'LA VOLPE',
      slug: 'la-volpe',
      status: 'ACTIVE',
    },
  });

  const aterima = await prisma.organization.upsert({
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
        organizationId: aterima.id,
        code: 'timo',
      },
    },
    update: {},
    create: {
      organizationId: aterima.id,
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
          organizationId: aterima.id,
          code: def.code,
        },
      },
      update: {},
      create: {
        organizationId: aterima.id,
        code: def.code,
        name: def.name,
        riskLevel: def.riskLevel,
        requiresApproval: false,
      },
    });
  }

  await seedOwner(laVolpe.id);

  console.log(
    `Seed abgeschlossen: Platform "${laVolpe.slug}", Business-Tenant "${aterima.slug}", DigitalEmployee "${timo.code}".`,
  );
}

main()
  .catch((error) => {
    console.error('Seed fehlgeschlagen:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
