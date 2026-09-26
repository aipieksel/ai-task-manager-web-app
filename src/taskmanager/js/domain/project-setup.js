import { stableId } from '../lib/utils.js';

export const WORKFLOW_KIT = Object.freeze({
  owner: 'aipieksel',
  repository: 'ai-agent-workflow-kits',
  tag: 'v1.0.0',
  commit: '928dd48b86385177d62646866acbaeaf13f5af77',
  taskRoot: 'docs/tasks',
});

export const BOOTSTRAP_PATH = 'docs/tasks/.taskmanager-bootstrap.json';
export const SETUP_INSTRUCTION_PATH = 'docs/tasks/onboarding/install-agent-workflow-kits.md';

export const CANONICAL_TASK_MARKERS = Object.freeze([
  'docs/tasks/workflow.md',
  'docs/tasks/todo.md',
  'docs/tasks/planning',
  'docs/tasks/lessons-active.md',
  'docs/tasks/lessons-index.json',
  'docs/tasks/task-system.config.yaml',
  'docs/tasks/verification.md',
]);

export function workflowKitUrl() {
  return ['https:', '', 'github.com', WORKFLOW_KIT.owner, WORKFLOW_KIT.repository].join('/');
}

export function buildWorkflowKitInstruction(projectName = 'this project') {
  const name = String(projectName || 'this project').trim().replace(/[\r\n]+/g, ' ');
  return `# Install Agent Workflow Kits for ${name}

You are configuring this project so it can be managed by Agentic AI Projects Task Manager.
These instructions are agent-neutral: use them with Codex, VS Code/Copilot, or another capable coding agent that can inspect and edit the project.

## Your task

1. Inspect the project before changing files. Preserve existing documentation, task records, agent rules, and user-edited configuration.
2. Use **Agent Workflow Kits** from ${workflowKitUrl()}, pinned to tag **${WORKFLOW_KIT.tag}** (commit \`${WORKFLOW_KIT.commit}\`). Inspect the repository and its installer instructions before running or copying anything.
3. Install the **All** option in its documented order: Documentation → Task → Verification. The canonical task root must be \`${WORKFLOW_KIT.taskRoot}\`.
4. Resolve merges conservatively. Never overwrite user-owned content silently. If an installer reports a conflict, stop and explain the exact relative paths that need a decision.
5. Run every validation required by the kit and confirm that \`docs/tasks/workflow.md\`, \`docs/tasks/todo.md\`, \`docs/tasks/planning/\`, \`docs/tasks/lessons-active.md\`, \`docs/tasks/lessons-index.json\`, \`docs/tasks/task-system.config.yaml\`, and \`docs/tasks/verification.md\` exist.
6. Do **not** commit, push, publish, or modify Task Manager's bootstrap files. Report what was installed, what was preserved, validations run, and any unresolved conflicts.

When complete, return to Task Manager and choose **Check setup**. Task Manager will validate the generated files; it never downloads or executes the kit itself.
`;
}

export function normalizeSetupState(scan = {}) {
  const state = String(scan.setup?.state || scan.state || 'healthy');
  return {
    state,
    taskRootPath: scan.taskRootPath || (state === 'healthy' ? '.' : WORKFLOW_KIT.taskRoot),
    missing: Array.isArray(scan.setup?.missing) ? scan.setup.missing : [],
    conflicts: Array.isArray(scan.setup?.conflicts) ? scan.setup.conflicts : [],
    revision: String(scan.setup?.revision || ''),
    bootstrap: scan.setup?.bootstrap || null,
  };
}

export function buildSetupTask(project, setup = {}) {
  const instruction = buildWorkflowKitInstruction(project?.name || 'this project');
  return {
    id: stableId(`${project?.id || project?.rootLabel || 'project'}:workflow-kit-setup`),
    projectId: project?.id || '',
    projectName: project?.name || 'Project',
    title: 'Install the Agent Workflow Kits task system',
    description: 'Copy one safe setup instruction to your coding agent, then check the generated task system.',
    status: setup.state === 'conflict' ? 'Needs attention' : 'Setup required',
    lifecycle: 'setup',
    source: 'project-setup',
    virtual: true,
    buildable: false,
    automatable: false,
    path: SETUP_INSTRUCTION_PATH,
    instruction,
    setup,
    createdAt: project?.connectedAt || Date.now(),
    lastModified: project?.lastScanAt || Date.now(),
  };
}
