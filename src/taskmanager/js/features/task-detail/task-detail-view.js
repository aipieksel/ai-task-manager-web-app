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
  lifecycleValueForTask,
  modifiedLabel,
  plural,
  queueStatusFilterValue,
  renderAgentActivityPanel,
  renderChecklistAccordion,
  renderPlanMetadataPanels,
  renderPriorityCommentPanel,
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
} from '../../ui/view-helpers.js';

import { renderUserFeedbackPanel } from '../queue/queue-view.js';

function sectionAnchor(section) {
  return slugify(section.sectionId || section.title || section.file || 'section');
}

function renderSectionDocument(task) {
  if (task.planKind !== 'folder' || !task.planSections?.length) {
    const legacySections = (task.sections || []).filter((section) => section.level === 2);
    if (!legacySections.length) return renderMarkdown(stripPlanDocumentChrome(task.raw));
    return legacySections.map((section, index) => {
      const anchor = slugify(section.title);
      const heading = escapeHtml(section.title);
      const body = `## ${section.title}\n\n${section.content || ''}`;
      return `<details class="plan-section-card plan-section-accordion plan-section-layout-article" id="${escapeHtml(anchor)}" data-plan-section="${escapeHtml(section.id || anchor)}">
        <summary class="plan-section-card-header"><span class="plan-section-title"><span class="plan-section-number">${String(index + 1).padStart(2, '0')}</span><span>${heading}</span></span></summary>
        <div class="markdown-body">${renderMarkdown(stripPlanDocumentChrome(body))}</div>
      </details>`;
    }).join('');
  }
  return task.planSections.map((section) => {
    const anchor = sectionAnchor(section);
    const layout = escapeHtml(section.layout || 'article');
    const heading = escapeHtml(section.title || section.navLabel || section.file);
    const file = escapeHtml(section.file || fileLabel(section.path));
    return `<details class="plan-section-card plan-section-accordion plan-section-layout-${layout}" id="${escapeHtml(anchor)}" data-plan-section="${escapeHtml(section.sectionId || section.file)}">
      <summary class="plan-section-card-header"><span class="plan-section-title"><span class="plan-section-number">${String(section.order || '').padStart(2, '0')}</span><span>${heading}</span></span></summary>
      <div class="markdown-body">${renderMarkdown(stripPlanDocumentChrome(section.text || ''))}</div>
    </details>`;
  }).join('');
}

export function renderTaskDetail(route) {
  const domain = aggregateDomain();
  const task = selectedTask(route, domain, true);
  if (!task) return `<div class="workspace-page plan-workspace"><header class="workspace-toolbar"><div class="workspace-heading"><div class="workspace-heading-copy"><h1>Plan workspace</h1><p>Inspect the complete generated plan without leaving TaskManager.</p></div></div></header><div class="workspace-empty">${emptyState({ title: 'No generated plans available', description: 'Connect and scan a task system containing lifecycle plan files.', action: actionLink('Open queue', '/', {}, true), iconName: 'plan' })}</div></div>`;
  const outlineSections = task.planKind === 'folder' && task.planSections?.length
    ? task.planSections.map((section) => ({ ...section, title: section.navLabel || section.title, anchor: sectionAnchor(section) }))
    : task.sections.filter((section) => section.level === 2).map((section) => ({ ...section, anchor: slugify(section.title) }));
  const sectionButtons = outlineSections.map((section, index) => `<button class="plan-nav-link ${index === 0 ? 'active' : ''}" type="button" data-action="scroll-plan-section" data-section-id="${escapeHtml(section.anchor)}"><span class="plan-nav-index">${String(index + 1).padStart(2, '0')}</span><span>${escapeHtml(section.title)}</span></button>`).join('');
  const lifecycleActions = taskStatusControl(task, { compact: false });
  const planHtml = renderSectionDocument(task);
  const questionSummary = task.questionCount ? `${task.questionCount - task.unansweredQuestions} questions resolved` : 'No questions parsed';
  const openQuestions = task.unansweredQuestions ? `${task.unansweredQuestions} questions open` : 'Questions clear';
  return `<div class="workspace-page plan-workspace"><header class="workspace-toolbar"><div class="workspace-heading"><a class="icon-btn back-btn" href="#/" aria-label="Back to queue">${icon('back')}</a><div class="workspace-heading-copy"><h1>${escapeHtml(task.title)}</h1><p>${escapeHtml(task.projectName)} · ${escapeHtml(task.filename)} · ${escapeHtml(cleanStatusLabel(task.status))}</p></div></div><div class="header-actions">${task.unansweredQuestions ? actionLink(`Answer ${task.unansweredQuestions} questions`, '/questions', { task: task.id }) : actionLink('Questions', '/questions', { task: task.id })}${lifecycleActions}</div></header><div class="workspace-body"><aside class="workspace-pane plan-nav"><div class="pane-header"><strong>Plan outline</strong><span>${outlineSections.length} generated sections</span></div><div class="plan-nav-list">${sectionButtons}</div></aside><article class="workspace-pane plan-document"><div class="plan-doc-inner"><header class="plan-doc-title"><span class="page-kicker">${task.planKind === 'folder' ? 'Generated plan folder' : 'Generated implementation plan'}</span><h2>${escapeHtml(task.title)}</h2><div class="plan-badges"><span class="badge">Plan score ${escapeHtml(task.score || '—')}</span><span class="badge">Risk: ${escapeHtml(riskLabel(task))}</span>${task.planKind === 'folder' ? `<span class="badge">${escapeHtml(String(task.planSections?.length || 0))} files</span>` : ''}<span class="status-text">${escapeHtml(questionSummary)}</span>${task.unansweredQuestions ? `<span class="status-text">${escapeHtml(openQuestions)}</span>` : ''}</div></header>${planHtml}</div></article><aside class="workspace-pane inspector-pane plan-control-pane"><div class="inspector-top"><strong>Plan controls</strong><span>Lifecycle and gate state</span></div>${renderAgentActivityPanel(task)}${renderPriorityCommentPanel(task)}${renderUserFeedbackPanel(task)}<section class="plan-score-card">${scoreRingHtml(task.score)}<div><strong>Plan score</strong><span>${escapeHtml(scoreCaption(task.score))} ${task.unansweredQuestions ? `${task.unansweredQuestions} decisions remain open.` : 'No open decisions.'}</span></div></section>${renderPlanMetadataPanels(task)}${renderChecklistAccordion(task, 'Checklist in plan order')}<section class="plan-inspector-section"><h3>Approval gates</h3><div class="gate-row"><span class="check-box checked"></span><span>Documentation routed</span><span class="status-text">Pass</span></div><div class="gate-row"><span class="check-box checked"></span><span>Request reviewed</span><span class="status-text">Pass</span></div><div class="gate-row"><span class="check-box ${task.unansweredQuestions ? '' : 'checked'}"></span><span>Questions resolved</span><span class="status-text">${escapeHtml(task.unansweredQuestions ? `${task.unansweredQuestions} open` : 'Pass')}</span></div><div class="gate-row"><span class="check-box"></span><span>User approved</span><span class="status-text">${escapeHtml(task.lifecycle === 'draft' ? 'Waiting' : cleanStatusLabel(task.status))}</span></div></section><div class="decision-label">${task.planKind === 'folder' ? 'Plan folder' : 'Plan file'}</div><div class="path-block">${escapeHtml(task.path)}</div><div class="inspector-actions">${actionLink('Verification run', '/verification', { task: task.id }, true)}${actionLink('Queue', '/')}</div></aside></div></div>`;
}
