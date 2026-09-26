const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { URL } = require('url');
const { execFileSync } = require('child_process');

const TEXT_EXTENSIONS = new Set(['.md', '.json']);
const REQUEST_JSON_MAX_BYTES = 2 * 1024 * 1024;
const BOOTSTRAP_PATH = 'docs/tasks/.taskmanager-bootstrap.json';
const SETUP_INSTRUCTION_PATH = 'docs/tasks/onboarding/install-agent-workflow-kits.md';
const WORKFLOW_KIT_TAG = 'v1.0.0';
const WORKFLOW_KIT_COMMIT = '928dd48b86385177d62646866acbaeaf13f5af77';
const CANONICAL_TASK_MARKERS = [
  'docs/tasks/workflow.md',
  'docs/tasks/todo.md',
  'docs/tasks/planning',
  'docs/tasks/lessons-active.md',
  'docs/tasks/lessons-index.json',
  'docs/tasks/task-system.config.yaml',
  'docs/tasks/verification.md',
];
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizeSlash(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function hashText(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function safeResolve(root, relativePath = '') {
  const rel = normalizeSlash(relativePath);
  let cursor = path.resolve(root);
  for (const part of rel.split('/').filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in confined project paths: ${relativePath}`);
    }
  }
  const resolved = path.resolve(root, rel || '.');
  const rootResolved = path.resolve(root);
  const relative = path.relative(rootResolved, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes project root: ${relativePath}`);
  }
  return resolved;
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJsonFile(file, payload) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function send(res, status, body, headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ''), 'utf8');
  res.writeHead(status, {
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    'X-TaskManager-Runtime-Config-Write': '1',
    ...headers,
  });
  res.end(payload);
}

function sendJson(res, status, payload) {
  send(res, status, `${JSON.stringify(payload, null, 2)}\n`, { 'Content-Type': 'application/json; charset=utf-8' });
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tooLarge = Number(req.headers['content-length'] || 0) > REQUEST_JSON_MAX_BYTES;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > REQUEST_JSON_MAX_BYTES) tooLarge = true;
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        if (tooLarge) throw new Error('Runtime JSON request exceeds the supported size limit.');
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function projectRoot(payload = {}) {
  const project = payload.project && typeof payload.project === 'object' ? payload.project : payload;
  const rootLabel = String(project.rootLabel || project.rootPath || '').trim();
  if (!rootLabel) throw new Error('Project rootLabel is required for server-backed filesystem access.');
  const root = path.resolve(rootLabel.replace(/^~(?=$|\/)/, os.homedir()));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Project root does not exist or is not a directory: ${rootLabel}`);
  }
  return root;
}

function fileRecord(root, filePath, taskRootPath = '') {
  const text = fs.readFileSync(filePath, 'utf8');
  const stat = fs.statSync(filePath);
  const relativePath = normalizeSlash(path.relative(root, filePath));
  let relativeToTaskRoot = '';
  if (taskRootPath) {
    const taskRoot = safeResolve(root, taskRootPath === '.' ? '' : taskRootPath);
    relativeToTaskRoot = normalizeSlash(path.relative(taskRoot, filePath));
  }
  return {
    path: relativePath,
    relativeToTaskRoot,
    text,
    hash: hashText(text),
    size: stat.size,
    createdAt: Math.round((stat.birthtimeMs || Math.min(stat.ctimeMs, stat.mtimeMs))),
    lastModified: Math.round(stat.mtimeMs),
    serverBacked: true,
  };
}

function looksLikeTaskRoot(dir) {
  const markers = [
    fs.existsSync(path.join(dir, 'todo.md')),
    fs.existsSync(path.join(dir, 'workflow.md')),
    fs.existsSync(path.join(dir, 'planning')) && fs.statSync(path.join(dir, 'planning')).isDirectory(),
    fs.existsSync(path.join(dir, 'lessons.md')),
  ];
  const count = markers.filter(Boolean).length;
  return count >= 2 && (markers[0] || markers[1]);
}

function candidatePaths(settings = {}, explicitPath = '') {
  const docs = settings.documentationFolderNames || ['docs', 'documentation'];
  const tasks = settings.taskFolderNames || ['task'];
  const candidates = [];
  if (explicitPath) candidates.push(String(explicitPath).replace(/^\/+|\/+$/g, ''));
  candidates.push('');
  for (const task of tasks) candidates.push(String(task).replace(/^\/+|\/+$/g, ''));
  for (const doc of docs) {
    for (const task of tasks) candidates.push(`${String(doc).replace(/^\/+|\/+$/g, '')}/${String(task).replace(/^\/+|\/+$/g, '')}`.replace(/^\/+|\/+$/g, ''));
  }
  const seen = new Set();
  return candidates.map(normalizeSlash).filter((candidate) => {
    const key = candidate.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findTaskRoot(root, settings = {}, explicitPath = '') {
  for (const candidate of candidatePaths(settings, explicitPath)) {
    const dir = candidate ? safeResolve(root, candidate) : root;
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory() && looksLikeTaskRoot(dir)) {
      return { taskRoot: dir, taskRootPath: candidate || '.' };
    }
  }
  const docsNames = new Set((settings.documentationFolderNames || ['docs', 'documentation']).map((name) => String(name).toLowerCase()));
  const taskNames = new Set((settings.taskFolderNames || ['task']).map((name) => String(name).toLowerCase()));
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (looksLikeTaskRoot(dir)) return { taskRoot: dir, taskRootPath: normalizeSlash(path.relative(root, dir)) || '.' };
    if (depth >= 3) continue;
    let children = [];
    try {
      children = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    } catch (_) {
      continue;
    }
    for (const child of children) {
      const lower = child.toLowerCase();
      if (depth === 0 || docsNames.has(lower) || taskNames.has(lower) || depth < 2) {
        queue.push({ dir: path.join(dir, child), depth: depth + 1 });
      }
    }
  }
  return null;
}

function setupRevision(root) {
  const parts = [...new Set([...CANONICAL_TASK_MARKERS, BOOTSTRAP_PATH, SETUP_INSTRUCTION_PATH])].sort().map((relative) => {
    const target = safeResolve(root, relative);
    if (fs.existsSync(target) && fs.statSync(target).isFile()) return `${relative}:file:${crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')}`;
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) return `${relative}:dir`;
    return `${relative}:missing`;
  });
  return hashText(parts.join('\n'));
}

function classifyProjectSetup(root) {
  const missing = CANONICAL_TASK_MARKERS.filter((relative) => {
    const target = safeResolve(root, relative);
    if (!fs.existsSync(target)) return true;
    if (relative === 'docs/tasks/planning') return !fs.statSync(target).isDirectory();
    if (!fs.statSync(target).isFile() || !fs.readFileSync(target, 'utf8').trim()) return true;
    if (relative === 'docs/tasks/lessons-index.json') {
      try { return typeof JSON.parse(fs.readFileSync(target, 'utf8')) !== 'object'; } catch (_) { return true; }
    }
    return false;
  });
  const manifestPath = safeResolve(root, BOOTSTRAP_PATH);
  const instructionPath = safeResolve(root, SETUP_INSTRUCTION_PATH);
  const conflicts = [];
  let bootstrap = null;
  if (fs.existsSync(manifestPath)) {
    if (!fs.statSync(manifestPath).isFile()) conflicts.push(BOOTSTRAP_PATH);
    else {
      try {
        bootstrap = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (bootstrap.schema !== 'taskmanager-project-bootstrap/v1' || bootstrap.kit?.tag !== WORKFLOW_KIT_TAG) conflicts.push(BOOTSTRAP_PATH);
      } catch (_) {
        conflicts.push(BOOTSTRAP_PATH);
      }
    }
  }
  if (fs.existsSync(instructionPath) && !fs.statSync(instructionPath).isFile()) conflicts.push(SETUP_INSTRUCTION_PATH);
  else if (fs.existsSync(instructionPath)) {
    const instruction = fs.readFileSync(instructionPath, 'utf8');
    const expectedHash = String(bootstrap?.instruction?.sha256 || '');
    if (!bootstrap || !expectedHash || hashText(instruction) !== expectedHash) conflicts.push(SETUP_INSTRUCTION_PATH);
  }
  const anySetupContent = CANONICAL_TASK_MARKERS.some((relative) => fs.existsSync(safeResolve(root, relative)));
  const state = !missing.length ? 'healthy' : conflicts.length ? 'conflict' : (bootstrap || anySetupContent) ? 'setup-incomplete' : 'setup-required';
  return {
    state,
    missing,
    conflicts: [...new Set(conflicts)].sort(),
    revision: setupRevision(root),
    bootstrap,
    kit: { repository: 'aipieksel/ai-agent-workflow-kits', tag: WORKFLOW_KIT_TAG, commit: WORKFLOW_KIT_COMMIT },
  };
}

function bootstrapProject(root, payload) {
  const instruction = String(payload.instruction || '');
  if (Buffer.byteLength(instruction, 'utf8') > 100_000 || !instruction.includes('aipieksel/ai-agent-workflow-kits') || !instruction.includes(WORKFLOW_KIT_TAG)) {
    throw new Error('Bootstrap instruction does not match the supported Agent Workflow Kits release.');
  }
  const setup = classifyProjectSetup(root);
  if (payload.expectedRevision && String(payload.expectedRevision) !== setup.revision) return { status: 409, payload: { ok: false, error: 'Project setup changed after the last scan. Check setup before retrying.', setup } };
  if (setup.state === 'healthy') return { status: 409, payload: { ok: false, error: 'This project already has a healthy task system.', setup } };
  if (setup.conflicts.length) return { status: 409, payload: { ok: false, error: 'Task Manager bootstrap paths contain conflicting content.', setup } };
  const instructionPath = safeResolve(root, SETUP_INSTRUCTION_PATH);
  const manifestPath = safeResolve(root, BOOTSTRAP_PATH);
  if (fs.existsSync(instructionPath) && fs.statSync(instructionPath).isFile() && fs.readFileSync(instructionPath, 'utf8') === instruction && fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile()) {
    return { status: 200, payload: { ok: true, created: false, idempotent: true, setup: classifyProjectSetup(root) } };
  }
  if (payload.dryRun) return { status: 200, payload: { ok: true, dryRun: true, created: false, paths: [BOOTSTRAP_PATH, SETUP_INSTRUCTION_PATH], setup } };
  const createdAt = new Date().toISOString();
  const manifest = { schema: 'taskmanager-project-bootstrap/v1', version: 1, status: 'instruction-ready', kit: { repository: 'aipieksel/ai-agent-workflow-kits', tag: WORKFLOW_KIT_TAG, commit: WORKFLOW_KIT_COMMIT }, createdAt, updatedAt: createdAt, instruction: { path: SETUP_INSTRUCTION_PATH, sha256: hashText(instruction) }, detectedContractVersion: null };
  const writes = [[manifestPath, `${JSON.stringify(manifest, null, 2)}\n`], [instructionPath, instruction]];
  const staged = writes.map(([finalPath, text]) => {
    mkdirp(path.dirname(finalPath));
    const temporary = path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.taskmanager-${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(temporary, text, 'utf8');
    if (fs.readFileSync(temporary, 'utf8') !== text) throw new Error(`Bootstrap staging verification failed: ${normalizeSlash(path.relative(root, finalPath))}`);
    return { temporary, finalPath, text };
  });
  const committed = [];
  try {
    for (const item of staged) {
      if (fs.existsSync(item.finalPath)) {
        if (fs.statSync(item.finalPath).isFile() && fs.readFileSync(item.finalPath, 'utf8') === item.text) { fs.rmSync(item.temporary, { force: true }); continue; }
        throw new Error(`Bootstrap conflict: ${normalizeSlash(path.relative(root, item.finalPath))}`);
      }
      fs.renameSync(item.temporary, item.finalPath);
      committed.push(item.finalPath);
    }
  } catch (error) {
    for (const file of committed) fs.rmSync(file, { force: true });
    throw error;
  } finally {
    for (const item of staged) fs.rmSync(item.temporary, { force: true });
  }
  return { status: 200, payload: { ok: true, created: true, idempotent: false, paths: [BOOTSTRAP_PATH, SETUP_INSTRUCTION_PATH], setup: classifyProjectSetup(root) } };
}

function walkTextFiles(root, dir, taskRootPath, maxDepth = 6, depth = 0) {
  let records = [];
  let children = [];
  try {
    children = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch (_) {
    return records;
  }
  for (const child of children) {
    const full = path.join(dir, child.name);
    if (child.isFile() && TEXT_EXTENSIONS.has(path.extname(child.name).toLowerCase())) {
      records.push(fileRecord(root, full, taskRootPath));
    } else if (child.isDirectory() && depth < maxDepth) {
      records = records.concat(walkTextFiles(root, full, taskRootPath, maxDepth, depth + 1));
    }
  }
  return records;
}

function createRuntimeServer(options) {
  const staticDir = path.resolve(options.staticDir);
  const runtimeDir = path.resolve(options.runtimeDir);
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
  const selectDirectory = options.selectDirectory;
  const host = options.host || '127.0.0.1';
  const port = Number(options.port || 0);

  mkdirp(runtimeDir);
  mkdirp(path.join(runtimeDir, 'config'));
  const projectsFile = path.join(runtimeDir, 'projects.json');
  const registryResolution = options.registryResolution || {
    activePath: projectsFile,
    runtimeDir,
    source: 'runtime-dir',
  };
  if (!fs.existsSync(projectsFile)) writeJsonFile(projectsFile, { version: 1, projects: [] });

  function registryHeaders() {
    return {
      'X-TaskManager-Runtime-Config-Path': String(registryResolution.activePath || projectsFile),
      'X-TaskManager-Runtime-Config-Source': String(registryResolution.source || 'runtime-dir'),
    };
  }

  function runtimeConfigFile(requestPath) {
    if (requestPath === '/data/runtime/projects.json') return projectsFile;
    if (requestPath.startsWith('/data/runtime/config/') && requestPath.endsWith('.json')) {
      return path.join(runtimeDir, normalizeSlash(requestPath.replace('/data/runtime/', '')));
    }
    return null;
  }

  const assignmentsFile = path.join(runtimeDir, 'automation-assignments.json');
  const controlFile = path.join(runtimeDir, 'automation-control.json');
  const auditFile = path.join(runtimeDir, 'automation-audit.jsonl');

  function emptyControl() {
    return { version: 1, updatedAt: new Date().toISOString(), projects: {}, reviewers: {}, threadLinks: {}, conflicts: {} };
  }

  function loadControl() {
    return readJsonFile(controlFile, emptyControl());
  }

  function saveControl(control) {
    control.updatedAt = new Date().toISOString();
    writeJsonFile(controlFile, control);
  }

  function loadAssignments() {
    return readJsonFile(assignmentsFile, { version: 1, updatedAt: new Date().toISOString(), assignments: [] });
  }

  function saveAssignments(registry) {
    registry.updatedAt = new Date().toISOString();
    writeJsonFile(assignmentsFile, registry);
  }

  function replaceStatus(text, status) {
    const patterns = [
      /(^>\s*\*\*Status:\*\*\s*)(.+)$/im,
      /(^>\s*Status:\s*)(.+)$/im,
      /(^\*\*Status\*\*:\s*)(.+)$/im,
      /(^Status:\s*)(.+)$/im,
    ];
    for (const pattern of patterns) {
      if (pattern.test(text)) return text.replace(pattern, `$1${status}`);
    }
    return `> **Status:** ${status}\n\n${text}`;
  }

  function setPlanBlockState(planPath, { blocked, reason, actor, timestamp }) {
    if (!planPath || !fs.existsSync(planPath)) throw new Error(`Plan path not found: ${planPath}`);
    if (!fs.statSync(planPath).isDirectory()) {
      const previousText = fs.readFileSync(planPath, 'utf8');
      const nextStatus = blocked ? 'Blocked' : 'In Progress';
      fs.writeFileSync(planPath, `${replaceStatus(previousText, nextStatus).trim()}\n\n## ${timestamp} — ${blocked ? 'Blocked' : 'Unblocked'} by ${actor}\n\nReason: ${reason}\n`, 'utf8');
      return [{ path: planPath, textHash: crypto.createHash('sha1').update(previousText).digest('hex').slice(0, 12) }, { path: planPath, status: nextStatus, blocked, reason }];
    }
    const manifest = path.join(planPath, 'plan.json');
    const data = readJsonFile(manifest, {});
    const previous = { status: data.status || '', block: data.block || {} };
    const history = Array.isArray(data.block?.history) ? data.block.history : [];
    const event = { blocked, reason, actor, timestamp };
    if (blocked) {
      data.block = { blocked: true, reason, blockedAt: timestamp, blockedBy: actor, statusBeforeBlock: data.status || '', history: [...history, event] };
      data.status = 'Blocked';
    } else {
      const previousBlock = data.block && typeof data.block === 'object' ? data.block : {};
      const restoreStatus = previousBlock.statusBeforeBlock && previousBlock.statusBeforeBlock !== 'Blocked' ? previousBlock.statusBeforeBlock : 'In Progress';
      data.block = { ...previousBlock, blocked: false, unblockedAt: timestamp, unblockedBy: actor, unblockReason: reason, history: [...history, event] };
      data.status = restoreStatus;
    }
    data.updated = timestamp.slice(0, 10);
    writeJsonFile(manifest, data);
    const comments = path.join(planPath, '12-comments.md');
    if (fs.existsSync(comments)) fs.appendFileSync(comments, `\n## ${timestamp} — ${blocked ? 'Blocked' : 'Unblocked'} by ${actor}\n\nReason: ${reason}\n`, 'utf8');
    return [previous, { status: data.status || '', block: data.block || {} }];
  }

  function appendAudit(event) {
    mkdirp(path.dirname(auditFile));
    const payload = { version: 1, timestamp: new Date().toISOString(), source: 'runtime-server', ...event };
    fs.appendFileSync(auditFile, `${JSON.stringify(payload)}\n`, 'utf8');
    return payload;
  }

  function readAudit(limit = 120) {
    if (!fs.existsSync(auditFile)) return [];
    return fs.readFileSync(auditFile, 'utf8').split(/\r?\n/).filter(Boolean).slice(-limit).map((line) => {
      try { return JSON.parse(line); } catch (_) { return { timestamp: '', action: 'unparseable', reason: line }; }
    }).reverse();
  }

  function runAutomationReconcile() {
    const helper = path.join(repoRoot, 'tooling', 'scripts', 'automation_assignments.py');
    if (!fs.existsSync(helper)) return null;
    try {
      const raw = execFileSync('python3', [helper, '--registry', assignmentsFile, '--control', controlFile, '--ui-config', path.join(runtimeDir, 'config', 'ui.json'), 'reconcile', '--projects', projectsFile, '--stale-after-minutes', '60'], { cwd: repoRoot, encoding: 'utf8', timeout: 15000 });
      return JSON.parse(raw);
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  }

  function fallbackAutomationSummary() {
    const registry = loadAssignments();
    const control = loadControl();
    const projects = readJsonFile(projectsFile, { version: 1, projects: [] }).projects || [];
    const now = Date.now();
    const heldWork = [];
    for (const entry of registry.assignments || []) {
      const projectPolicy = control.projects?.[entry.projectId] || {};
      const reviewerPolicy = control.reviewers?.[`${entry.projectId}::${entry.planBasename}`] || control.reviewers?.[entry.projectId] || {};
      const leaseTime = entry.leaseExpiresAt ? Date.parse(entry.leaseExpiresAt) : 0;
      if (projectPolicy.paused) heldWork.push({ ...entry, holdReason: 'project_paused', holdLabel: 'Held: project paused by user', recommendedAction: 'unpause_project' });
      else if (entry.role === 'reviewer-agent' && reviewerPolicy.stopped) heldWork.push({ ...entry, holdReason: 'reviewer_stopped', holdLabel: 'Held: reviewer stopped by user', recommendedAction: 'resume_reviewer' });
      else if (entry.state === 'running') heldWork.push({ ...entry, holdReason: 'active_assignment_exists', holdLabel: 'Held: active assignment already exists', recommendedAction: 'nudge_active_agent' });
      else if (leaseTime && leaseTime < now && !entry.completedAt) heldWork.push({ ...entry, holdReason: 'stale_assignment_cleanup', holdLabel: 'Held: stale assignment needs cleanup or recovery', recommendedAction: 'recover_or_resume_assignment' });
    }
    return { ok: true, generatedAt: new Date().toISOString(), projects, eligibleWork: [], unassignedWork: [], heldWork, blockedWork: [], priorityUserReplyWork: [], projectAgentQueue: [], leaseMismatches: [], movedPlanRepairs: [], pausedIgnoredWork: [], conflictWork: { explicit: [], suggested: [] }, reviewReadinessFailures: [], heartbeatNotifications: [], activeAssignments: (registry.assignments || []).filter((entry) => entry.state === 'running'), staleAssignments: [], expiredAssignments: [], nonEligibleWork: [], controlPolicy: control, fallback: true };
  }

  function automationSummary() {
    const reconcile = runAutomationReconcile();
    const summary = reconcile && reconcile.ok !== false ? reconcile : fallbackAutomationSummary();
    summary.registryResolution = registryResolution;
    summary.auditEvents = readAudit();
    summary.assignments = loadAssignments().assignments || [];
    if (reconcile && reconcile.ok === false) summary.reconcileError = reconcile.error;
    return summary;
  }

  function mutateAutomationAction(payload = {}) {
    const action = String(payload.action || '');
    const actor = String(payload.actor || 'operator');
    const reason = String(payload.reason || 'No reason recorded.');
    const projectId = String(payload.projectId || '');
    const reviewerKey = String(payload.reviewerKey || projectId);
    if (!action) throw new Error('Automation action is required.');
    const control = loadControl();
    control.projects = control.projects || {};
    control.reviewers = control.reviewers || {};
    control.threadLinks = control.threadLinks || {};
    control.conflicts = control.conflicts || {};
    let previousState = {};
    let nextState = {};
    if (['pause-project', 'unpause-project'].includes(action)) {
      previousState = { ...(control.projects?.[projectId] || {}) };
      nextState = { ...previousState, paused: action === 'pause-project', reason, updatedAt: new Date().toISOString(), updatedBy: actor };
      control.projects = { ...(control.projects || {}), [projectId]: nextState };
      saveControl(control);
    } else if (['stop-reviewer', 'resume-reviewer'].includes(action)) {
      previousState = { ...(control.reviewers?.[reviewerKey] || {}) };
      nextState = { ...previousState, stopped: action === 'stop-reviewer', reason, updatedAt: new Date().toISOString(), updatedBy: actor };
      control.reviewers = { ...(control.reviewers || {}), [reviewerKey]: nextState };
      saveControl(control);
    } else if (['release-assignment', 'cancel-assignment', 'reclaim-orphan', 'nudge-agent'].includes(action)) {
      const registry = loadAssignments();
      const assignment = (registry.assignments || []).find((entry) => entry.id === payload.assignmentId);
      if (!assignment && action !== 'nudge-agent') throw new Error(`Assignment not found: ${payload.assignmentId}`);
      previousState = assignment ? { ...assignment } : {};
      if (!assignment && action === 'nudge-agent') {
        nextState = { nudged: true, projectId, planPath: String(payload.planPath || ''), reason };
      } else if (action !== 'nudge-agent') {
        const timestamp = new Date().toISOString();
        assignment.state = action === 'cancel-assignment' ? 'cancelled' : 'released';
        assignment.completedAt = timestamp;
        assignment.lastHeartbeatAt = timestamp;
        assignment.leaseExpiresAt = timestamp;
        assignment.notes = reason;
        if (action === 'reclaim-orphan') {
          assignment.reclaimedAt = timestamp;
          assignment.reclaimSemantics = 'released_for_reclaim';
        } else {
          delete assignment.reclaimedAt;
          delete assignment.reclaimSemantics;
        }
        saveAssignments(registry);
        nextState = { ...assignment };
      } else {
        nextState = { ...assignment, nudged: true };
      }
    } else if (['block-plan', 'unblock-plan'].includes(action)) {
      [previousState, nextState] = setPlanBlockState(path.resolve(String(payload.planPath || '')), { blocked: action === 'block-plan', reason, actor, timestamp: new Date().toISOString() });
    } else if (['mark-conflict', 'clear-conflict'].includes(action)) {
      const conflictKey = String(payload.conflictKey || payload.assignmentId || crypto.createHash('sha1').update(`${projectId}\0${payload.planPath || ''}`).digest('hex').slice(0, 20));
      previousState = { ...(control.conflicts?.[conflictKey] || {}) };
      nextState = { ...previousState, projectId, planPaths: [String(payload.planPath || '')], reason, cleared: action === 'clear-conflict', updatedAt: new Date().toISOString(), updatedBy: actor };
      control.conflicts = { ...(control.conflicts || {}), [conflictKey]: nextState };
      saveControl(control);
    } else if (action === 'repair-moved-plan') {
      const registry = loadAssignments();
      const assignment = (registry.assignments || []).find((entry) => entry.id === payload.assignmentId);
      if (!assignment) throw new Error(`Assignment not found: ${payload.assignmentId}`);
      const currentPath = path.resolve(String(payload.currentPlanPath || payload.planPath || ''));
      if (!fs.existsSync(currentPath)) throw new Error(`Current plan path not found: ${currentPath}`);
      previousState = { ...assignment };
      assignment.planPath = currentPath;
      assignment.planBasename = path.basename(currentPath);
      assignment.lastHeartbeatAt = new Date().toISOString();
      assignment.notes = reason;
      saveAssignments(registry);
      nextState = { ...assignment };
    } else {
      throw new Error(`Unsupported automation action: ${action}`);
    }
    const auditEvent = appendAudit({ actor, action, projectId, role: payload.role || '', planPath: payload.planPath || '', assignmentId: payload.assignmentId || '', previousState, nextState, reason });
    return { ok: true, auditEvent, summary: automationSummary() };
  }

  async function handleApi(req, res, pathname) {
    try {
      const payload = await readRequestJson(req);
      if (pathname === '/api/system/select-directory') {
        if (payload && payload.dryRun) return sendJson(res, 200, { ok: true, available: typeof selectDirectory === 'function' });
        if (typeof selectDirectory !== 'function') throw new Error('Native folder picker is unavailable in this Electron runtime.');
        const selected = await selectDirectory();
        if (!selected) return sendJson(res, 409, { ok: false, error: 'Folder selection cancelled.' });
        return sendJson(res, 200, { ok: true, path: selected, name: path.basename(selected) });
      }
      if (pathname === '/api/automation/summary') {
        return sendJson(res, 200, automationSummary());
      }
      if (pathname === '/api/automation/action') {
        return sendJson(res, 200, mutateAutomationAction(payload));
      }
      if (pathname === '/api/projects/scan') {
        const root = projectRoot(payload);
        const project = payload.project && typeof payload.project === 'object' ? payload.project : {};
        const settings = payload.settings && typeof payload.settings === 'object' ? payload.settings : {};
        let setup = classifyProjectSetup(root);
        let found = setup.state === 'healthy' ? { taskRoot: safeResolve(root, 'docs/tasks'), taskRootPath: 'docs/tasks' } : null;
        if (!found) {
          const legacy = findTaskRoot(root, settings, String(project.explicitTaskPath || ''));
          if (legacy && legacy.taskRootPath.toLowerCase() !== 'docs/tasks') {
            found = legacy;
            setup = { ...setup, state: 'healthy', contract: 'compatible-legacy', missing: [], conflicts: [] };
          }
        }
        if (!found) return sendJson(res, 200, { ok: true, taskRootPath: 'docs/tasks', files: [], setup });
        let files = walkTextFiles(root, found.taskRoot, found.taskRootPath, 6);
        const observations = path.join(path.dirname(found.taskRoot), 'agent-observations');
        if (fs.existsSync(observations) && fs.statSync(observations).isDirectory()) {
          files = files.concat(walkTextFiles(root, observations, found.taskRootPath, 4));
        }
        return sendJson(res, 200, { ok: true, taskRootPath: found.taskRootPath, files, setup: { ...setup, state: 'healthy', contract: setup.contract || 'agent-workflow-kits-v1' } });
      }
      if (pathname === '/api/projects/bootstrap') {
        const result = bootstrapProject(projectRoot(payload), payload);
        return sendJson(res, result.status, result.payload);
      }
      if (pathname === '/api/files/read') {
        const root = projectRoot(payload);
        const file = safeResolve(root, payload.path || '');
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`File not found: ${payload.path}`);
        return sendJson(res, 200, { ok: true, file: fileRecord(root, file, String(payload.taskRootPath || '')) });
      }
      if (pathname === '/api/files/text') {
        const root = projectRoot(payload);
        const file = safeResolve(root, payload.path || '');
        const expectedHash = String(payload.expectedHash || '');
        if (fs.existsSync(file) && expectedHash) {
          const current = fs.readFileSync(file, 'utf8');
          if (hashText(current) !== expectedHash) return sendJson(res, 409, { ok: false, error: 'The file changed after the last scan. Rescan before writing.' });
        }
        mkdirp(path.dirname(file));
        const text = String(payload.text || '');
        fs.writeFileSync(file, text, 'utf8');
        if (fs.readFileSync(file, 'utf8') !== text) throw new Error('Write verification failed: saved content differs from requested content.');
        return sendJson(res, 200, { ok: true, file: fileRecord(root, file, String(payload.taskRootPath || '')) });
      }
      if (pathname === '/api/files/copy-verify-delete') {
        const root = projectRoot(payload);
        const source = safeResolve(root, payload.sourcePath || '');
        const destination = safeResolve(root, payload.destinationPath || '');
        if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`Source plan does not exist: ${payload.sourcePath}`);
        const sourceText = fs.readFileSync(source, 'utf8');
        const sourceHash = hashText(sourceText);
        if (payload.expectedSourceHash && sourceHash !== String(payload.expectedSourceHash)) {
          return sendJson(res, 409, { ok: false, error: 'The source plan changed after the last scan. Rescan before changing its lifecycle.' });
        }
        if (fs.existsSync(destination)) throw new Error(`Destination plan already exists: ${payload.destinationPath}`);
        mkdirp(path.dirname(destination));
        const destinationText = String(payload.destinationText || '');
        fs.writeFileSync(destination, destinationText, 'utf8');
        if (fs.readFileSync(destination, 'utf8') !== destinationText) throw new Error('Destination verification failed.');
        fs.unlinkSync(source);
        if (fs.existsSync(source)) throw new Error(`Source file still exists after deletion: ${payload.sourcePath}`);
        return sendJson(res, 200, { ok: true, sourceHash, file: fileRecord(root, destination, String(payload.taskRootPath || '')) });
      }
      if (pathname === '/api/folders/copy-verify-delete') {
        const root = projectRoot(payload);
        const source = safeResolve(root, payload.sourcePath || '');
        const destination = safeResolve(root, payload.destinationPath || '');
        const taskRootPath = String(payload.taskRootPath || '');
        if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new Error(`Source plan folder does not exist: ${payload.sourcePath}`);
        const sourceManifest = path.join(source, 'plan.json');
        if (!fs.existsSync(sourceManifest) || !fs.statSync(sourceManifest).isFile()) throw new Error(`Source plan folder is missing plan.json: ${payload.sourcePath}`);
        const sourceManifestText = fs.readFileSync(sourceManifest, 'utf8');
        const sourceManifestHash = hashText(sourceManifestText);
        if (payload.expectedManifestHash && sourceManifestHash !== String(payload.expectedManifestHash)) {
          return sendJson(res, 409, { ok: false, error: 'The source plan manifest changed after the last scan. Rescan before changing its lifecycle.' });
        }
        if (fs.existsSync(destination)) throw new Error(`Destination plan folder already exists: ${payload.destinationPath}`);
        mkdirp(path.dirname(destination));
        fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
        const updates = payload.updates && typeof payload.updates === 'object' && !Array.isArray(payload.updates) ? payload.updates : {};
        const updatedFiles = [];
        for (const [relative, textValue] of Object.entries(updates)) {
          const rel = normalizeSlash(relative);
          if (!rel) continue;
          const target = path.resolve(destination, rel);
          const back = path.relative(destination, target);
          if (back.startsWith('..') || path.isAbsolute(back)) throw new Error(`Folder update escapes destination: ${relative}`);
          mkdirp(path.dirname(target));
          const text = String(textValue);
          fs.writeFileSync(target, text, 'utf8');
          if (fs.readFileSync(target, 'utf8') !== text) throw new Error(`Folder update verification failed: ${relative}`);
          updatedFiles.push(fileRecord(root, target, taskRootPath));
        }
        const destinationManifest = path.join(destination, 'plan.json');
        if (!fs.existsSync(destinationManifest) || !fs.statSync(destinationManifest).isFile()) throw new Error('Destination plan folder verification failed: plan.json missing.');
        fs.rmSync(source, { recursive: true, force: false });
        if (fs.existsSync(source)) throw new Error(`Source folder still exists after deletion: ${payload.sourcePath}`);
        return sendJson(res, 200, {
          ok: true,
          folderPath: normalizeSlash(path.relative(root, destination)),
          sourceManifestHash,
          manifest: fileRecord(root, destinationManifest, taskRootPath),
          updatedFiles,
        });
      }
      return sendJson(res, 404, { ok: false, error: 'Runtime API not found' });
    } catch (error) {
      const status = String(error.message || '').toLowerCase().includes('cancelled') ? 409 : 400;
      return sendJson(res, status, { ok: false, error: error.message || String(error) });
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${host}`);
    const pathname = decodeURIComponent(url.pathname);
    try {
      if (req.method === 'HEAD') {
        const configFile = runtimeConfigFile(pathname);
        if (configFile) {
          if (!fs.existsSync(configFile)) writeJsonFile(configFile, pathname.endsWith('/projects.json') ? { version: 1, projects: [] } : {});
          return send(res, 200, '', { 'Content-Type': 'application/json; charset=utf-8', ...registryHeaders() });
        }
      }
      if (req.method === 'GET') {
        if (pathname === '/api/automation/summary') return sendJson(res, 200, automationSummary());
        const configFile = runtimeConfigFile(pathname);
        if (configFile) {
          if (!fs.existsSync(configFile)) writeJsonFile(configFile, pathname.endsWith('/projects.json') ? { version: 1, projects: [] } : {});
          return send(res, 200, fs.readFileSync(configFile), { 'Content-Type': 'application/json; charset=utf-8', ...registryHeaders() });
        }
      }
      if (req.method === 'PUT') {
        const configFile = runtimeConfigFile(pathname);
        if (configFile) {
          const payload = await readRequestJson(req);
          if (typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Runtime config file must be a JSON object');
          if (pathname.endsWith('/projects.json') && !Array.isArray(payload.projects)) throw new Error('projects.json must be an object with a projects array');
          writeJsonFile(configFile, payload);
          return sendJson(res, 200, { ok: true, path: pathname.replace(/^\//, ''), registryResolution });
        }
      }
      if ((req.method === 'POST' || req.method === 'PUT') && (pathname.startsWith('/api/') || pathname === '/api/files/text')) {
        return handleApi(req, res, pathname);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 404, { ok: false, error: 'Not found' });
      const requested = pathname === '/' ? '/index.html' : pathname;
      const staticPath = safeResolve(staticDir, requested);
      const filePath = fs.existsSync(staticPath) && fs.statSync(staticPath).isFile() ? staticPath : path.join(staticDir, 'index.html');
      const ext = path.extname(filePath).toLowerCase();
      const body = req.method === 'HEAD' ? '' : fs.readFileSync(filePath);
      return send(res, 200, body, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error.message || String(error) });
    }
  });

  return {
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          const address = server.address();
          resolve({ server, host, port: address.port, url: `http://${host}:${address.port}/` });
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { createRuntimeServer, classifyProjectSetup, bootstrapProject };
