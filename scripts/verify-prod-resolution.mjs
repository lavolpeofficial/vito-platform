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