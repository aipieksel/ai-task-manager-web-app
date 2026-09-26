import { normalizePath, stableId, uniqueStrings } from '../lib/utils.js';

const CONFIG_CANDIDATES = [
  './data/runtime/projects.json',
];

const UI_CONFIG_CANDIDATES = [
  './data/runtime/config/ui.json',
];

const DEFAULT_QUEUE_CUSTOM_ORDER = Object.freeze({
  enabledScopes: {},
  orders: {},
});

const DEFAULT_RUNTIME_UI_CONFIG = Object.freeze({
  version: 1,
  settings: {},
  routes: {
    queue: { customOrder: DEFAULT_QUEUE_CUSTOM_ORDER },
    tasks: {},
  },
});

function normalizeProjectConfig(rawProject = {}, sourceUrl = '') {
  const name = String(rawProject.name || rawProject.id || rawProject.rootLabel || rawProject.rootPath || '').trim();
  const rootLabel = String(rawProject.rootLabel || rawProject.rootPath || rawProject.path || rawProject.directory || '').trim();
  const explicitTaskPath = normalizePath(rawProject.explicitTaskPath || rawProject.taskRootPath || rawProject.taskRoot || '');
  const autoApprovePending = rawProject.autoApprovePending === true || ['1', 'true', 'yes', 'on', 'enabled'].includes(String(rawProject.autoApprovePending || '').trim().toLowerCase());
  const includeInAllQueue = rawProject.includeInAllQueue === false || ['0', 'false', 'no', 'off', 'disabled'].includes(String(rawProject.includeInAllQueue || '').trim().toLowerCase())
    ? false
    : !rawProject.excludeFromAllQueue;
  const id = normalizePath(rawProject.id || stableId('runtime-project', name, rootLabel, explicitTaskPath));
  if (!id || !name) return null;
  return {
    id,
    name,
    rootHandle: null,
    rootLabel: rootLabel || name,
    explicitTaskPath,
    taskRootPath: '',
    connectedAt: null,
    lastScanAt: null,
    status: 'configured',
    permission: 'server',
    error: '',
    autoApprovePending,
    includeInAllQueue,
    configBacked: true,
    serverBacked: true,
    configSource: sourceUrl,
  };
}

function normalizeConfig(payload, sourceUrl, diagnostics = {}) {
  const rawProjects = Array.isArray(payload) ? payload : Array.isArray(payload?.projects) ? payload.projects : [];
  const projects = rawProjects
    .map((project) => normalizeProjectConfig(project, sourceUrl))
    .filter(Boolean);
  const seen = new Set();
  return {
    sourceUrl,
    registryPath: diagnostics.registryPath || '',
    registrySource: diagnostics.registrySource || '',
    projects: projects.filter((project) => {
      const key = project.id.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

function responseRegistryDiagnostics(response) {
  return {
    registryPath: response.headers.get('X-TaskManager-Runtime-Config-Path') || '',
    registrySource: response.headers.get('X-TaskManager-Runtime-Config-Source') || '',
  };
}

function uniqueOrderKeys(values = []) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter((value) => value && !seen.has(value) && seen.add(value));
}

function isProjectCustomOrderScope(scope = '') {
  return /^project:[^\s:]+/.test(String(scope || '').trim());
}

function normalizeQueueCustomOrder(raw = {}) {
  const enabledScopes = {};
  Object.entries(raw.enabledScopes || {}).forEach(([scope, enabled]) => {
    const key = String(scope || '').trim();
    if (isProjectCustomOrderScope(key)) enabledScopes[key] = Boolean(enabled);
  });
  const orders = {};
  Object.entries(raw.orders || {}).forEach(([scope, order]) => {
    const key = String(scope || '').trim();
    if (isProjectCustomOrderScope(key)) orders[key] = uniqueOrderKeys(order);
  });
  return { enabledScopes, orders };
}

function normalizeSortPreference(raw = {}, routeKey = '') {
  const sort = ['created', 'modified'].includes(raw.sort) ? raw.sort : '';
  const dir = raw.dir === 'asc' ? 'asc' : raw.dir === 'desc' ? 'desc' : '';
  return {
    ...(sort ? { sort } : {}),
    ...(dir ? { dir } : {}),
    ...(routeKey === 'queue' ? { customOrder: normalizeQueueCustomOrder(raw.customOrder || {}) } : {}),
  };
}

function normalizeRuntimeUiConfig(payload = {}, sourceUrl = '') {
  const routes = payload.routes && typeof payload.routes === 'object' ? payload.routes : {};
  const settings = payload.settings && typeof payload.settings === 'object' ? payload.settings : {};
  return {
    sourceUrl,
    config: {
      version: 1,
      settings: { ...settings },
      routes: {
        queue: normalizeSortPreference(routes.queue || {}, 'queue'),
        tasks: normalizeSortPreference(routes.tasks || {}, 'tasks'),
      },
    },
  };
}

export function serializeRuntimeUiConfig(config = DEFAULT_RUNTIME_UI_CONFIG) {
  return {
    version: 1,
    settings: { ...(config.settings || {}) },
    routes: {
      queue: normalizeSortPreference(config.routes?.queue || {}, 'queue'),
      tasks: normalizeSortPreference(config.routes?.tasks || {}, 'tasks'),
    },
  };
}

export function serializeRuntimeProjectConfig(projects = []) {
  return {
    version: 1,
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      rootLabel: project.rootLabel || project.rootHandle?.name || project.name,
      explicitTaskPath: normalizePath(project.explicitTaskPath || project.taskRootPath || ''),
      autoApprovePending: Boolean(project.autoApprovePending),
      includeInAllQueue: project.includeInAllQueue !== false,
    })),
  };
}

function projectKey(project = {}) {
  return normalizePath(project.id || stableId('runtime-project', project.name, project.rootLabel || project.rootPath || '', project.explicitTaskPath || '')).toLowerCase();
}

async function loadExistingRuntimeProjects(url = '') {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return [];
    return normalizeConfig(await response.json(), url, responseRegistryDiagnostics(response)).projects;
  } catch (_) {
    return [];
  }
}

async function mergedRuntimeProjects(projects = [], url = '', { preserveExisting = false, removeIds = [] } = {}) {
  if (!preserveExisting && !removeIds.length) return projects;
  const removed = new Set(removeIds.map((id) => normalizePath(id).toLowerCase()).filter(Boolean));
  const merged = new Map();
  for (const project of await loadExistingRuntimeProjects(url)) {
    const key = projectKey(project);
    if (key && !removed.has(key)) merged.set(key, project);
  }
  for (const project of projects) {
    const key = projectKey(project);
    if (key && !removed.has(key)) merged.set(key, project);
  }
  return [...merged.values()];
}

export async function loadRuntimeProjectConfig() {
  if (!window.fetch || location.protocol === 'file:') return { sourceUrl: '', projects: [] };
  if ('onLine' in navigator && !navigator.onLine) return { sourceUrl: '', projects: [] };
  const candidates = uniqueStrings(CONFIG_CANDIDATES.map((candidate) => new URL(candidate, location.href).href));
  for (const url of candidates) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.status === 404) continue;
      if (!response.ok) continue;
      return normalizeConfig(await response.json(), url, responseRegistryDiagnostics(response));
    } catch (_) {
      continue;
    }
  }
  return { sourceUrl: '', projects: [] };
}

export async function saveRuntimeProjectConfig(projects = [], sourceUrl = '', options = {}) {
  if (!window.fetch || location.protocol === 'file:') {
    throw new Error('Runtime project config writes require an HTTP server.');
  }
  const url = sourceUrl || new URL(CONFIG_CANDIDATES[0], location.href).href;
  const probe = await fetch(url, { method: 'HEAD', cache: 'no-store' });
  if (probe.headers.get('X-TaskManager-Runtime-Config-Write') !== '1') {
    throw new Error('The current server cannot write data/runtime/projects.json. Use tooling/scripts/serve-runtime.py.');
  }
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(serializeRuntimeProjectConfig(await mergedRuntimeProjects(projects, url, options)), null, 2) + '\n',
  });
  if (!response.ok) {
    throw new Error(`Runtime project config write failed: HTTP ${response.status}`);
  }
  const payload = await response.json().catch(() => ({ ok: true }));
  return {
    ...payload,
    registryPath: payload.registryResolution?.activePath || probe.headers.get('X-TaskManager-Runtime-Config-Path') || '',
    registrySource: payload.registryResolution?.source || probe.headers.get('X-TaskManager-Runtime-Config-Source') || '',
  };
}


export async function loadRuntimeUiConfig() {
  if (!window.fetch || location.protocol === 'file:') return normalizeRuntimeUiConfig(DEFAULT_RUNTIME_UI_CONFIG, '');
  if ('onLine' in navigator && !navigator.onLine) return normalizeRuntimeUiConfig(DEFAULT_RUNTIME_UI_CONFIG, '');
  const candidates = uniqueStrings(UI_CONFIG_CANDIDATES.map((candidate) => new URL(candidate, location.href).href));
  for (const url of candidates) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.status === 404) continue;
      if (!response.ok) continue;
      return normalizeRuntimeUiConfig(await response.json(), url);
    } catch (_) {
      continue;
    }
  }
  return normalizeRuntimeUiConfig(DEFAULT_RUNTIME_UI_CONFIG, new URL(UI_CONFIG_CANDIDATES[0], location.href).href);
}

export async function saveRuntimeUiConfig(config = DEFAULT_RUNTIME_UI_CONFIG, sourceUrl = '') {
  if (!window.fetch || location.protocol === 'file:') {
    throw new Error('Runtime UI config writes require an HTTP server.');
  }
  const url = sourceUrl || new URL(UI_CONFIG_CANDIDATES[0], location.href).href;
  const probe = await fetch(url, { method: 'HEAD', cache: 'no-store' });
  if (probe.headers.get('X-TaskManager-Runtime-Config-Write') !== '1') {
    throw new Error('The current server cannot write data/runtime/config/ui.json. Use tooling/scripts/serve-runtime.py.');
  }
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(serializeRuntimeUiConfig(config), null, 2) + '\n',
  });
  if (!response.ok) {
    throw new Error(`Runtime UI config write failed: HTTP ${response.status}`);
  }
  return response.json().catch(() => ({ ok: true }));
}
