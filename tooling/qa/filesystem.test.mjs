import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const runtimeModule = require('../../electron/runtime-server.cjs');
const { createRuntimeServer, bootstrapProject } = runtimeModule;
const instruction = `# Install Agent Workflow Kits\n\nUse aipieksel/ai-agent-workflow-kits at v1.0.0.\n`;
const canonicalMarkers = ['workflow.md', 'todo.md', 'lessons-active.md', 'lessons-index.json', 'task-system.config.yaml', 'verification.md'];

const shippedJs = ['js/services/server-fs.js', ...readdirSync('dist/js', { recursive: true }).filter((name) => String(name).endsWith('.js')).map((name) => `js/${name}`).sort().filter((name, index, list) => list.indexOf(name) === index)];

assert.ok(shippedJs.includes('js/services/server-fs.js'), 'server filesystem client is shipped');
assert.ok(!shippedJs.some((name) => name.endsWith('/filesystem.js') || name === 'filesystem.js'), 'browser filesystem helper is not shipped');
assert.ok(!shippedJs.some((name) => name.endsWith('/idb.js') || name === 'idb.js'), 'IndexedDB persistence helper is not shipped');

const forbidden = /\b(indexedDB|showDirectoryPicker|FileSystemDirectoryHandle|localStorage|sessionStorage)\b/;
for (const file of shippedJs) {
  if (file.endsWith('/browser-cleanup.js')) continue;
  const text = readFileSync(join('dist', file), 'utf8');
  assert.doesNotMatch(text, forbidden, `${file} must not use browser-backed storage or filesystem APIs`);
}

const temp = mkdtempSync(join(tmpdir(), 'taskmanager-folder-copy-'));
let runtime;
try {
  const projectRoot = join(temp, 'project');
  const source = join(projectRoot, 'documentation/task/planning/pending/00001-folder');
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'plan.json'), JSON.stringify({ status: 'Pending', lifecycle: 'pending', sections: [] }, null, 2) + '\n');
  writeFileSync(join(source, '01-original-scope.md'), '# Scope\n');
  runtime = await createRuntimeServer({ staticDir: 'dist', runtimeDir: join(temp, 'runtime'), port: 0 }).listen();
  const response = await fetch(`${runtime.url}api/folders/copy-verify-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project: { rootLabel: projectRoot },
      taskRootPath: 'documentation/task',
      sourcePath: 'documentation/task/planning/pending/00001-folder',
      destinationPath: 'documentation/task/planning/approved/00001-folder',
      updates: {
        'plan.json': JSON.stringify({ status: 'Approved', lifecycle: 'approved', sections: [] }, null, 2) + '\n',
      },
    }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200, payload.error || 'folder copy endpoint should succeed');
  assert.equal(payload.ok, true);
  assert.ok(!existsSync(source), 'source folder is deleted after verified copy');
  assert.ok(existsSync(join(projectRoot, 'documentation/task/planning/approved/00001-folder/plan.json')), 'destination manifest exists');
  assert.match(readFileSync(join(projectRoot, 'documentation/task/planning/approved/00001-folder/plan.json'), 'utf8'), /Approved/);

  const automationResponse = await fetch(`${runtime.url}api/automation/summary`);
  const automationPayload = await automationResponse.json();
  assert.equal(automationResponse.status, 200, automationPayload.error || 'automation summary should succeed');
  assert.equal(automationPayload.ok, true, 'automation summary should not fail because of runtime root resolution');
  assert.notEqual(automationPayload.error, 'ROOT is not defined', 'automation summary must not reference an undefined ROOT constant');

  const freshRoot = join(temp, 'fresh-project');
  mkdirSync(freshRoot, { recursive: true });
  const scan = await fetch(`${runtime.url}api/projects/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: { rootLabel: freshRoot }, settings: {} }) });
  const scanPayload = await scan.json();
  assert.equal(scan.status, 200);
  assert.equal(scanPayload.setup.state, 'setup-required');
  assert.deepEqual(scanPayload.files, []);

  const dryRun = await fetch(`${runtime.url}api/projects/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: { rootLabel: freshRoot }, instruction, expectedRevision: scanPayload.setup.revision, dryRun: true }) });
  assert.equal(dryRun.status, 200);
  assert.equal(existsSync(join(freshRoot, 'docs/tasks')), false, 'dry run does not create setup paths');

  const bootstrap = await fetch(`${runtime.url}api/projects/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: { rootLabel: freshRoot }, instruction, expectedRevision: scanPayload.setup.revision }) });
  const bootstrapPayload = await bootstrap.json();
  assert.equal(bootstrap.status, 200, bootstrapPayload.error);
  assert.equal(bootstrapPayload.setup.state, 'setup-incomplete');
  assert.ok(existsSync(join(freshRoot, 'docs/tasks/.taskmanager-bootstrap.json')));
  assert.ok(existsSync(join(freshRoot, 'docs/tasks/onboarding/install-agent-workflow-kits.md')));

  const retry = await fetch(`${runtime.url}api/projects/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: { rootLabel: freshRoot }, instruction, expectedRevision: bootstrapPayload.setup.revision }) });
  const retryPayload = await retry.json();
  assert.equal(retry.status, 200, retryPayload.error);
  assert.equal(retryPayload.idempotent, true);

  writeFileSync(join(freshRoot, 'docs/tasks/onboarding/install-agent-workflow-kits.md'), `${instruction}changed\n`);
  const conflictScan = await fetch(`${runtime.url}api/projects/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: { rootLabel: freshRoot }, settings: {} }) });
  assert.equal((await conflictScan.json()).setup.state, 'conflict');

  const healthyRoot = join(temp, 'healthy-project');
  mkdirSync(join(healthyRoot, 'docs/tasks/planning'), { recursive: true });
  canonicalMarkers.forEach((name) => writeFileSync(join(healthyRoot, 'docs/tasks', name), name.endsWith('.json') ? '{}\n' : '# Fixture\n'));
  const healthyScan = await fetch(`${runtime.url}api/projects/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: { rootLabel: healthyRoot }, settings: {} }) });
  const healthyPayload = await healthyScan.json();
  assert.equal(healthyScan.status, 200, healthyPayload.error);
  assert.equal(healthyPayload.setup.state, 'healthy');
  assert.equal(healthyPayload.taskRootPath, 'docs/tasks');

  const staleRoot = join(temp, 'stale-project');
  mkdirSync(staleRoot, { recursive: true });
  const staleScan = await fetch(`${runtime.url}api/projects/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: { rootLabel: staleRoot }, settings: {} }) }).then((response) => response.json());
  mkdirSync(join(staleRoot, 'docs/tasks'), { recursive: true });
  writeFileSync(join(staleRoot, 'docs/tasks/todo.md'), '# changed\n');
  const staleResponse = await fetch(`${runtime.url}api/projects/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: { rootLabel: staleRoot }, instruction, expectedRevision: staleScan.setup.revision }) });
  assert.equal(staleResponse.status, 409, 'stale expected revision is rejected');

  const symlinkRoot = join(temp, 'symlink-project');
  const outside = join(temp, 'outside');
  mkdirSync(symlinkRoot, { recursive: true });
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, join(symlinkRoot, 'docs'));
  const symlinkResponse = await fetch(`${runtime.url}api/projects/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: { rootLabel: symlinkRoot }, instruction }) });
  assert.notEqual(symlinkResponse.status, 200, 'symlink escape is rejected');
  assert.equal(existsSync(join(outside, 'tasks')), false, 'symlink escape writes nothing outside the project');

  const compensationRoot = join(temp, 'compensation-project');
  mkdirSync(compensationRoot, { recursive: true });
  const fsModule = require('node:fs');
  const originalRename = fsModule.renameSync;
  let renameCount = 0;
  fsModule.renameSync = (...args) => {
    renameCount += 1;
    if (renameCount === 2) throw new Error('induced second-write failure');
    return originalRename(...args);
  };
  try {
    assert.throws(() => bootstrapProject(compensationRoot, { instruction }), /induced second-write failure/);
  } finally {
    fsModule.renameSync = originalRename;
  }
  assert.equal(existsSync(join(compensationRoot, 'docs/tasks/.taskmanager-bootstrap.json')), false, 'compensation removes first committed bootstrap file');
  assert.equal(existsSync(join(compensationRoot, 'docs/tasks/onboarding/install-agent-workflow-kits.md')), false, 'compensation leaves no instruction file');
} finally {
  if (runtime?.server) await new Promise((resolve) => runtime.server.close(resolve));
  rmSync(temp, { recursive: true, force: true });
}

console.log('filesystem.test.mjs: pass');
