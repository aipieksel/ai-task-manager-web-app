import { buildProjectDomain } from '../domain/parser.js';
import { buildSetupTask, buildWorkflowKitInstruction, normalizeSetupState } from '../domain/project-setup.js';
import { appendUserFeedback, appendUserVerificationComment, applyQuestionAnswer, applyRecommendedAnswers, removeTodoTaskItem, updatePlanMetadata, updateTodoTaskFields } from '../domain/writer.js';
import {
  copyVerifyDeleteFolderServer,
  bootstrapServerProject,
  copyVerifyDeleteServer,
  isServerBackedProject,
  readServerTextFile,
  scanServerProject,
  selectProjectFolder,
  writeServerTextFile,
} from './server-fs.js';
import {
  addActivity,
  getState,
  saveProject,
  setProjectData,
} from '../state/store.js';
import { normalizePath, stableId } from '../lib/utils.js';


const pendingTaskManagerChanges = new Map();
const STATUS_DEFINITIONS = Object.freeze({
  draft: { key: 'draft', lifecycle: 'draft', status: 'Draft' },
  pending: { key: 'pending', lifecycle: 'pending', status: 'Pending' },
  approved: { key: 'approved', lifecycle: 'approved', status: 'Approved' },
  'in-progress': { key: 'in-progress', lifecycle: 'in-progress', status: 'In Progress' },
  review: { key: 'review', lifecycle: 'review', status: 'Review' },
  reviewing: { key: 'reviewing', lifecycle: 'review', status: 'Reviewing', statusOnly: true },
  'pending-correction': { key: 'pending-correction', lifecycle: 'in-progress', status: 'Pending Correction', statusOnly: true },
  'user-verification': { key: 'user-verification', lifecycle: 'user-verification', status: 'User Verification' },
  'failed-user-verification': { key: 'failed-user-verification', lifecycle: 'failed-user-verification', status: 'Requesting User Feedback' },
  'user-replied': { key: 'user-replied', lifecycle: 'failed-user-verification', status: 'User Replied', statusOnly: true },
  'sent-to-agent': { key: 'sent-to-agent', lifecycle: 'user-verification', status: 'Sent to Agent', statusOnly: true },
  completed: { key: 'completed', lifecycle: 'completed', status: 'Complete' },
  archive: { key: 'archive', lifecycle: 'archive', status: 'Archived' },
  parked: { key: 'parked', lifecycle: 'parked', status: 'Parked' },
  blocker: { key: 'blocker', lifecycle: 'blocker', status: 'Blocked' },
});

function normalizeStatusKey(value = '') {
  const normalized = String(value || '').replace(/`/g, '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (normalized === 'complete') return 'completed';
  if (normalized === 'inprogress') return 'in-progress';
  if (normalized === 'archived') return 'archive';
  if (normalized === 'blocked') return 'blocker';
  if (normalized === 'parking') return 'parked';
  if (normalized === 'agent-reviewing') return 'reviewing';
  if (normalized === 'user-verifying') return 'user-verification';
  if (['agent-requested', 'agent-response-requested', 'sent-agent', 'sent-to-automation'].includes(normalized)) return 'sent-to-agent';
  if (['not-fixed', 'not-implemented', 'changes-requested', 'requires-changes', 'requesting-user-feedback'].includes(normalized)) return 'failed-user-verification';
  if (Object.hasOwn(STATUS_DEFINITIONS, normalized)) return normalized;
  throw new Error('Unsupported task status.');
}

function statusDefinition(value = '') {
  return STATUS_DEFINITIONS[normalizeStatusKey(value)];
}

function pendingChanges(projectId) {
  if (!pendingTaskManagerChanges.has(projectId)) {
    pendingTaskManagerChanges.set(projectId, { upserts: new Map(), deletes: new Set() });
  }
  return pendingTaskManagerChanges.get(projectId);
}

function expectTaskManagerUpsert(projectId, path, hash) {
  pendingChanges(projectId).upserts.set(normalizePath(path), hash);
}

function expectTaskManagerDelete(projectId, path) {
  pendingChanges(projectId).deletes.add(normalizePath(path));
}

function expectTaskManagerDeletePlan(projectId, task) {
  [task.manifestPath || task.path, ...(task.planSections || []).map((section) => section.path), task.path]
    .filter(Boolean)
    .forEach((path) => expectTaskManagerDelete(projectId, path));
}

function consumeExpectedChanges(projectId, before, after) {
  const expected = pendingTaskManagerChanges.get(projectId);
  if (!expected) return new Set();
  const suppressed = new Set();
  for (const [path, hash] of expected.upserts) {
    if (after.get(path)?.hash === hash) {
      suppressed.add(`upsert:${path}`);
      expected.upserts.delete(path);
    }
  }
  for (const path of expected.deletes) {
    if (before.has(path) && !after.has(path)) {
      suppressed.add(`delete:${path}`);
      expected.deletes.delete(path);
    }
  }
  if (!expected.upserts.size && !expected.deletes.size) pendingTaskManagerChanges.delete(projectId);
  return suppressed;
}

function runtimeProject(id) {
  const state = getState();
  const project = state.projects.find((item) => item.id === id);
  if (!project) throw new Error('The selected project is not connected.');
  return project;
}

function relativeToTaskRoot(project, path) {
  const normalized = normalizePath(path);
  const root = normalizePath(project.taskRootPath);
  if (!root || root === '.') return normalized;
  return normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)
    ? normalized.slice(root.length + 1)
    : normalized;
}

function todoPlanReference(project, task, destinationPath) {
  const previous = normalizePath(task?.todo?.planPath || task?.planPath || '');
  if (previous && !/^planning\//i.test(previous)) return normalizePath(destinationPath);
  return relativeToTaskRoot(project, destinationPath);
}

function planFileForTask(data, task) {
  const planPath = normalizePath(task.manifestPath || task.path);
  return data.files.find((file) => normalizePath(file.path) === planPath);
}

function folderRelativeFile(task, absolutePath = '') {
  const folder = normalizePath(task.folderPath || task.path).replace(/\/$/, '');
  const path = normalizePath(absolutePath);
  return path.toLowerCase().startsWith(`${folder.toLowerCase()}/`) ? path.slice(folder.length + 1) : path.split('/').pop();
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function updateManifestText(text, definition) {
  let manifest;
  try {
    manifest = JSON.parse(text || '{}');
  } catch (error) {
    throw new Error(`plan.json is invalid: ${error.message}`);
  }
  manifest.lifecycle = definition.lifecycle;
  manifest.status = definition.status;
  manifest.updated = todayIsoDate();
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function updateSectionFrontmatter(text, definition) {
  const source = String(text || '');
  const updates = {
    lifecycle: definition.lifecycle,
    status: definition.status,
    updated: todayIsoDate(),
  };
  const keys = Object.keys(updates);
  if (!/^---\s*\n/.test(source)) {
    return [
      '---',
      ...keys.map((key) => `${key}: ${updates[key]}`),
      '---',
      source,
    ].join('\n');
  }
  return source.replace(/^---\s*\n([\s\S]*?)\n---\s*\n?/, (match, body) => {
    const seen = new Set();
    const lines = body.split(/\r?\n/).map((line) => {
      const item = /^([A-Za-z0-9_-]+):\s*(.*?)\s*$/.exec(line);
      if (!item) return line;
      const key = item[1].trim();
      const lookup = key.toLowerCase();
      if (!Object.hasOwn(updates, lookup)) return line;
      seen.add(lookup);
      return `${key}: ${updates[lookup]}`;
    });
    keys.forEach((key) => {
      if (!seen.has(key)) lines.push(`${key}: ${updates[key]}`);
    });
    return `---\n${lines.join('\n')}\n---\n`;
  });
}

function buildFolderPlanUpdates(task, data, definition) {
  const updates = {};
  const manifestFile = planFileForTask(data, task);
  if (!manifestFile) throw new Error('The plan manifest is unavailable. Rescan before changing lifecycle.');
  updates['plan.json'] = updateManifestText(manifestFile.text, definition);
  (task.planSections || []).forEach((section) => {
    const file = data.files.find((item) => normalizePath(item.path) === normalizePath(section.path));
    if (!file || section.appendOnly) return;
    updates[folderRelativeFile(task, file.path)] = updateSectionFrontmatter(file.text, definition);
  });
  return updates;
}

export async function connectProject({ name = '', rootLabel = '', explicitTaskPath = '', autoApprovePending = false } = {}) {
  let rootPath = rootLabel.trim();
  if (!rootPath) {
    try {
      const selection = await selectProjectFolder();
      rootPath = String(selection.path || '').trim();
    } catch (error) {
      if (/cancel/i.test(error.message || String(error))) return null;
      rootPath = window.prompt('Native folder picker is unavailable. Paste the absolute project path to add to data/runtime/projects.json:', '')?.trim() || '';
    }
  }
  if (!rootPath) return null;
  const project = {
    id: stableId(rootPath),
    name: name.trim() || rootPath.split('/').filter(Boolean).slice(-2).join('/') || rootPath,
    rootHandle: null,
    rootLabel: rootPath,
    explicitTaskPath: normalizePath(explicitTaskPath),
    autoApprovePending: Boolean(autoApprovePending),
    includeInAllQueue: true,
    taskRootPath: '',
    connectedAt: Date.now(),
    lastScanAt: null,
    status: 'configured',
    permission: 'server',
    error: '',
    serverBacked: true,
  };
  await saveProject(project);
  await addActivity({
    projectId: project.id,
    projectName: project.name,
    source: 'taskmanager',
    type: 'project-connected',
    summary: 'Project directory connected',
    path: project.rootLabel,
  });
  await scanProject(project.id, { requestPermission: true });
  return project;
}

export async function restoreProjectAccess(projectId) {
  const existing = runtimeProject(projectId);
  const project = { ...existing, status: 'configured', permission: 'server', error: '', serverBacked: true };
  await saveProject(project);
  await scanProject(project.id, { requestPermission: true });
  return project;
}

function detectChanges(project, previousData, files) {
  if (!previousData?.files?.length) return [];
  const before = new Map(previousData.files.map((file) => [normalizePath(file.path), file]));
  const after = new Map(files.map((file) => [normalizePath(file.path), file]));
  const suppressed = consumeExpectedChanges(project.id, before, after);
  const changes = [];
  after.forEach((file, path) => {
    const previous = before.get(path);
    if (!previous && !suppressed.has(`upsert:${path}`)) changes.push({ type: 'file-created', path, summary: 'Task-system file created' });
    else if (previous && previous.hash !== file.hash && !suppressed.has(`upsert:${path}`)) changes.push({ type: 'file-modified', path, summary: 'Task-system file changed' });
  });
  before.forEach((file, path) => {
    if (!after.has(path) && !suppressed.has(`delete:${path}`)) changes.push({ type: 'file-deleted', path, summary: 'Task-system file removed' });
  });
  return changes.map((change) => ({
    ...change,
    projectId: project.id,
    projectName: project.name,
    source: 'agent',
  }));
}

export async function scanProject(projectId, { requestPermission = false, preloadedScan = null } = {}) {
  const state = getState();
  const project = runtimeProject(projectId);
  try {
    if (!isServerBackedProject(project)) throw new Error('Project must have an absolute filesystem path in data/runtime/projects.json.');
    const scan = preloadedScan || await scanServerProject(project, state.settings);
    const setup = normalizeSetupState(scan);
    if (setup.state !== 'healthy') {
      const current = {
        ...project,
        taskRootPath: 'docs/tasks',
        status: setup.state,
        setup,
        permission: 'server',
        serverBacked: true,
        lastScanAt: Date.now(),
        error: setup.state === 'conflict'
          ? `Conflicting setup files: ${setup.conflicts.join(', ')}`
          : setup.state === 'setup-incomplete'
            ? `Workflow Kit setup is incomplete. Missing ${setup.missing.length} required item${setup.missing.length === 1 ? '' : 's'}.`
            : '',
      };
      const setupTask = buildSetupTask(current, setup);
      await saveProject(current);
      setProjectData(project.id, { project: current, files: [], tasks: [setupTask], queue: [setupTask], questions: [], verifications: [], lessons: [], observations: [], completed: [], setup });
      return getState().projectData.get(project.id);
    }
    const current = {
      ...project,
      taskRootPath: scan.taskRootPath || project.explicitTaskPath || '.',
      status: 'healthy',
      permission: 'server',
      serverBacked: true,
      lastScanAt: Date.now(),
      error: '',
      setup,
    };
    const previousData = state.projectData.get(project.id);
    const domain = buildProjectDomain(current, scan.files || []);
    for (const change of detectChanges(current, previousData, scan.files || [])) await addActivity(change);
    if (project.status && project.status !== 'healthy' && ['setup-required', 'setup-incomplete', 'conflict'].includes(project.status)) {
      await addActivity({
        projectId: project.id,
        projectName: project.name,
        source: 'taskmanager',
        type: 'project-setup-complete',
        summary: 'Agent Workflow Kits task system validated',
        path: scan.taskRootPath || 'docs/tasks',
      });
    }
    await saveProject(current);
    setProjectData(project.id, domain);
    return domain;
  } catch (error) {
    const message = error.message || String(error);
    const missingRoot = /project root does not exist|not a directory/i.test(message);
    const failed = { ...project, status: missingRoot ? 'missing-root' : 'error', permission: 'server', serverBacked: true, lastScanAt: Date.now(), error: message };
    await saveProject(failed);
    setProjectData(project.id, { project: failed, files: [], tasks: [], queue: [], questions: [], verifications: [], lessons: [], observations: [], completed: [], error: failed.error });
    if (!missingRoot) {
      await addActivity({
        projectId: project.id,
        projectName: project.name,
        source: 'taskmanager',
        type: 'scan-error',
        level: 'error',
        summary: failed.error,
        path: project.taskRootPath || project.rootLabel,
      });
    }
    throw error;
  }
}

export async function createProjectSetupTask(projectId) {
  const project = runtimeProject(projectId);
  const instruction = buildWorkflowKitInstruction(project.name);
  const result = await bootstrapServerProject(project, {
    instruction,
    expectedRevision: project.setup?.revision || '',
  });
  await addActivity({
    projectId: project.id,
    projectName: project.name,
    source: 'taskmanager',
    type: result.idempotent ? 'project-setup-reused' : 'project-setup-created',
    summary: result.idempotent ? 'Existing setup instruction verified' : 'Agent Workflow Kits setup instruction created',
    path: 'docs/tasks/onboarding/install-agent-workflow-kits.md',
  });
  return scanProject(projectId, { requestPermission: true });
}

export function projectSetupInstruction(projectId) {
  const project = runtimeProject(projectId);
  return buildWorkflowKitInstruction(project.name);
}

export async function scanAllProjects({ requestPermission = false } = {}) {
  const projects = [...getState().projects];
  const results = [];
  for (const project of projects) {
    try {
      results.push(await scanProject(project.id, { requestPermission }));
    } catch (_) {
      results.push(null);
    }
  }
  return results;
}

function locateQuestion(questionUid) {
  for (const data of getState().projectData.values()) {
    const question = data.questions?.find((item) => item.uid === questionUid);
    if (question) {
      const task = data.tasks.find((item) => item.id === question.taskId);
      const file = data.files.find((item) => normalizePath(item.path) === normalizePath(question.planPath));
      return { data, question, task, file };
    }
  }
  throw new Error('The selected question is no longer available. Rescan the project.');
}

export async function saveQuestionAnswer(questionUid, optionKey, customText = '') {
  const { question, task, file } = locateQuestion(questionUid);
  const project = runtimeProject(question.projectId);
  if (!file) throw new Error('The plan file is unavailable. Rescan the project.');
  const current = await readServerTextFile(project, file.path);
  if (file.hash && current.hash !== file.hash) {
    await addActivity({
      projectId: project.id,
      projectName: project.name,
      source: 'conflict',
      type: 'write-conflict',
      level: 'error',
      summary: `Answer not written because ${file.path} changed after the last scan.`,
      path: file.path,
    });
    throw new Error('The plan changed after it was scanned. Rescan before saving the answer.');
  }
  const option = question.options.find((candidate) => candidate.key === optionKey);
  if (!option && !customText.trim()) throw new Error('Choose an answer before saving.');
  const result = applyQuestionAnswer(current.text, question.id, option || { key: 'other', text: 'Other' }, customText);
  const written = await writeServerTextFile(project, file.path, result.text, file.hash);
  expectTaskManagerUpsert(project.id, file.path, written.hash);
  await addActivity({
    projectId: project.id,
    projectName: project.name,
    source: 'taskmanager',
    type: 'question-answer',
    summary: `${question.id} answered in ${task.title}`,
    path: file.path,
    detail: result.answer,
  });
  await scanProject(project.id);
  return result;
}

export async function saveRecommendedAnswersForTask(taskId) {
  for (const data of getState().projectData.values()) {
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task) continue;
    const project = runtimeProject(task.projectId);
    const targetPath = task.questionPath || task.path;
    const file = data.files.find((item) => normalizePath(item.path) === normalizePath(targetPath));
    if (!file) throw new Error('The plan file is unavailable. Rescan the project.');
    const current = await readServerTextFile(project, file.path);
    if (file.hash && current.hash !== file.hash) {
      await addActivity({
        projectId: project.id,
        projectName: project.name,
        source: 'conflict',
        type: 'write-conflict',
        level: 'error',
        summary: `Recommended answers were not written because ${file.path} changed after the last scan.`,
        path: file.path,
      });
      throw new Error('The plan changed after it was scanned. Rescan before saving answers.');
    }
    const result = applyRecommendedAnswers(current.text);
    if (!result.applied.length) return result;
    const written = await writeServerTextFile(project, file.path, result.text, file.hash);
    expectTaskManagerUpsert(project.id, file.path, written.hash);
    await addActivity({
      projectId: project.id,
      projectName: project.name,
      source: 'taskmanager',
      type: 'recommended-answers',
      summary: `${result.applied.length} recommended answer${result.applied.length === 1 ? '' : 's'} saved in ${task.title}`,
      path: file.path,
    });
    await scanProject(project.id);
    return result;
  }
  throw new Error('The selected plan is no longer available.');
}

export async function captureInstruction(projectId, { title, scope = '', category = 'General', type = 'Task' }) {
  const project = runtimeProject(projectId);
  const state = getState();
  const data = state.projectData.get(projectId);
  if (!title?.trim()) throw new Error('Instruction title is required.');
  const todoPath = normalizePath(`${project.taskRootPath === '.' ? '' : project.taskRootPath}/todo.md`);
  const scannedTodo = data?.files?.find((file) => normalizePath(file.path) === todoPath);
  let current;
  try {
    current = await readServerTextFile(project, todoPath);
  } catch (_) {
    current = { text: '', hash: '', path: todoPath };
  }
  if (scannedTodo?.hash && current.hash !== scannedTodo.hash) {
    await addActivity({
      projectId: project.id,
      projectName: project.name,
      source: 'conflict',
      type: 'write-conflict',
      level: 'error',
      summary: `Instruction not captured because ${todoPath} changed after the last scan.`,
      path: todoPath,
    });
    throw new Error('The active task file changed after it was scanned. Rescan before capturing the instruction.');
  }
  let text = current.text;
  if (!text.trim()) {
    text = `# ${project.name} — Active Tasks\n\n> Active work only. Completed work is removed after it is recorded in the daily task log.\n\n## Active\n`;
  }
  const entry = [
    `- [ ] **${title.trim().replaceAll('**', '')}**`,
    `  - Category: \`${category.trim() || 'General'}\``,
    `  - Type: \`${type === 'Sprint' ? 'Sprint' : 'Task'}\``,
    '  - Status: `Draft`',
    '  - Plan: `none — quick task`',
    '  - Plan Score: `not applicable — quick task`',
    '  - Verification Method: `not selected`',
    `  - Scope: ${scope.trim() || title.trim()}`,
    '  - Closeout: `Not started`',
    '  - Blocker: `none`',
  ].join('\n');
  const nextText = `${text.trimEnd()}\n\n${entry}\n`;
  const written = await writeServerTextFile(project, todoPath, nextText, scannedTodo?.hash || current.hash || '');
  expectTaskManagerUpsert(project.id, todoPath, written.hash);
  await addActivity({
    projectId: project.id,
    projectName: project.name,
    source: 'taskmanager',
    type: 'instruction-captured',
    summary: title.trim(),
    path: todoPath,
  });
  await scanProject(project.id);
}

function shouldRemoveTodoForLifecycle(lifecycle = '') {
  return ['completed', 'archive'].includes(lifecycle);
}

function assertTransitionAllowed(task, definition) {
  const gatedForQuestions = ['approved', 'in-progress', 'review', 'user-verification', 'completed'].includes(definition.lifecycle);
  if (gatedForQuestions && task.unansweredQuestions) {
    throw new Error(`The plan cannot move to ${definition.status} while planning questions remain unanswered.`);
  }
  if (definition.lifecycle === 'completed' && task.lifecycle !== 'user-verification') {
    throw new Error('The plan can only move to completed from the user verification stage.');
  }
  if (definition.lifecycle === 'completed' && !/^complete$/i.test(task.closeoutStatus || '')) {
    throw new Error('The plan cannot move to completed until its Closeout Review final status is Complete.');
  }
  if (definition.lifecycle === 'completed' && task.planKind === 'folder' && task.completionBlockers?.length) {
    throw new Error(`The plan cannot move to completed until completion evidence is complete: ${task.completionBlockers.join('; ')}.`);
  }
}

async function syncLinkedTodoAfterTransition(project, data, task, status, destinationPath, lifecycle = '') {
  if (!task.todo) return '';
  const todoFile = data.files.find((file) => /(^|\/)todo\.md$/i.test(file.relativeToTaskRoot || file.path));
  if (!todoFile?.hash) return '';
  const currentTodo = await readServerTextFile(project, todoFile.path);
  if (currentTodo.hash !== todoFile.hash) {
    await addActivity({
      projectId: project.id,
      projectName: project.name,
      source: 'conflict',
      type: 'write-conflict',
      level: 'error',
      summary: `Todo status was not updated because ${todoFile.path} changed after the last scan.`,
      path: todoFile.path,
    });
    throw new Error('The active task file changed after it was scanned. Rescan before changing status.');
  }
  const nextTodo = shouldRemoveTodoForLifecycle(lifecycle)
    ? removeTodoTaskItem(currentTodo.text, task.todo)
    : updateTodoTaskFields(currentTodo.text, task.todo, {
      Status: `\`${status}\``,
      Plan: `\`${todoPlanReference(project, task, destinationPath)}\``,
    });
  if (nextTodo === currentTodo.text) return '';
  const written = await writeServerTextFile(project, todoFile.path, nextTodo, todoFile.hash);
  expectTaskManagerUpsert(project.id, todoFile.path, written.hash);
  return shouldRemoveTodoForLifecycle(lifecycle) ? 'todo item removed' : 'todo status and plan path updated';
}

async function assertLinkedTodoFresh(project, data, task) {
  if (!task.todo) return;
  const todoFile = data.files.find((file) => /(^|\/)todo\.md$/i.test(file.relativeToTaskRoot || file.path));
  if (!todoFile?.hash) return;
  const currentTodo = await readServerTextFile(project, todoFile.path);
  if (currentTodo.hash === todoFile.hash) return;
  await addActivity({
    projectId: project.id,
    projectName: project.name,
    source: 'conflict',
    type: 'write-conflict',
    level: 'error',
    summary: `Lifecycle transition blocked because ${todoFile.path} changed after the last scan.`,
    path: todoFile.path,
  });
  throw new Error('The active task file changed after it was scanned. Rescan before changing status.');
}

export async function transitionPlan(taskId, destinationLifecycle) {
  const definition = statusDefinition(destinationLifecycle);
  if (definition.statusOnly) throw new Error(`${definition.status} updates the current plan status without moving the plan file.`);
  const state = getState();
  for (const data of state.projectData.values()) {
    const task = data.tasks.find((item) => item.id === taskId && item.source === 'plan');
    if (!task) continue;
    const project = runtimeProject(task.projectId);
    assertTransitionAllowed(task, definition);
    const sourcePath = normalizePath(task.path);
    const destinationLifecycleName = definition.lifecycle;
    const lifecycleFolderPattern = /(^|\/)planning\/(draft|pending|approved|in-progress|review|user-verification|failed-user-verification|completed|archive|parked|blocker)\//i;
    const destinationPath = sourcePath.replace(lifecycleFolderPattern, (match, prefix) => `${prefix}planning/${destinationLifecycleName}/`);
    if (destinationPath === sourcePath) throw new Error('The plan is already in that lifecycle folder.');
    const status = definition.status;
    const planFile = planFileForTask(data, task);
    if (!planFile?.hash) throw new Error('The plan revision is unavailable. Rescan before changing its lifecycle.');
    let todoSyncDetail = '';
    try {
      await assertLinkedTodoFresh(project, data, task);
      if (task.planKind === 'folder') {
        const current = await readServerTextFile(project, task.manifestPath);
        if (current.hash !== planFile.hash) throw new Error('The source plan manifest changed after the last scan. Rescan before changing its lifecycle.');
        const result = await copyVerifyDeleteFolderServer(
          project,
          sourcePath,
          destinationPath,
          buildFolderPlanUpdates(task, data, definition),
          planFile.hash,
        );
        expectTaskManagerUpsert(project.id, result.manifest.path, result.manifest.hash);
        expectTaskManagerDeletePlan(project.id, task);
      } else {
        const current = await readServerTextFile(project, sourcePath);
        if (current.hash !== planFile.hash) throw new Error('The source plan changed after the last scan. Rescan before changing its lifecycle.');
        const written = await copyVerifyDeleteServer(
          project,
          sourcePath,
          destinationPath,
          updatePlanMetadata(current.text, 'Status', status),
          planFile.hash,
        );
        expectTaskManagerUpsert(project.id, destinationPath, written.hash);
        expectTaskManagerDelete(project.id, sourcePath);
      }
      todoSyncDetail = await syncLinkedTodoAfterTransition(project, data, task, status, destinationPath, destinationLifecycleName);
    } catch (error) {
      if (/changed after the last scan/i.test(error.message || '')) {
        await addActivity({
          projectId: project.id,
          projectName: project.name,
          source: 'conflict',
          type: 'write-conflict',
          level: 'error',
          summary: `Lifecycle transition blocked because ${sourcePath} changed after the last scan.`,
          path: sourcePath,
        });
      }
      throw error;
    }
    await addActivity({
      projectId: project.id,
      projectName: project.name,
      source: 'taskmanager',
      type: 'lifecycle-transition',
      summary: `${task.title} moved to ${destinationLifecycleName}`,
      path: destinationPath,
      detail: `copy → verify → delete from ${sourcePath}${todoSyncDetail ? `; ${todoSyncDetail}` : ''}`,
    });
    await scanProject(project.id);
    return destinationPath;
  }
  throw new Error('The selected plan is no longer available.');
}

async function updatePlanStatusInPlace(project, data, task, definition) {
  assertTransitionAllowed(task, definition);
  const sourcePath = normalizePath(task.manifestPath || task.path);
  const status = definition.status;
  const planFile = planFileForTask(data, task);
  if (!planFile?.hash) throw new Error('The plan revision is unavailable. Rescan before changing its status.');
  const current = await readServerTextFile(project, sourcePath);
  if (current.hash !== planFile.hash) {
    await addActivity({
      projectId: project.id,
      projectName: project.name,
      source: 'conflict',
      type: 'write-conflict',
      level: 'error',
      summary: `Status update blocked because ${sourcePath} changed after the last scan.`,
      path: sourcePath,
    });
    throw new Error('The source plan changed after the last scan. Rescan before changing its status.');
  }
  if (task.planKind === 'folder') {
    const nextPlan = updateManifestText(current.text, definition);
    if (nextPlan !== current.text) {
      const written = await writeServerTextFile(project, sourcePath, nextPlan, planFile.hash);
      expectTaskManagerUpsert(project.id, sourcePath, written.hash);
    }
    for (const section of task.planSections || []) {
      if (section.appendOnly) continue;
      const sectionFile = data.files.find((file) => normalizePath(file.path) === normalizePath(section.path));
      if (!sectionFile?.hash) continue;
      const currentSection = await readServerTextFile(project, sectionFile.path);
      if (currentSection.hash !== sectionFile.hash) throw new Error('A plan section changed after the last scan. Rescan before changing status.');
      const nextSection = updateSectionFrontmatter(currentSection.text, definition);
      if (nextSection !== currentSection.text) {
        const written = await writeServerTextFile(project, sectionFile.path, nextSection, sectionFile.hash);
        expectTaskManagerUpsert(project.id, sectionFile.path, written.hash);
      }
    }
  } else {
    const nextPlan = updatePlanMetadata(current.text, 'Status', status);
    if (nextPlan !== current.text) {
      const written = await writeServerTextFile(project, sourcePath, nextPlan, planFile.hash);
      expectTaskManagerUpsert(project.id, sourcePath, written.hash);
    }
  }
  const todoSyncDetail = await syncLinkedTodoAfterTransition(project, data, task, status, task.path, definition.lifecycle);
  await addActivity({
    projectId: project.id,
    projectName: project.name,
    source: 'taskmanager',
    type: 'status-update',
    summary: `${task.title} status set to ${status}`,
    path: sourcePath,
    detail: todoSyncDetail || 'plan metadata updated in place',
  });
  await scanProject(project.id);
  return sourcePath;
}

async function updateTodoOnlyStatus(project, data, task, definition) {
  const status = definition.status;
  const todoFile = data.files.find((file) => /(^|\/)todo\.md$/i.test(file.relativeToTaskRoot || file.path));
  if (!todoFile?.hash) throw new Error('The active task file is unavailable. Rescan before changing status.');
  const currentTodo = await readServerTextFile(project, todoFile.path);
  if (currentTodo.hash !== todoFile.hash) {
    await addActivity({
      projectId: project.id,
      projectName: project.name,
      source: 'conflict',
      type: 'write-conflict',
      level: 'error',
      summary: `Todo status was not updated because ${todoFile.path} changed after the last scan.`,
      path: todoFile.path,
    });
    throw new Error('The active task file changed after it was scanned. Rescan before changing status.');
  }
  const nextTodo = shouldRemoveTodoForLifecycle(definition.lifecycle)
    ? removeTodoTaskItem(currentTodo.text, task)
    : updateTodoTaskFields(currentTodo.text, task, { Status: `\`${status}\`` });
  if (nextTodo !== currentTodo.text) {
    const written = await writeServerTextFile(project, todoFile.path, nextTodo, todoFile.hash);
    expectTaskManagerUpsert(project.id, todoFile.path, written.hash);
  }
  await addActivity({
    projectId: project.id,
    projectName: project.name,
    source: 'taskmanager',
    type: 'status-update',
    summary: shouldRemoveTodoForLifecycle(definition.lifecycle) ? `${task.title} removed from active todo` : `${task.title} status set to ${status}`,
    path: todoFile.path,
  });
  await scanProject(project.id);
  return todoFile.path;
}

export async function updateTaskStatus(taskId, requestedStatus) {
  const definition = statusDefinition(requestedStatus);
  const state = getState();
  for (const data of state.projectData.values()) {
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task) continue;
    const project = runtimeProject(task.projectId);
    if (task.source === 'plan') {
      return definition.statusOnly || task.lifecycle === definition.lifecycle
        ? updatePlanStatusInPlace(project, data, task, definition)
        : transitionPlan(taskId, definition.key);
    }
    return updateTodoOnlyStatus(project, data, task, definition);
  }
  throw new Error('The selected task is no longer available.');
}

export async function saveUserVerificationFeedback(taskId, feedback) {
  const definition = STATUS_DEFINITIONS['user-replied'];
  const state = getState();
  for (const data of state.projectData.values()) {
    const task = data.tasks.find((item) => item.id === taskId && item.source === 'plan');
    if (!task) continue;
    if (task.lifecycle !== 'failed-user-verification') {
      throw new Error('User feedback can only be saved for tasks in failed user verification.');
    }
    const project = runtimeProject(task.projectId);
    if (task.planKind === 'folder') {
      const commentsPath = normalizePath(task.commentsPath || task.path);
      const commentsFile = data.files.find((file) => normalizePath(file.path) === commentsPath);
      if (!commentsFile?.hash) throw new Error('The comments file is unavailable. Rescan before saving feedback.');
      const currentComments = await readServerTextFile(project, commentsPath);
      if (currentComments.hash !== commentsFile.hash) {
        await addActivity({
          projectId: project.id,
          projectName: project.name,
          source: 'conflict',
          type: 'write-conflict',
          level: 'error',
          summary: `User feedback was not saved because ${commentsPath} changed after the last scan.`,
          path: commentsPath,
        });
        throw new Error('The comments file changed after the last scan. Rescan before saving feedback.');
      }
      await assertLinkedTodoFresh(project, data, task);
      const writtenComments = await writeServerTextFile(
        project,
        commentsPath,
        appendUserFeedback(currentComments.text, feedback),
        commentsFile.hash,
      );
      expectTaskManagerUpsert(project.id, commentsPath, writtenComments.hash);
      await updatePlanStatusInPlace(project, data, task, definition);
      await addActivity({
        projectId: project.id,
        projectName: project.name,
        source: 'taskmanager',
        type: 'user-feedback',
        summary: `${task.title} user feedback saved in comments`,
        path: commentsPath,
      });
      return commentsPath;
    }
    const sourcePath = normalizePath(task.path);
    const planFile = data.files.find((file) => normalizePath(file.path) === sourcePath);
    if (!planFile?.hash) throw new Error('The plan revision is unavailable. Rescan before saving feedback.');
    const current = await readServerTextFile(project, sourcePath);
    if (current.hash !== planFile.hash) {
      await addActivity({
        projectId: project.id,
        projectName: project.name,
        source: 'conflict',
        type: 'write-conflict',
        level: 'error',
        summary: `User feedback was not saved because ${sourcePath} changed after the last scan.`,
        path: sourcePath,
      });
      throw new Error('The source plan changed after the last scan. Rescan before saving feedback.');
    }
    let todoSyncDetail = '';
    await assertLinkedTodoFresh(project, data, task);
    const nextPlan = updatePlanMetadata(
      appendUserFeedback(current.text, feedback),
      'Status',
      definition.status,
    );
    const written = await writeServerTextFile(project, sourcePath, nextPlan, planFile.hash);
    expectTaskManagerUpsert(project.id, sourcePath, written.hash);
    todoSyncDetail = await syncLinkedTodoAfterTransition(project, data, task, definition.status, sourcePath, definition.lifecycle);
    await addActivity({
      projectId: project.id,
      projectName: project.name,
      source: 'taskmanager',
      type: 'user-feedback',
      summary: `${task.title} user feedback saved`,
      path: sourcePath,
      detail: `status set to ${definition.status}${todoSyncDetail ? `; ${todoSyncDetail}` : ''}`,
    });
    await scanProject(project.id);
    return sourcePath;
  }
  throw new Error('The selected plan is no longer available.');
}

export async function sendUserVerificationComment(taskId, comment) {
  const definition = STATUS_DEFINITIONS['sent-to-agent'];
  const state = getState();
  for (const data of state.projectData.values()) {
    const task = data.tasks.find((item) => item.id === taskId && item.source === 'plan');
    if (!task) continue;
    if (task.lifecycle !== 'user-verification') {
      throw new Error('Comments can only be sent to an agent from the user verification stage.');
    }
    const project = runtimeProject(task.projectId);
    if (task.planKind === 'folder') {
      const commentsPath = normalizePath(task.commentsPath || task.path);
      const commentsFile = data.files.find((file) => normalizePath(file.path) === commentsPath);
      if (!commentsFile?.hash) throw new Error('The comments file is unavailable. Rescan before sending the comment.');
      const currentComments = await readServerTextFile(project, commentsPath);
      if (currentComments.hash !== commentsFile.hash) {
        await addActivity({
          projectId: project.id,
          projectName: project.name,
          source: 'conflict',
          type: 'write-conflict',
          level: 'error',
          summary: `User verification comment was not saved because ${commentsPath} changed after the last scan.`,
          path: commentsPath,
        });
        throw new Error('The comments file changed after the last scan. Rescan before sending the comment.');
      }
      await assertLinkedTodoFresh(project, data, task);
      const writtenComments = await writeServerTextFile(
        project,
        commentsPath,
        appendUserVerificationComment(currentComments.text, comment),
        commentsFile.hash,
      );
      expectTaskManagerUpsert(project.id, commentsPath, writtenComments.hash);
      await updatePlanStatusInPlace(project, data, task, definition);
      await addActivity({
        projectId: project.id,
        projectName: project.name,
        source: 'taskmanager',
        type: 'user-verification-comment',
        summary: `${task.title} user verification comment saved in comments`,
        path: commentsPath,
      });
      return commentsPath;
    }
    const sourcePath = normalizePath(task.path);
    const planFile = data.files.find((file) => normalizePath(file.path) === sourcePath);
    if (!planFile?.hash) throw new Error('The plan revision is unavailable. Rescan before sending the comment.');
    const current = await readServerTextFile(project, sourcePath);
    if (current.hash !== planFile.hash) {
      await addActivity({
        projectId: project.id,
        projectName: project.name,
        source: 'conflict',
        type: 'write-conflict',
        level: 'error',
        summary: `User verification comment was not saved because ${sourcePath} changed after the last scan.`,
        path: sourcePath,
      });
      throw new Error('The source plan changed after the last scan. Rescan before sending the comment.');
    }
    let todoSyncDetail = '';
    await assertLinkedTodoFresh(project, data, task);
    const nextPlan = updatePlanMetadata(
      appendUserVerificationComment(current.text, comment),
      'Status',
      definition.status,
    );
    const written = await writeServerTextFile(project, sourcePath, nextPlan, planFile.hash);
    expectTaskManagerUpsert(project.id, sourcePath, written.hash);
    todoSyncDetail = await syncLinkedTodoAfterTransition(project, data, task, definition.status, sourcePath, definition.lifecycle);
    await addActivity({
      projectId: project.id,
      projectName: project.name,
      source: 'taskmanager',
      type: 'user-verification-comment',
      summary: `${task.title} user verification comment sent to agent`,
      path: sourcePath,
      detail: `status set to ${definition.status}${todoSyncDetail ? `; ${todoSyncDetail}` : ''}`,
    });
    await scanProject(project.id);
    return sourcePath;
  }
  throw new Error('The selected plan is no longer available.');
}
