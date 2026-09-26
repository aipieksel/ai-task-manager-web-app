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
