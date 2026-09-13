#!/usr/bin/env node

const baseUrl = (process.env.VITO_BASE_URL ?? 'http://127.0.0.1:33000').replace(/\/$/, '');
const email = process.env.VITO_OWNER_EMAIL;
const password = process.env.VITO_OWNER_PASSWORD;
const organizationSlug = process.env.VITO_ORGANIZATION_SLUG ?? 'aterima';
const assuranceLevel = process.env.VITO_DOGFOOD_ASSURANCE_LEVEL ?? 'AL3';
const goal = process.env.VITO_DOGFOOD_GOAL
  ?? 'Exercise the governed VITO staging workflow end to end while preserving every human release boundary.';

function required(name, value) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return body;
}

async function main() {
  required('VITO_OWNER_EMAIL', email);
  required('VITO_OWNER_PASSWORD', password);

  const login = await request('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, organizationSlug }),
  });
  const token = login?.accessToken;
  if (!token || login?.user?.role !== 'OWNER') throw new Error('OWNER login failed');

  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
  const goalBody = JSON.stringify({ goal, assuranceLevel });

  const plan = await request('/goal-plans/engineering', { method: 'POST', headers, body: goalBody });
  if (
    plan?.executable !== false ||
    plan?.requiresHumanReleaseApproval !== true ||
    plan?.providerSelection !== 'DEFERRED_TO_PROVIDER_ROUTER' ||
    plan?.nextAction !== 'CREATE_GOVERNED_WORKFLOW_FROM_APPROVED_PLAN'
  ) {
    throw new Error('Goal plan violated governed planning invariants');
  }

  const materialized = await request('/goal-plans/engineering/workflows', {
    method: 'POST', headers, body: goalBody,
  });
  const workflowRunId = materialized?.workflowRun?.id;
  if (
    !workflowRunId ||
    materialized?.workflowRun?.status !== 'CREATED' ||
    materialized?.started !== false ||
    materialized?.executionAuthorityGranted !== false ||
    materialized?.requiresHumanReleaseApproval !== true
  ) {
    throw new Error('Workflow materialization violated governed creation invariants');
  }

  const started = await request(`/workflow-runtime/${workflowRunId}/start`, {
    method: 'POST', headers,
  });
  if (started?.run?.status !== 'RUNNING' || started?.run?.currentStepType !== 'PLAN') {
    throw new Error('Workflow did not enter the expected RUNNING/PLAN state');
  }

  const execution = await request(`/workflow-agent-runtime/${workflowRunId}/execute-until-boundary`, {
    method: 'POST', headers,
  });
  const observation = await request(`/workflow-observer/${workflowRunId}`, { headers });

  if (observation?.authority !== 'READ_ONLY') {
    throw new Error('Workflow observer did not preserve read-only authority');
  }
  if (observation?.status === 'COMPLETED' || observation?.currentStepType === 'RELEASE_EXECUTION') {
    throw new Error('Human release boundary was crossed without explicit approval');
  }

  console.log('staging-dogfood-goal-flow: PASS');
  console.log(`workflow_run_id=${workflowRunId}`);
  console.log(`runner_disposition=${execution?.disposition ?? 'UNKNOWN'}`);
  console.log(`runner_boundary=${execution?.boundary ?? 'UNKNOWN'}`);
  console.log(`workflow_status=${observation?.status ?? 'UNKNOWN'}`);
  console.log(`current_step=${observation?.currentStepType ?? 'NONE'}`);
  console.log(`next_action=${observation?.nextAction ?? 'NONE'}`);
  console.log(`steps_observed=${Array.isArray(observation?.steps) ? observation.steps.length : 0}`);
  console.log('human_release_approved=no');
}

main().catch((error) => {
  console.error(`staging-dogfood-goal-flow: FAIL: ${error.message}`);
  process.exitCode = 1;
});
