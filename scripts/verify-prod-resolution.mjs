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
const openRouterFreeLauncherPath = resolve(
  rootDir,
  'deploy/staging/trusted-launchers/opencode-openrouter-free',
);
const openAiProbeLauncherPath = resolve(
  rootDir,
  'deploy/staging/trusted-launchers/opencode-openai-probe',
);
const identityEvidencePath = resolve(
  rootDir,
  'deploy/staging/trusted-launchers/opencode-sqlite-identity-evidence.mjs',
);
const stagingComposePath = resolve(rootDir, 'deploy/staging/docker-compose.yml');

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
let openRouterFreeLauncher;
let openAiProbeLauncher;
let identityEvidence;
let stagingCompose;
try {
  dockerfile = readFileSync(dockerfilePath, 'utf8');
  trustedLauncher = readFileSync(trustedLauncherPath, 'utf8');
  openRouterFreeLauncher = readFileSync(openRouterFreeLauncherPath, 'utf8');
  openAiProbeLauncher = readFileSync(openAiProbeLauncherPath, 'utf8');
  identityEvidence = readFileSync(identityEvidencePath, 'utf8');
  stagingCompose = readFileSync(stagingComposePath, 'utf8');
} catch (error) {
  fail(`trusted launcher runtime assets are missing (${error.code ?? error.message})`);
}
if (
  !dockerfile.includes(
    'COPY deploy/staging/trusted-launchers/opencode /opt/vito/trusted-launchers/opencode',
  ) ||
  !dockerfile.includes(
    'COPY deploy/staging/trusted-launchers/opencode-openrouter-free /opt/vito/trusted-launchers/opencode-openrouter-free',
  ) ||
  !dockerfile.includes(
    'COPY deploy/staging/trusted-launchers/opencode-openai-probe /opt/vito/trusted-launchers/opencode-openai-probe',
  ) ||
  !dockerfile.includes(
    'COPY deploy/staging/trusted-launchers/opencode-sqlite-identity-evidence.mjs /opt/vito/trusted-launchers/opencode-sqlite-identity-evidence.mjs',
  )
) {
  fail('Dockerfile must ship the reviewed OpenCode launchers and SQLite identity evidence assets');
}
if (
  !trustedLauncher.includes('XDG_DATA_HOME') ||
  !trustedLauncher.includes('opencode-sqlite-identity-evidence.mjs') ||
  !trustedLauncher.includes('AUTH_FILE="$XDG_DATA_HOME/opencode/auth.json"') ||
  !trustedLauncher.includes('OPENAI_API_KEY=') ||
  !trustedLauncher.includes('export OPENAI_API_KEY') ||
  !trustedLauncher.includes('rm -f "$AUTH_FILE"') ||
  !trustedLauncher.includes('model:"openai/gpt-5.6-sol"') ||
  !trustedLauncher.includes('process.env.CAPABILITY_CODE==="TEST_EXECUTION"') ||
  !trustedLauncher.includes('{action:"edit",resource:"*",effect:"deny"}') ||
  !trustedLauncher.includes('{action:"edit",resource:"docs/vito-flight-001-proof.md",effect:"allow"}') ||
  !trustedLauncher.includes('{action:"shell",resource:"*",effect:"deny"}') ||
  !trustedLauncher.includes('{action:"shell",resource:"git status *",effect:"allow"}') ||
  !trustedLauncher.includes('{action:"shell",resource:"git diff *",effect:"allow"}') ||
  !trustedLauncher.includes('{action:"shell",resource:"git rev-parse *",effect:"allow"}') ||
  !trustedLauncher.includes('{action:"shell",resource:"pnpm test",effect:"allow"}') ||
  !trustedLauncher.includes('{action:"shell",resource:"pnpm test *",effect:"allow"}')
) {
  fail('reviewed OpenCode launcher must pin the server-owned model, enforce SQLite identity evidence, and keep TEST_EXECUTION fail-closed with only canonical Flight-001 edit plus bounded read-only git/test authority');
}

if (
  !openAiProbeLauncher.includes('XDG_DATA_HOME') ||
  !openAiProbeLauncher.includes('AUTH_FILE="$XDG_DATA_HOME/opencode/auth.json"') ||
  !openAiProbeLauncher.includes('OPENAI_API_KEY=') ||
  !openAiProbeLauncher.includes('export OPENAI_API_KEY') ||
  !openAiProbeLauncher.includes('rm -f "$AUTH_FILE"') ||
  !openAiProbeLauncher.includes('model:"openai/gpt-5.6-sol"') ||
  !openAiProbeLauncher.includes('default_agent:"plan"') ||
  !openAiProbeLauncher.includes('{action:"edit",resource:"*",effect:"deny"}') ||
  !openAiProbeLauncher.includes('{action:"shell",resource:"*",effect:"deny"}')
) {
  fail('OpenAI readiness probe must require the ephemeral server-owned API key, pin gpt-5.6-sol/plan, and deny edit/shell authority');
}

if (
  !openRouterFreeLauncher.includes('XDG_DATA_HOME') ||
  !openRouterFreeLauncher.includes('opencode-sqlite-identity-evidence.mjs') ||
  !openRouterFreeLauncher.includes('OPENROUTER_API_KEY') ||
  !openRouterFreeLauncher.includes('model:"openrouter/cohere/north-mini-code:free"') ||
  !openRouterFreeLauncher.includes('default_agent:"plan"') ||
  !openRouterFreeLauncher.includes('{action:"edit",resource:"*",effect:"deny"}') ||
  !openRouterFreeLauncher.includes('{action:"shell",resource:"*",effect:"deny"}') ||
  !openRouterFreeLauncher.includes('{action:"subagent",resource:"*",effect:"deny"}') ||
  !openRouterFreeLauncher.includes('"$BIN" run --agent plan --print-logs --log-level info -')
) {
  fail('reviewed OpenRouter free CODE_PLAN launcher must bind the ephemeral key, pin the free model/plan agent, deny write/shell/subagent authority and enforce SQLite identity evidence');
}
if (
  !identityEvidence.includes("new DatabaseSync(dbPath, { readOnly: true })") ||
  !identityEvidence.includes('providerID=') ||
  !identityEvidence.includes('modelID=')
) {
  fail('SQLite identity evidence helper must remain read-only and emit provider/model identity evidence');
}

if (
  !stagingCompose.includes('"profileId":"staging-openai-api"') ||
  !stagingCompose.includes('"credentialRef":"cloud:openai:api:staging"') ||
  !stagingCompose.includes('"testExecutionLauncherAlias":"opencode"') ||
  !stagingCompose.includes('"expectedProviderId":"openai","allowedModelIds":["gpt-5.6-sol"]') ||
  stagingCompose.includes('VITO_CLOUD_OPENCODE_DB_PATH') ||
  stagingCompose.includes('/run/secrets/vito-cloud/opencode.db')
) {
  fail('staging OpenAI profile must use only the server-owned API credential path and must not mount ChatGPT OAuth state');
}

if (
  !stagingCompose.includes('"providerCode":"cloud.openrouter.free"') ||
  !stagingCompose.includes('"credentialRef":"cloud:openrouter:staging"') ||
  !stagingCompose.includes('"trustedLauncherAlias":"opencode-openrouter-free"') ||
  !stagingCompose.includes('"expectedProviderId":"openrouter","allowedModelIds":["cohere/north-mini-code:free"]')
) {
  fail('staging OpenRouter free profile must be separately credentialed, launcher-bound and model-allowlisted');
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