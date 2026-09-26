import { emptyState, icon, pageHeader, statusBadge } from '../../ui/components.js';
import { getState } from '../../state/store.js';
import { button } from '../../ui/view-helpers.js';
import { escapeHtml, formatRelativeTime } from '../../lib/utils.js';

function list(value) {
  return Array.isArray(value) ? value : [];
}

function age(value = '') {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? formatRelativeTime(time) : '—';
}

function shortPath(value = '') {
  const parts = String(value || '').split('/').filter(Boolean);
  return parts.slice(-3).join('/') || '—';
}

function policySummary(control = {}) {
  const projects = Object.entries(control.projects || {}).filter(([, policy]) => policy?.paused);
  const reviewers = Object.entries(control.reviewers || {}).filter(([, policy]) => policy?.stopped);
  return { projects, reviewers };
}

function automationAttrs(action, item = {}, extra = {}) {
  return [
    `data-automation-action="${escapeHtml(action)}"`,
    `data-project-id="${escapeHtml(item.projectId || '')}"`,
    `data-project-name="${escapeHtml(item.projectName || '')}"`,
    `data-assignment-id="${escapeHtml(item.assignmentId || item.id || '')}"`,
    `data-role="${escapeHtml(item.role || '')}"`,
    `data-plan-path="${escapeHtml(item.planPath || '')}"`,
    `data-current-plan-path="${escapeHtml(extra.currentPlanPath || item.currentPlanPath || '')}"`,
    `data-conflict-key="${escapeHtml(extra.conflictKey || item.conflictKey || item.conflict?.conflictKey || '')}"`,
    `data-reviewer-key="${escapeHtml(extra.reviewerKey || item.projectId || '')}"`,
    `data-reason="${escapeHtml(extra.reason || item.holdLabel || item.notes || 'Operator action from Agent Control Center')}"`,
  ].join(' ');
}

function actionButton(label, action, item = {}, extra = {}) {
  return button(label, 'automation-action', { attrs: automationAttrs(action, item, extra) });
}

function assignmentControls(item = {}, context = 'status') {
  if (!item.assignmentId) return [];
  const reasonSuffix = context === 'held' ? 'from Held / Paused Work Queue.' : 'from Agent Status Table.';
  const controls = [
    actionButton(context === 'held' ? 'Release assignment' : 'Release', 'release-assignment', item, { reason: `Release assignment ${reasonSuffix}` }),
    actionButton(context === 'held' ? 'Cancel assignment' : 'Cancel', 'cancel-assignment', item, { reason: `Cancel assignment ${reasonSuffix}` }),
  ];
  const shouldOfferReclaim = item.holdReason === 'stale_assignment_cleanup' || item.recommendedAction === 'recover_or_resume_assignment' || item.expired || item.status === 'expired';
  if (shouldOfferReclaim) {
    controls.push(actionButton('Reclaim orphaned work', 'reclaim-orphan', item, { reason: 'Reclaim orphaned assignment by releasing the stale lease so work can be claimed again.' }));
  }
  controls.push(actionButton('Nudge intent', 'nudge-agent', item, { reason: 'Nudge intent recorded from Agent Control Center.' }));
  return controls;
}

function renderStatusRow(item = {}) {
  const registryId = item.registryAgentId || item.agentId || 'Not assigned';
  const threadId = item.codexThreadId || item.threadId || 'Not linked / unknown';
  const state = item.state || item.status || (item.assigned ? 'running' : 'eligible');
  const recommended = item.recommendedAction || (item.assigned ? 'nudge_active_agent' : 'claim_or_spawn_when_allowed');
  const controls = [
    item.projectId ? actionButton('Pause project', 'pause-project', item, { reason: 'Pause project automation from Agent Status Table.' }) : '',
    item.role === 'reviewer-agent' ? actionButton('Stop reviewer', 'stop-reviewer', item, { reviewerKey: item.projectId || '', reason: 'Stop reviewer automation from Agent Status Table.' }) : '',
    ...assignmentControls(item, 'status'),
  ].filter(Boolean).join('');
  return `<tr data-filter-row>
    <td><strong>${escapeHtml(item.projectName || item.projectId || 'Unknown project')}</strong><span>${escapeHtml(item.role || 'project-agent')}</span></td>
    <td><strong>${escapeHtml(item.planBasename || shortPath(item.planPath))}</strong><span class="mono">${escapeHtml(shortPath(item.planPath))}</span></td>
    <td>${statusBadge(item.folderState || item.lifecycle || 'assignment')}</td>
    <td>${statusBadge(state)}</td>
    <td class="mono">${escapeHtml(registryId)}</td>
    <td class="mono">${escapeHtml(threadId)}</td>
    <td>${escapeHtml(age(item.lastHeartbeatAt))}</td>
    <td>${escapeHtml(item.leaseExpiresAt || '—')}</td>
    <td>${escapeHtml(item.holdLabel || item.holdReason || 'No hold policy')}</td>
    <td>${escapeHtml(String(recommended).replace(/_/g, ' '))}</td>
    <td><div class="inline-actions">${controls || '<span class="badge badge-muted">Read only</span>'}</div></td>
  </tr>`;
}

function renderHeldCard(item = {}) {
  const canResumeReviewer = item.holdReason === 'reviewer_stopped';
  const canUnpauseProject = item.holdReason === 'project_paused';
  const actions = [
    canResumeReviewer ? actionButton('Resume reviewer', 'resume-reviewer', item, { reason: 'Resume reviewer from held queue.' }) : '',
    canUnpauseProject ? actionButton('Unpause project', 'unpause-project', item, { reason: 'Unpause project automation from held queue.' }) : '',
    ...assignmentControls(item, 'held'),
  ].filter(Boolean).join('');
  return `<article class="agent-held-card" data-filter-row>
    <div><span class="page-kicker">${escapeHtml(item.holdReason || 'held')}</span><h3>${escapeHtml(item.holdLabel || 'Held work')}</h3><p>${escapeHtml(item.projectName || item.projectId || 'Unknown project')} · ${escapeHtml(item.planBasename || shortPath(item.planPath))}</p></div>
    <dl><div><dt>Recommended action</dt><dd>${escapeHtml(String(item.recommendedAction || 'inspect').replace(/_/g, ' '))}</dd></div><div><dt>Assignment</dt><dd class="mono">${escapeHtml(item.assignmentId || '—')}</dd></div><div><dt>Registry agent ID</dt><dd class="mono">${escapeHtml(item.registryAgentId || item.agentId || '—')}</dd></div><div><dt>Codex thread ID</dt><dd class="mono">${escapeHtml(item.codexThreadId || 'Not linked / unknown')}</dd></div></dl>
    <div class="inline-actions">${actions || '<span class="badge badge-muted">No direct action</span>'}</div>
  </article>`;
}

function detailList(item = {}, fields = []) {
  return `<dl>${fields.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd class="${String(value || '').startsWith('/') ? 'mono' : ''}">${escapeHtml(value || '—')}</dd></div>`).join('')}</dl>`;
}

function renderLifecycleCard(item = {}, options = {}) {
  const actions = (options.actions || []).map((action) => actionButton(action.label, action.action, item, action.extra || {})).join('');
  return `<article class="agent-held-card ${options.compact ? 'compact' : ''}" data-filter-row>
    <div><span class="page-kicker">${escapeHtml(options.kicker || item.reason || item.holdReason || 'lifecycle')}</span><h3>${escapeHtml(options.title || item.holdLabel || item.planBasename || 'Lifecycle item')}</h3><p>${escapeHtml(options.description || `${item.projectName || item.projectId || 'Unknown project'} · ${item.planBasename || shortPath(item.planPath)}`)}</p></div>
    ${detailList(item, options.fields || [
      ['Recommended action', String(item.recommendedAction || 'inspect').replace(/_/g, ' ')],
      ['Status', item.status || item.assignmentState || '—'],
      ['Last heartbeat', age(item.lastHeartbeatAt || item.lastAgentTouchAt)],
      ['Last note', item.lastAgentNote || item.block?.reason || item.reason || '—'],
      ['Path', item.planPath || item.currentPlanPath || '—'],
    ])}
    <div class="inline-actions">${actions || '<span class="badge badge-muted">Inspect only</span>'}</div>
  </article>`;
}

function renderNotificationRow(item = {}) {
  return `<tr data-filter-row><td>${statusBadge(item.severity || 'info')}</td><td>${escapeHtml(String(item.reason || '').replace(/_/g, ' '))}</td><td>${escapeHtml(item.projectName || item.projectId || '—')}</td><td>${escapeHtml(item.planBasename || shortPath(item.planPath))}</td><td>${escapeHtml(item.message || '')}</td><td>${escapeHtml(String(item.recommendedAction || 'inspect').replace(/_/g, ' '))}</td></tr>`;
}

function renderAuditRow(event = {}) {
  return `<tr data-filter-row><td>${escapeHtml(age(event.timestamp))}</td><td>${statusBadge(event.action || 'event')}</td><td>${escapeHtml(event.actor || event.source || 'automation')}</td><td>${escapeHtml(event.projectId || '—')}</td><td class="mono">${escapeHtml(event.assignmentId || '—')}</td><td>${escapeHtml(event.reason || '')}</td></tr>`;
}

function agentOverviewControls(item = {}) {
  const category = item.overviewCategory || '';
  const actions = [];
  if (category === 'Blocked') {
    actions.push(actionButton('Unblock', 'unblock-plan', item, { reason: `Unblock ${item.planBasename || 'plan'} from Agent Control Center.` }));
    actions.push(actionButton('Record blocker', 'block-plan', item, { reason: item.block?.reason || item.reason || 'Confirm blocker from Agent Control Center.' }));
  } else if (category === 'User reply' || category === 'Project queue' || category === 'Review readiness') {
    actions.push(actionButton('Nudge agent', 'nudge-agent', item, { reason: item.overviewMessage || `Nudge agent about ${item.planBasename || 'work'}.` }));
  } else if (category === 'Paused') {
    actions.push(actionButton('Unpause', 'unpause-project', item, { reason: `Unpause ${item.projectName || item.projectId || 'project'}.` }));
  } else if (category === 'Lease / moved path') {
    actions.push(item.currentPlanPath
      ? actionButton('Repair path', 'repair-moved-plan', item, { currentPlanPath: item.currentPlanPath, reason: `Repair moved plan lease for ${item.planBasename || 'plan'}.` })
      : actionButton('Release lease', 'release-assignment', item, { reason: `Release mismatched lease for ${item.planBasename || 'plan'}.` }));
  } else if (category === 'Conflict') {
    actions.push(actionButton('Mark conflict', 'mark-conflict', item, { reason: item.conflict?.reason || 'Mark conflict after operator inspection.' }));
    actions.push(actionButton('Clear', 'clear-conflict', item, { conflictKey: item.conflict?.conflictKey || '', reason: 'Clear conflict after operator inspection.' }));
  } else {
    actions.push(...assignmentControls(item, 'status'));
  }
  return actions.filter(Boolean).join('') || '<span class="muted-copy">Inspect only</span>';
}

function renderAgentOverviewRow(item = {}) {
  const state = item.overviewState || item.state || item.status || item.folderState || '—';
  const message = item.overviewMessage || item.message || item.holdLabel || item.reason || item.recommendedAction || '';
  return `<tr data-filter-row>
    <td><strong>${escapeHtml(item.overviewCategory || 'Assignment')}</strong><span>${escapeHtml(String(state).replace(/_/g, ' '))}</span></td>
    <td><strong>${escapeHtml(item.projectName || item.projectId || 'Unknown project')}</strong><span>${escapeHtml(item.role || 'project-agent')}</span></td>
    <td><strong>${escapeHtml(item.planBasename || shortPath(item.planPath) || '—')}</strong><span class="mono">${escapeHtml(shortPath(item.planPath || item.currentPlanPath || item.oldPlanPath))}</span></td>
    <td>${escapeHtml(age(item.lastHeartbeatAt || item.lastAgentTouchAt || item.updatedAt))}</td>
    <td class="mono">${escapeHtml(item.registryAgentId || item.agentId || '—')}</td>
    <td>${escapeHtml(message)}</td>
    <td><div class="inline-actions">${agentOverviewControls(item)}</div></td>
  </tr>`;
}

function renderUnifiedAgentRow(item = {}) {
  const type = item.rowType || item.overviewCategory || 'Agent work';
  const rowState = item.state || item.overviewState || item.status || item.folderState || '—';
  const project = item.projectName || item.projectId || '—';
  const role = item.role || item.agentRole || '—';
  const scope = item.planBasename || item.subject || shortPath(item.planPath || item.currentPlanPath || item.taskRoot || item.oldPlanPath);
  const heartbeat = age(item.lastHeartbeatAt || item.lastAgentTouchAt || item.updatedAt || item.timestamp);
  const registryId = item.registryAgentId || item.agentId || item.assignmentId || '—';
  const threadId = item.codexThreadId || item.threadId || 'Not linked / unknown';
  const message = item.message || item.overviewMessage || item.holdLabel || item.reason || item.recommendedAction || '—';
  return `<tr data-filter-row>
    <td title="${escapeHtml(type)}">${escapeHtml(type)}</td>
    <td title="${escapeHtml(String(rowState).replace(/_/g, ' '))}">${escapeHtml(String(rowState).replace(/_/g, ' '))}</td>
    <td title="${escapeHtml(project)}">${escapeHtml(project)}</td>
    <td title="${escapeHtml(role)}">${escapeHtml(role)}</td>
    <td title="${escapeHtml(scope)}">${escapeHtml(scope)}</td>
    <td title="${escapeHtml(heartbeat)}">${escapeHtml(heartbeat)}</td>
    <td class="mono" title="${escapeHtml(registryId)}">${escapeHtml(registryId)}</td>
    <td class="mono" title="${escapeHtml(threadId)}">${escapeHtml(threadId)}</td>
    <td title="${escapeHtml(message)}">${escapeHtml(message)}</td>
    <td><div class="inline-actions">${item.controls || agentOverviewControls(item)}</div></td>
  </tr>`;
}

function projectControlRow(project = {}) {
  const item = { projectId: project.projectId, projectName: project.name || project.projectName || project.projectId };
  return {
    rowType: 'Project control',
    state: project.paused ? 'Paused' : 'Ready',
    projectId: item.projectId,
    projectName: item.projectName,
    role: 'project automation',
    subject: project.taskRoot || 'No task root',
    taskRoot: project.taskRoot || project.projectId || '',
    message: project.taskRoot || 'No task root recorded.',
    controls: `${actionButton('Pause project', 'pause-project', item, { reason: 'Pause project automation from Agent Control Center quick controls.' })}${actionButton('Stop reviewer', 'stop-reviewer', item, { reviewerKey: project.projectId || '', reason: 'Stop reviewer automation from Agent Control Center quick controls.' })}`,
  };
}

export function renderAgents() {
  const state = getState();
  const summary = state.automationSummary || {};
  const loading = state.automationSummaryStatus === 'loading';
  const held = list(summary.heldWork);
  const eligible = list(summary.eligibleWork);
  const assignments = list(summary.assignments || summary.activeAssignments);
  const blocked = list(summary.blockedWork);
  const replies = list(summary.priorityUserReplyWork);
  const projectQueue = list(summary.projectAgentQueue);
  const mismatches = list(summary.leaseMismatches);
  const repairs = list(summary.movedPlanRepairs);
  const pausedIgnored = list(summary.pausedIgnoredWork);
  const conflicts = [...list(summary.conflictWork?.explicit), ...list(summary.conflictWork?.suggested)];
  const reviewFailures = list(summary.reviewReadinessFailures);
  const notifications = list(summary.heartbeatNotifications);
  const rows = [...eligible, ...assignments].filter((item, index, all) => {
    const key = `${item.assignmentId || item.id || ''}:${item.planPath || ''}:${item.role || ''}`;
    return key !== '::' && all.findIndex((candidate) => `${candidate.assignmentId || candidate.id || ''}:${candidate.planPath || ''}:${candidate.role || ''}` === key) === index;
  });
  const policy = policySummary(summary.controlPolicy || {});
  const header = pageHeader({
    kicker: 'Automation operations',
    title: 'Agent Control Center',
    description: 'See active, stale, paused, and held lifecycle automation without confusing registry agent IDs with Codex thread IDs.',
  });
  const error = state.automationSummaryError ? `<div class="doc-callout"><strong>Automation summary unavailable</strong><p>${escapeHtml(state.automationSummaryError)}</p></div>` : '';
  const overviewRows = [
    ...blocked.map((item) => ({ ...item, overviewCategory: 'Blocked', overviewState: item.status || 'Blocked', overviewMessage: item.block?.reason || item.holdLabel || 'Blocked lifecycle work needs attention.' })),
    ...replies.map((item) => ({ ...item, overviewCategory: 'User reply', overviewState: item.status || 'Ready', overviewMessage: 'Deliver this user reply to the existing project agent.' })),
    ...projectQueue.map((item) => ({ ...item, overviewCategory: 'Project queue', overviewState: 'Queued', overviewMessage: `${item.projectName || item.projectId || 'Project'} work is serialized behind an active assignment.` })),
    ...mismatches.map((item) => ({ ...item, overviewCategory: 'Lease / moved path', overviewState: item.mismatchReason || 'Lease mismatch', overviewMessage: 'Registry lease and plan status/path do not match.' })),
    ...repairs.map((item) => ({ ...item, overviewCategory: 'Lease / moved path', overviewState: 'Moved plan repair', overviewMessage: 'Assignment path appears stale after lifecycle movement.' })),
    ...pausedIgnored.map((item) => ({ ...item, overviewCategory: 'Paused', overviewState: 'Paused project', overviewMessage: 'Project is paused; work is visible but ignored by automation.' })),
    ...conflicts.map((item) => ({ ...item, overviewCategory: 'Conflict', overviewState: item.conflict ? 'Explicit conflict' : 'Suggested conflict', overviewMessage: item.conflict?.reason || 'Conflict requires operator review.' })),
    ...reviewFailures.map((item) => ({ ...item, overviewCategory: 'Review readiness', overviewState: 'Blocked', overviewMessage: `Missing: ${list(item.missingReadiness).join(', ') || 'readiness evidence'}` })),
    ...held.map((item) => ({ ...item, overviewCategory: 'Held', overviewState: item.holdReason || item.status || 'Held', overviewMessage: item.holdLabel || item.recommendedAction || 'Held by policy or active assignment.' })),
    ...rows.map((item) => ({ ...item, overviewCategory: 'Assignment', overviewState: item.state || item.status || item.folderState || 'Active', overviewMessage: item.recommendedAction || 'Assignment tracked in registry.' })),
  ].filter((item, index, all) => {
    const key = `${item.overviewCategory}:${item.assignmentId || item.id || ''}:${item.planPath || item.currentPlanPath || ''}:${item.role || ''}`;
    return key !== `${item.overviewCategory}:::` && all.findIndex((candidate) => `${candidate.overviewCategory}:${candidate.assignmentId || candidate.id || ''}:${candidate.planPath || candidate.currentPlanPath || ''}:${candidate.role || ''}` === key) === index;
  });
  const unifiedRows = [
    {
      rowType: 'Summary',
      state: 'Info',
      projectName: 'All projects',
      role: 'identity',
      subject: 'Registry ID vs Codex thread',
      message: 'Registry agent IDs are TaskManager metadata; Codex thread IDs appear only when an external coordinator records them.',
      controls: '<span class="muted-copy">Read only</span>',
    },
    {
      rowType: 'Summary',
      state: `${eligible.length} eligible`,
      projectName: 'All projects',
      role: 'work count',
      subject: `${blocked.length} blocked · ${replies.length} replies · ${projectQueue.length} queued`,
      message: `${held.length} held/paused · ${assignments.length} registry assignments · ${policy.projects.length + policy.reviewers.length} active policies`,
      controls: button(loading ? 'Refreshing…' : 'Refresh summary', 'refresh-automation-summary', { primary: true, iconName: 'refresh', attrs: loading ? 'disabled' : '' }),
    },
    ...list(summary.projects).map(projectControlRow),
    ...overviewRows,
    ...notifications.map((item) => ({
      ...item,
      rowType: 'Heartbeat alert',
      state: item.severity || 'info',
      subject: item.reason || 'Heartbeat notification',
      message: item.message || item.recommendedAction || 'Inspect heartbeat notification.',
    })),
    ...policy.projects.map(([projectId, item]) => ({
      rowType: 'Active policy',
      state: 'Paused',
      projectId,
      projectName: projectId,
      role: 'project policy',
      subject: 'Project pause',
      updatedAt: item.updatedAt,
      message: item.reason || 'Project paused by operator policy.',
      controls: actionButton('Unpause', 'unpause-project', { projectId }, { reason: 'Unpause project policy.' }),
    })),
    ...policy.reviewers.map(([key, item]) => ({
      rowType: 'Active policy',
      state: 'Reviewer stopped',
      projectId: key.split('::')[0],
      projectName: key.split('::')[0],
      role: 'reviewer policy',
      subject: key,
      updatedAt: item.updatedAt,
      message: item.reason || 'Reviewer automation stopped by operator policy.',
      controls: actionButton('Resume', 'resume-reviewer', { projectId: key.split('::')[0] }, { reviewerKey: key, reason: 'Resume reviewer policy.' }),
    })),
    ...list(summary.auditEvents).map((event) => ({
      rowType: 'Audit',
      state: event.action || 'event',
      projectId: event.projectId || '—',
      projectName: event.projectId || '—',
      role: event.actor || event.source || 'automation',
      subject: event.assignmentId || 'Audit event',
      timestamp: event.timestamp,
      message: event.reason || event.source || 'Audit event recorded.',
      controls: '<span class="muted-copy">Recorded</span>',
    })),
  ];
  const unifiedTable = unifiedRows.length
    ? `<div class="table-wrap agent-overview-wrap"><table class="data-table agent-overview-table"><thead><tr><th>Type</th><th>State</th><th>Project</th><th>Role</th><th>Plan / scope</th><th>Heartbeat</th><th>Registry agent</th><th>Codex thread</th><th>What to do</th><th>Controls</th></tr></thead><tbody>${unifiedRows.map(renderUnifiedAgentRow).join('')}</tbody></table></div>`
    : emptyState({ title: loading ? 'Loading automation summary' : 'No agent work or project controls available', description: 'Project controls, active assignments, blocked work, user replies, held work, and lease issues appear in one table.', iconName: 'check' });
  return `<div class="page agents-page">${header}${error}<div class="toolbar"><div class="input-wrap search-wide">${icon('search')}<input class="input" type="search" placeholder="Search project, plan, assignment, reason…" data-live-filter="[data-filter-row]"></div></div><section class="agent-section priority-section"><h2>Agent operations table</h2><p class="section-subtitle">Everything on this route is consolidated into this single table; each row stays one line for fast scanning.</p>${unifiedTable}</section></div>`;
}
