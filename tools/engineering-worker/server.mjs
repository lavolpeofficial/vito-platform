import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.env.VITO_WORKER_PORT ?? 8081);
const TOKEN = process.env.VITO_WORKER_TOKEN ?? '';
const MAX_OUTPUT_BYTES = Number(process.env.VITO_WORKER_MAX_OUTPUT_BYTES ?? 1_000_000);
const DEFAULT_TIMEOUT_MS = Number(process.env.VITO_WORKER_DEFAULT_TIMEOUT_MS ?? 120_000);
const ARTIFACT_DIR_NAME = '.vito-artifacts';

const repoRegistry = loadRegistry();
const executions = new Map();

function loadRegistry() {
  const raw = process.env.VITO_WORKER_REPOSITORIES_JSON;
  if (!raw) {
    return {
      'vito-platform': {
        canonicalPath: '/home/alessandro/Downloads/vito-platform_eo01_runtime',
        buildProfiles: { default: ['pnpm', 'build'] },
        testProfiles: { default: ['pnpm', 'test'] },
      },
      'aoe-knowledge-engine': {
        canonicalPath: '/home/alessandro/LA_VOLPE/GITHUB/aoe-knowledge-engine',
        buildProfiles: { default: ['pnpm', 'build'] },
        testProfiles: { default: ['pnpm', 'test'] },
      },
    };
  }
  return JSON.parse(raw);
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function authOk(req) {
  if (!TOKEN) return false;
  const incoming = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(incoming);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function parseBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function canonicalRepo(repositoryId) {
  const config = repoRegistry[repositoryId];
  if (!config) throw policyError('UNKNOWN_REPOSITORY');
  const configured = path.resolve(config.canonicalPath);
  const resolved = await realpath(configured);
  if (resolved !== configured) throw policyError('REPOSITORY_SYMLINK_ALIAS_DENIED');
  return { config, cwd: resolved };
}

function policyError(code) {
  const err = new Error(code);
  err.code = code;
  err.policyBlocked = true;
  return err;
}

function assertSafeId(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(value)) {
    throw policyError(`INVALID_${field.toUpperCase()}`);
  }
}

function commandFor(action, parameters, config) {
  switch (action) {
    case 'GIT_INSPECT':
      return [
        ['git', 'branch', '--show-current'],
        ['git', 'status', '--short'],
        ['git', 'diff', '--stat'],
        ['git', 'rev-parse', 'HEAD'],
      ];
    case 'RUN_BUILD': {
      const profile = parameters?.profile ?? 'default';
      const cmd = config.buildProfiles?.[profile];
      if (!cmd) throw policyError('BUILD_PROFILE_DENIED');
      return [cmd];
    }
    case 'RUN_TESTS': {
      const profile = parameters?.profile ?? 'default';
      const cmd = config.testProfiles?.[profile];
      if (!cmd) throw policyError('TEST_PROFILE_DENIED');
      return [cmd];
    }
    case 'RUN_PRISMA_GENERATE':
      return [['pnpm', 'prisma:generate']];
    default:
      throw policyError('ACTION_DENIED');
  }
}

function allowedEnv() {
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: '/nonexistent-vito-worker-home',
    LANG: process.env.LANG ?? 'C.UTF-8',
    LC_ALL: process.env.LC_ALL ?? 'C.UTF-8',
    NODE_ENV: 'test',
    CI: '1',
  };
  return env;
}

async function runCommand(argv, cwd, timeoutMs) {
  const startedAt = new Date();
  return await new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: allowedEnv(),
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;

    const append = (current, chunk) => {
      if (current.length >= MAX_OUTPUT_BYTES) return current;
      return Buffer.concat([current, chunk]).subarray(0, MAX_OUTPUT_BYTES);
    };

    child.stdout.on('data', (c) => { stdout = append(stdout, c); });
    child.stderr.on('data', (c) => { stderr = append(stderr, c); });

    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 3000).unref();
    }, timeoutMs);

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const finishedAt = new Date();
      resolve({
        argv,
        exitCode: code,
        signal,
        timedOut,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      });
    });
  });
}

async function persistArtifact(cwd, executionId, name, content) {
  const root = path.join(cwd, ARTIFACT_DIR_NAME, executionId);
  await mkdir(root, { recursive: true });
  const filePath = path.join(root, name);
  await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' }).catch(async (err) => {
    if (err.code !== 'EEXIST') throw err;
  });
  const bytes = await readFile(filePath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { path: filePath, sha256, size: bytes.length };
}

async function executeRequest(input) {
  const executionId = input.executionId ?? randomUUID();
  assertSafeId(executionId, 'executionId');
  assertSafeId(input.repositoryId, 'repositoryId');
  assertSafeId(input.action, 'action');

  if (executions.has(executionId)) return executions.get(executionId);

  const { config, cwd } = await canonicalRepo(input.repositoryId);
  const timeoutMs = Math.min(Math.max(Number(input.timeoutMs ?? DEFAULT_TIMEOUT_MS), 1000), 15 * 60_000);
  const commands = commandFor(input.action, input.parameters ?? {}, config);

  const startedAt = new Date().toISOString();
  const result = {
    executionId,
    workflowRunId: input.workflowRunId ?? null,
    workflowStepRunId: input.workflowStepRunId ?? null,
    repositoryId: input.repositoryId,
    action: input.action,
    status: 'RUNNING',
    startedAt,
    policyDecision: { allowed: true, policyVersion: input.policyVersion ?? 'worker-v0.1' },
    attempts: [],
  };
  executions.set(executionId, result);

  for (const argv of commands) {
    const attempt = await runCommand(argv, cwd, timeoutMs);
    result.attempts.push(attempt);
    if (attempt.timedOut || attempt.exitCode !== 0) break;
  }

  const combinedStdout = result.attempts.map((x) => `$ ${x.argv.join(' ')}\n${x.stdout}`).join('\n');
  const combinedStderr = result.attempts.map((x) => `$ ${x.argv.join(' ')}\n${x.stderr}`).join('\n');
  const stdoutArtifact = await persistArtifact(cwd, executionId, 'stdout.txt', combinedStdout);
  const stderrArtifact = await persistArtifact(cwd, executionId, 'stderr.txt', combinedStderr);

  const failed = result.attempts.some((x) => x.timedOut || x.exitCode !== 0);
  result.status = failed ? 'FAILED' : 'SUCCEEDED';
  result.finishedAt = new Date().toISOString();
  result.exitCode = result.attempts.at(-1)?.exitCode ?? 0;
  result.errorCode = result.attempts.some((x) => x.timedOut) ? 'TIMEOUT' : failed ? 'COMMAND_FAILED' : null;
  result.stdoutArtifactRef = stdoutArtifact;
  result.stderrArtifactRef = stderrArtifact;
  result.producedArtifactRefs = [stdoutArtifact, stderrArtifact];
  return result;
}

const server = createServer(async (req, res) => {
  try {
    if (req.url === '/health' && req.method === 'GET') {
      return json(res, 200, { status: 'ok', service: 'vito-controlled-engineering-worker', version: '0.1.0' });
    }

    if (!authOk(req)) return json(res, 401, { error: 'UNAUTHORIZED' });

    if (req.url === '/execute' && req.method === 'POST') {
      const input = await parseBody(req);
      try {
        const result = await executeRequest(input);
        return json(res, result.status === 'SUCCEEDED' ? 200 : 422, result);
      } catch (err) {
        if (err.policyBlocked) {
          return json(res, 403, {
            executionId: input.executionId ?? null,
            status: 'POLICY_BLOCKED',
            errorCode: err.code,
            policyDecision: { allowed: false, reason: err.code },
          });
        }
        throw err;
      }
    }

    const executionMatch = req.url?.match(/^\/executions\/([A-Za-z0-9._:-]+)$/);
    if (executionMatch && req.method === 'GET') {
      const found = executions.get(executionMatch[1]);
      return found ? json(res, 200, found) : json(res, 404, { error: 'NOT_FOUND' });
    }

    return json(res, 404, { error: 'NOT_FOUND' });
  } catch (err) {
    return json(res, 500, { error: 'INTERNAL_ERROR', message: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(JSON.stringify({ service: 'vito-controlled-engineering-worker', status: 'listening', host: '127.0.0.1', port: PORT }));
});
