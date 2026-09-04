#!/usr/bin/env node
// VITO-OB-002 -- Operator Bridge real-flow smoke harness (CLI entry).
//
// Thin Node ESM entry over scripts/operator-bridge-real-flow.js (the tested
// harness logic). Run it directly:
//
//   npm run operator-bridge:real-flow
//
//   VITO_BASE_URL=<endpoint> VITO_OPERATOR_TOKEN=<jwt> node scripts/operator-bridge-real-flow.mjs
//
// The harness is an operator client only. It never executes OpenCode, Bubblewrap,
// the RemoteExecutionWorker, git mutation, repository writes, patch application,
// branch/commit/push, or any internal execution path. Execution authority stays
// fully server-side. Credentials are environment-only and are never printed.

import { pathToFileURL } from 'node:url';
import {
  run,
  safeText,
  ConfigurationError,
  ENV_VAR_TOKEN,
} from './operator-bridge-real-flow.js';

function parseArgs(argv) {
  if (argv.length > 2) {
    throw new ConfigurationError(
      'No CLI options are accepted. Configure via VITO_BASE_URL and VITO_OPERATOR_TOKEN environment variables only.',
    );
  }
}

async function main() {
  try {
    parseArgs(process.argv);
    const outcome = await run();
    console.log('operator-bridge:real-flow');
    for (const line of outcome.summary) console.log(`  ${line}`);
    if (outcome.ok) {
      console.log('RESULT: PASS');
      process.exitCode = 0;
    } else {
      for (const failure of outcome.failures) console.log(`FAIL: ${failure}`);
      console.log('RESULT: FAIL');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      `operator-bridge:real-flow: ${safeText(error?.message, process.env[ENV_VAR_TOKEN])}`,
    );
    process.exitCode = error instanceof ConfigurationError ? 2 : 1;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main();
}