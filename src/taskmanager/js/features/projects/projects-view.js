import { emptyState, icon, pageHeader, projectStatusText, statusBadge } from '../../ui/components.js';
import { renderMarkdown } from '../../ui/markdown.js';
import { aggregateDomain, getQueueCustomOrdering, getState, queueCustomOrderKey } from '../../state/store.js';
import { escapeHtml, formatRelativeTime, normalizePath, slugify } from '../../lib/utils.js';
import {
  absoluteTaskPath,
  actionLink,
  answeredQuestionCount,
  button,
  checklistSummary,
  cleanStatusLabel,
  createdLabel,
  fileLabel,
  lifecycleProgress,
  lifecycleValueForTask,
  modifiedLabel,
  plural,
  queueStatusFilterValue,
  riskLabel,
  routeWithSavedSort,
  scoreCaption,
  scoreRingHtml,
  selectedTask,
  sortHeader,
  sortTasks,
  sortTasksByCustomOrder,
  statusFilterTabs,
  stripPlanDocumentChrome,
  taskMatchesQueueFilters,
  taskRecentChanges,
  taskStatusControl,
  updatedLabel,
} from '../../ui/view-helpers.js';

export function renderProjects() {
  const state = getState();
  const registryPath = state.runtimeConfigPath || state.runtimeConfigSource || 'No runtime registry loaded';
  const header = pageHeader({ kicker: 'Administration / Project registry', title: 'Project registry', description: 'Projects are loaded from the active TaskManager runtime registry and scanned by the local runtime server.', actions: button('Add project', 'connect-project', { primary: true, iconName: 'plus' }) });
  const registryDiagnostics = `<section class="doc-callout registry-diagnostics"><strong>Active registry</strong><p>${escapeHtml(registryPath)}</p><div class="inline-actions"><span class="badge">${escapeHtml(state.runtimeConfigRegistrySource || 'runtime')}</span><span class="badge badge-success">Isolated public app data</span></div>${state.runtimeConfigWriteError ? `<p class="danger-text">${escapeHtml(state.runtimeConfigWriteError)}</p>` : ''}</section>`;
  if (!state.projects.length) return `<div class="page">${header}${registryDiagnostics}${emptyState({ title: 'No projects configured', description: 'Add an absolute filesystem path to data/runtime/projects.json, or use Add project path while running tooling/scripts/serve-runtime.py.', action: button('Add project', 'connect-project', { primary: true, iconName: 'projects' }), iconName: 'projects' })}</div>`;
  const rows = state.projects.map((project, index) => {
    const data = state.projectData.get(project.id);
    const fileCount = data?.files?.length || 0;
    const health = project.status === 'healthy' ? 100 : project.status === 'setup-incomplete' ? 45 : project.status === 'setup-required' ? 20 : project.status === 'conflict' ? 10 : project.status === 'missing-root' ? 5 : project.status === 'permission-required' ? 10 : 0;
    const accessLabel = project.status === 'missing-root' ? 'Missing root' : project.permission === 'server' ? 'Runtime server' : project.status;
    const expanded = index === 0;
    const rescanButton = button('Run health check', 'health-check', { primary: true, iconName: 'refresh', attrs: `data-project-id="${project.id}"` });
    const accessCopy = 'TaskManager reads and writes this absolute path through tooling/scripts/serve-runtime.py. No browser directory handle is required.';
    const rowMenu = `<button type="button" data-action="health-check" data-project-id="${project.id}">Rescan filesystem</button><button type="button" data-action="edit-project" data-project-id="${project.id}">Edit connection</button>`;
    const needsSetup = ['setup-required', 'setup-incomplete', 'conflict'].includes(project.status);
    const setupActions = project.setup?.bootstrap
      ? `${button('Copy agent instruction', 'copy-project-setup-instruction', { primary: true, iconName: 'copy', attrs: `data-project-id="${project.id}"` })}${rescanButton}`
      : `${button('Create setup task', 'create-project-setup-task', { primary: true, iconName: 'plus', attrs: `data-project-id="${project.id}"` })}${rescanButton}`;
    const setupPanel = needsSetup ? `<section class="project-setup-panel"><div><span class="page-kicker">Setup required</span><h3>Connect this project to its task system</h3><p>${project.status === 'conflict' ? escapeHtml(project.error) : 'Create one copyable task for your coding agent. Task Manager will wait while Agent Workflow Kits installs Documentation, Task, and Verification.'}</p></div><div class="setup-panel-actions">${setupActions}<a class="btn" href="#/">View setup queue</a></div></section>` : '';
    return `<tr class="record-row ${needsSetup ? 'project-needs-setup' : ''}"><td><div class="row-title"><button class="expander" type="button" data-action="toggle-expansion" data-target="project-${project.id}" aria-expanded="${expanded}">${icon('chevron')}</button><div class="row-title-copy"><strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(project.rootLabel || 'Filesystem path')}</span>${project.autoApprovePending ? '<span class="badge badge-success">auto-approve pending</span>' : ''}</div></div></td><td class="mono">${escapeHtml(project.taskRootPath || project.explicitTaskPath || 'Auto-detect')}</td><td><div class="project-health"><div class="health-meter"><span style="width:${health}%"></span></div><span>${health}%</span></div></td><td>${statusBadge(accessLabel)}</td><td>${projectStatusText(project)}</td><td><div class="row-menu-control"><button class="icon-btn" type="button" data-action="toggle-row-menu" data-menu-id="menu-${project.id}" aria-label="More actions for ${escapeHtml(project.name)}" aria-expanded="false">${icon('menu')}</button><div class="row-menu" id="menu-${project.id}" hidden>${rowMenu}<button type="button" class="danger-text" data-action="disconnect-project" data-project-id="${project.id}">Disconnect</button></div></div></td></tr><tr class="expansion-row" id="project-${project.id}" ${expanded ? '' : 'hidden'}><td colspan="6"><div class="expansion-content">${setupPanel}<div class="expansion-grid"><section class="expansion-block project-mapping-block"><h4>Filesystem mapping</h4><div class="project-map"><div class="project-map-card"><strong>Project root</strong><code>${escapeHtml(project.rootLabel || project.name)}</code></div><span class="project-map-arrow">→</span><div class="project-map-card"><strong>Task folder</strong><code>${escapeHtml(project.taskRootPath || project.explicitTaskPath || 'Auto-detect')}</code></div></div><p>${escapeHtml(accessCopy)}</p></section><section class="expansion-block"><h4>Automation policy</h4><p>${needsSetup ? 'Automation remains disabled until setup validates.' : project.autoApprovePending ? 'New pending plans are automatically promoted to approved during lifecycle reconciliation.' : 'Pending plans wait for manual approval before automation can build them.'}</p>${statusBadge(needsSetup ? 'Setup gated' : project.autoApprovePending ? 'Auto-approve enabled' : 'Manual approval')}</section><section class="expansion-block"><h4>Detected structure</h4><ul class="step-list"><li class="step-item"><span class="check-box ${data?.files?.some((file) => /todo\.md$/i.test(file.path)) ? 'checked' : ''}"></span><span>todo.md</span></li><li class="step-item"><span class="check-box ${data?.files?.some((file) => /planning\/(draft|pending|approved|in-progress|review|user-verification|failed-user-verification|completed|archive)/i.test(file.path)) ? 'checked' : ''}"></span><span>Plan lifecycle folders</span></li><li class="step-item"><span class="check-box ${data?.files?.some((file) => /lessons-active\.md$/i.test(file.path)) ? 'checked' : ''}"></span><span>Lessons system</span></li><li class="step-item"><span class="check-box ${data?.files?.some((file) => /verification\.md$/i.test(file.path)) ? 'checked' : ''}"></span><span>Verification profile</span></li></ul></section><section class="expansion-block"><h4>Health check</h4><p>${escapeHtml(project.error || `${fileCount} readable task-system files were indexed. Runtime read/write probe is available through the local server.`)}</p><div class="inline-actions">${rescanButton}${button('Edit project', 'edit-project', { attrs: `data-project-id="${project.id}"` })}</div></section></div></div></td></tr>`;
  }).join('');
  return `<div class="page projects-page">${header}${registryDiagnostics}<div class="toolbar"><div class="toolbar-group"><span class="badge">${state.projects.length} projects</span><span class="badge badge-success">${state.projects.filter((project) => project.status === 'healthy').length} healthy</span>${state.runtimeConfigPath ? '<span class="badge">shared registry</span>' : ''}${state.runtimeConfigWriteError ? `<span class="badge badge-warning" title="${escapeHtml(state.runtimeConfigWriteError)}">config write unavailable</span>` : ''}</div><div class="input-wrap search-wide">${icon('search')}<input class="input" type="search" placeholder="Search project or filesystem path…" aria-label="Search projects" data-live-filter=".record-row"></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Project and filesystem root</th><th>Task folder</th><th>Integrity</th><th>Access</th><th>Last scan</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
