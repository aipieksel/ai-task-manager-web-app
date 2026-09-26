import assert from 'node:assert/strict';
import { buildSetupTask, buildWorkflowKitInstruction, CANONICAL_TASK_MARKERS, WORKFLOW_KIT } from '../../src/taskmanager/js/domain/project-setup.js';

const instruction = buildWorkflowKitInstruction('Demo\nProject');
assert.match(instruction, /Agent Workflow Kits/);
assert.match(instruction, /v1\.0\.0/);
assert.match(instruction, /Documentation → Task → Verification/);
assert.match(instruction, /do \*\*not\*\* commit, push, publish/i);
assert.match(instruction, /Codex|coding agent/i);
assert.doesNotMatch(instruction, /Demo\nProject/);
assert.equal(WORKFLOW_KIT.taskRoot, 'docs/tasks');
assert.ok(CANONICAL_TASK_MARKERS.length >= 7);

const setupTask = buildSetupTask({ id: 'demo', name: 'Demo', connectedAt: 1 }, { state: 'setup-required' });
assert.equal(setupTask.virtual, true);
assert.equal(setupTask.buildable, false);
assert.equal(setupTask.automatable, false);
assert.equal(setupTask.source, 'project-setup');
assert.equal([setupTask].filter((task) => task.source === 'project-setup').length, 1);

console.log('project_setup.test.mjs: pass');
