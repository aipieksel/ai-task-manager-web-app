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
  isTerminalTask,
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

export function renderVerification(route) {
  const domain = aggregateDomain();
  const taskId = route.params.get('task');
  const records = domain.verifications;
  const recordsByFreshness = [...records].sort((a, b) => {
    const taskA = domain.tasks.find((item) => item.id === a.taskId);
    const taskB = domain.tasks.find((item) => item.id === b.taskId);
    const taskAFreshness = Number(taskA?.lastModified || 0);
    const taskBFreshness = Number(taskB?.lastModified || 0);
    const taskAOpen = taskA ? !isTerminalTask(taskA) : false;
    const taskBOpen = taskB ? !isTerminalTask(taskB) : false;
    if (taskAOpen !== taskBOpen) return taskAOpen ? -1 : 1;
    return (taskBFreshness - taskAFreshness) || String(a.taskTitle).localeCompare(String(b.taskTitle));
  });
  const selected = taskId
    ? records.find((record) => record.taskId === taskId) || records[0] || null
    : recordsByFreshness.find((record) => {
      const task = domain.tasks.find((item) => item.id === record.taskId);
      return task && !isTerminalTask(task);
    }) || records[0] || null;
  if (!selected) return `<div class="workspace-page verification-workspace"><header class="workspace-toolbar"><div class="workspace-heading"><div class="workspace-heading-copy"><h1>Verification run</h1><p>Inspect blocking evidence, reconciliation, and closeout gates.</p></div></div></header><div class="workspace-empty">${emptyState({ title: 'No verification plans available', description: 'Verification surfaces are created from generated plan sections and checkboxes.', action: actionLink('Open queue', '/', {}, true), iconName: 'verification' })}</div></div>`;
  const task = domain.tasks.find((item) => item.id === selected.taskId);
  const items = selected.items || [];
  const selectedDone = items.filter((item) => item.checked).length;
  const selectedStatus = selectedDone === items.length && items.length ? 'Complete' : selectedDone ? 'Running' : 'Queued';
  const recordState = (record) => {
    const recordItems = record.items || [];
    if (recordItems.length && recordItems.every((item) => item.checked)) return 'passed';
    const recordTask = domain.tasks.find((item) => item.id === record.taskId);
    if (recordTask && !isTerminalTask(recordTask) && /in-progress|review|user-verification/i.test(recordTask.lifecycle || '')) return 'running';
    return 'queued';
  };
  const passedRecords = records.filter((record) => recordState(record) === 'passed').length;
  const runningRecords = records.filter((record) => recordState(record) === 'running').length;
  const scenarioButtons = recordsByFreshness.map((record) => {
    const recordTask = domain.tasks.find((item) => item.id === record.taskId);
    const recordItems = record.items || [];
    const done = recordItems.filter((item) => item.checked).length;
    const state = recordState(record);
    const dotState = state === 'passed' ? 'pass' : state === 'running' ? 'run' : 'wait';
    return `<a class="scenario-button ${record.id === selected.id ? 'active' : ''}" href="#/verification?task=${encodeURIComponent(record.taskId)}"><span class="scenario-status ${dotState}" aria-hidden="true"></span><span class="scenario-copy"><strong>${escapeHtml(record.taskTitle)}</strong><span>${escapeHtml(dotState === 'pass' ? 'Passed' : dotState === 'run' ? 'Running' : 'Queued')}</span></span><span class="scenario-count">${recordItems.length ? `${done}/${recordItems.length}` : '0 checks'}</span></a>`;
  }).join('');
  const checkRows = items.map((item, index) => `<div class="check-row"><span class="check-box ${item.checked ? 'checked' : ''}"></span><span class="check-copy"><strong>${escapeHtml(item.text)}</strong><span>Mapped to ${escapeHtml(fileLabel(selected.path))} · V${index + 1}</span></span><span>${escapeHtml(item.checked ? 'Plan file' : 'Awaiting evidence')}</span><span>${statusBadge(item.checked ? 'Pass' : 'Queued')}</span></div>`).join('');
  const sectionCards = selected.sections.slice(0, 2).map((section) => `<article class="evidence-card"><div class="evidence-visual"><span>${icon('verification')}<strong>Source-backed</strong><small>${escapeHtml(fileLabel(section.sourcePath || selected.path))}</small></span></div><div class="evidence-body"><strong>${escapeHtml(section.title)}</strong><span>Parsed from the current project task system.</span></div></article>`).join('');
  const userGate = task?.lifecycle === 'completed' ? 'Pass' : task?.lifecycle === 'user-verification' ? 'Awaiting user' : 'Pending';
  return `<div class="workspace-page verification-workspace"><header class="workspace-toolbar"><div class="workspace-heading"><a class="icon-btn back-btn" href="#/" aria-label="Back to queue">${icon('back')}</a><div class="workspace-heading-copy"><h1>Verification run</h1><p>${escapeHtml(selected.taskTitle)} · evidence must match the approved plan</p></div>${statusBadge(selectedStatus)}</div><div class="header-actions">${actionLink('Review plan', '/task', { id: selected.taskId })}${button('Run next check', 'scan-all', { primary: true, iconName: 'verification' })}</div></header><div class="workspace-body"><aside class="workspace-pane scenario-pane"><div class="pane-header"><strong>Scenario matrix</strong><span>${passedRecords} passed · ${runningRecords} running · ${Math.max(0, records.length - passedRecords - runningRecords)} queued</span></div><div class="scenario-list">${scenarioButtons}</div></aside><section class="workspace-pane verification-canvas"><div class="verification-canvas-inner"><div class="run-summary"><div><span class="page-kicker">Scenario ${String(Math.max(1, recordsByFreshness.findIndex((record) => record.id === selected.id) + 1)).padStart(2, '0')}</span><h2>Inspect the complete generated plan</h2><p>Confirm checklist state, generated plan rendering, closeout status, and parsed verification items in a real rendered browser.</p></div>${statusBadge(`${selectedDone} of ${items.length} checks`)}</div>${items.length ? `<div class="check-matrix"><div class="check-row header"><span></span><span>Verification item</span><span>Evidence</span><span>Status</span></div>${checkRows}</div>` : '<p class="muted-copy">No verification checkboxes were parsed from this plan.</p>'}<section class="evidence-section"><div class="section-head"><div><h3>Evidence</h3><p>Each state is read from the current file-backed task system.</p></div>${actionLink('Add evidence', '/activity')}</div><div class="evidence-grid">${sectionCards || `<article class="evidence-card"><div class="evidence-visual">${icon('verification')}</div><div class="evidence-body"><strong>Plan source</strong><span>No extra evidence sections were parsed.</span></div></article>`}</div></section></div></section><aside class="workspace-pane inspector-pane verification-controls"><div class="inspector-top"><strong>Run controls</strong><span>Selected verification method</span></div><section class="method-card"><strong>Local runtime browser pass</strong><span>Live rendered page inspection with filesystem-backed plan data and screenshot capture.</span></section><section class="plan-inspector-section"><h3>Required gates</h3><div class="gate-row"><span class="check-box ${selectedDone ? 'checked' : ''}"></span><span>Implementation checks</span><span>${statusBadge(selectedDone ? 'Pass' : 'Pending')}</span></div><div class="gate-row"><span class="check-box ${items.length ? 'checked' : ''}"></span><span>Plan checklist parsed</span><span>${statusBadge(items.length ? 'Pass' : 'Pending')}</span></div><div class="gate-row"><span class="check-box ${selectedDone === items.length && items.length ? 'checked' : ''}"></span><span>Visual verification</span><span>${statusBadge(selectedStatus)}</span></div><div class="gate-row"><span class="check-box ${userGate === 'Pass' ? 'checked' : ''}"></span><span>User verification</span><span>${statusBadge(userGate)}</span></div></section><div class="decision-label">Evidence root</div><div class="path-block">docs/tasks/planning/&lt;lifecycle&gt;/&lt;plan&gt;/evidence/proof-screenshots/</div><div class="inspector-actions">${actionLink('Open plan', '/task', { id: selected.taskId }, true)}${actionLink('Change feed', '/activity')}</div></aside></div></div>`;
}
