import { loadRuntimeProjectConfig, loadRuntimeUiConfig, saveRuntimeProjectConfig, saveRuntimeUiConfig } from './runtime-config.js';
import { stableId, uniqueStrings } from '../lib/utils.js';

export const DEFAULT_SETTINGS = Object.freeze({
  documentationFolderNames: ['docs', 'documentation'],
  taskFolderNames: ['tasks', 'task'],
  autoScan: true,
  scanIntervalMs: 30000,
  requestWriteAccess: true,
  confirmLifecycleWrites: true,
});

const DEFAULT_QUEUE_CUSTOM_ORDER = Object.freeze({
  enabledScopes: {},
  orders: {},
});

const DEFAULT_UI_CONFIG = Object.freeze({
  version: 1,
  settings: {},
  routes: { queue: { customOrder: DEFAULT_QUEUE_CUSTOM_ORDER }, tasks: {} },
});

const state = {
  ready: false,
  busy: false,
  projects: [],
  projectData: new Map(),
  activity: [],
  settings: { ...DEFAULT_SETTINGS },
  uiConfig: { ...DEFAULT_UI_CONFIG, routes: { queue: {}, tasks: {} } },
  selectedProjectId: 'all',
  selectedTaskId: null,
  selectedQueueTaskId: null,
  selectedQuestionId: null,
  lastError: null,
  runtimeConfigSource: '',
  runtimeConfigPath: '',
  runtimeConfigRegistrySource: '',
  runtimeConfigWriteError: '',
  runtimeUiConfigSource: '',
  runtimeUiConfigWriteError: '',
  recentFileChanges: [],
  automationSummary: null,
  automationSummaryStatus: "idle",
  automationSummaryError: "",
};

const listeners = new Set();

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit() {
  listeners.forEach((listener) => listener(state));
}

export function patchState(patch) {
  Object.assign(state, patch);
  emit();
}

function normalizeFileChange(change = {}) {
  const path = String(change.path || '').trim();
  if (!path) return null;
  return {
    projectId: String(change.projectId || ''),
    projectName: String(change.projectName || ''),
    path,
    kind: String(change.kind || 'modified'),
    lastModified: Number(change.lastModified || 0),
  };
}

export function setRecentFileChanges(changes = []) {
  state.recentFileChanges = (Array.isArray(changes) ? changes : []).map(normalizeFileChange).filter(Boolean);
  emit();
}

export function setAutomationSummary(summary, status = "ready", error = "") {
  state.automationSummary = summary || null;
  state.automationSummaryStatus = status;
  state.automationSummaryError = error || "";
  emit();
}

export function setAutomationSummaryLoading() {
  state.automationSummaryStatus = "loading";
  state.automationSummaryError = "";
  emit();
}

function runtimeProjects(runtimeConfig = { projects: [] }) {
  return (runtimeConfig.projects || []).map((project) => ({
    ...project,
    rootHandle: null,
    serverBacked: true,
    permission: 'server',
    status: project.status === 'restore-access' ? 'configured' : (project.status || 'configured'),
    error: '',
  }));
}

export async function hydrateState() {
  const [runtimeConfig, runtimeUiConfig] = await Promise.all([
    loadRuntimeProjectConfig().catch(() => ({ sourceUrl: '', projects: [] })),
    loadRuntimeUiConfig().catch(() => ({ sourceUrl: '', config: { ...DEFAULT_UI_CONFIG, routes: { queue: {}, tasks: {} } } })),
  ]);
  state.uiConfig = normalizeUiConfig(runtimeUiConfig.config);
  state.settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...(state.uiConfig.settings || {}) });
  state.projects = runtimeProjects(runtimeConfig);
  state.activity = [];
  state.runtimeConfigSource = runtimeConfig.sourceUrl || '';
  state.runtimeConfigPath = runtimeConfig.registryPath || '';
  state.runtimeConfigRegistrySource = runtimeConfig.registrySource || '';
  state.runtimeUiConfigSource = runtimeUiConfig.sourceUrl || '';
  state.ready = true;
  emit();
}

export function normalizeSettings(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    documentationFolderNames: uniqueStrings(settings.documentationFolderNames || DEFAULT_SETTINGS.documentationFolderNames),
    taskFolderNames: uniqueStrings(settings.taskFolderNames || DEFAULT_SETTINGS.taskFolderNames),
    scanIntervalMs: Math.max(5000, Number(settings.scanIntervalMs) || DEFAULT_SETTINGS.scanIntervalMs),
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

function normalizeRoutePreference(preference = {}, routeKey = '') {
  const sort = ['created', 'modified'].includes(preference.sort) ? preference.sort : '';
  const dir = preference.dir === 'asc' ? 'asc' : preference.dir === 'desc' ? 'desc' : '';
  return {
    ...(sort ? { sort } : {}),
    ...(dir ? { dir } : {}),
    ...(routeKey === 'queue' ? { customOrder: normalizeQueueCustomOrder(preference.customOrder || {}) } : {}),
  };
}

function normalizeUiConfig(config = DEFAULT_UI_CONFIG) {
  return {
    version: 1,
    settings: { ...(config.settings || {}) },
    routes: {
      queue: normalizeRoutePreference(config.routes?.queue || {}, 'queue'),
      tasks: normalizeRoutePreference(config.routes?.tasks || {}, 'tasks'),
    },
  };
}

async function saveUiConfig() {
  try {
    await saveRuntimeUiConfig(state.uiConfig, state.runtimeUiConfigSource);
    state.runtimeUiConfigWriteError = '';
    return true;
  } catch (error) {
    state.runtimeUiConfigWriteError = error.message || String(error);
    console.warn(state.runtimeUiConfigWriteError);
    return false;
  }
}

export async function saveSettings(nextSettings) {
  state.settings = normalizeSettings(nextSettings);
  state.uiConfig = normalizeUiConfig({ ...state.uiConfig, settings: state.settings });
  await saveUiConfig();
  emit();
}

export function getRoutePreference(routeKey) {
  return normalizeRoutePreference(state.uiConfig.routes?.[routeKey] || {}, routeKey);
}

export async function saveRoutePreference(routeKey, preference = {}) {
  if (!['queue', 'tasks'].includes(routeKey)) return;
  const current = getRoutePreference(routeKey);
  const normalized = normalizeRoutePreference({ ...current, ...preference }, routeKey);
  if (current.sort === normalized.sort && current.dir === normalized.dir && JSON.stringify(current.customOrder || {}) === JSON.stringify(normalized.customOrder || {})) return;
  state.uiConfig = normalizeUiConfig({
    ...state.uiConfig,
    routes: {
      ...(state.uiConfig.routes || {}),
      [routeKey]: normalized,
    },
  });
  const persisted = await saveUiConfig();
  emit();
  return persisted;
}

export function queueCustomOrderScope(projectId = state.selectedProjectId) {
  const id = String(projectId || 'all').trim();
  return id && id !== 'all' ? `project:${id}` : '';
}

export function queueCustomOrderKey(task = {}) {
  const filename = String(task.filename || task.path || task.id || '').split('/').filter(Boolean).pop() || '';
  return `${task.projectId || ''}::${filename}`;
}

export function getQueueCustomOrdering(projectId = state.selectedProjectId) {
  const scope = queueCustomOrderScope(projectId);
  const customOrder = getRoutePreference('queue').customOrder || normalizeQueueCustomOrder();
  return {
    scope,
    enabled: Boolean(scope && customOrder.enabledScopes?.[scope]),
    order: uniqueOrderKeys(scope ? customOrder.orders?.[scope] || [] : []),
    customOrder,
  };
}

export async function setQueueCustomOrdering(projectId = state.selectedProjectId, { enabled, order = [], activeKeys = [] } = {}) {
  const scope = queueCustomOrderScope(projectId);
  if (!scope) throw new Error('Custom run order can only be enabled for a specific project. Select a project first.');
  const current = getQueueCustomOrdering(projectId).customOrder;
  const active = new Set(uniqueOrderKeys(activeKeys));
  const orderedActive = uniqueOrderKeys(order).filter((key) => !active.size || active.has(key));
  const missingActive = [...active].filter((key) => !orderedActive.includes(key));
  const nextCustomOrder = normalizeQueueCustomOrder({
    enabledScopes: {
      ...(current.enabledScopes || {}),
      [scope]: Boolean(enabled),
    },
    orders: {
      ...(current.orders || {}),
      [scope]: [...orderedActive, ...missingActive],
    },
  });
  const persisted = await saveRoutePreference('queue', { customOrder: nextCustomOrder });
  if (persisted === false) throw new Error('Custom run order could not be saved to data/runtime/config/ui.json. Start the writable runtime server or Electron app and try again.');
  return getQueueCustomOrdering(projectId);
}

export async function toggleQueueCustomOrdering(projectId = state.selectedProjectId, activeKeys = []) {
  const current = getQueueCustomOrdering(projectId);
  return setQueueCustomOrdering(projectId, { enabled: !current.enabled, order: current.order.length ? current.order : activeKeys, activeKeys });
}

export async function saveQueueCustomOrder(projectId = state.selectedProjectId, orderedKeys = [], activeKeys = []) {
  const current = getQueueCustomOrdering(projectId);
  return setQueueCustomOrdering(projectId, { enabled: current.enabled, order: orderedKeys, activeKeys });
}

export async function saveProject(project) {
  const clean = { ...project };
  const nextProjects = state.projects.slice();
  const index = nextProjects.findIndex((item) => item.id === clean.id);
  if (index >= 0) nextProjects.splice(index, 1, clean);
  else nextProjects.push(clean);
  try {
    const result = await saveRuntimeProjectConfig(nextProjects, state.runtimeConfigSource, { preserveExisting: true });
    state.projects = nextProjects;
    state.runtimeConfigPath = result.registryPath || state.runtimeConfigPath;
    state.runtimeConfigRegistrySource = result.registrySource || state.runtimeConfigRegistrySource;
    state.runtimeConfigWriteError = '';
    emit();
  } catch (error) {
    state.runtimeConfigWriteError = error.message || String(error);
    emit();
    throw error;
  }
}

export async function removeProject(id) {
  const previousProjects = state.projects;
  const nextProjects = state.projects.filter((project) => project.id !== id);
  try {
    const result = await saveRuntimeProjectConfig(nextProjects, state.runtimeConfigSource, { preserveExisting: true, removeIds: [id] });
    state.projects = nextProjects;
    state.runtimeConfigPath = result.registryPath || state.runtimeConfigPath;
    state.runtimeConfigRegistrySource = result.registrySource || state.runtimeConfigRegistrySource;
    state.projectData.delete(id);
    if (state.selectedProjectId === id) state.selectedProjectId = 'all';
    state.runtimeConfigWriteError = '';
    emit();
  } catch (error) {
    state.projects = previousProjects;
    state.runtimeConfigWriteError = error.message || String(error);
    emit();
    throw error;
  }
}

export async function toggleProjectAllInclusion(id) {
  const project = state.projects.find((item) => item.id === id);
  if (!project) return null;
  const next = { ...project, includeInAllQueue: project.includeInAllQueue === false };
  await saveProject(next);
  return next;
}

export function setProjectData(id, data) {
  state.projectData.set(id, data);
  emit();
}

export async function addActivity(entry) {
  const record = {
    id: entry.id || stableId(entry.projectId, entry.path, entry.type, Date.now(), Math.random()),
    timestamp: entry.timestamp || Date.now(),
    source: entry.source || 'taskmanager',
    level: entry.level || 'info',
    ...entry,
  };
  state.activity = [record, ...state.activity].slice(0, 500);
  emit();
  return record;
}

export async function resetState() {
  const [runtimeConfig, runtimeUiConfig] = await Promise.all([
    loadRuntimeProjectConfig().catch(() => ({ sourceUrl: '', projects: [] })),
    loadRuntimeUiConfig().catch(() => ({ sourceUrl: '', config: { ...DEFAULT_UI_CONFIG, routes: { queue: {}, tasks: {} } } })),
  ]);
  state.projects = runtimeProjects(runtimeConfig);
  state.projectData = new Map();
  state.activity = [];
  state.uiConfig = normalizeUiConfig(runtimeUiConfig.config);
  state.settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...(state.uiConfig.settings || {}) });
  state.runtimeConfigSource = runtimeConfig.sourceUrl || '';
  state.runtimeConfigPath = runtimeConfig.registryPath || '';
  state.runtimeConfigRegistrySource = runtimeConfig.registrySource || '';
  state.runtimeUiConfigSource = runtimeUiConfig.sourceUrl || '';
  state.runtimeConfigWriteError = '';
  state.runtimeUiConfigWriteError = '';
  state.selectedProjectId = 'all';
  state.selectedTaskId = null;
  state.selectedQueueTaskId = null;
  state.selectedQuestionId = null;
  state.lastError = null;
  state.recentFileChanges = [];
  emit();
}

export function selectProject(id) {
  state.selectedProjectId = id || 'all';
  emit();
}

export function selectQueueTask(id) {
  state.selectedQueueTaskId = id || null;
  emit();
}

export function selectTask(id) {
  state.selectedTaskId = id || null;
  emit();
}

export function selectQuestion(id) {
  state.selectedQuestionId = id || null;
  emit();
}

export function allProjectData() {
  return [...state.projectData.values()];
}

export function visibleProjectData() {
  if (state.selectedProjectId !== 'all') return [state.projectData.get(state.selectedProjectId)].filter(Boolean);
  const includedIds = new Set(state.projects.filter((project) => project.includeInAllQueue !== false).map((project) => project.id));
  return allProjectData().filter((data) => includedIds.has(data.project?.id));
}

export function aggregateDomain() {
  const datasets = visibleProjectData();
  return {
    tasks: datasets.flatMap((data) => data.tasks || []),
    queue: datasets.flatMap((data) => data.queue || []),
    questions: datasets.flatMap((data) => data.questions || []),
    verifications: datasets.flatMap((data) => data.verifications || []),
    lessons: datasets.flatMap((data) => data.lessons || []),
    observations: datasets.flatMap((data) => data.observations || []),
    completed: datasets.flatMap((data) => data.completed || []),
  };
}
