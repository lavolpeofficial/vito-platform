#!/usr/bin/env node
// Production build/start resolution gate (regression for VITO-OB packaging).
//
// The shipped production run path is `node dist/main` (root `pnpm start` /
// `pnpm --filter @vito/api start`). It fails today because `@vito/contracts`
// resolved to its TypeScript `src/index.ts` (plain Node cannot run TS enums,
// and the source's ESM-style `./x.js` subpath specifiers do not map to `.ts`
// files in a CJS `require` graph). This script proves the *built* artifacts are
// self-sufficient: the package entry resolves to compiled CJS output and the
// emitted API entry (`apps/api/dist/main.js`) loads its whole module graph —
// including `@vito/contracts`, NestJS decorators, and the Prisma client —
// without any session shim or TS runtime.
//
// It is wired into the root `build` script as an implicit regression gate.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = resolve(rootDir, 'apps/api');
const contractsPkgPath = resolve(rootDir, 'packages/contracts/package.json');
const contractsPkg = JSON.parse(readFileSync(contractsPkgPath, 'utf8'));
const dockerfilePath = resolve(rootDir, 'Dockerfile');
const trustedLauncherPath = resolve(rootDir, 'deploy/staging/trusted-launchers/opencode');
const identityEvidencePath = resolve(
  rootDir,
  'deploy/staging/trusted-launchers/opencode-sqlite-identity-evidence.mjs',
);
const stagingComposePath = resolve(rootDir, 'deploy/staging/docker-compose.yml');
const credentialStatePath = resolve(
  rootDir,
  'apps/api/src/modules/cloud-governed-execution/opencode-sqlite-credential-state.ts',
);

function fail(message) {
  console.error(`verify-prod-resolution: FAILED — ${message}`);
  process.exit(1);
}

if (contractsPkg.main !== 'dist/index.js') {
  fail(`@vito/contracts main must be "dist/index.js" (got "${contractsPkg.main}")`);
}
if (contractsPkg.types !== 'dist/index.d.ts') {
  fail(`@vito/contracts types must be "dist/index.d.ts" (got "${contractsPkg.types}")`);
}
if (typeof contractsPkg.scripts?.build !== 'string' || !contractsPkg.scripts.build.includes('tsc')) {
  fail('@vito/contracts must expose a tsc-based "build" script');
}

let dockerfile;
let trustedLauncher;
let identityEvidence;
let stagingCompose;
let credentialState;
try {
  dockerfile = readFileSync(dockerfilePath, 'utf8');
  trustedLauncher = readFileSync(trustedLauncherPath, 'utf8');
  identityEvidence = readFileSync(identityEvidencePath, 'utf8');
  stagingCompose = readFileSync(stagingComposePath, 'utf8');
  credentialState = readFileSync(credentialStatePath, 'utf8');
} catch (error) {
  fail(`trusted launcher runtime assets are missing (${error.code ?? error.message})`);
}
if (
  !dockerfile.includes(
    'COPY deploy/staging/trusted-launchers/opencode /opt/vito/trusted-launchers/opencode',
  ) ||
  !dockerfile.includes(
    'COPY deploy/staging/trusted-launchers/opencode-sqlite-identity-evidence.mjs /opt/vito/trusted-launchers/opencode-sqlite-identity-evidence.mjs',
  )
) {
  fail('Dockerfile must ship the reviewed OpenCode launcher and SQLite identity evidence assets');
}
if (
  !trustedLauncher.includes('XDG_DATA_HOME') ||
  !trustedLauncher.includes('opencode-sqlite-identity-evidence.mjs') ||
  !trustedLauncher.includes('model:"openai/gpt-6-astra"')
) {
  fail('reviewed OpenCode launcher must pin the server-owned model and enforce SQLite identity evidence');
}
if (
  !identityEvidence.includes("new DatabaseSync(dbPath, { readOnly: true })") ||
  !identityEvidence.includes('providerID=') ||
  !identityEvidence.includes('modelID=')
) {
  fail('SQLite identity evidence helper must remain read-only and emit provider/model identity evidence');
}

if (
  !stagingCompose.includes('"expectedProviderId":"openai","allowedModelIds":["gpt-6-astra"]')
) {
  fail('staging cloud profile must server-authorize only the governed gpt-6-astra model');
}

if (
  !stagingCompose.includes(
    'VITO_CLOUD_OPENCODE_STATE_DB_PATH: /var/lib/vito/cloud-credential-state/opencode.db',
  ) ||
  !stagingCompose.includes('cloud-credential-state:/var/lib/vito/cloud-credential-state') ||
  !stagingCompose.includes('/run/secrets/vito-cloud/opencode-seed.db:ro') ||
  !stagingCompose.includes('cp /run/secrets/vito-cloud/opencode-seed.db')
) {
  fail(
    'staging must keep the host OpenCode DB read-only and seed a separate persistent credential-state volume',
  );
}

if (
  !credentialState.includes('UPDATE credential SET value = ?, time_updated = ?') ||
  !credentialState.includes('PRAGMA journal_mode=DELETE') ||
  !credentialState.includes('OPENCODE_OAUTH_ROTATION_NOT_MONOTONIC')
) {
  fail(
    'OpenCode credential-state reconciliation must remain row-scoped, self-contained and monotonic',
  );
}

const requireFromApi = createRequire(resolve(apiDir, 'package.json'));
let contractsResolved;
try {
  contractsResolved = requireFromApi.resolve('@vito/contracts');
} catch (error) {
  fail(`@vito/contracts cannot be resolved from the API package context (${error.code ?? error.message})`);
}
if (!contractsResolved.endsWith('dist/index.js') || contractsResolved.includes('src/index.ts')) {
  fail(`@vito/contracts resolves to "${contractsResolved}", not the compiled dist/index.js`);
}

let contracts;
try {
  contracts = requireFromApi('@vito/contracts');
} catch (error) {
  fail(`built @vito/contracts failed to load (${error.code ?? error.message})`);
}
const checks = {
  'EngineeringCapability.CODE_BUILD': contracts?.EngineeringCapability?.CODE_BUILD,
  'ProviderType.CLOUD_LLM': contracts?.ProviderType?.CLOUD_LLM,
  'ExecutionTier.CLOUD_GOVERNED': contracts?.ExecutionTier?.CLOUD_GOVERNED,
  'OperatorTaskStatus.COMPLETED': contracts?.OperatorTaskStatus?.COMPLETED,
};
for (const [label, value] of Object.entries(checks)) {
  if (value === undefined || value === null) fail(`built @vito/contracts is missing ${label}`);
}

const apiEntry = resolve(apiDir, 'dist/main.js');
let loaded;
try {
  loaded = requireFromApi(apiEntry);
} catch (error) {
  fail(`apps/api/dist/main.js failed to load its production module graph (${error.code ?? error.message})`);
}
if (typeof loaded.createApp !== 'function') {
  fail('apps/api/dist/main.js must export createApp()');
}

console.log(
  `verify-prod-resolution: OK — @vito/contracts ${contractsResolvedDifference(contractsResolved)}; ` +
    `apps/api/dist/main.js module graph loads (createApp present)`,
);

function contractsResolvedDifference(resolved) {
  return resolved.slice(resolved.indexOf('packages/contracts'));
}