import { icon } from './components.js';
import { getQueueCustomOrdering, getRoutePreference, getState, queueCustomOrderKey } from '../state/store.js';
import { escapeHtml, normalizePath } from '../lib/utils.js';

export function button(label, action, { primary = false, iconName = '', attrs = '' } = {}) {
  return `<button class="btn ${primary ? 'btn-primary' : ''}" type="button" data-action="${action}" ${attrs}>${iconName ? icon(iconName) : ''}<span>${escapeHtml(label)}</span></button>`;
}

export function actionLink(label, path, params = {}, primary = false) {
  const query = new URLSearchParams(params).toString();
  return `<a class="btn ${primary ? 'btn-primary' : ''}" href="#${path}${query ? `?${query}` : ''}">${escapeHtml(label)}</a>`;
}

export function selectedTask(route, domain, plansOnly = false) {
  const candidates = plansOnly ? domain.tasks.filter((task) => task.source === 'plan') : domain.tasks;
  const id = route.params.get('id') || getState().selectedTaskId;
  if (id) return candidates.find((task) => task.id === id) || candidates[0] || null;
  const open = candidates.filter((task) => !isTerminalTask(task));
  const byFreshness = (a, b) => (Number(b.lastModified || 0) - Number(a.lastModified || 0)) || String(a.title).localeCompare(String(b.title));
  return [...(open.length ? open : candidates)].sort(byFreshness)[0] || null;
}

export function isTerminalTask(task) {
  return /completed|archive/i.test(`${task?.lifecycle || ''} ${task?.status || ''}`);
}

export function lifecycleProgress(task) {
  if (task.lifecycle === 'archive') return 100;
  if (task.lifecycle === 'parked' || task.lifecycle === 'blocker') return 5;
  const states = ['draft', 'pending', 'approved', 'in-progress', 'review', 'user-verification', 'failed-user-verification', 'completed'];
  const index = Math.max(0, states.indexOf(task.lifecycle));
  const questionPart = task.questionCount ? (task.questionCount - task.unansweredQuestions) / task.questionCount : 1;
  const stepPart = task.totalSteps ? task.completedSteps / task.totalSteps : 0;
  return Math.round(Math.min(100, ((index / 7) * 60) + (questionPart * 15) + (stepPart * 25)));
}

export function answeredQuestionCount(task) {
  return Math.max(0, Number(task.questionCount || 0) - Number(task.unansweredQuestions || 0));
}

export function scoreNumber(score = '') {
  const value = String(score || '').trim();
  if (!value) return '—';
  const fraction = value.match(/\d+(?:\.\d+)?\s*\/\s*10/);
  if (fraction) return fraction[0].replace(/\s+/g, '');
  const match = value.match(/(\d+(?:\.\d+)?)/);
  return match ? match[1] : '—';
}

export function scoreCaption(score = '') {
  const value = String(score || '').trim();
  if (!value) return 'No plan score recorded.';
  return /\/\s*10/.test(value) ? `Recorded as ${value}.` : `Recorded as ${value}/10.`;
}

export function scoreRingHtml(score = '') {
  const display = scoreNumber(score);
  const match = display.match(/^(\d+(?:\.\d+)?)(?:\/10)?$/);
  const numeric = match ? Math.max(0, Math.min(10, Number(match[1]))) : 0;
  const degrees = Number.isFinite(numeric) ? Math.round((numeric / 10) * 360) : 0;
  if (!match) return `<div class="score-ring" style="--score-angle:0deg"><span class="score-ring-value">${escapeHtml(display)}</span></div>`;
  return `<div class="score-ring score-ring-fraction" style="--score-angle:${degrees}deg" aria-label="Plan score ${escapeHtml(match[1])} out of 10"><strong>${escapeHtml(match[1])}</strong><span>/10</span></div>`;
}

export function queueStatusFilterValue(task) {
  const lifecycleValue = lifecycleValueForTask(task);
  if (lifecycleValue) return lifecycleValue;
  const status = cleanStatusLabel(task.status).toLowerCase().replace(/\s+/g, '-');
  if (status) return status;
  return task.lifecycle || 'unknown';
}

export function taskMatchesQueueFilters(task, route) {
  const status = route.params.get('status') || 'all';
  return status === 'all' || queueStatusFilterValue(task) === status;
}

export function queueFilterHref(route, extra = {}) {
  const params = Object.fromEntries(route.params.entries());
  Object.assign(params, extra);
  Object.keys(params).forEach((key) => {
    if (!params[key] || params[key] === 'all') delete params[key];
  });
  const query = new URLSearchParams(params).toString();
  return `#/${query ? `?${query}` : ''}`;
}

export function riskLabel(task) {
  return task.riskLevel || task.metadata?.riskLevel || task.metadata?.risk_level || task.metadata?.['risk level'] || task.metadata?.risk || 'Not recorded';
}

const HEADER_OPERATIONAL_METADATA_LABELS = new Set([
  'status',
  'created',
  'estimated steps',
  'risk level',
  'plan score',
  'planning state',
  'execution state',
  'lifecycle folder',
  'user verification outcome',
  'reviewer seal',
  'review report',
  'verification evidence',
  'r1 implementation approval',
  'r1 approval',
  'documentation structure review',
  'documentation accuracy review',
  'automation claimed',
  'automation completed',
  'automation assignment id',
  'automation agent role',
  'automation agent id',
  'automation agent nickname',
  'automation lease expires',
  'automation last heartbeat',
  'automation handoff reason',
  'automation state',
  'automation notes',
  'automation completed at',
  'assignment id',
  'agent role',
  'agent id',
  'agent nickname',
  'lease expires at',
  'last heartbeat at',
  'handoff reason',
  'completed at',
].map((label) => label.toLowerCase()));

function normalizeMetadataKey(value = '') {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function displayValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join(', ');
  if (typeof value === 'object') return '';
  return String(value).trim();
}

function flattenedMetadataSources(task = {}) {
  const sources = [task, task.metadata || {}, task.manifest || {}];
  if (task.automation) sources.push(task.automation);
  if (task.metadata?.automation) sources.push(task.metadata.automation);
  if (task.manifest?.automation) sources.push(task.manifest.automation);
  return sources.filter(Boolean);
}

function metadataValue(task, aliases = []) {
  const normalizedAliases = aliases.map(normalizeMetadataKey);
  for (const source of flattenedMetadataSources(task)) {
    for (const [key, value] of Object.entries(source || {})) {
      if (!normalizedAliases.includes(normalizeMetadataKey(key))) continue;
      const rendered = displayValue(value);
      if (rendered) return rendered;
    }
  }
  return '';
}

function relativeAndExactTimestamp(value = '') {
  if (!value) return '—';
  const smart = smartDateLabel(value);
  const exact = readableTimestampLabel(value);
  return exact.startsWith(smart) || smart === exact ? exact : `${smart} · ${exact}`;
}

function automationObject(task = {}) {
  return task.automation || task.metadata?.automation || task.manifest?.automation || {};
}

function booleanLike(value) {
  return value === true || /^true|yes|claimed$/i.test(String(value || '').trim());
}

export function agentActivitySummary(task = {}) {
  const automation = automationObject(task);
  const heartbeat = metadataValue(task, ['automation last heartbeat', 'last heartbeat at', 'lastHeartbeatAt', 'last_heartbeat_at'])
    || automation.lastHeartbeatAt
    || '';
  const state = displayValue(automation.state || metadataValue(task, ['automation state', 'state'])) || '';
  const claimed = booleanLike(automation.claimed ?? metadataValue(task, ['automation claimed', 'claimed']));
  const agent = displayValue(automation.agentNickname || automation.agentId || metadataValue(task, ['automation agent nickname', 'automation agent id', 'agent nickname', 'agent id'])) || '';
  const handoff = displayValue(automation.handoffReason || metadataValue(task, ['automation handoff reason', 'handoff reason'])) || '';
  const lease = automation.leaseExpiresAt || metadataValue(task, ['automation lease expires', 'lease expires at', 'leaseExpiresAt']);
  const activeHeartbeat = heartbeat ? Date.now() - dateValue(heartbeat) < 45 * 60 * 1000 : false;
  const lastTouch = metadataValue(task, ['last agent touch', 'lastAgentTouchAt', 'last_agent_touch_at'])
    || heartbeat
    || task.lastModified
    || task.updatedAt
    || '';
  let ownership = 'No active claim recorded';
  if (/blocked/i.test(state) || /blocked/i.test(task.status || '')) ownership = agent ? `Blocked by ${agent}` : 'Blocked by agent';
  else if (/take.?over|handoff|resume/i.test(handoff)) ownership = agent ? `Taken over by ${agent}` : 'Taken over';
  else if (activeHeartbeat) ownership = agent ? `Actively working · ${agent}` : 'Actively working';
  else if (claimed) ownership = agent ? `Claimed by ${agent}` : 'Claimed by agent';

  return { lastTouch, heartbeat, ownership, lease, state, handoff };
}

export function renderAgentActivityPanel(task = {}) {
  const summary = agentActivitySummary(task);
  const rows = [
    ['Last touch', relativeAndExactTimestamp(summary.lastTouch)],
    ['Heartbeat', summary.heartbeat ? relativeAndExactTimestamp(summary.heartbeat) : 'No heartbeat recorded'],
    ['State', summary.ownership],
  ];
  if (summary.lease) rows.push(['Lease', readableTimestampLabel(summary.lease)]);
  return `<section class="agent-activity-panel" aria-label="Agent activity summary">
    ${rows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}
  </section>`;
}

export function renderPriorityCommentPanel(task = {}) {
  const latestAgentReply = [...(task.commentEvents || [])].reverse().find((event) => event.actor === 'agent');
  if (!latestAgentReply) return '';
  return `<section class="sidebar-accordion-block agent-reply-highlight">
    <details class="sidebar-accordion agent-reply-accordion">
      <summary><span>Latest agent reply</span><strong>${escapeHtml(latestAgentReply.title || 'Agent reply')}</strong></summary>
      <div class="sidebar-accordion-body">
        <p>${escapeHtml(latestAgentReply.text || '')}</p>
        <small>${escapeHtml(latestAgentReply.path ? fileLabel(latestAgentReply.path) : 'Plan comments')}</small>
      </div>
    </details>
  </section>`;
}

function metadataRows(task, fields = []) {
  return fields
    .map((field) => ({ ...field, value: metadataValue(task, field.aliases || [field.label]) }))
    .filter((field) => field.value);
}

export function planOperationalMetadata(task = {}) {
  if (!task || task.source !== 'plan') return [];
  const stateRows = metadataRows(task, [
    { label: 'Planning state', aliases: ['planning state', 'planningState', 'planning_state'] },
    { label: 'Execution state', aliases: ['execution state', 'executionState', 'execution_state'] },
    { label: 'User verification', aliases: ['user verification outcome', 'userVerificationOutcome', 'user_verification_outcome'] },
  ]);

  const reviewRows = metadataRows(task, [
    { label: 'Reviewer seal', aliases: ['reviewer seal', 'reviewerSeal', 'reviewer_seal'] },
    { label: 'Review report', aliases: ['review report', 'reviewReport', 'review_report'] },
    { label: 'R1 approval', aliases: ['r1 implementation approval', 'r1 approval', 'r1ImplementationApproval', 'r1_implementation_approval'] },
  ]);

  const automationRows = [
    ...metadataRows(task, [
      { label: 'Lease expires', aliases: ['automation lease expires', 'lease expires at', 'leaseExpiresAt', 'lease_expires_at'] },
      { label: 'Assignment ID', aliases: ['automation assignment id', 'assignment id', 'assignmentId', 'assignment_id'] },
      { label: 'Agent role', aliases: ['automation agent role', 'agent role', 'agentRole', 'agent_role'] },
      { label: 'Agent ID', aliases: ['automation agent id', 'agent id', 'agentId', 'agent_id'] },
      { label: 'Agent nickname', aliases: ['automation agent nickname', 'agent nickname', 'agentNickname', 'agent_nickname'] },
      { label: 'Handoff reason', aliases: ['automation handoff reason', 'handoff reason', 'handoffReason', 'handoff_reason'] },
      { label: 'Automation state', aliases: ['automation state', 'state'] },
      { label: 'Automation notes', aliases: ['automation notes', 'notes'] },
      { label: 'Completed at', aliases: ['automation completed at', 'completed at', 'completedAt', 'completed_at'] },
      { label: 'Claimed', aliases: ['automation claimed', 'claimed'] },
      { label: 'Completed', aliases: ['automation completed', 'completed'] },
    ]),
  ].filter(Boolean);
  const block = task.block || task.manifest?.block || task.metadata?.block || {};
  const blockRows = block && typeof block === 'object' ? [
    block.blocked !== undefined ? { label: 'Blocked', value: displayValue(block.blocked) } : null,
    block.reason ? { label: 'Block reason', value: displayValue(block.reason) } : null,
    block.blockedAt ? { label: 'Blocked at', value: displayValue(block.blockedAt) } : null,
    block.blockedBy ? { label: 'Blocked by', value: displayValue(block.blockedBy) } : null,
    block.unblockedAt ? { label: 'Unblocked at', value: displayValue(block.unblockedAt) } : null,
  ].filter(Boolean) : [];

  return [
    { id: 'plan-state', title: 'Plan state', empty: 'No plan-state metadata recorded.', rows: stateRows },
    { id: 'review-verification', title: 'Review and verification', empty: 'No review metadata recorded.', rows: reviewRows },
    { id: 'blocker-state', title: 'Block / unblock state', empty: 'No block metadata recorded.', rows: blockRows },
    { id: 'automation-assignment', title: 'Automation assignment', empty: 'No automation assignment metadata recorded.', rows: automationRows, expandable: automationRows.length > 2 },
  ];
}

function renderPlanStateRows(group) {
  if (!group.rows.length) return `<p class="metadata-empty-note">${escapeHtml(group.empty)}</p>`;
  const [primary, ...secondary] = group.rows;
  return `<div class="plan-state-stack">
    <p class="plan-state-value">${escapeHtml(primary.value)}</p>
    ${secondary.map((row) => `<div class="plan-state-secondary"><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(row.value)}</strong></div>`).join('')}
  </div>`;
}

export function renderPlanMetadataPanels(task = {}) {
  const groups = planOperationalMetadata(task);
  if (!groups.length) return '';
  return `<section class="plan-metadata-panels" aria-label="Plan operational metadata">${groups.map((group) => {
    if (group.id === 'plan-state') {
      return `<div class="plan-metadata-panel plan-metadata-${escapeHtml(group.id)}"><h3>${escapeHtml(group.title)}</h3>${renderPlanStateRows(group)}</div>`;
    }
    const rows = group.rows.length
      ? `<dl class="plan-metadata-list">${group.rows.map((row) => `<div><dt>${escapeHtml(row.label)}</dt><dd>${row.label === 'Planning state' || row.label === 'Execution state' || row.label === 'User verification' ? `<span class="status-text">${escapeHtml(row.value)}</span>` : escapeHtml(row.value)}</dd></div>`).join('')}</dl>`
      : `<p class="metadata-empty-note">${escapeHtml(group.empty)}</p>`;
    if (group.expandable) {
      const [first, second, ...rest] = group.rows;
      const summary = [first, second].filter(Boolean);
      const summaryRows = `<dl class="plan-metadata-list">${summary.map((row) => `<div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`).join('')}</dl>`;
      const detailRows = rest.length ? `<details class="metadata-detail-disclosure"><summary>More assignment details</summary><dl class="plan-metadata-list metadata-detail-list">${rest.map((row) => `<div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`).join('')}</dl></details>` : '';
      return `<div class="plan-metadata-panel plan-metadata-${escapeHtml(group.id)}"><h3>${escapeHtml(group.title)}</h3>${summaryRows}${detailRows}</div>`;
    }
    return `<div class="plan-metadata-panel plan-metadata-${escapeHtml(group.id)}"><h3>${escapeHtml(group.title)}</h3>${rows}</div>`;
  }).join('')}</section>`;
}

export function renderChecklistAccordion(task = {}, title = 'Checklist items') {
  const items = Array.isArray(task.checkboxes) ? task.checkboxes : [];
  const summary = checklistSummary(task);
  const body = items.length
    ? `<ol class="plan-checklist-items">${items.map((item, index) => `<li class="plan-checklist-item ${item.checked ? 'checked' : ''}"><span class="check-box ${item.checked ? 'checked' : ''}" aria-hidden="true"></span><span class="checklist-copy"><strong>${String(index + 1).padStart(2, '0')}</strong><span>${escapeHtml(item.text || 'Untitled checklist item')}</span></span></li>`).join('')}</ol>`
    : `<p class="metadata-empty-note">No checklist items were parsed for this plan.</p>`;
  return `<section class="sidebar-accordion-block plan-checklist-section"><details class="sidebar-accordion plan-checklist-accordion"><summary><span>Plan checklist</span><strong>${escapeHtml(title)} · ${escapeHtml(summary.label)}</strong></summary><div class="sidebar-accordion-body">${body}</div></details></section>`;
}

export function stripPlanHeaderMetadata(raw = '') {
  const source = String(raw || '');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const titleIndex = lines.findIndex((line) => /^#\s+/.test(line));
  if (titleIndex < 0) return source;

  let index = titleIndex + 1;
  const candidateIndexes = [];
  let metadataCount = 0;
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      candidateIndexes.push(index);
      index += 1;
      continue;
    }
    const match = /^>\s*\*\*([^*]+):\*\*\s*.*$/.exec(trimmed);
    if (!match || !HEADER_OPERATIONAL_METADATA_LABELS.has(normalizeMetadataKey(match[1]))) break;
    candidateIndexes.push(index);
    metadataCount += 1;
    index += 1;
  }
  if (!metadataCount) return source;
  const removeIndexes = new Set(candidateIndexes);
  const nextLines = lines.filter((_, lineIndex) => !removeIndexes.has(lineIndex));
  if (nextLines[titleIndex + 1] && nextLines[titleIndex + 1].trim()) {
    nextLines.splice(titleIndex + 1, 0, '');
  }
  return nextLines.join(newline);
}

export function stripPlanDocumentChrome(raw = '') {
  return stripPlanHeaderMetadata(raw)
    .replace(/^# [^\n]*(?:\n|$)\n*/i, '')
    .replace(/^##\s+Plan:\s+[^\n]*(?:\n|$)\n*/i, '');
}

export function fileLabel(path = '') {
  return String(path || '').split('/').filter(Boolean).pop() || '—';
}

export function absoluteTaskPath(task) {
  if (!task?.path || task.source !== 'plan') return '';
  const project = getState().projects.find((item) => item.id === task.projectId);
  const root = String(project?.rootLabel || project?.rootPath || '').trim().replace(/\/+$/, '');
  const relative = String(task.path || '').trim().replace(/^\/+/, '');
  return root && relative ? `${root}/${relative}` : '';
}

export function plural(value, singular, pluralLabel = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralLabel}`;
}

export function cleanStatusLabel(status = '') {
  const raw = String(status || 'Active').replace(/`/g, '').trim();
  const first = raw.split('|')[0].trim();
  if (/questions?\s+pending/i.test(first)) return 'Questions pending';
  if (/in\s+progress/i.test(first)) return 'In progress';
  if (/pending verification/i.test(first)) return 'Pending verification';
  if (/sent[-_ ]?to[-_ ]?agent|agent[-_ ]?requested|agent[-_ ]?response[-_ ]?requested|sent[-_ ]?to[-_ ]?automation/i.test(first)) return 'Sent to Agent';
  if (/agent[-_ ]?reviewing|reviewing/i.test(first)) return 'Reviewing';
  if (/user[-_ ]?verification/i.test(first)) return 'User Verification';
  if (/requesting[-_ ]?user[-_ ]?feedback|changes? requested|requires? changes|not fixed|not implemented/i.test(first)) return 'Requesting User Feedback';
  if (/user[-_ ]?replied/i.test(first)) return 'User Replied';
  if (/pending correction|correction required before next r1|pending[-_ ]?correction/i.test(first)) return 'Pending Correction';
  if (/blocked/i.test(first)) return 'Blocked';
  if (/parked/i.test(first)) return 'Parked';
  if (/stale/i.test(first)) return 'Stale';
  if (/draft/i.test(first)) return 'Draft';
  if (/pending/i.test(first)) return 'Pending';
  if (/approved/i.test(first)) return 'Approved';
  if (/review/i.test(first)) return 'Review';
  if (/archive|archived/i.test(first)) return 'Archived';
  if (/partial/i.test(first)) return 'Partial';
  if (/needs plan/i.test(first)) return 'Needs plan';
  return first.length > 28 ? `${first.slice(0, 25)}…` : first;
}

export function queueSectionForTask(task) {
  const status = cleanStatusLabel(task.status).toLowerCase();
  if (/blocked|stale|partial/.test(status) || task.lifecycle === 'blocker') return 'blocked';
  if (/parked/.test(status) || task.lifecycle === 'parked') return 'untriaged';
  if (/questions?\s+pending|needs plan|draft/.test(status)) return 'untriaged';
  if (/pending-correction/.test(status)) return 'feedback';
  if (/approved/.test(status) || task.lifecycle === 'approved') return 'approved';
  if (/pending/.test(status) || task.lifecycle === 'pending') return 'pending';
  if (/user-replied/.test(status)) return 'feedback';
  if (/sent-to-agent/.test(status)) return 'userVerification';
  if (/requesting-user-feedback/.test(status) || task.lifecycle === 'failed-user-verification') return 'feedback';
  if (/user-verification/.test(status) || task.lifecycle === 'user-verification') return 'userVerification';
  if (/review/.test(status) || task.lifecycle === 'review') return 'review';
  if (/archive/.test(status) || task.lifecycle === 'archive') return 'archived';
  return 'active';
}

export function lifecycleValueForTask(task) {
  const lifecycle = String(task.lifecycle || '').toLowerCase();
  const status = cleanStatusLabel(task.status).toLowerCase().replace(/\s+/g, '-');
  if (status === 'pending-correction') return 'pending-correction';
  if (status === 'reviewing') return 'reviewing';
  if (status === 'user-replied') return 'user-replied';
  if (status === 'sent-to-agent') return 'sent-to-agent';
  if (status === 'blocked') return 'blocker';
  if (status === 'parked') return 'parked';
  if (status === 'stale') return 'stale';
  if (status === 'partial') return 'partial';
  if (['draft', 'pending', 'approved', 'in-progress', 'review', 'user-verification', 'failed-user-verification', 'completed', 'archive', 'parked', 'blocker'].includes(lifecycle)) return lifecycle;
  if (status === 'complete') return 'completed';
  if (status === 'archived') return 'archive';
  if (['draft', 'pending', 'approved', 'pending-correction', 'in-progress', 'review', 'user-verification', 'failed-user-verification', 'completed', 'archive', 'parked', 'blocker'].includes(status)) return status;
  return '';
}

export const STATUS_OPTIONS = Object.freeze([
  ['draft', 'Draft'],
  ['pending', 'Pending'],
  ['approved', 'Approved'],
  ['in-progress', 'In progress'],
  ['pending-correction', 'Pending correction'],
  ['review', 'Review'],
  ['reviewing', 'Reviewing'],
  ['user-verification', 'User verification'],
  ['sent-to-agent', 'Sent to agent'],
  ['failed-user-verification', 'Request feedback / changes'],
  ['user-replied', 'User replied'],
  ['parked', 'Parked'],
  ['blocker', 'Blocked'],
  ['completed', 'Completed'],
  ['archive', 'Archived'],
]);

export const STATUS_FILTER_LABELS = Object.freeze({
  setup: 'Setup required',
  draft: 'Draft',
  pending: 'Pending',
  approved: 'Approved',
  'in-progress': 'In progress',
  'pending-correction': 'Pending correction',
  review: 'Review',
  reviewing: 'Reviewing',
  'user-verification': 'User verification',
  'sent-to-agent': 'Sent to agent',
  'failed-user-verification': 'Needs feedback',
  'user-replied': 'User replied',
  parked: 'Parked',
  blocker: 'Blocked',
  active: 'Active',
  blocked: 'Blocked',
  partial: 'Partial',
  'questions-pending': 'Questions pending',
  'needs-plan': 'Needs plan',
  completed: 'Completed',
  archive: 'Archived',
  unknown: 'Unknown',
});

export const STATUS_FILTER_ORDER = Object.freeze([
  'setup',
  'draft',
  'pending',
  'approved',
  'in-progress',
  'pending-correction',
  'review',
  'reviewing',
  'user-verification',
  'sent-to-agent',
  'failed-user-verification',
  'user-replied',
  'parked',
  'blocker',
  'active',
  'blocked',
  'partial',
  'questions-pending',
  'needs-plan',
  'completed',
  'archive',
  'unknown',
]);

export function statusFilterOptions(tasks, selectedStatus = 'all') {
  const counts = tasks.reduce((groups, task) => {
    const key = queueStatusFilterValue(task);
    groups[key] = (groups[key] || 0) + 1;
    return groups;
  }, {});
  const ordered = [...STATUS_FILTER_ORDER, ...Object.keys(counts).sort()]
    .filter((key, index, list) => list.indexOf(key) === index)
    .filter((key) => counts[key] || key === selectedStatus);
  return [
    `<option value="all" ${selectedStatus === 'all' ? 'selected' : ''}>All statuses (${tasks.length})</option>`,
    ...ordered.map((key) => `<option value="${escapeHtml(key)}" ${selectedStatus === key ? 'selected' : ''}>${escapeHtml(STATUS_FILTER_LABELS[key] || cleanStatusLabel(key))} (${counts[key] || 0})</option>`),
  ].join('');
}


export function statusFilterTabs(tasks, route, selectedStatus = 'all', allCount = tasks.length) {
  const counts = tasks.reduce((groups, task) => {
    const key = queueStatusFilterValue(task);
    groups[key] = (groups[key] || 0) + 1;
    return groups;
  }, {});
  const ordered = [...STATUS_FILTER_ORDER, ...Object.keys(counts).sort()]
    .filter((key, index, list) => list.indexOf(key) === index)
    .filter((key) => counts[key] || key === selectedStatus);
  const filters = [
    ['all', 'All', allCount],
    ...ordered.map((key) => [key, STATUS_FILTER_LABELS[key] || cleanStatusLabel(key), counts[key] || 0]),
  ];
  return `<nav class="status-filter-tabs" aria-label="Status filters">${filters.map(([key, label, count]) => {
    const active = selectedStatus === key;
    return `<a class="status-filter-tab ${active ? 'active' : ''}" href="${queueFilterHref(route, { status: key })}" aria-current="${active ? 'page' : 'false'}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(count))}</strong></a>`;
  }).join('')}</nav>`;
}

export function taskStatusStateClass(task) {
  const value = lifecycleValueForTask(task) || cleanStatusLabel(task.status);
  const token = String(value || 'unknown').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return `status-state-${token || 'unknown'}`;
}

export function taskStatusControl(task, { compact = true } = {}) {
  const value = lifecycleValueForTask(task);
  const currentLabel = cleanStatusLabel(task.status);
  const openQuestions = Number(task.unansweredQuestions || 0);
  const completionGate = taskCompletionGate(task);
  const fallbackOption = value ? '' : `<option value="" selected disabled>${escapeHtml(currentLabel || 'Unknown')}</option>`;
  const options = fallbackOption + STATUS_OPTIONS.map(([key, label]) => {
    const blockForQuestions = ['approved', 'in-progress', 'review', 'reviewing', 'user-verification', 'sent-to-agent', 'completed'].includes(key) && openQuestions;
    const blockComplete = key === 'completed' && !completionGate.allowed;
    const blockManualAgentSend = key === 'sent-to-agent';
    const disabled = key !== value && (blockForQuestions || blockComplete || blockManualAgentSend);
    const optionLabel = key === 'completed' && disabled && completionGate.reason ? `${label} — ${completionGate.reason}` : label;
    return `<option class="status-option status-option-${key}" value="${key}" ${value === key ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${escapeHtml(optionLabel)}</option>`;
  }).join('');
  const title = task.source === 'plan'
    ? 'Change status, update todo.md, and move the linked plan folder when needed.'
    : 'Change the todo.md status. This item has no linked plan file to move.';
  const stateToken = (value || currentLabel || 'unknown').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const stateClass = `status-state-${stateToken || 'unknown'}`;
  return `<label class="status-badge-control ${stateClass} ${compact ? 'compact' : ''}" title="${escapeHtml(title)}"><span class="status-badge-label">${compact ? 'Status' : 'Task status'}</span><select class="status-badge-select" data-task-status-select data-task-id="${escapeHtml(task.id)}" data-current-status="${escapeHtml(value)}" aria-label="Change status for ${escapeHtml(task.title)}">${options}</select></label>`;
}

export function taskCompletionGate(task = {}) {
  const openQuestions = Number(task.unansweredQuestions || 0);
  if (task.lifecycle !== 'user-verification') {
    return { allowed: false, reason: 'Only available from User Verification' };
  }
  if (openQuestions) {
    return { allowed: false, reason: `${openQuestions} planning question${openQuestions === 1 ? '' : 's'} still open` };
  }
  if (!/^complete$/i.test(task.closeoutStatus || '')) {
    return { allowed: false, reason: 'Closeout Review final status is not Complete' };
  }
  if (task.planKind === 'folder' && task.completionBlockers?.length) {
    return { allowed: false, reason: task.completionBlockers[0] };
  }
  return { allowed: true, reason: '' };
}

export function updatedLabel(task) {
  return modifiedLabel(task);
}

export function answeredSummary(task) {
  return task.questionCount ? `${answeredQuestionCount(task)} / ${task.questionCount}` : '—';
}

export function checklistSummary(task) {
  const total = Number(task.totalSteps || 0);
  if (!total) return { label: '—', complete: 0, total: 0, percent: 0 };
  const complete = Math.max(0, Math.min(total, Number(task.completedSteps || 0)));
  return {
    label: `${complete} / ${total}`,
    complete,
    total,
    percent: Math.round((complete / total) * 100),
  };
}

export function uniqueRecentChanges(changes = []) {
  const seen = new Set();
  return (changes || []).filter((change) => {
    const key = `${change.projectId || ''}:${normalizePath(change.path)}`;
    if (!change.path || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


export function taskRecentChanges(task, changes = getState().recentFileChanges || []) {
  const taskPaths = [
    task.path,
    task.todo?.path,
    task.planPath,
    task.manifestPath,
    task.questionPath,
    task.commentsPath,
    ...(task.planSections || []).map((section) => section.path),
  ].filter(Boolean).map(normalizePath);
  return uniqueRecentChanges(changes).filter((change) => {
    if (change.projectId && task.projectId && change.projectId !== task.projectId) return false;
    const changedPath = normalizePath(change.path);
    return taskPaths.some((path) => path && (path === changedPath || path.endsWith(`/${changedPath}`) || changedPath.endsWith(`/${path}`)));
  });
}

export function dateValue(value) {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function taskDateValue(task, field) {
  return field === 'created'
    ? dateValue(task.createdAt || task.metadata?.created)
    : dateValue(task.lastModified || task.updatedAt);
}

export function actualDateLabel(date) {
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

export function readableTimestampLabel(value) {
  if (!value) return '—';
  const raw = String(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const date = dateOnly ? new Date(`${raw}T00:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return raw;
  if (dateOnly) return actualDateLabel(date);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function smartDateLabel(value) {
  if (!value) return '—';
  const raw = String(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const date = dateOnly ? new Date(`${raw}T00:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return raw;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const time = date.getTime();
  if (dateOnly) {
    if (time >= todayStart) return 'Today';
    if (time >= yesterdayStart && time < todayStart) return 'Yesterday';
    return actualDateLabel(date);
  }
  const delta = Date.now() - time;
  if (Number.isFinite(delta) && delta >= 0 && delta < 10_000) return 'Just now';
  const minutes = Math.round(delta / 60_000);
  if (Number.isFinite(minutes) && minutes >= 0 && minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (Number.isFinite(hours) && hours >= 0 && hours < 24) return `${hours} hr ago`;
  if (time >= yesterdayStart && time < todayStart) return 'Yesterday';
  return actualDateLabel(date);
}

export function createdLabel(task) {
  return readableTimestampLabel(task.createdAt || task.metadata?.created);
}

export function modifiedLabel(task) {
  return smartDateLabel(task.lastModified || task.updatedAt);
}

const naturalTaskCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function taskOrderText(task = {}) {
  return [task.title, task.filename, task.path].filter(Boolean).join(' ');
}

export function taskSequenceNumber(task = {}) {
  const source = taskOrderText(task);
  const match = source.match(/\btask\s*(\d+)\b/i);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]);
}

export function compareTaskOrder(a = {}, b = {}) {
  const sequenceDiff = taskSequenceNumber(a) - taskSequenceNumber(b);
  if (Number.isFinite(sequenceDiff) && sequenceDiff !== 0) return sequenceDiff;
  return naturalTaskCollator.compare(
    String(a.title || a.filename || a.path || ''),
    String(b.title || b.filename || b.path || ''),
  ) || naturalTaskCollator.compare(String(a.filename || a.path || ''), String(b.filename || b.path || ''));
}

export function hasTaskSequence(task = {}) {
  return Number.isFinite(taskSequenceNumber(task));
}

export function sameProjectTaskSequenceDiff(a = {}, b = {}) {
  if (!a.projectId || a.projectId !== b.projectId || !hasTaskSequence(a) || !hasTaskSequence(b)) return 0;
  return taskSequenceNumber(a) - taskSequenceNumber(b);
}

export function sortTasks(tasks, route) {
  const field = route.params.get('sort');
  if (!['created', 'modified'].includes(field)) return tasks;
  const direction = route.params.get('dir') === 'asc' ? 1 : -1;
  return [...tasks].sort((a, b) => {
    const diff = taskDateValue(a, field) - taskDateValue(b, field);
    const sequenceDiff = sameProjectTaskSequenceDiff(a, b);
    return (diff || sequenceDiff || compareTaskOrder(a, b)) * direction;
  });
}

export function customOrderRankMap(order = []) {
  const map = new Map();
  (order || []).forEach((key, index) => {
    const clean = String(key || '').trim();
    if (clean && !map.has(clean)) map.set(clean, index);
  });
  return map;
}

export function sortTasksByCustomOrder(tasks, fallbackSorted, order = []) {
  const rank = customOrderRankMap(order);
  return [...fallbackSorted].sort((a, b) => {
    const aKey = queueCustomOrderKey(a);
    const bKey = queueCustomOrderKey(b);
    const aRank = rank.has(aKey) ? rank.get(aKey) : Number.POSITIVE_INFINITY;
    const bRank = rank.has(bKey) ? rank.get(bKey) : Number.POSITIVE_INFINITY;
    return (aRank - bRank) || fallbackSorted.indexOf(a) - fallbackSorted.indexOf(b);
  });
}

export function queueScopeLabel(state) {
  if (state.selectedProjectId === 'all') return 'All projects';
  return state.projects.find((project) => project.id === state.selectedProjectId)?.name || 'Selected project';
}


export function routeWithSavedSort(route, routeKey, fallback = {}) {
  if (route.params.get('sort')) return route;
  const preference = getRoutePreference(routeKey);
  const sort = preference.sort || fallback.sort;
  if (!sort) return route;
  const params = new URLSearchParams(route.params);
  params.set('sort', sort);
  params.set('dir', preference.dir || fallback.dir || 'desc');
  return { ...route, params };
}

export function routeHref(path, route, overrides = {}) {
  const params = Object.fromEntries(route.params.entries());
  Object.assign(params, overrides);
  Object.keys(params).forEach((key) => {
    if (!params[key]) delete params[key];
  });
  const query = new URLSearchParams(params).toString();
  return `#${path}${query ? `?${query}` : ''}`;
}

export function sortHeader(route, path, field, label) {
  const active = route.params.get('sort') === field;
  const currentDir = route.params.get('dir') === 'asc' ? 'asc' : 'desc';
  const nextDir = active && currentDir === 'desc' ? 'asc' : 'desc';
  const indicator = active ? (currentDir === 'asc' ? ' ↑' : ' ↓') : '';
  return `<a class="sort-link ${active ? 'active' : ''}" href="${routeHref(path, route, { sort: field, dir: nextDir })}">${escapeHtml(label)}${indicator}</a>`;
}
