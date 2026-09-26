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

export function renderSettings() {
  const state = getState();
  const settings = state.settings;
  const aliases = settings.documentationFolderNames.map((name) => `<span class="alias-chip"><code>${escapeHtml(name)}</code><button type="button" data-action="remove-doc-alias" data-alias="${escapeHtml(name)}" aria-label="Remove ${escapeHtml(name)}">${icon('close', 'icon icon-sm')}</button></span>`).join('');
  const taskAliases = settings.taskFolderNames.map((name) => `<span class="alias-chip"><code>${escapeHtml(name)}</code><button type="button" data-action="remove-task-alias" data-alias="${escapeHtml(name)}" aria-label="Remove ${escapeHtml(name)}">${icon('close', 'icon icon-sm')}</button></span>`).join('');
  const header = pageHeader({ kicker: 'TaskManager settings', title: 'General settings', description: 'Control runtime-server task discovery, interactive answers, filesystem writes, lifecycle transitions, conflict handling, and verification policy.', actions: button('Save changes', 'save-settings', { primary: true, iconName: 'check' }) });
  return `<div class="page settings-page">${header}
    <section class="settings-section" id="watching"><div class="settings-section-head"><h2>Discovery and file watching</h2><p>How TaskManager finds and refreshes generated task artifacts.</p></div>
      <div class="settings-row"><div class="settings-row-copy"><strong>Documentation folder names</strong><span>Add every directory name that may contain a generated task folder.</span><div class="alias-list">${aliases}</div></div><form class="alias-form" data-form="add-doc-alias"><input class="input" name="alias" placeholder="e.g. project-docs" autocomplete="off"><button class="btn" type="submit">Add name</button></form></div>
      <div class="settings-row"><div class="settings-row-copy"><strong>Task folder names</strong><span>Names searched beneath documentation directories and at the selected project root.</span><div class="alias-list">${taskAliases}</div></div><form class="alias-form" data-form="add-task-alias"><input class="input" name="alias" placeholder="e.g. tasks" autocomplete="off"><button class="btn" type="submit">Add name</button></form></div>
      <div class="settings-row"><div class="settings-row-copy"><strong>Automatic task-folder watching</strong><span>Detect external task-file changes while the app is open and refresh affected views in place.</span></div><button class="toggle" type="button" role="switch" aria-checked="${settings.autoScan}" data-action="toggle-setting" data-setting="autoScan" aria-label="Automatic task-folder watching"></button></div>
      <div class="settings-row"><div class="settings-row-copy"><strong>Watch interval</strong><span>Lower values detect agent file changes faster but increase filesystem reads.</span></div><select class="select select-compact" data-setting-select="scanIntervalMs"><option value="10000" ${settings.scanIntervalMs === 10000 ? 'selected' : ''}>10 seconds</option><option value="30000" ${settings.scanIntervalMs === 30000 ? 'selected' : ''}>30 seconds</option><option value="60000" ${settings.scanIntervalMs === 60000 ? 'selected' : ''}>1 minute</option><option value="300000" ${settings.scanIntervalMs === 300000 ? 'selected' : ''}>5 minutes</option></select></div>
    </section>
    <section class="settings-section" id="questions"><div class="settings-section-head"><h2>Interactive question answers</h2><p>How generated plan questions are presented and written back.</p></div>
      <div class="settings-row"><div class="settings-row-copy"><strong>Clickable answer choices</strong><span>Render every generated option as a single-choice control instead of requiring raw Markdown edits.</span></div>${statusBadge('Enabled')}</div>
      <div class="settings-row"><div class="settings-row-copy"><strong>Runtime server writes</strong><span>Write task files through tooling/scripts/serve-runtime.py instead of browser storage or handles.</span></div><button class="toggle" type="button" role="switch" aria-checked="${settings.requestWriteAccess}" data-action="toggle-setting" data-setting="requestWriteAccess" aria-label="Request write access"></button></div>
      <div class="settings-row"><div class="settings-row-copy"><strong>Preserve unknown plan sections</strong><span>Custom Markdown sections are retained during targeted TaskManager writes.</span></div>${statusBadge('Enforced')}</div>
      <div class="settings-row"><div class="settings-row-copy"><strong>Answer source label</strong><span>Stored beside answers written through the Decision desk.</span></div><input class="input select-compact mono" type="text" value="TaskManager interactive choice" readonly></div>
    </section>
    <section class="settings-section" id="lifecycle"><div class="settings-section-head"><h2>Lifecycle writes</h2><p>Safety rules for plan-folder transitions. Status dropdown changes run immediately.</p></div>
      <div class="settings-row"><div class="settings-row-copy"><strong>Enforce copy → verify → delete</strong><span>Rename and move APIs are not used for lifecycle transitions.</span></div>${statusBadge('Enforced')}</div>
      <div class="settings-row"><div class="settings-row-copy"><strong>Confirm manual plan moves</strong><span>Require explicit confirmation before using a manual Move plan action.</span></div><button class="toggle" type="button" role="switch" aria-checked="${settings.confirmLifecycleWrites}" data-action="toggle-setting" data-setting="confirmLifecycleWrites" aria-label="Confirm manual plan moves"></button></div>
      <div class="settings-row"><div class="settings-row-copy"><strong>Write verification</strong><span>After every answer, task capture, or lifecycle update, re-read the file and verify persisted content.</span></div>${statusBadge('Enforced')}</div>
    </section>
    <section class="settings-section" id="verification"><div class="settings-section-head"><h2>Verification and conflicts</h2><p>Blocking behavior for stale revisions and source-preserving writes.</p></div>
      <div class="settings-row"><div class="settings-row-copy"><strong>Revision conflict policy</strong><span>Stale revisions are blocked and must be rescanned before TaskManager can retry the write.</span></div>${statusBadge('Block and rescan')}</div>
      <div class="settings-row"><div class="settings-row-copy"><strong>Selected verification method</strong><span>Read from each project’s generated verification.md profile.</span></div><span class="badge">Project profile</span></div>
    </section>
    <section class="settings-section" id="pwa-install"><div class="settings-section-head"><h2>PWA app install</h2><p>TaskManager ships with a manifest, service worker, offline app shell, and generated macOS launcher metadata.</p></div>
      <div class="settings-row"><div class="settings-row-copy"><strong>Browser app install</strong><span>Install the browser PWA when your browser exposes the install prompt.</span></div>${button('Install browser app', 'install-pwa', { iconName: 'plus' })}</div>
      <div class="settings-row"><div class="settings-row-copy"><strong>Reload current app window</strong><span>Refresh the installed Mac/PWA shell when the window does not expose a browser reload control.</span></div>${button('Reload app', 'reload-app', { iconName: 'refresh' })}</div>
      <div class="settings-row"><div class="settings-row-copy"><strong>macOS launcher registry</strong><span>Launcher setup is controlled by data/runtime/config/pwa.json and uses the TaskManager icon.</span></div><span class="badge">File-backed registry</span></div>
    </section>
    <section class="settings-section" id="browser-cleanup"><div class="settings-section-head"><h2>Browser cleanup registry</h2><p>Runtime startup clears stale browser service workers, cache storage, and legacy client storage before loading file-backed project configuration.</p></div>
      <div class="settings-row"><div class="settings-row-copy"><strong>Cleanup source</strong><span>Controlled by data/runtime/config/browser.json and applied before data/runtime/projects.json is hydrated.</span></div><span class="badge">File-backed registry</span></div>
      <div class="settings-row"><div class="settings-row-copy"><strong>Clear browser residue now</strong><span>Remove previous browser-backed state for this origin, then continue using the runtime registry.</span></div>${button('Clear browser residue', 'clear-browser-residue', { iconName: 'trash' })}</div>
    </section>
    <section class="danger-zone"><h2>Reset in-memory TaskManager state</h2><p class="muted">Reload file-backed project configuration and clear the current in-page activity feed. Project task files are not deleted.</p>${button('Reload file-backed configuration', 'reset-state', { iconName: 'trash' })}</section>
  </div>`;
}
