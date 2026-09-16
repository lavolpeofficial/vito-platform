import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../lib/workflows/actions.ts', import.meta.url), 'utf8');

test('workflow mutation success redirect stays outside API error catch', () => {
  const start = source.indexOf('export async function workflowAction(');
  const end = source.indexOf('\nfunction mutationPath(', start);
  assert.ok(start >= 0 && end > start, 'workflow action must exist');
  const action = source.slice(start, end);
  const catchStart = action.indexOf('} catch (error) {');
  const catchEnd = action.indexOf('\n  }\n', catchStart);
  const successRedirect = action.indexOf('redirectWorkflow(workflowRunId, notice, false);');
  assert.ok(catchStart >= 0 && catchEnd > catchStart, 'API error boundary must exist');
  assert.ok(successRedirect > catchEnd, 'success redirect must not be swallowed by API catch');
  assert.match(action.slice(catchStart, catchEnd), /redirectWorkflow\(workflowRunId, code\)/);
  assert.match(action.slice(catchEnd, successRedirect), /revalidatePath\(WORKFLOWS_PATH\)/);
});
