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

function renderActivityHistogram(records) {
  const now = Math.max(Date.now(), ...records.map((entry) => Number(new Date(entry.timestamp).getTime()) || 0));
  const buckets = Array.from({ length: 28 }, () => 0);
  records.forEach((entry) => {
    const timestamp = Number(new Date(entry.timestamp).getTime());
    if (!Number.isFinite(timestamp)) return;
    const ageHours = Math.floor((now - timestamp) / 3600000);
    if (ageHours >= 0 && ageHours < buckets.length) buckets[buckets.length - 1 - ageHours] += 1;
  });
  const max = Math.max(1, ...buckets);
  return `<div class="histogram" role="img" aria-label="Task activity over the last 28 hours">${buckets.map((count) => {
    const height = count ? Math.max(18, Math.round((count / max) * 100)) : 4;
    return `<span class="histogram-bar ${count ? 'hot' : ''}" style="height:${height}%" title="${count} event${count === 1 ? '' : 's'}"></span>`;
  }).join('')}</div>`;
}

export function renderQuestions(route) {
  const domain = aggregateDomain();
  const taskFilter = route.params.get('task');
  const questions = taskFilter ? domain.questions.filter((question) => question.taskId === taskFilter) : domain.questions;
  const selectedUid = route.params.get('id') || getState().selectedQuestionId || questions.find((question) => !question.answered)?.uid || questions[0]?.uid;
  const selected = questions.find((question) => question.uid === selectedUid) || questions[0] || null;
  if (!selected) return `<div class="workspace-page question-workspace"><header class="workspace-toolbar"><div class="workspace-heading"><div class="workspace-heading-copy"><h1>Decision desk</h1><p>Select generated answers directly and preserve the complete decision trail.</p></div></div></header><div class="workspace-empty">${emptyState({ title: 'No generated questions', description: 'Questions appear here after a scanned plan contains a Question History or Open Questions block.', action: actionLink('Open queue', '/', {}, true), iconName: 'questions' })}</div></div>`;
  const task = domain.tasks.find((item) => item.id === selected.taskId);
  const answered = questions.filter((question) => question.answered).length;
  const allAnswered = questions.length > 0 && answered === questions.length;
  const selectedAnswerKey = /^\(?([a-z])\)?/i.exec(selected.answer || '')?.[1]?.toLowerCase() || '';
  const list = questions.map((question) => `<button class="question-list-button ${question.uid === selected.uid ? 'active' : ''} ${question.answered ? 'answered' : ''}" type="button" data-action="select-question" data-question-id="${question.uid}" data-task-id="${escapeHtml(question.taskId)}"><span class="question-index">${escapeHtml(question.id)}</span><span class="question-list-copy"><strong>${escapeHtml(question.question)}</strong><span>${escapeHtml(question.decision || (question.answered ? 'Answered' : 'Awaiting decision'))}</span></span><span class="question-state-dot" aria-hidden="true"></span></button>`).join('');
  const options = selected.options.map((option) => {
    const selectedClass = selected.answered && option.key.toLowerCase() === selectedAnswerKey ? 'selected answered' : '';
    const disabledAttrs = selected.answered ? 'disabled aria-disabled="true"' : `data-action="select-answer-option"`;
    return `<button class="option ${option.recommended ? 'recommended' : ''} ${selectedClass}" type="button" role="radio" aria-checked="${selectedClass ? 'true' : 'false'}" ${disabledAttrs} data-option-key="${escapeHtml(option.key)}"><span class="option-mark"></span><span class="option-copy"><strong>(${escapeHtml(option.key)}) ${escapeHtml(option.text)}</strong><span>${option.recommended ? escapeHtml(selected.recommendation || 'Recommended by the planning agent.') : 'Alternative preserved in the generated question history.'}</span></span>${option.recommended ? '<span class="recommended-tag">Recommended</span>' : ''}</button>`;
  }).join('');
  const currentAnswer = selected.answered ? selected.answer : 'No answer selected.';
  const instructionFilename = fileLabel(task?.filename || selected.planPath || '');
  const pendingInstruction = `I have answered all the questions on the document ${instructionFilename}, move the plan to pending`;
  const approvalGateInstruction = `I have answered all the questions on the document ${instructionFilename}; update the plan, keep it in pending, and do not execute until I change its TaskManager status to Approved.`;
  const taskQuestionsComplete = task ? Number(task.questionCount || 0) > 0 && Number(task.unansweredQuestions || 0) === 0 : allAnswered;
  const copyInstructionActions = taskQuestionsComplete ? `${button('Copy Pending Instructions', 'copy-text', { attrs: `data-copy-text="${escapeHtml(pendingInstruction)}"` })}${button('Copy Approval Gate', 'copy-text', { attrs: `data-copy-text="${escapeHtml(approvalGateInstruction)}"` })}` : '';
  const questionActions = selected.answered
    ? `<div class="question-actions question-actions-locked"><p>This decision is already answered in the source plan, so TaskManager will not write another answer over it.</p><div class="inline-actions"><span class="badge badge-success">Answered</span>${copyInstructionActions}${actionLink('Review plan', '/task', { id: selected.taskId })}</div></div>`
    : `<div class="question-actions"><p>Selection writes to the original plan question block and preserves every option.</p><div class="inline-actions"><button class="btn" type="button">Leave unanswered</button>${button('Save answer', 'save-answer', { primary: true, attrs: `data-question-id="${selected.uid}" disabled` })}</div></div>`;
  const progress = questions.length ? Math.round((answered / questions.length) * 100) : 0;
  const planSections = [selected.decision, 'Question History', 'Implementation Steps', 'Verification Plan'].filter(Boolean).join(', ');
  return `<div class="workspace-page question-workspace"><header class="workspace-toolbar"><div class="workspace-heading"><a class="icon-btn back-btn" href="#/" aria-label="Back to queue">${icon('back')}</a><div class="workspace-heading-copy"><span class="workspace-kicker">${escapeHtml(selected.projectName)} · ${escapeHtml(selected.taskTitle)}</span><h1>Decision desk</h1><p>Question history remains in the plan file.</p></div></div><div class="header-actions">${allAnswered ? '<span class="badge badge-success">All answered</span>' : button('Use recommended for all', 'use-recommended', { iconName: 'refresh', attrs: `data-task-id="${selected.taskId}"` })}${actionLink('Review plan', '/task', { id: selected.taskId }, true)}</div></header><div class="workspace-body"><aside class="workspace-pane question-list-pane"><div class="pane-header"><strong>Open decisions</strong><span>${answered} of ${questions.length} answered</span></div><div class="question-list">${list}</div></aside><section class="workspace-pane question-canvas"><div class="question-canvas-inner"><div class="question-progress-strip"><span>${answered} of ${questions.length} answered</span><div class="progress-track"><div class="progress-bar" style="width:${progress}%"></div></div><span>${task?.score ? `Plan score ${escapeHtml(task.score)}` : 'Plan score —'}</span></div><article class="question-panel"><span class="page-kicker">${escapeHtml(selected.id)} · ${escapeHtml(selected.decision || 'Planning decision')}</span><h2 tabindex="-1">${escapeHtml(selected.question)}</h2><div class="question-context-card"><strong>Why this matters:</strong> <span>${escapeHtml(selected.why || 'This choice changes the approved implementation path and is preserved in the plan.')}</span></div><div class="option-list" role="radiogroup" aria-label="Answer choices">${options}</div><label class="field other-answer" hidden data-other-answer><span>Custom answer</span><textarea class="textarea" rows="4" data-custom-answer placeholder="Enter the exact answer to write into the plan"></textarea></label>${questionActions}</article></div></section><aside class="workspace-pane decision-inspector"><div class="inspector-top"><strong>Decision impact</strong><span>What this answer changes</span></div><div class="decision-impact-list"><section><strong>Target artifact</strong><span>${escapeHtml(task?.filename || selected.planPath)}</span></section><section><strong>Plan sections affected</strong><span>${escapeHtml(planSections)}</span></section><section><strong>Write behavior</strong><span>Atomic save → re-read → verify exact answer line and source.</span></section><section><strong>History policy</strong><span>Question text, options, recommendation, rejected alternatives, and prior answers remain visible.</span></section></div><div class="decision-label">Markdown preview</div><pre class="answer-preview" data-answer-preview>Answer: ${escapeHtml(currentAnswer)}\nAnswer source: ${escapeHtml(selected.answerSource || 'Not recorded')}</pre><div class="conflict-callout"><strong>Conflict protection</strong><span>If the plan revision changes while this page is open, the save is blocked and a file diff is shown.</span></div></aside></div></div>`;
}

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
  const passedRecords = records.filter((record) => record.items?.length && record.items.every((item) => item.checked)).length;
  const runningRecords = records.filter((record) => {
    const recordTask = domain.tasks.find((item) => item.id === record.taskId);
    return recordTask && !isTerminalTask(recordTask);
  }).length;
  const scenarioButtons = recordsByFreshness.map((record) => {
    const recordTask = domain.tasks.find((item) => item.id === record.taskId);
    const recordItems = record.items || [];
    const done = recordItems.filter((item) => item.checked).length;
    const dotState = done === recordItems.length && recordItems.length ? 'pass' : /progress/i.test(recordTask?.lifecycle || '') ? 'run' : 'wait';
    return `<a class="scenario-button ${record.id === selected.id ? 'active' : ''}" href="#/verification?task=${encodeURIComponent(record.taskId)}"><span class="scenario-status ${dotState}" aria-hidden="true"></span><span class="scenario-copy"><strong>${escapeHtml(record.taskTitle)}</strong><span>${escapeHtml(dotState === 'pass' ? 'Passed' : dotState === 'run' ? 'Running' : 'Queued')}</span></span><span class="scenario-count">${recordItems.length ? `${done}/${recordItems.length}` : '0 checks'}</span></a>`;
  }).join('');
  const checkRows = items.map((item, index) => `<div class="check-row"><span class="check-box ${item.checked ? 'checked' : ''}"></span><span class="check-copy"><strong>${escapeHtml(item.text)}</strong><span>Mapped to ${escapeHtml(fileLabel(selected.path))} · V${index + 1}</span></span><span>${escapeHtml(item.checked ? 'Plan file' : 'Awaiting evidence')}</span><span>${statusBadge(item.checked ? 'Pass' : 'Queued')}</span></div>`).join('');
  const sectionCards = selected.sections.slice(0, 2).map((section) => `<article class="evidence-card"><div class="evidence-visual">${icon('verification')}</div><div class="evidence-body"><strong>${escapeHtml(section.title)}</strong><span>Source section parsed from the current plan.</span></div></article>`).join('');
  return `<div class="workspace-page verification-workspace"><header class="workspace-toolbar"><div class="workspace-heading"><a class="icon-btn back-btn" href="#/" aria-label="Back to queue">${icon('back')}</a><div class="workspace-heading-copy"><h1>Verification run</h1><p>${escapeHtml(selected.taskTitle)} · evidence must match the approved plan</p></div>${statusBadge(selectedStatus)}</div><div class="header-actions">${actionLink('Review plan', '/task', { id: selected.taskId })}${button('Run next check', 'scan-all', { primary: true, iconName: 'verification' })}</div></header><div class="workspace-body"><aside class="workspace-pane scenario-pane"><div class="pane-header"><strong>Scenario matrix</strong><span>${passedRecords} passed · ${runningRecords} running · ${Math.max(0, records.length - passedRecords - runningRecords)} queued</span></div><div class="scenario-list">${scenarioButtons}</div></aside><section class="workspace-pane verification-canvas"><div class="verification-canvas-inner"><div class="run-summary"><div><span class="page-kicker">Scenario ${String(Math.max(1, recordsByFreshness.findIndex((record) => record.id === selected.id) + 1)).padStart(2, '0')}</span><h2>Inspect the complete generated plan</h2><p>Confirm checklist state, generated plan rendering, closeout status, and parsed verification items in a real rendered browser.</p></div>${statusBadge(`${selectedDone} of ${items.length} checks`)}</div>${items.length ? `<div class="check-matrix"><div class="check-row header"><span></span><span>Verification item</span><span>Evidence</span><span>Status</span></div>${checkRows}</div>` : '<p class="muted-copy">No verification checkboxes were parsed from this plan.</p>'}<section class="evidence-section"><div class="section-head"><div><h3>Evidence</h3><p>Each state is read from the current file-backed task system.</p></div>${actionLink('Add evidence', '/activity')}</div><div class="evidence-grid">${sectionCards || `<article class="evidence-card"><div class="evidence-visual">${icon('verification')}</div><div class="evidence-body"><strong>Plan source</strong><span>No extra evidence sections were parsed.</span></div></article>`}</div></section></div></section><aside class="workspace-pane inspector-pane verification-controls"><div class="inspector-top"><strong>Run controls</strong><span>Selected verification method</span></div><section class="method-card"><strong>Local runtime browser pass</strong><span>Live rendered page inspection with filesystem-backed plan data and screenshot capture.</span></section><section class="plan-inspector-section"><h3>Required gates</h3><div class="gate-row"><span class="check-box checked"></span><span>Implementation checks</span><span>${statusBadge(selectedDone ? 'Pass' : 'Pending')}</span></div><div class="gate-row"><span class="check-box ${items.length ? 'checked' : ''}"></span><span>Plan checklist parsed</span><span>${statusBadge(items.length ? 'Pass' : 'Pending')}</span></div><div class="gate-row"><span class="check-box ${selectedDone === items.length && items.length ? 'checked' : ''}"></span><span>Visual verification</span><span>${statusBadge(selectedStatus)}</span></div><div class="gate-row"><span class="check-box"></span><span>User verification</span><span>${statusBadge(task?.closeout || 'Blocked')}</span></div></section><div class="decision-label">Screenshot root</div><div class="path-block">data/temp/screenshots/2026-06-21-all-pages-visual-pass/</div><div class="inspector-actions">${actionLink('Open plan', '/task', { id: selected.taskId }, true)}${actionLink('Change feed', '/activity')}</div></aside></div></div>`;
}

export function renderActivity(route) {
  const state = getState();
  const tab = route.params.get('tab') || 'all';
  const tabMap = { all: () => true, agent: (entry) => entry.source === 'agent', taskmanager: (entry) => entry.source === 'taskmanager', conflicts: (entry) => entry.source === 'conflict' || entry.type === 'write-conflict' };
  const entries = state.activity.filter(tabMap[tab] || tabMap.all);
  const tabs = [['all', 'All changes'], ['agent', 'Agent writes'], ['taskmanager', 'TaskManager writes'], ['conflicts', 'Conflicts']].map(([key, label]) => `<a class="tab ${tab === key ? 'active' : ''}" href="#/activity?tab=${key}" role="tab" aria-selected="${tab === key}">${label}</a>`).join('');
  const header = pageHeader({ kicker: 'Operations / Change feed', title: 'Change feed', description: 'Append-only local audit history for scans, agent file changes, TaskManager writes, and conflicts.', actions: `<button class="btn" type="button">${icon('download')}<span>Export events</span></button>${button('Refresh', 'scan-all', { primary: true, iconName: 'refresh' })}` });
  const histogram = renderActivityHistogram(state.activity);
  const table = entries.length ? `<div class="table-wrap"><table class="data-table activity-table"><thead><tr><th>Event</th><th>Project</th><th>Source</th><th>Path</th><th>When</th></tr></thead><tbody>${entries.map((entry) => `<tr class="record-row" data-filter-row><td><div class="activity-event"><span class="activity-icon ${entry.level === 'error' ? 'danger' : ''}">${icon(entry.source === 'conflict' ? 'warning' : entry.source === 'agent' ? 'activity' : 'check')}</span><div class="row-title-copy"><strong>${escapeHtml(entry.summary || entry.type)}</strong><span>${escapeHtml(entry.detail || entry.type || '')}</span></div></div></td><td>${escapeHtml(entry.projectName || 'Local')}</td><td>${statusBadge(entry.source)}</td><td class="mono activity-path" title="${escapeHtml(entry.path || '')}">${escapeHtml(fileLabel(entry.path))}</td><td>${formatRelativeTime(entry.timestamp)}</td></tr>`).join('')}</tbody></table></div>` : emptyState({ title: 'No activity in this view', description: 'Activity is recorded after projects are scanned or TaskManager writes to a connected file.', iconName: 'activity' });
  return `<div class="page activity-page">${header}<div class="toolbar"><div class="toolbar-group"><div class="tabs" role="tablist">${tabs}</div></div><div class="toolbar-group"><div class="input-wrap search-wide">${icon('search')}<input class="input" type="search" placeholder="Search event ID or message…" aria-label="Search activity" data-live-filter=".record-row"></div><button class="btn" type="button">${icon('filter')}<span>Date range</span></button></div></div>${histogram}${table}</div>`;
}
