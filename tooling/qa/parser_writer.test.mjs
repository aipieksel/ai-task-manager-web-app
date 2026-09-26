import assert from 'node:assert/strict';
import { buildProjectDomain, parsePlan, parseQuestions, parseTodo } from '../../src/taskmanager/js/domain/parser.js';
import { appendUserFeedback, appendUserVerificationComment, applyQuestionAnswer, applyRecommendedAnswers, removeTodoTaskItem, updateTodoTaskFields } from '../../src/taskmanager/js/domain/writer.js';
import { sha256 } from '../../src/taskmanager/js/lib/utils.js';
import { planOperationalMetadata, renderPlanMetadataPanels, renderPriorityCommentPanel, riskLabel, stripPlanDocumentChrome } from '../../src/taskmanager/js/ui/view-helpers.js';

const project = { id: 'project-test', name: 'Parser Test' };
const planPath = 'documentation/task/planning/draft/2026-06-21-test-plan.md';
const plan = `# Plan: Test plan

> **Status:** Questions Pending
> **Plan score:** Provisional 8/10

## Target State

A real target state.

## Question History / Decision Log

- [ ] **Q1: Which storage mode should be used?**
  - Decision: Storage mode
  - Why this matters: It changes persistence behavior.
  - Options:
    - (a) IndexedDB *(recommended)*
    - (b) Local storage
    - (c) Other — free-form path
  - Agent recommendation: (a) — Handles structured data.
  - Answer: pending
  - Answer source: pending

- [ ] **Q2: Which scan interval should be used?**
  - Decision: Polling interval
  - Why this matters: It changes filesystem load.
  - Options:
    - (a) Thirty seconds *(recommended)*
    - (b) Ten seconds
    - (c) Other — free-form path
  - Agent recommendation: (a) — Balanced default.
  - Answer: Pending.

## Implementation Steps

- [x] **Step 1: Parse files**
- [ ] **Step 2: Render records**

## Verification Plan — BLOCKING

- [ ] Verify parser output.

## Closeout Review

- Final status: Partial
`;

const todo = `# Parser Test — Active Tasks

## Active

- [ ] **Test plan**
  - Type: \`Task\`
  - Status: \`Questions Pending\`
  - Category: \`Bug\`
  - Plan: \`${planPath}\`
  - Scope: A real target state.
  - Closeout: \`Partial\`
  - Blocker: \`none\`
`;

const questions = parseQuestions(plan);
assert.equal(questions.length, 2);
assert.equal(questions[0].id, 'Q1');
assert.equal(questions[0].options.length, 3);
assert.equal(questions[0].options[0].recommended, true);
assert.equal(questions[0].answer, 'pending');
assert.equal(questions[0].answered, false);
assert.equal(questions[1].answer, 'Pending.');
assert.equal(questions[1].answered, false);

const answered = applyQuestionAnswer(plan, 'Q1', questions[0].options[1]);
assert.match(answered.text, /- \[x\] \*\*Q1:/);
assert.match(answered.text, /- Answer: Local storage/);
assert.match(answered.text, /- Answer source: TaskManager interactive choice/);
assert.match(answered.text, /\(a\) IndexedDB/);
assert.match(answered.text, /\(c\) Other/);
assert.equal(parseQuestions(answered.text)[0].answered, true);

const recommended = applyRecommendedAnswers(answered.text);
assert.equal(recommended.applied.length, 1);
assert.equal(recommended.applied[0].id, 'Q2');
assert.match(recommended.text, /- Answer: Thirty seconds/);

const parsedPlan = parsePlan(plan, planPath, project);
assert.equal(parsedPlan.title, 'Test plan');
assert.equal(parsedPlan.lifecycle, 'draft');
assert.equal(parsedPlan.closeoutStatus, 'Partial');
assert.equal(parsedPlan.completedSteps, 1);
assert.equal(parsedPlan.totalSteps, 3);
assert.equal(parsedPlan.questions.filter((question) => !question.answered).length, 2);

const checklistBookkeepingPlan = `# Plan: Checklist bookkeeping

## Implementation Steps

- [ ] Implement canonical resolver.
- [ ] Update UI diagnostics.

## Executor implementation results — 2026-06-23

- [x] Added canonical resolver.
- [x] Updated UI diagnostics.

## R1 rejection route — 2026-06-23

- [ ] R1 Implementation Approved — NOT APPROVED; stale historical review result.

## Fresh R1 approval and user-verification routing — 2026-06-23

- [x] R1 Implementation Approved — fresh approval.
- [x] User Verification Required — final item checked.
`;
const parsedBookkeepingPlan = parsePlan(checklistBookkeepingPlan, 'documentation/task/planning/user-verification/2026-06-23-checklist-bookkeeping.md', project);
assert.equal(parsedBookkeepingPlan.completedSteps, 2);
assert.equal(parsedBookkeepingPlan.totalSteps, 4);
assert.ok(parsedBookkeepingPlan.checkboxes.some((item) => item.text === 'Implement canonical resolver.'));
assert.ok(!parsedBookkeepingPlan.checkboxes.some((item) => item.text === 'Added canonical resolver.'));
assert.ok(!parsedBookkeepingPlan.checkboxes.some((item) => /NOT APPROVED/.test(item.text)));

const legacyOperationalPlan = `# Plan: Legacy operational header

> **Planning State:** Ready for Review
> **Execution State:** Agent complete
> **Reviewer Seal:** R1 approved
> **Automation assignment id:** abc123
> **Automation agent id:** aipieksel-task-tracker-build-agent

## Actual Work

This is the implementation body.

> **Status:** This ordinary quote is not top chrome.
`;
const legacyOperationalTask = { ...parsePlan(legacyOperationalPlan, 'documentation/task/planning/review/legacy-operational-header.md', project), source: 'plan' };
const legacyMetadataGroups = planOperationalMetadata(legacyOperationalTask);
assert.equal(legacyMetadataGroups.find((group) => group.id === 'plan-state').rows.find((row) => row.label === 'Planning state').value, 'Ready for Review');
assert.equal(legacyMetadataGroups.find((group) => group.id === 'review-verification').rows.find((row) => row.label === 'Reviewer seal').value, 'R1 approved');
assert.equal(legacyMetadataGroups.find((group) => group.id === 'automation-assignment').rows.find((row) => row.label === 'Assignment ID').value, 'abc123');
assert.match(renderPlanMetadataPanels(legacyOperationalTask), /Automation assignment/);
const cleanedLegacyBody = stripPlanDocumentChrome(legacyOperationalPlan);
assert.ok(!cleanedLegacyBody.includes('Planning State'));
assert.ok(!cleanedLegacyBody.includes('Automation assignment id'));
assert.match(cleanedLegacyBody, /^## Actual Work/m);
assert.match(cleanedLegacyBody, /> \*\*Status:\*\* This ordinary quote is not top chrome/);
assert.equal(legacyOperationalTask.status, 'Review');

const approvedPlan = parsePlan(plan.replace('> **Status:** Questions Pending', '> **Status:** Approved'), 'documentation/task/planning/approved/2026-06-21-test-plan.md', project);
assert.equal(approvedPlan.lifecycle, 'approved');
assert.equal(approvedPlan.status, 'Approved');

const reviewPlan = parsePlan(plan.replace('> **Status:** Questions Pending', '> **Status:** Review'), 'documentation/task/planning/review/2026-06-21-test-plan.md', project);
assert.equal(reviewPlan.lifecycle, 'review');
assert.equal(reviewPlan.status, 'Review');

const reviewingPlan = parsePlan(plan.replace('> **Status:** Questions Pending', '> **Status:** Reviewing'), 'documentation/task/planning/review/2026-06-21-test-plan.md', project);
assert.equal(reviewingPlan.lifecycle, 'review');
assert.equal(reviewingPlan.status, 'Reviewing');

const userVerificationPlan = parsePlan(plan.replace('> **Status:** Questions Pending', '> **Status:** User Verification'), 'documentation/task/planning/user-verification/2026-06-21-test-plan.md', project);
assert.equal(userVerificationPlan.lifecycle, 'user-verification');
assert.equal(userVerificationPlan.status, 'User Verification');

const sentToAgentPlan = parsePlan(plan.replace('> **Status:** Questions Pending', '> **Status:** Sent to Agent'), 'documentation/task/planning/user-verification/2026-06-21-test-plan.md', project);
assert.equal(sentToAgentPlan.lifecycle, 'user-verification');
assert.equal(sentToAgentPlan.status, 'Sent to Agent');

const failedUserVerificationPlan = parsePlan(plan.replace('> **Status:** Questions Pending', '> **Status:** Requesting User Feedback'), 'documentation/task/planning/failed-user-verification/2026-06-21-test-plan.md', project);
assert.equal(failedUserVerificationPlan.lifecycle, 'failed-user-verification');
assert.equal(failedUserVerificationPlan.status, 'Requesting User Feedback');

const archivePlan = parsePlan(plan.replace('> **Status:** Questions Pending', '> **Status:** Archived'), 'documentation/task/planning/archive/2026-06-21-test-plan.md', project);
assert.equal(archivePlan.lifecycle, 'archive');
assert.equal(archivePlan.status, 'Archived');

const todoTasks = parseTodo(todo, 'documentation/task/todo.md', project);
assert.equal(todoTasks.length, 1);
assert.equal(todoTasks[0].category, 'Bug');
assert.equal(todoTasks[0].planPath, planPath);

const updatedTodo = updateTodoTaskFields(todo, todoTasks[0], {
  Status: '`Approved`',
  Plan: '`documentation/task/planning/approved/2026-06-21-test-plan.md`',
});
assert.match(updatedTodo, /Status: `Approved`/);
assert.ok(updatedTodo.includes('Plan: `documentation/task/planning/approved/2026-06-21-test-plan.md`'));
assert.match(updatedTodo, /Category: `Bug`/);

const reviewTodo = updateTodoTaskFields(updatedTodo, todoTasks[0], {
  Status: '`Review`',
  Plan: '`documentation/task/planning/review/2026-06-21-test-plan.md`',
});
assert.match(reviewTodo, /Status: `Review`/);
assert.ok(reviewTodo.includes('Plan: `documentation/task/planning/review/2026-06-21-test-plan.md`'));

const removedTodo = removeTodoTaskItem(reviewTodo, todoTasks[0]);
assert.ok(!removedTodo.includes('**Test plan**'));
assert.ok(!removedTodo.includes('Plan: `documentation/task/planning/review/2026-06-21-test-plan.md`'));

const feedbackPlan = appendUserFeedback(plan, 'Preview is still broken on mobile.', { savedAt: '2026-06-21T17:30:00Z' });
assert.match(feedbackPlan, /## User Verification Feedback/);
assert.match(feedbackPlan, /### Feedback saved 2026-06-21T17:30:00Z/);
assert.match(feedbackPlan, /Preview is still broken on mobile/);

const commentPlan = appendUserVerificationComment(plan, 'Can the agent explain what was verified?', { savedAt: '2026-06-21T18:30:00Z' });
assert.match(commentPlan, /## User Verification Comments/);
assert.match(commentPlan, /### Comment sent 2026-06-21T18:30:00Z/);
assert.match(commentPlan, /- Status: Sent to Agent/);
assert.match(commentPlan, /Can the agent explain what was verified/);

const files = [
  { path: 'documentation/task/todo.md', relativeToTaskRoot: 'todo.md', text: todo, hash: await sha256(todo), size: todo.length, lastModified: 1 },
  { path: planPath, relativeToTaskRoot: 'planning/draft/2026-06-21-test-plan.md', text: plan, hash: await sha256(plan), size: plan.length, lastModified: 1 },
];
const domain = buildProjectDomain(project, files);
assert.equal(domain.tasks.length, 1);
assert.equal(domain.tasks[0].todo.title, 'Test plan');
assert.equal(domain.tasks[0].unansweredQuestions, 2);
assert.equal(domain.questions.length, 2);
assert.equal(domain.queue.length, 1);

const folderBase = 'documentation/task/planning/in-progress/00001-2026-06-22-folder-plan';
const manifest = {
  schema: 'task-plan-folder/v1',
  planId: '00001',
  title: 'Folder plan',
  lifecycle: 'in-progress',
  status: 'In Progress',
  planScore: { value: 8.85, provisional: false, reason: 'Structured score shape from generated plan.json.' },
  riskLevel: 'High',
  planningState: 'Executor complete',
  reviewerSeal: 'R1 approved by reviewer',
  userVerificationOutcome: 'Accepted by user',
  automation: {
    claimed: true,
    assignmentId: 'folder-assignment-123',
    agentRole: 'project-agent',
    agentId: 'aipieksel-task-tracker-build-agent',
    leaseExpiresAt: '2026-06-23T07:00:00Z',
    handoffReason: 'approved_execution',
  },
  folderName: '00001-2026-06-22-folder-plan',
  canonicalFiles: [
    '01-original-scope.md',
    '05-questions-and-decisions.md',
    '12-comments.md',
  ],
};
const folderQuestions = `---
schema: task-plan-section/v1
status: In Progress
lifecycle: in-progress
---
# Questions and Decisions

- [x] **Q1: Which structure should be used?**
  - Options:
    - (a) Legacy file
    - (b) V7 folder *(recommended)*
  - Agent recommendation: (b) — Matches generator.
  - Answer: V7 folder
  - Answer source: user chat
`;
const folderTodo = `# Parser Test — Active Tasks

| ID | Title | Status | Plan | Owner | Updated | Scope |
| --- | --- | --- | --- | --- | --- | --- |
| TASK-00001 | Folder plan | In Progress | [plan](${folderBase}) | Codex | 2026-06-22 | Parse V7 folders. |
`;
const folderFiles = [
  { path: 'documentation/task/todo.md', relativeToTaskRoot: 'todo.md', text: folderTodo, hash: await sha256(folderTodo), size: folderTodo.length, lastModified: 1 },
  { path: `${folderBase}/plan.json`, relativeToTaskRoot: 'planning/in-progress/00001-2026-06-22-folder-plan/plan.json', text: `${JSON.stringify(manifest, null, 2)}\n`, hash: await sha256(JSON.stringify(manifest)), size: 1, lastModified: 5 },
  { path: `${folderBase}/01-original-scope.md`, relativeToTaskRoot: 'planning/in-progress/00001-2026-06-22-folder-plan/01-original-scope.md', text: '# Original Scope\n\nFolder target state.', hash: await sha256('scope'), size: 1, lastModified: 2 },
  { path: `${folderBase}/05-questions-and-decisions.md`, relativeToTaskRoot: 'planning/in-progress/00001-2026-06-22-folder-plan/05-questions-and-decisions.md', text: folderQuestions, hash: await sha256(folderQuestions), size: folderQuestions.length, lastModified: 3 },
  { path: `${folderBase}/12-comments.md`, relativeToTaskRoot: 'planning/in-progress/00001-2026-06-22-folder-plan/12-comments.md', text: '# Comments\n\n## Comment sent 2026-06-24T10:00:00Z\n\n- Comment: Can you explain this?\n\n## Agent reply 2026-06-24T10:05:00Z\n\n- Reply: The blocked status now syncs to todo.\n', hash: await sha256('comments'), size: 1, lastModified: 4 },
  { path: 'documentation/task/task-system-tests/plan-folder-structure/sample-planning/plan.json', relativeToTaskRoot: 'task-system-tests/plan-folder-structure/sample-planning/plan.json', text: `${JSON.stringify(manifest)}\n`, hash: await sha256('ignored'), size: 1, lastModified: 6 },
];
const folderDomain = buildProjectDomain(project, folderFiles);
assert.equal(folderDomain.tasks.length, 1);
assert.equal(folderDomain.tasks[0].planKind, 'folder');
assert.equal(folderDomain.tasks[0].path, folderBase);
assert.equal(folderDomain.tasks[0].manifestPath, `${folderBase}/plan.json`);
assert.equal(folderDomain.tasks[0].questionPath, `${folderBase}/05-questions-and-decisions.md`);
assert.equal(folderDomain.tasks[0].commentsPath, `${folderBase}/12-comments.md`);
assert.equal(folderDomain.tasks[0].planSections.length, 3);
assert.equal(folderDomain.tasks[0].todo.title, 'Folder plan');
assert.equal(folderDomain.tasks[0].status, 'In Progress');
assert.equal(folderDomain.tasks[0].lifecycle, 'in-progress');
assert.equal(folderDomain.tasks[0].score, '8.85/10');
assert.equal(folderDomain.tasks[0].commentEvents.length, 2);
assert.equal(folderDomain.tasks[0].commentEvents[1].actor, 'agent');
assert.match(renderPriorityCommentPanel(folderDomain.tasks[0]), /Latest agent reply/);
assert.match(renderPriorityCommentPanel(folderDomain.tasks[0]), /blocked status now syncs to todo/);
const folderMetadataGroups = planOperationalMetadata(folderDomain.tasks[0]);
assert.equal(folderMetadataGroups.find((group) => group.id === 'plan-state').rows.find((row) => row.label === 'Planning state').value, 'Executor complete');
assert.equal(folderMetadataGroups.find((group) => group.id === 'plan-state').rows.find((row) => row.label === 'User verification').value, 'Accepted by user');
assert.equal(folderMetadataGroups.find((group) => group.id === 'review-verification').rows.find((row) => row.label === 'Reviewer seal').value, 'R1 approved by reviewer');
assert.equal(folderMetadataGroups.find((group) => group.id === 'automation-assignment').rows.find((row) => row.label === 'Assignment ID').value, 'folder-assignment-123');
assert.match(renderPlanMetadataPanels(folderDomain.tasks[0]), /Review and verification/);
assert.ok(folderDomain.tasks[0].completionBlockers.includes('R1 implementation approval is missing'));
assert.equal(folderDomain.questions.length, 1);
assert.equal(folderDomain.questions[0].planPath, `${folderBase}/05-questions-and-decisions.md`);
assert.equal(folderDomain.queue.length, 1);

const markdownChromeBase = 'documentation/task/planning/pending/00003-markdown-summary';
const markdownChromeManifest = { ...manifest, planId: '00003', title: 'Markdown-free queue summary', lifecycle: 'pending', status: 'Pending', folderName: '00003-markdown-summary', canonicalFiles: ['01-original-scope.md'] };
const markdownChromeScope = '# Original Scope\n\n> **At a Glance:** Preserve **customer state** with a [`safe retry`](https://example.invalid/retry).\n';
const markdownChromeDomain = buildProjectDomain(project, [
  { path: `${markdownChromeBase}/plan.json`, relativeToTaskRoot: 'planning/pending/00003-markdown-summary/plan.json', text: `${JSON.stringify(markdownChromeManifest, null, 2)}\n`, hash: await sha256(JSON.stringify(markdownChromeManifest)), size: 1, lastModified: 5 },
  { path: `${markdownChromeBase}/01-original-scope.md`, relativeToTaskRoot: 'planning/pending/00003-markdown-summary/01-original-scope.md', text: markdownChromeScope, hash: await sha256(markdownChromeScope), size: markdownChromeScope.length, lastModified: 4 },
]);
assert.equal(markdownChromeDomain.tasks[0].description, 'Preserve customer state with a safe retry.');
assert.ok(!/[>*_`\[\]]/.test(markdownChromeDomain.tasks[0].description));
assert.equal(riskLabel(markdownChromeDomain.tasks[0]), 'High');

const roleOwnedFolderBase = 'documentation/task/planning/in-progress/00002-2026-06-23-role-owned-plan';
const roleOwnedManifest = {
  schema: 'task-plan-folder/v1',
  planId: '00002',
  title: 'Role owned folder plan',
  lifecycle: 'in-progress',
  status: 'In Progress',
  planScore: '8/10',
  riskLevel: 'Medium',
  folderName: '00002-2026-06-23-role-owned-plan',
  sections: [
    { order: 3, file: '03-implementation-checklist.md', sectionId: '03-implementation-checklist', title: 'Implementation Checklist', navLabel: 'Implementation', layout: 'checklist', ownerRole: 'planner', editPolicy: 'taskmanager-synced' },
    { order: 6, file: '06-executor-report.md', sectionId: '06-executor-report', title: 'Executor Report', navLabel: 'Executor', layout: 'report', ownerRole: 'executor', editPolicy: 'role-owned' },
    { order: 10, file: '10-post-implementation-checklist.md', sectionId: '10-post-implementation-checklist', title: 'Post-Implementation Checklist', navLabel: 'Checklist', layout: 'checklist', ownerRole: 'reviewer', editPolicy: 'taskmanager-synced' },
  ],
};
const roleOwnedFiles = [
  { path: 'documentation/task/todo.md', relativeToTaskRoot: 'todo.md', text: folderTodo.replace('Folder plan', 'Role owned folder plan').replace(folderBase, roleOwnedFolderBase), hash: await sha256(folderTodo), size: 1, lastModified: 1 },
  { path: `${roleOwnedFolderBase}/plan.json`, relativeToTaskRoot: 'planning/in-progress/00002-2026-06-23-role-owned-plan/plan.json', text: `${JSON.stringify(roleOwnedManifest, null, 2)}\n`, hash: await sha256(JSON.stringify(roleOwnedManifest)), size: 1, lastModified: 5 },
  { path: `${roleOwnedFolderBase}/03-implementation-checklist.md`, relativeToTaskRoot: 'planning/in-progress/00002-2026-06-23-role-owned-plan/03-implementation-checklist.md', text: '# Implementation Checklist\n\n- [x] Live implementation item.\n- [ ] Remaining implementation item.\n', hash: await sha256('impl'), size: 1, lastModified: 2 },
  { path: `${roleOwnedFolderBase}/06-executor-report.md`, relativeToTaskRoot: 'planning/in-progress/00002-2026-06-23-role-owned-plan/06-executor-report.md', text: '# Executor Report\n\n- [x] Invalid duplicate result checkbox that must not count.\n', hash: await sha256('report'), size: 1, lastModified: 3 },
  { path: `${roleOwnedFolderBase}/10-post-implementation-checklist.md`, relativeToTaskRoot: 'planning/in-progress/00002-2026-06-23-role-owned-plan/10-post-implementation-checklist.md', text: '# Post-Implementation Checklist\n\n- [x] R1 approved.\n', hash: await sha256('post'), size: 1, lastModified: 4 },
];
const roleOwnedDomain = buildProjectDomain(project, roleOwnedFiles);
assert.equal(roleOwnedDomain.tasks[0].completedSteps, 2);
assert.equal(roleOwnedDomain.tasks[0].totalSteps, 3);
assert.ok(!roleOwnedDomain.tasks[0].checkboxes.some((item) => /Invalid duplicate/.test(item.text)));

const updatedTableTodo = updateTodoTaskFields(folderTodo, folderDomain.tasks[0].todo, {
  Status: '`Review`',
  Plan: '`documentation/task/planning/review/00001-2026-06-22-folder-plan`',
});
assert.match(updatedTableTodo, /`Review`/);
assert.ok(updatedTableTodo.includes('planning/review/00001-2026-06-22-folder-plan'));
assert.ok(!removeTodoTaskItem(updatedTableTodo, folderDomain.tasks[0].todo).includes('TASK-00001'));

console.log('parser_writer.test.mjs: pass');
