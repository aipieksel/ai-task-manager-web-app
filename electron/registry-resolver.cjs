const fs = require('fs');
const os = require('os');
const path = require('path');

const PUBLIC_APP_SUPPORT_NAME = 'Agentic AI Projects Task Manager';

function envPath(name) {
  return process.env[name] ? path.resolve(process.env[name]) : '';
}

function publicUserDataDir(app) {
  if (app && typeof app.getPath === 'function') return path.resolve(app.getPath('userData'));
  return path.join(os.homedir(), 'Library', 'Application Support', PUBLIC_APP_SUPPORT_NAME);
}

function writeEmptyRegistry(file) {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, projects: [] }, null, 2)}\n`, 'utf8');
}

function resolveRuntimeRegistry({ app, repoRoot, explicitProjectsFile = '', explicitRuntimeDir = '' } = {}) {
  const baseRoot = repoRoot || path.resolve(__dirname, '..');
  const repoPath = path.join(baseRoot, 'src', 'taskmanager', 'data', 'runtime', 'projects.json');
  const appSupportPath = path.join(publicUserDataDir(app), 'data', 'runtime', 'projects.json');

  let activePath;
  let source;
  if (explicitProjectsFile || process.env.TASKMANAGER_PROJECTS_FILE) {
    activePath = path.resolve(explicitProjectsFile || process.env.TASKMANAGER_PROJECTS_FILE);
    source = explicitProjectsFile ? 'explicit' : 'env:TASKMANAGER_PROJECTS_FILE';
  } else if (explicitRuntimeDir || process.env.TASKMANAGER_RUNTIME_DIR) {
    activePath = path.join(path.resolve(explicitRuntimeDir || process.env.TASKMANAGER_RUNTIME_DIR), 'projects.json');
    source = explicitRuntimeDir ? 'explicit-runtime-dir' : 'env:TASKMANAGER_RUNTIME_DIR';
  } else if (process.env.AGENTIC_TASK_MANAGER_USE_REPO_DATA === '1') {
    activePath = repoPath;
    source = 'env:AGENTIC_TASK_MANAGER_USE_REPO_DATA';
  } else {
    activePath = appSupportPath;
    source = 'public-app-support';
  }

  writeEmptyRegistry(activePath);
  return {
    activePath,
    runtimeDir: path.dirname(activePath),
    source,
    repoPath,
    appSupportPath,
  };
}

module.exports = { PUBLIC_APP_SUPPORT_NAME, resolveRuntimeRegistry };
