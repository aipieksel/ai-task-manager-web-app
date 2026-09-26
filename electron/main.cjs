const { app, BrowserWindow, dialog, shell, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { createRuntimeServer } = require('./runtime-server.cjs');
const { resolveRuntimeRegistry } = require('./registry-resolver.cjs');

let mainWindow;
let runtime;

app.setName('Agentic AI Projects Task Manager');

if (process.platform === 'darwin') {
  app.setActivationPolicy('regular');
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

function repoRoot() {
  return path.resolve(__dirname, '..');
}

function staticDirectory() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'dist'), path.join(app.getAppPath(), 'dist')]
    : [path.join(repoRoot(), 'dist'), path.join(repoRoot(), 'src', 'taskmanager')];
  const found = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'index.html')));
  if (!found) throw new Error(`Missing Agentic AI Projects Task Manager static build. Checked: ${candidates.join(', ')}`);
  return found;
}

function registryResolution() {
  return resolveRuntimeRegistry({ app, repoRoot: repoRoot() });
}

function runtimeDirectory() {
  return registryResolution().runtimeDir;
}

function ensurePackagedRuntimeSeed(runtimeDir) {
  const projectsFile = path.join(runtimeDir, 'projects.json');
  if (fs.existsSync(projectsFile)) return;
  fs.mkdirSync(runtimeDir, { recursive: true });
  const bundled = path.join(process.resourcesPath, 'data', 'runtime', 'projects.json');
  if (app.isPackaged && fs.existsSync(bundled)) {
    fs.copyFileSync(bundled, projectsFile);
  } else {
    fs.writeFileSync(projectsFile, `${JSON.stringify({ version: 1, projects: [] }, null, 2)}\n`, 'utf8');
  }
}

async function startRuntime() {
  const resolution = registryResolution();
  const runtimeDir = resolution.runtimeDir;
  ensurePackagedRuntimeSeed(runtimeDir);
  const port = Number(process.env.AGENTIC_TASK_MANAGER_ELECTRON_PORT || 0);
  runtime = createRuntimeServer({
    staticDir: staticDirectory(),
    runtimeDir,
    repoRoot: repoRoot(),
    registryResolution: resolution,
    host: '127.0.0.1',
    port,
    selectDirectory: async () => {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select an Agentic AI Projects Task Manager project folder',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths.length) return '';
      return result.filePaths[0];
    },
  });
  return runtime.listen();
}

function installMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Reload Task Manager', accelerator: 'CommandOrControl+R', click: () => mainWindow?.reload() },
        { label: 'Open Runtime Data Folder', click: () => shell.openPath(runtimeDirectory()) },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload Task Manager', accelerator: 'CommandOrControl+R', click: () => mainWindow?.reload() },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  const runtimeInfo = await startRuntime();
  installMenu();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    title: 'Agentic AI Projects Task Manager',
    backgroundColor: '#f6f6f4',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const template = [];
    if (params.selectionText) template.push({ role: 'copy', label: 'Copy' });
    if (params.isEditable) {
      template.push(
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
        { type: 'separator' },
        { role: 'selectAll', label: 'Select All' },
      );
    }
    if (!template.length) {
      template.push(
        { role: 'copy', label: 'Copy', enabled: Boolean(params.selectionText) },
        { type: 'separator' },
        { label: 'Reload Task Manager', click: () => mainWindow?.reload() },
      );
    }
    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });
  await mainWindow.loadURL(`${runtimeInfo.url}#/`);
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    if (process.platform === 'darwin') {
      app.dock.show();
    }
    await createWindow();
  }).catch((error) => {
    dialog.showErrorBox('Agentic AI Projects Task Manager failed to start', error.stack || error.message || String(error));
    app.quit();
  });
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (runtime) runtime.close().catch(() => {});
});
