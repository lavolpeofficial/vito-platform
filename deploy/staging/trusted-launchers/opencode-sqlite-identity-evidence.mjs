[Reading 30 lines from start (total: 30 lines, 0 remaining)]

import { DatabaseSync } from 'node:sqlite';
const dbPath = process.argv[2];
if (!dbPath) process.exit(50);
const providerPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const modelPattern = /^[A-Za-z0-9._:\/-]{1,128}$/;
const db = new DatabaseSync(dbPath, { readOnly: true });
const session = db.prepare('SELECT id FROM session_v2 ORDER BY time_updated DESC LIMIT 1').get();
if (!session?.id || typeof session.id !== 'string') process.exit(51);
const rows = db.prepare('SELECT data FROM session_message WHERE session_id=? ORDER BY seq').all(session.id);
const tuples = new Set();
for (const row of rows) {
  let data; try { data = JSON.parse(row.data); } catch { continue; }
  const stack = [data];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    const model = value.model;
    if (model && typeof model === 'object') {
      const provider = model.providerID, modelId = model.id;
      if (typeof provider === 'string' && typeof modelId === 'string') tuples.add(`${provider}\u0000${modelId}`);
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
  }
}
db.close();
if (tuples.size !== 1) process.exit(52);
const [tuple] = tuples;
const [provider, modelId] = tuple.split('\u0000');
if (!providerPattern.test(provider) || !modelPattern.test(modelId)) process.exit(53);
process.stderr.write(`message=stream agent=build providerID=${provider} modelID=${modelId}\n`);

[executed on device: ubuntu-4gb-hel1-1 (fe3754ea-5627-4a36-b351-e958ef584b11)]