import { renderShell } from '../ui/components.js';
import { clearBrowserResidueFromRegistry } from '../services/browser-cleanup.js';
import { loadAutomationSummary, submitAutomationAction } from '../services/automation-control.js';
import { navigate, currentRoute, listen } from './router.js';
import {
  addActivity,
  aggregateDomain,
  getQueueCustomOrdering,
  getState,
  hydrateState,
  normalizeSettings,
  removeProject,
  resetState,
  saveProject,
  saveRoutePreference,
  saveSettings,
  setRecentFileChanges,
  setAutomationSummary,
  setAutomationSummaryLoading,
  queueCustomOrderKey,
  saveQueueCustomOrder,
  selectProject,
  selectQueueTask,
  selectTask,
  selectQuestion,
  subscribe,
  toggleProjectAllInclusion,
  toggleQueueCustomOrdering,
} from '../state/store.js';
import {
  captureInstruction,
  connectProject,
  createProjectSetupTask,
  projectSetupInstruction,
  restoreProjectAccess,
  saveQuestionAnswer,
  saveRecommendedAnswersForTask,
  saveUserVerificationFeedback,
  sendUserVerificationComment,
  scanAllProjects,
  scanProject,
  transitionPlan,
  updateTaskStatus,
} from '../services/project-service.js';
import { renderRoute } from './render-route.js';
import { scanServerProject } from '../services/server-fs.js';
import { escapeHtml, normalizePath, uniqueStrings } from '../lib/utils.js';

const root = document.getElementById('app');
let autoScanTimer = 0;
let updateCheckTimer = 0;
let updateCheckInFlight = false;
let toastTimer = 0;
let recentChangeClearTimer = 0;
let rendering = false;
let deferredInstallPrompt = null;

function counts() {
  const state = getState();
  const domain = aggregateDomain();
  return {
    queue: domain.queue.length,
    tasks: domain.tasks.length,
    questions: domain.questions.filter((question) => !question.answered).length,
    verification: domain.verifications.filter((record) => !/complete|verified/i.test(record.status || '')).length,
    lessons: domain.lessons.length,
    observations: domain.observations.length,
    projects: state.projects.length,
  };
}

function activeDraftSnapshot() {
  const active = document.activeElement;
  if (!active?.matches?.('input, textarea')) return null;
  const draftKey = active.dataset?.draftKey;
  if (!draftKey) return null;
  return {
    draftKey,
    value: active.value,
    selectionStart: active.selectionStart,
    selectionEnd: active.selectionEnd,
    scrollTop: active.scrollTop,
  };
}

function restoreActiveDraft(snapshot) {
  if (!snapshot?.draftKey) return;
  const draft = [...document.querySelectorAll('[data-draft-key]')]
    .find((element) => element.dataset.draftKey === snapshot.draftKey);
  if (!draft) return;
  draft.value = snapshot.value;
  draft.focus({ preventScroll: true });
  if (Number.isInteger(snapshot.selectionStart) && Number.isInteger(snapshot.selectionEnd) && draft.setSelectionRange) {
    draft.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  }
  if (Number.isFinite(snapshot.scrollTop)) draft.scrollTop = snapshot.scrollTop;
}

function activeViewportSnapshot() {
  const panes = [...document.querySelectorAll('.workspace-pane')]
    .map((pane, index) => ({
      selector: pane.className
        .split(/\s+/)
        .filter((name) => name && name !== 'workspace-pane')
        .slice(0, 2)
        .map((name) => `.${CSS.escape(name)}`)
        .join('') || `.workspace-pane:nth-of-type(${index + 1})`,
      scrollTop: pane.scrollTop,
      scrollLeft: pane.scrollLeft,
    }));
  const disclosures = [...document.querySelectorAll('details')]
    .map((detail, index) => {
      const summaryText = detail.querySelector('summary')?.textContent?.trim().replace(/\s+/g, ' ') || '';
      const key = detail.id
        || detail.dataset.planSection
        || detail.dataset.disclosureKey
        || [
          ...detail.classList,
          summaryText,
          String(index),
        ].filter(Boolean).join('::');
      return key ? { key, open: detail.open } : null;
    })
    .filter(Boolean);
  return {
    windowX: window.scrollX,
    windowY: window.scrollY,
    mainScrollTop: document.getElementById('main-content')?.scrollTop || 0,
    planScrollTop: document.querySelector('.plan-document')?.scrollTop || 0,
    queueScrollTop: document.querySelector('.queue-pane')?.scrollTop || 0,
    panes,
    disclosures,
  };
}

function restoreViewportSnapshot(snapshot) {
  if (!snapshot) return;
  const disclosureState = new Map((snapshot.disclosures || []).map((item) => [item.key, item.open]));
  const restoreDisclosures = () => {
    [...document.querySelectorAll('details')].forEach((detail, index) => {
      const summaryText = detail.querySelector('summary')?.textContent?.trim().replace(/\s+/g, ' ') || '';
      const key = detail.id
        || detail.dataset.planSection
        || detail.dataset.disclosureKey
        || [
          ...detail.classList,
          summaryText,
          String(index),
        ].filter(Boolean).join('::');
      if (!disclosureState.has(key)) return;
      detail.open = Boolean(disclosureState.get(key));
    });
  };
  const apply = () => {
    restoreDisclosures();
    const main = document.getElementById('main-content');
    const plan = document.querySelector('.plan-document');
    const queue = document.querySelector('.queue-pane');
    if (main) main.scrollTop = snapshot.mainScrollTop || 0;
    if (plan) plan.scrollTop = snapshot.planScrollTop || 0;
    if (queue) queue.scrollTop = snapshot.queueScrollTop || 0;
    (snapshot.panes || []).forEach((pane) => {
      const element = document.querySelector(pane.selector);
      if (!element) return;
      element.scrollTop = pane.scrollTop || 0;
      element.scrollLeft = pane.scrollLeft || 0;
    });
    window.scrollTo(snapshot.windowX || 0, snapshot.windowY || 0);
  };
  apply();
  window.requestAnimationFrame(() => {
    apply();
    window.requestAnimationFrame(apply);
  });
}




function render() {
  if (rendering || !root) return;
  rendering = true;
  const draftSnapshot = activeDraftSnapshot();
  const viewportSnapshot = activeViewportSnapshot();
  const state = getState();
  const route = currentRoute();
  root.innerHTML = renderShell({ route, state, counts: counts(), content: renderRoute(route) });
  bindTransientControls();
  if (route.path === '/agents' && state.automationSummaryStatus === 'idle') {
    refreshAutomationSummary({ quiet: true }).catch(console.error);
  }
  restoreActiveDraft(draftSnapshot);
  restoreViewportSnapshot(viewportSnapshot);
  rendering = false;
}

function notify(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2400);
}

function showError(error) {
  console.error(error);
  notify(error?.message || String(error), 'error');
}

let automationSummaryInFlight = false;
async function refreshAutomationSummary({ quiet = false } = {}) {
  if (automationSummaryInFlight) return;
  automationSummaryInFlight = true;
  setAutomationSummaryLoading();
  try {
    const summary = await loadAutomationSummary();
    setAutomationSummary(summary, 'ready', '');
    if (!quiet) notify('Automation summary refreshed.');
  } catch (error) {
    setAutomationSummary(null, 'error', error?.message || String(error));
    if (!quiet) showError(error);
  } finally {
    automationSummaryInFlight = false;
  }
}

function filesByPath(files = []) {
  return new Map((files || []).map((file) => [normalizePath(file.path), file]));
}

function compareScannedFiles(previousFiles = [], latestFiles = []) {
  if (!previousFiles.length) return { count: 0, newestModified: 0, files: [] };
  const previous = filesByPath(previousFiles);
  const latest = filesByPath(latestFiles);
  const files = [];
  let newestModified = 0;
  latest.forEach((file, path) => {
    const old = previous.get(path);
    if (!old || old.hash !== file.hash) {
      const kind = old ? 'modified' : 'created';
      files.push({ path, kind, lastModified: Number(file.lastModified || 0) });
      newestModified = Math.max(newestModified, Number(file.lastModified || 0));
    }
  });
  previous.forEach((file, path) => {
    if (!latest.has(path)) {
      files.push({ path, kind: 'deleted', lastModified: Number(file.lastModified || 0) });
      newestModified = Math.max(newestModified, Number(file.lastModified || 0));
    }
  });
  return { count: files.length, newestModified, files };
}

function activeQueueOrderKeysFromDom() {
  return [...document.querySelectorAll('[data-custom-order-key]')]
    .map((element) => element.dataset.customOrderKey)
    .filter(Boolean);
}

function activeQueueKeysFromState() {
  const state = getState();
  const domain = aggregateDomain();
  const projectId = state.selectedProjectId;
  const tasks = projectId === 'all' ? domain.queue : domain.queue.filter((task) => task.projectId === projectId);
  return tasks.map(queueCustomOrderKey).filter(Boolean);
}

function activeQueueKeysForProject(projectId = 'all') {
  const domain = aggregateDomain();
  const tasks = projectId === 'all' ? domain.queue : domain.queue.filter((task) => task.projectId === projectId);
  return tasks.map(queueCustomOrderKey).filter(Boolean);
}

async function saveDraggedQueueOrder(sourceKey, targetKey) {
  if (!sourceKey || !targetKey || sourceKey === targetKey) return;
  const keys = activeQueueOrderKeysFromDom();
  const sourceIndex = keys.indexOf(sourceKey);
  const targetIndex = keys.indexOf(targetKey);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const next = [...keys];
  const [moved] = next.splice(sourceIndex, 1);
  const adjustedTargetIndex = next.indexOf(targetKey);
  next.splice(adjustedTargetIndex < 0 ? targetIndex : adjustedTargetIndex, 0, moved);
  await saveQueueCustomOrder(getState().selectedProjectId, next, keys);
  notify('Custom queue order saved.');
}


function changeSignature(changes = []) {
  return (changes || [])
    .map((change) => `${change.projectId || ''}:${normalizePath(change.path)}:${change.kind || ''}:${change.lastModified || 0}`)
    .sort()
    .join('|');
}

function showRealtimeHighlights(changedFiles = []) {
  if (!changedFiles.length) return;
  const signature = changeSignature(changedFiles);
  setRecentFileChanges(changedFiles);
  clearTimeout(recentChangeClearTimer);
  recentChangeClearTimer = window.setTimeout(() => {
    if (changeSignature(getState().recentFileChanges || []) === signature) setRecentFileChanges([]);
  }, 6200);
}

async function checkForAgentFileUpdates() {
  const state = getState();
  if (!state.ready || !state.projects.length || updateCheckInFlight) return;
  const projects = state.projects.filter((project) => state.projectData.get(project.id)?.files?.length);
  if (!projects.length) return;
  updateCheckInFlight = true;
  try {
    const changedFiles = [];
    for (const project of projects) {
      const previous = state.projectData.get(project.id);
      const scan = await scanServerProject(project, state.settings);
      const diff = compareScannedFiles(previous?.files || [], scan.files || []);
      if (!diff.count) continue;
      changedFiles.push(...diff.files.map((file) => ({ ...file, projectId: project.id, projectName: project.name })));
      await scanProject(project.id, { preloadedScan: scan });
    }
    showRealtimeHighlights(changedFiles);
  } catch (error) {
    console.warn('Realtime file update failed', error);
  } finally {
    updateCheckInFlight = false;
  }
}

function scheduleAgentUpdateCheck() {
  clearInterval(updateCheckTimer);
  const state = getState();
  if (!state.settings.autoScan || !state.projects.length) return;
  updateCheckTimer = window.setInterval(() => {
    checkForAgentFileUpdates().catch(console.error);
  }, Math.max(15000, Math.min(Number(state.settings.scanIntervalMs || 30000), 60000)));
}

function isStandalonePwa() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

async function registerRuntimeServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
  registration.update().catch((error) => console.warn('Service worker update failed', error));
  return registration;
}

async function copyToClipboard(text = '') {
  if (!text) throw new Error('Nothing to copy.');
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard copy failed.');
}

function bindTransientControls() {
  const menuButton = document.querySelector('[data-open-drawer]');
  const scrim = document.querySelector('.drawer-scrim');
  menuButton?.addEventListener('click', () => {
    document.body.classList.add('drawer-open');
    menuButton.setAttribute('aria-expanded', 'true');
    document.querySelector('.sidebar a, .sidebar button')?.focus();
  });
  scrim?.addEventListener('click', closeDrawer);

  const scopeToggle = document.querySelector('[data-scope-toggle]');
  const scopeMenu = document.querySelector('[data-scope-menu]');
  scopeToggle?.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = !scopeMenu.hidden;
    closeMenus(scopeMenu);
    scopeMenu.hidden = open;
    scopeToggle.setAttribute('aria-expanded', String(!open));
  });

  document.querySelectorAll('[data-live-filter]').forEach((input) => {
    input.addEventListener('input', () => {
      const value = input.value.trim().toLowerCase();
      document.querySelectorAll(input.dataset.liveFilter).forEach((row) => {
        row.hidden = Boolean(value) && !row.textContent.toLowerCase().includes(value);
      });
    });
  });
}

function closeDrawer() {
  document.body.classList.remove('drawer-open');
  document.querySelector('[data-open-drawer]')?.setAttribute('aria-expanded', 'false');
}

function closeMenus(except = null) {
  document.querySelectorAll('.scope-menu, .row-menu').forEach((menu) => {
    if (menu !== except) menu.hidden = true;
  });
  document.querySelectorAll('[data-scope-toggle], [data-action="toggle-row-menu"]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
}

function showDialog(html) {
  const host = document.getElementById('dialog-root');
  if (!host) return null;
  host.innerHTML = html;
  const dialog = host.querySelector('dialog');
  dialog.addEventListener('close', () => { host.innerHTML = ''; });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.showModal();
  dialog.querySelector('input, select, textarea, button')?.focus();
  return dialog;
}

function captureDialog() {
  const state = getState();
  if (!state.projects.length) {
    navigate('/projects');
    notify('Connect a project before capturing an instruction.');
    return;
  }
  const options = state.projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join('');
  const dialog = showDialog(`<dialog class="app-dialog"><form method="dialog" class="dialog-card" data-form="capture-instruction"><header><div><span class="page-kicker">New record</span><h2>Capture instruction</h2><p>Append a source-backed active task item to the selected project’s todo.md.</p></div><button class="icon-btn" value="cancel" aria-label="Close">×</button></header><div class="dialog-body"><label class="field"><span>Project</span><select class="select" name="projectId" required>${options}</select></label><label class="field"><span>Instruction</span><input class="input" name="title" required maxlength="240" placeholder="Action-oriented task title"></label><label class="field"><span>Scope</span><textarea class="textarea" name="scope" rows="4" placeholder="One-sentence outcome"></textarea></label><div class="form-grid"><label class="field"><span>Category</span><input class="input" name="category" value="General"></label><label class="field"><span>Type</span><select class="select" name="type"><option>Task</option><option>Sprint</option></select></label></div></div><footer><button class="btn" value="cancel">Cancel</button><button class="btn btn-primary" type="submit" value="default">Capture instruction</button></footer></form></dialog>`);
  dialog.querySelector('[data-form="capture-instruction"]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await captureInstruction(data.get('projectId'), {
        title: data.get('title'),
        scope: data.get('scope'),
        category: data.get('category'),
        type: data.get('type'),
      });
      dialog.close();
      notify('Instruction captured in todo.md.');
    } catch (error) { showError(error); }
  });
}

function connectProjectDialog() {
  const dialog = showDialog(`<dialog class="app-dialog"><form method="dialog" class="dialog-card" data-form="connect-project"><header><div><span class="page-kicker">Project connection</span><h2>Add site/project</h2><p>Add a file-backed task project and choose whether new pending plans should be approved automatically by automation.</p></div><button class="icon-btn" value="cancel" aria-label="Close">×</button></header><div class="dialog-body"><label class="field"><span>Project name</span><input class="input" name="name" placeholder="e.g. example-project"></label><label class="field"><span>Absolute project path</span><input class="input mono" name="rootLabel" placeholder="/path/to/project"><small>Leave empty to use the native folder picker.</small></label><label class="field"><span>Explicit task root</span><input class="input mono" name="explicitTaskPath" placeholder="Auto-detect when empty, e.g. docs/tasks"></label><label class="settings-row compact-row checkbox-row"><span class="settings-row-copy"><strong>Auto-approve pending tasks</strong><span>When enabled, lifecycle automation moves new plans from planning/pending/ to planning/approved/ on its next reconcile pass.</span></span><input type="checkbox" name="autoApprovePending"></label><div class="doc-callout"><strong>Automation behavior</strong><p>Only pending plans in this project are auto-approved. Draft plans stay untouched, and conflicts are skipped instead of overwritten.</p></div></div><footer><button class="btn" value="cancel">Cancel</button><button class="btn btn-primary" type="submit" value="default">Add and scan</button></footer></form></dialog>`);
  dialog.querySelector('[data-form="connect-project"]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const project = await connectProject({
        name: String(data.get('name') || '').trim(),
        rootLabel: String(data.get('rootLabel') || '').trim(),
        explicitTaskPath: String(data.get('explicitTaskPath') || '').trim(),
        autoApprovePending: Boolean(data.get('autoApprovePending')),
      });
      if (!project) {
        notify('Project selection cancelled.');
        return;
      }
      dialog.close();
      navigate('/projects');
      const connected = getState().projects.find((item) => item.id === project.id) || project;
      notify(connected.status === 'healthy' ? 'Project connected and scanned.' : 'Project connected. Setup is required.');
    } catch (error) { showError(error); }
  });
}

function editProjectDialog(projectId) {
  const project = getState().projects.find((item) => item.id === projectId);
  if (!project) return;
  const dialog = showDialog(`<dialog class="app-dialog"><form method="dialog" class="dialog-card" data-form="edit-project"><header><div><span class="page-kicker">Project connection</span><h2>Edit connection</h2><p>Change the file-backed project name, filesystem path, task-root path, or automation approval policy.</p></div><button class="icon-btn" value="cancel" aria-label="Close">×</button></header><div class="dialog-body"><input type="hidden" name="projectId" value="${escapeHtml(project.id)}"><label class="field"><span>Project name</span><input class="input" name="name" required value="${escapeHtml(project.name)}"></label><label class="field"><span>Absolute project path</span><input class="input mono" name="rootLabel" required value="${escapeHtml(project.rootLabel || '')}" placeholder="/path/to/project"></label><label class="field"><span>Explicit task root</span><input class="input mono" name="explicitTaskPath" value="${escapeHtml(project.explicitTaskPath || '')}" placeholder="Auto-detect when empty"></label><label class="settings-row compact-row checkbox-row"><span class="settings-row-copy"><strong>Auto-approve pending tasks</strong><span>Move new planning/pending/ plans to planning/approved/ during automation reconcile.</span></span><input type="checkbox" name="autoApprovePending" ${project.autoApprovePending ? 'checked' : ''}></label><div class="doc-callout"><strong>Runtime server rule</strong><p>Absolute paths are read and written by tooling/scripts/serve-runtime.py. No browser directory handle is used.</p></div></div><footer><button class="btn" value="cancel">Cancel</button><button class="btn btn-primary" type="submit" value="default">Save and rescan</button></footer></form></dialog>`);
  dialog.querySelector('[data-form="edit-project"]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await saveProject({ ...project, name: String(data.get('name')).trim(), rootLabel: String(data.get('rootLabel')).trim(), explicitTaskPath: String(data.get('explicitTaskPath')).trim(), autoApprovePending: Boolean(data.get('autoApprovePending')), status: 'configured', permission: 'server', serverBacked: true, error: '' });
      await scanProject(project.id, { requestPermission: true });
      dialog.close();
      notify('Project connection updated.');
    } catch (error) { showError(error); }
  });
}

async function handleAction(button) {
  const action = button.dataset.action;
  if (!action) return;
  try {
    switch (action) {
      case 'connect-project': {
        connectProjectDialog();
        break;
      }
      case 'refresh-automation-summary':
        await refreshAutomationSummary();
        break;
      case 'automation-action': {
        const automationAction = button.dataset.automationAction;
        if (!automationAction) throw new Error('Automation action is missing.');
        const reason = button.dataset.reason || `Agent Control Center action: ${automationAction}`;
        const label = automationAction.replace(/-/g, ' ');
        if (!window.confirm(`Confirm ${label}? This writes durable automation policy/audit state.\n\nReason: ${reason}`)) break;
        await submitAutomationAction(automationAction, {
          actor: 'TaskManager operator',
          reason,
          projectId: button.dataset.projectId || '',
          projectName: button.dataset.projectName || '',
          role: button.dataset.role || '',
          planPath: button.dataset.planPath || '',
          currentPlanPath: button.dataset.currentPlanPath || '',
          conflictKey: button.dataset.conflictKey || '',
          assignmentId: button.dataset.assignmentId || '',
          reviewerKey: button.dataset.reviewerKey || '',
        });
        await refreshAutomationSummary({ quiet: true });
        notify(`Automation action recorded: ${label}.`);
        break;
      }
      case 'scan-all':
        notify('Scanning connected task systems…');
        await scanAllProjects({ requestPermission: true });
        setRecentFileChanges([]);
        notify('Task systems rescanned.');
        break;
      case 'open-capture':
        captureDialog();
        break;
      case 'clear-browser-residue': {
        const result = await clearBrowserResidueFromRegistry();
        await registerRuntimeServiceWorker().catch((error) => console.warn('Service worker registration failed', error));
        const cleared = result.cleared || {};
        const count = Object.values(cleared).reduce((total, value) => total + Number(value || 0), 0);
        notify(`Browser residue cleared from registry${count ? ` (${count} items)` : ''}.`);
        break;
      }
      case 'reload-app': {
        notify('Reloading TaskManager…');
        const registration = await navigator.serviceWorker?.getRegistration?.();
        await registration?.update?.();
        window.setTimeout(() => window.location.reload(), 120);
        break;
      }
      case 'install-pwa': {
        if (isStandalonePwa()) {
          notify('TaskManager is already running as an installed app.');
          break;
        }
        if (!deferredInstallPrompt) {
          notify('Use the generated macOS launcher or your browser’s Install app/Add to Dock menu.');
          break;
        }
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        notify(choice.outcome === 'accepted' ? 'TaskManager install accepted.' : 'TaskManager install dismissed.');
        render();
        break;
      }
      case 'copy-text':
        await copyToClipboard(button.dataset.copyText || '');
        notify(button.dataset.copyToast || 'Instructions copied.');
        break;
      case 'create-project-setup-task':
        button.disabled = true;
        await createProjectSetupTask(button.dataset.projectId);
        notify('Setup task created. Copy it to your coding agent.');
        break;
      case 'copy-project-setup-instruction':
        await copyToClipboard(projectSetupInstruction(button.dataset.projectId));
        notify('Agent Workflow Kits instruction copied.');
        break;
      case 'select-project':
        selectProject(button.dataset.projectId);
        break;
      case 'toggle-project-all-inclusion': {
        const updated = await toggleProjectAllInclusion(button.dataset.projectId);
        if (updated) notify(updated.includeInAllQueue === false ? `${updated.name} hidden from All projects.` : `${updated.name} included in All projects.`);
        break;
      }
      case 'toggle-custom-queue-order': {
        const route = currentRoute();
        if (getState().selectedProjectId === 'all') {
          notify('Select a specific project before enabling custom run order.', 'error');
          break;
        }
        if ((route.params.get('status') || 'all') === 'completed') {
          notify('Completed tasks are not part of active custom ordering.', 'error');
          break;
        }
        const keys = activeQueueOrderKeysFromDom();
        const fallbackKeys = keys.length ? keys : activeQueueKeysFromState();
        const next = await toggleQueueCustomOrdering(getState().selectedProjectId, fallbackKeys);
        notify(next.enabled ? 'Project custom run order enabled. Drag rows to set the sequence.' : 'Project custom run order disabled. Queue is using timestamp sorting.');
        break;
      }
      case 'select-queue-task':
        selectQueueTask(button.dataset.taskId);
        break;
      case 'toggle-expansion': {
        const target = document.getElementById(button.dataset.target);
        if (!target) break;
        const open = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', String(!open));
        target.hidden = open;
        break;
      }
      case 'save-settings':
        await saveSettings(getState().settings);
        notify('Settings saved.');
        break;
      case 'scroll-plan-section': {
        document.querySelectorAll('[data-action="scroll-plan-section"]').forEach((item) => item.classList.remove('active'));
        button.classList.add('active');
        document.getElementById(button.dataset.sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
      case 'select-question':
        selectQuestion(button.dataset.questionId);
        navigate('/questions', { task: button.dataset.taskId, id: button.dataset.questionId });
        break;
      case 'select-answer-option': {
        if (button.disabled || button.getAttribute('aria-disabled') === 'true') break;
        const panel = button.closest('.question-panel');
        panel.querySelectorAll('[data-action="select-answer-option"]').forEach((option) => {
          option.classList.remove('selected');
          option.setAttribute('aria-checked', 'false');
        });
        button.classList.add('selected');
        button.setAttribute('aria-checked', 'true');
        const custom = panel.querySelector('[data-other-answer]');
        const isOther = /^other\b/i.test(button.querySelector('strong')?.textContent.replace(/^\([a-z]\)\s*/, '') || '');
        custom.hidden = !isOther;
        if (isOther) custom.querySelector('textarea')?.focus();
        const save = panel.querySelector('[data-action="save-answer"]');
        save.disabled = false;
        const preview = document.querySelector('[data-answer-preview]');
        if (preview) preview.textContent = `Answer: ${button.querySelector('strong')?.textContent.replace(/^\([a-z]\)\s*/, '') || ''}\nAnswer source: TaskManager interactive choice`;
        break;
      }
      case 'save-answer': {
        const panel = button.closest('.question-panel');
        const selected = panel.querySelector('[data-action="select-answer-option"].selected');
        if (!selected) throw new Error('Choose an answer before saving.');
        const optionKey = selected.dataset.optionKey;
        const customText = panel.querySelector('[data-custom-answer]')?.value || '';
        button.disabled = true;
        await saveQuestionAnswer(button.dataset.questionId, optionKey, customText);
        notify('Answer written and verified in the plan.');
        break;
      }
      case 'use-recommended':
        await saveRecommendedAnswersForTask(button.dataset.taskId);
        notify('Recommended answers written and verified.');
        break;
      case 'save-user-feedback': {
        const panel = button.closest('[data-user-feedback-panel]');
        const textarea = panel?.querySelector('[data-user-feedback-text]');
        const feedback = String(textarea?.value || '').trim();
        if (!feedback) throw new Error('Enter the issue or requested change before saving feedback.');
        button.disabled = true;
        await saveUserVerificationFeedback(button.dataset.taskId, feedback);
        notify('User feedback saved and status set to User Replied.');
        break;
      }
      case 'confirm-user-verification': {
        if (button.disabled || button.getAttribute('aria-disabled') === 'true') break;
        button.disabled = true;
        await updateTaskStatus(button.dataset.taskId, 'completed');
        const state = getState();
        const projectIds = state.projects.map((project) => project.id).filter(Boolean);
        await Promise.all(projectIds.map((projectId) => saveQueueCustomOrder(projectId, getQueueCustomOrdering(projectId).order, activeQueueKeysForProject(projectId))));
        notify('Work confirmed and task moved to Completed.');
        break;
      }
      case 'send-user-verification-comment': {
        const panel = button.closest('[data-user-verification-comment-panel]');
        const textarea = panel?.querySelector('[data-user-verification-comment-text]');
        const comment = String(textarea?.value || '').trim();
        if (!comment) throw new Error('Enter a comment before sending it to the agent.');
        button.disabled = true;
        await sendUserVerificationComment(button.dataset.taskId, comment);
        notify('Comment sent to agent.');
        break;
      }
      case 'transition-plan': {
        const state = getState();
        const message = `Move this plan to ${button.dataset.destination}? The app will use copy → verify → delete.`;
        if (state.settings.confirmLifecycleWrites && !window.confirm(message)) break;
        await transitionPlan(button.dataset.taskId, button.dataset.destination);
        notify(`Plan moved to ${button.dataset.destination}.`);
        break;
      }
      case 'toggle-row-menu': {
        const menu = document.getElementById(button.dataset.menuId);
        const open = menu && !menu.hidden;
        closeMenus(menu);
        if (menu) menu.hidden = open;
        button.setAttribute('aria-expanded', String(!open));
        break;
      }
      case 'health-check':
        await scanProject(button.dataset.projectId, { requestPermission: true });
        notify('Health check completed.');
        break;
      case 'restore-project-access':
        await restoreProjectAccess(button.dataset.projectId);
        notify('Project rescanned from filesystem.');
        break;
      case 'edit-project':
        editProjectDialog(button.dataset.projectId);
        break;
      case 'disconnect-project':
        if (window.confirm('Disconnect this project? Project files will not be deleted.')) {
          await removeProject(button.dataset.projectId);
          notify('Project disconnected.');
        }
        break;
      case 'toggle-setting': {
        const state = getState();
        const key = button.dataset.setting;
        await saveSettings({ ...state.settings, [key]: !state.settings[key] });
        scheduleAutoScan();
        scheduleAgentUpdateCheck();
        notify('Setting updated.');
        break;
      }
      case 'remove-doc-alias': {
        const state = getState();
        const names = state.settings.documentationFolderNames.filter((name) => name.toLowerCase() !== button.dataset.alias.toLowerCase());
        if (!names.length) throw new Error('Keep at least one documentation folder name.');
        await saveSettings({ ...state.settings, documentationFolderNames: names });
        notify('Documentation folder name removed.');
        break;
      }
      case 'remove-task-alias': {
        const state = getState();
        const names = state.settings.taskFolderNames.filter((name) => name.toLowerCase() !== button.dataset.alias.toLowerCase());
        if (!names.length) throw new Error('Keep at least one task folder name.');
        await saveSettings({ ...state.settings, taskFolderNames: names });
        notify('Task folder name removed.');
        break;
      }
      case 'reset-state':
        if (window.confirm('Reload file-backed TaskManager configuration? Project task files will not be changed.')) {
          await resetState();
          navigate('/');
          notify('File-backed configuration reloaded.');
        }
        break;
      default:
        break;
    }
  } catch (error) {
    showError(error);
  }
}

function routePreferenceKey(route = currentRoute()) {
  if (route.path === '/') return 'queue';
  return '';
}

async function persistRoutePreference(route = currentRoute()) {
  const key = routePreferenceKey(route);
  if (!key) return;
  const sort = route.params.get('sort');
  if (!['created', 'modified'].includes(sort)) return;
  await saveRoutePreference(key, { sort, dir: route.params.get('dir') === 'asc' ? 'asc' : 'desc' });
}

function isQueueRoute() {
  return currentRoute().path === '/';
}

function scheduleAutoScan() {
  clearInterval(autoScanTimer);
  // Queue content is user-editable (for example the user-verification comment
  // panel). Realtime file watching is handled by scheduleAgentUpdateCheck(),
  // which applies changed project scans in place without navigating or reloading.
}

document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]');
  const scopeChoice = event.target.closest('[data-select-project]');
  const selectableTaskRow = event.target.closest('[data-row-select-task]');
  if (event.target.closest('[data-task-status-select]')) return;
  if (scopeChoice) {
    selectProject(scopeChoice.dataset.selectProject);
    closeMenus();
    closeDrawer();
    return;
  }
  if (selectableTaskRow && !event.target.closest('a, button, input, select, textarea, [role="button"]')) {
    selectTask(selectableTaskRow.dataset.rowSelectTask);
    closeMenus();
    closeDrawer();
    return;
  }
  if (action) {
    event.preventDefault();
    handleAction(action);
    return;
  }
  if (!event.target.closest('.scope-control, .row-menu-control')) closeMenus();
  if (event.target.closest('.nav-link')) closeDrawer();
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  if (['capture-instruction', 'edit-project'].includes(form.dataset.form)) return;
  event.preventDefault();
  const input = form.elements.alias;
  const alias = String(input?.value || '').trim().replaceAll('/', '');
  if (!alias) return;
  const state = getState();
  try {
    if (form.dataset.form === 'add-doc-alias') {
      await saveSettings({ ...state.settings, documentationFolderNames: uniqueStrings([...state.settings.documentationFolderNames, alias]) });
    } else if (form.dataset.form === 'add-task-alias') {
      await saveSettings({ ...state.settings, taskFolderNames: uniqueStrings([...state.settings.taskFolderNames, alias]) });
    }
    notify('Folder name added.');
  } catch (error) { showError(error); }
});

document.addEventListener('change', async (event) => {
  const statusSelect = event.target.closest('[data-task-status-select]');
  if (statusSelect) {
    const previous = statusSelect.dataset.currentStatus || '';
    const next = statusSelect.value;
    const label = statusSelect.options[statusSelect.selectedIndex]?.textContent?.split('—')[0]?.trim() || next;
    try {
      statusSelect.disabled = true;
      await updateTaskStatus(statusSelect.dataset.taskId, next);
      if (next === 'completed') {
        const state = getState();
        const projectIds = state.projects.map((project) => project.id).filter(Boolean);
        await Promise.all(projectIds.map((projectId) => saveQueueCustomOrder(projectId, getQueueCustomOrdering(projectId).order, activeQueueKeysForProject(projectId))));
      }
      notify(`Task status changed to ${label}.`);
    } catch (error) {
      statusSelect.value = previous;
      showError(error);
    } finally {
      statusSelect.disabled = false;
    }
    return;
  }

  const taskFilter = event.target.closest('[data-task-filter]');
  if (taskFilter) {
    const route = currentRoute();
    const params = {
      status: document.querySelector('[data-task-filter="status"]')?.value || 'all',
      sort: route.params.get('sort') || '',
      dir: route.params.get('dir') || '',
    };
    Object.keys(params).forEach((key) => {
      if (!params[key] || params[key] === 'all') delete params[key];
    });
    navigate('/', params);
    return;
  }

  const select = event.target.closest('[data-setting-select]');
  if (!select) return;
  const state = getState();
  const key = select.dataset.settingSelect;
  const value = key === 'scanIntervalMs' ? Number(select.value) : select.value;
  try {
    await saveSettings(normalizeSettings({ ...state.settings, [key]: value }));
    scheduleAutoScan();
    scheduleAgentUpdateCheck();
    notify('Setting updated.');
  } catch (error) { showError(error); }
});


let draggedQueueOrderKey = '';

document.addEventListener('dragstart', (event) => {
  const row = event.target.closest?.('[data-custom-order-key]');
  if (!row) return;
  draggedQueueOrderKey = row.dataset.customOrderKey || '';
  row.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', draggedQueueOrderKey);
});

document.addEventListener('dragover', (event) => {
  if (!draggedQueueOrderKey) return;
  const row = event.target.closest?.('[data-custom-order-key]');
  if (!row || row.dataset.customOrderKey === draggedQueueOrderKey) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.ledger-row-shell.drag-over').forEach((item) => item.classList.remove('drag-over'));
  row.classList.add('drag-over');
});

document.addEventListener('dragleave', (event) => {
  const row = event.target.closest?.('[data-custom-order-key]');
  if (row && !row.contains(event.relatedTarget)) row.classList.remove('drag-over');
});

document.addEventListener('drop', async (event) => {
  if (!draggedQueueOrderKey) return;
  const row = event.target.closest?.('[data-custom-order-key]');
  document.querySelectorAll('.ledger-row-shell.drag-over').forEach((item) => item.classList.remove('drag-over'));
  if (!row) return;
  event.preventDefault();
  try {
    await saveDraggedQueueOrder(draggedQueueOrderKey, row.dataset.customOrderKey || '');
  } catch (error) {
    showError(error);
  }
});

document.addEventListener('dragend', () => {
  draggedQueueOrderKey = '';
  document.querySelectorAll('.ledger-row-shell.dragging, .ledger-row-shell.drag-over').forEach((item) => item.classList.remove('dragging', 'drag-over'));
});

document.addEventListener('keydown', (event) => {
  const queueRow = event.target.closest?.('.ledger-row[data-action="select-queue-task"]');
  if (queueRow && ['Enter', ' '].includes(event.key)) {
    event.preventDefault();
    handleAction(queueRow);
    return;
  }
  const taskRow = event.target.closest?.('[data-row-select-task]');
  if (taskRow && ['Enter', ' '].includes(event.key)) {
    event.preventDefault();
    selectTask(taskRow.dataset.rowSelectTask);
    return;
  }
  if (event.key === 'Escape') {
    closeDrawer();
    closeMenus();
  }
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  render();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  notify('TaskManager installed.');
  render();
});

async function boot() {
  try {
    await clearBrowserResidueFromRegistry().catch((error) => console.warn('Browser residue cleanup failed', error));
    await hydrateState();
    if (getState().projects.length) await scanAllProjects();
    render();
    subscribe(render);
    listen((route) => {
      render();
      persistRoutePreference(route).catch(console.error);
      scheduleAutoScan();
      scheduleAgentUpdateCheck();
    });
    persistRoutePreference(currentRoute()).catch(console.error);
    scheduleAutoScan();
    scheduleAgentUpdateCheck();
    await registerRuntimeServiceWorker().catch((error) => console.warn('Service worker registration failed', error));
  } catch (error) {
    root.innerHTML = `<main class="fatal-state"><h1>TaskManager could not start</h1><p>${escapeHtml(error.message || String(error))}</p></main>`;
  }
}

boot();
