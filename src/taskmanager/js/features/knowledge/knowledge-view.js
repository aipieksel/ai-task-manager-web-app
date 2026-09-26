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

export function renderLessons(route) {
  const domain = aggregateDomain();
  const tab = route.params.get('tab') || 'active';
  const valid = ['active', 'archive', 'index'];
  const layer = valid.includes(tab) ? tab : 'active';
  const lessons = domain.lessons.filter((lesson) => lesson.layer === layer || (layer === 'index' && lesson.layer === 'index-error'));
  const selected = lessons.find((lesson) => lesson.id === route.params.get('id')) || lessons[0] || null;
  const header = pageHeader({ kicker: 'Knowledge / Lessons library', title: 'Lessons library', description: 'Browse active guidance, the full archive, and the path-aware index generated for each project.' });
  const tabs = [['active', 'Active'], ['archive', 'Archive'], ['index', 'Index']].map(([key, label]) => `<a class="tab ${layer === key ? 'active' : ''}" href="#/lessons?tab=${key}" role="tab" aria-selected="${layer === key}">${label}</a>`).join('');
  if (!lessons.length) return `<div class="page">${header}<div class="tabs">${tabs}</div>${emptyState({ title: `No ${layer} lessons`, description: 'This view is populated directly from lessons-active.md, lessons.md, or lessons-index.json.', iconName: 'lessons' })}</div>`;
  const list = lessons.map((lesson) => `<a class="library-item ${lesson.id === selected.id ? 'active' : ''}" href="#/lessons?tab=${layer}&id=${encodeURIComponent(lesson.id)}"><strong>${escapeHtml(lesson.title)}</strong><span>${escapeHtml(lesson.projectName)}</span></a>`).join('');
  const detail = layer === 'index' ? `<pre class="answer-preview">${escapeHtml(JSON.stringify({ id: selected.id, title: selected.title, keywords: selected.keywords || [], paths: selected.paths || [], workflows: selected.workflows || [], active: selected.active }, null, 2))}</pre>` : `<div class="markdown-body">${renderMarkdown(selected.content)}</div>`;
  return `<div class="page lessons-page">${header}<div class="tabs" role="tablist">${tabs}</div><div class="library-shell"><aside class="library-index"><div class="input-wrap">${icon('search')}<input class="input" type="search" placeholder="Search lessons…" data-live-filter=".library-item" aria-label="Search lessons"></div><div class="library-list">${list}</div></aside><article class="library-detail"><span class="page-kicker">${escapeHtml(selected.projectName)} / ${escapeHtml(layer)}</span><h2>${escapeHtml(selected.title)}</h2><div class="path-block">${escapeHtml(selected.path)}</div>${detail}</article></div></div>`;
}

export function renderObservations(route) {
  const domain = aggregateDomain();
  const tab = route.params.get('tab') || 'critical';
  const valid = ['critical', 'recommendation', 'anomaly', 'closed'];
  const type = valid.includes(tab) ? tab : 'critical';
  const observations = domain.observations.filter((item) => item.type === type);
  const header = pageHeader({ kicker: 'Knowledge / Observation triage', title: 'Observation triage', description: 'Review discoveries separately from completed-work logs and lifecycle records.' });
  const tabs = [['critical', 'Critical'], ['recommendation', 'Recommendations'], ['anomaly', 'Anomalies'], ['closed', 'Closed']].map(([key, label]) => `<a class="tab ${type === key ? 'active' : ''}" href="#/observations?tab=${key}" role="tab" aria-selected="${type === key}">${label}</a>`).join('');
  const content = observations.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Observation</th><th>Project</th><th>Impact</th><th>Action</th><th>Status</th><th>Date</th></tr></thead><tbody>${observations.map((item) => `<tr class="record-row"><td><div class="row-title-copy"><strong>${escapeHtml(item.observation)}</strong><span>${escapeHtml(item.source)}</span></div></td><td>${escapeHtml(item.projectName)}</td><td>${escapeHtml(item.impact)}</td><td>${escapeHtml(item.action)}</td><td>${statusBadge(item.status || item.type)}</td><td>${escapeHtml(item.date)}</td></tr>`).join('')}</tbody></table></div>` : emptyState({ title: `No ${type} observations`, description: 'Observation rows are loaded from the configured agent-observations files.', iconName: 'observations' });
  return `<div class="page observations-page">${header}<div class="tabs" role="tablist">${tabs}</div>${content}</div>`;
}
