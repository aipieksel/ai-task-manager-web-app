# Codex Task Workflow

## Purpose

This workflow is the canonical task lifecycle for Codex-managed implementation work in this project. The fixed task root is `docs/tasks` unless a project install substituted an existing TaskManager task root. Do not create parallel task systems under another path.

## Fixed Folder Structure

Every generated task system must contain these folders:

```text
docs/tasks/planning/draft
docs/tasks/planning/pending
docs/tasks/planning/approved
docs/tasks/planning/in-progress
docs/tasks/planning/review
docs/tasks/planning/user-verification
docs/tasks/planning/failed-user-verification
docs/tasks/planning/completed
docs/tasks/planning/archive
docs/tasks/planning/parked
docs/tasks/planning/blocker
docs/tasks/reviews
docs/tasks/logs
docs/tasks/quick-fixes
docs/tasks/task-system.config.yaml
docs/tasks/task-system-tests/plan-folder-structure
```

## Lifecycle Summary

1. `draft` — planner creates a folder and asks/records open questions.
2. `pending` — plan is complete and awaiting user approval.
3. `approved` — user approved implementation.
4. `in-progress` — executor claimed the plan and writes only executor-owned files plus controlled checklist/status updates.
5. `review` — implementation finished and awaits R1 review.
6. `user-verification` — R1 approved, commit attempted, documentation/log handoff complete, user verification required.
7. `failed-user-verification` — user found an issue.
8. `completed` — user verification passed and R2 closeout approved.
9. `archive` — closed historical plans not part of active lifecycle.
10. `parked` — intentionally paused work.
11. `blocker` — blocked work with exact blocker reason.

## Task-System Configuration

The task system has a preserved project-local config file:

```text
docs/tasks/task-system.config.yaml
```

The generator creates this file only when missing. It must not overwrite user edits on later package updates.

Default config shape includes:

- `planning.defaultMode`: `auto`, `quick`, `standard`, or `full`.
- `planning.allowInvocationModeOverride`: allows `$plan-task --quick`, `@plan-task --standard`, and equivalent explicit mode invocations.
- `codexGoal.enabled`: controls whether executors call Codex goal tools.
- `review.autoSpawnSubagent`: controls whether executors spawn reviewer sub-agents after moving to review.
- `review.waitForSpawnedReviewer`: controls whether executors wait for spawned reviewers.
- `lifecycle.userVerification.treatAsDoneForAgentWork`: controls whether plans left in user-verification count as agent-complete/done for work triage.

Planning must snapshot the effective config into `plan.json.taskSystemConfigSnapshot`. Existing plans follow their snapshot; changing `docs/tasks/task-system.config.yaml` affects future plans and materially re-planned tasks.

When `codexGoal.enabled` is false, executors skip Codex goal tool calls and record the config-controlled skip. When `review.autoSpawnSubagent` is false, executors move to `review` and stop/request manual assignment instead of spawning a reviewer. When `lifecycle.userVerification.treatAsDoneForAgentWork` is true, a plan left in `user-verification` is considered agent-complete/done for work triage and must not be marked dirty merely because the user has not moved it to `completed`.

## Task Mode Triage

Before choosing a workflow, classify the request as `Quick Fix`, `Standard Plan`, or `Full Robust Plan`.

### Quick Fix Mode

Use `.agents/skills/quick-fix/SKILL.md` for a single-purpose, isolated, low-risk fix with an obvious target, normally one to three touched files, no material compatibility or migration risk, no security/auth/provider/data/schema/deployment boundary, no broad UI or cross-module coordination, and one straightforward verification path.

Quick Fix Mode bypasses the 12-file plan folder, but it does not bypass safety. It still requires relevant documentation/source inspection, the `Pre-flight Readiness Gate`, targeted verification, and a log entry under `docs/tasks/quick-fixes/YYYY-MM-DD.md`.

### Standard Plan Mode

Use `.agents/skills/plan-task/SKILL.md` for normal feature work, multi-file implementation, ambiguous scope, or any change requiring user decisions, lifecycle tracking, reviewer handoff, or multiple verification paths.

### Full Robust Plan Mode

Use the standard plan lifecycle with extra architecture, compatibility, rollback, migration, and verification detail for high-risk work touching saved data, public contracts, providers, auth/security, queues, infrastructure, deployment, or broad workflows.

When uncertain, choose `plan-task` instead of Quick Fix Mode.

## Explicit Plan-Task Mode Parameters

Agents must recognize explicit mode parameters in user prompts and skill invocations:

- `$plan-task --quick`, `@plan-task --quick`, `/plan-task --quick`, or `plan-task --quick` request Quick Fix Mode.
- `$plan-task --standard`, `@plan-task --standard`, `/plan-task --standard`, or `plan-task --standard` force Standard Plan Mode.
- `$plan-task --full`, `@plan-task --full`, `/plan-task --full`, `$plan-task --robust`, or `@plan-task --robust` force Full Robust Plan Mode.

Explicit mode parameters override `planning.defaultMode` except that `--quick` cannot bypass Quick Fix hard exclusions. If `--quick` is unsafe, escalate to Standard/Full and record the requested mode, effective mode, and reason.

## Pre-flight Readiness Gate

Agents must run a proportional `Pre-flight Readiness Gate` before editing when a task depends on runtime state. The gate finds missing databases, stopped services, unhealthy dev servers, stale migrations, unavailable ports, missing package installs, browser dependencies, credentials, or provider/service readiness issues before implementation is halfway complete.

Rules:

1. Check only dependencies required for the specific quick fix or approved plan.
2. Prefer documented project health commands, health endpoints, smoke tests, or helpers.
3. Record the result in the quick-fix log or `06-executor-report.md`.
4. If a required dependency is unhealthy before editing, stop early and report it as an environment/readiness blocker.
5. Do not repair unrelated infrastructure unless the user explicitly expands scope or the approved plan already includes that repair.
6. If no runtime dependency is required, record `Pre-flight Readiness Gate: not required`.

This gate speeds work by failing early and keeping implementation focused.

## Plan Next-Step Choice Contract

Every planning response that presents an approval-ready plan and asks what to do next must repeat the full Plan Quality Assessment in the same message and end with exactly this numbered choice block:

```markdown
## Choose next step
1. Move to approved and execute the plan using the execute-plan skill.
2. Move to pending.
3. Park.

Reply with `1`, `2`, or `3`.
```

The agent must treat `1` as explicit approval to move the plan to `approved` and execute it with `.agents/skills/execute-plan/SKILL.md`, `2` as explicit approval to move the plan to `pending`, and `3` as explicit approval to move the plan to `parked` with the parking reason recorded.

## Full-Context Clarification Questions

Planning questions must include the full question, the full explanation and reasoning for why the question matters, exactly three clear answer options, and one recommended answer. The agent must ask every question whose answer materially affects architecture, compatibility, migration, risk, testing, scope, implementation order, or acceptance, while limiting the question set to six when possible.

When there are six or fewer questions, include a recommended-answer bundle: "Reply `recommended` to proceed with all recommended answers, or answer individually using `Q1=A, Q2=B`." Record the same full questions, reasoning, options, recommendations, bundle, and user answers in `02-planning-and-decisions.md`.

## Post-Plan Change Preparation Gate

After a plan has already been approved, executed, reviewed, or moved through user verification, additional user-requested changes must not be blindly implemented. Even when no new plan is created, the agent must first read relevant documentation, scan the relevant codebase/source paths, understand the current implementation, compare the new request to approved scope and evidence, ask clarification questions when needed, then make the change, rerun relevant verification, and update documentation where needed.

If the additional change materially alters approved scope, public contracts, data shape, security, migration/rollback risk, or verification obligations, route back to `plan-task` for a new/amended plan or record an explicit no-new-plan change addendum with preparation evidence and user approval before editing.

## Path-Aware Lessons System

The task system uses three lesson layers:

- `docs/tasks/lessons-active.md` is the curated evergreen set and is read first.
- `docs/tasks/lessons-index.json` is the structured lookup matched by task keywords, expected or confirmed touched paths, and workflow type.
- `docs/tasks/lessons.md` is the full archive and is read only for matched lesson IDs needing extra context or when recording a new correction.

### Before planning

1. After completing any higher-priority repository documentation entry-point rule, read the latest one or two files in `docs/tasks/logs/` when present and read `docs/tasks/todo.md`.
2. Read `docs/tasks/lessons-active.md` and `docs/tasks/lessons-index.json`.
3. Match lessons using the user request, likely or confirmed touched paths, and the planning workflow type.
4. Read `docs/tasks/lessons.md` only for matched IDs that require more context.
5. Record matched IDs, titles, and one-line applicability reasons under `## Relevant Lessons` in `02-planning-and-decisions.md`, and surface the same result in the planning chat summary. When nothing matches, write `Relevant lessons: none.`
6. Re-run the lookup when evidence changes scope or identifies touched paths not covered by the initial match.

### Before execution, correction, review, verification, or documentation

1. Read the plan's `Relevant Lessons` section when present.
2. Re-read `docs/tasks/lessons-active.md` and `docs/tasks/lessons-index.json` using confirmed touched paths and the current workflow type.
3. Read only matched archive entries that need additional context.
4. State `Applied lessons` with matched lesson IDs/titles before implementation or workflow action. When nothing matches, state `Applied lessons: none.`
5. Re-run the lookup whenever scope changes or a newly touched path falls outside the initial match.

### After a user correction

1. Append a reusable recurrence-prevention lesson to `docs/tasks/lessons.md`.
2. Add or update the lesson's keyword, path-glob, and workflow lookup entry in `docs/tasks/lessons-index.json`.
3. When the lesson is evergreen and reusable, promote it to `docs/tasks/lessons-active.md`.
4. Validate `docs/tasks/lessons-index.json` as parseable JSON after editing it.
5. Never silently skip the update. If a required lesson file is missing or inaccessible, stop and report the exact path.

## Plan Folder Creation Helper

New plan folders should be created with the canonical helper:

```bash
python3 docs/tasks/task-system-helpers/create-plan-folder.py \
  --project-root . \
  --title "<task title>" \
  --codex-end-goal "<concise outcome-level goal with completion guard>"
```

The helper scans all lifecycle folders, chooses the next five-digit ID, writes `plan.json` with `codexEndGoal`, and creates all twelve section files. Agents must check `docs/tasks/task-system-helpers/create-plan-folder.py` before claiming no helper exists. Direct folder creation is only a fallback after recording the exact helper path and failure.

## Plan Folder Naming

New plans are folders, never standalone Markdown files. Use `<five-digit-sequential-id>-<yyyy-mm-dd>-<kebab-task-name>`. The next ID is calculated by scanning every lifecycle folder under `docs/tasks/planning/*` and taking the highest existing five-digit prefix plus one.

## Canonical Plan Files

Every plan folder contains exactly these section files plus `plan.json`:

```text
plan.json
01-original-scope.md
02-planning-and-decisions.md
03-implementation-checklist.md
04-testing-checklist.md
05-risk-rollback-acceptance.md
06-executor-report.md
07-executor-evidence.md
08-verification-handoff.md
09-r1-review.md
10-post-implementation-checklist.md
11-r2-closeout-review.md
12-comments.md
evidence/
evidence/proof-screenshots/
```

## Role-Owned File Contract

Plan artifacts separate role-owned writing areas from machine-owned state. Each plan folder also owns an `evidence/` directory, including `evidence/proof-screenshots/`, for durable proof files. Do not use a global `docs/tasks/verification-evidence` folder:

| File | Owner | Edit policy |
| --- | --- | --- |
| `01-original-scope.md` | planner | frozen-after-approval |
| `02-planning-and-decisions.md` | planner | frozen-after-approval |
| `03-implementation-checklist.md` | planner | taskmanager-synced |
| `04-testing-checklist.md` | planner | taskmanager-synced |
| `05-risk-rollback-acceptance.md` | planner | frozen-after-approval |
| `06-executor-report.md` | executor | role-owned |
| `07-executor-evidence.md` | executor | role-owned |
| `08-verification-handoff.md` | executor | role-owned |
| `09-r1-review.md` | reviewer | role-owned |
| `10-post-implementation-checklist.md` | reviewer | taskmanager-synced |
| `11-r2-closeout-review.md` | reviewer | role-owned |
| `12-comments.md` | all | append-only |


Rules:

- `plan.json` is TaskManager/helper-owned machine state. Do not hand-edit random JSON to make lifecycle/checklist state look correct.
- Planner-owned files freeze after approval except controlled status/lifecycle synchronization.
- Executors write execution notes only in executor-owned files and update live checklist items only as controlled progress state.
- Reviewers write review findings only in reviewer-owned files and update post-implementation checklist items only as controlled review/closeout state.
- Comments are append-only.

## plan.json Contract

Every `plan.json` must use this shape:

```json
{
  "schema": "task-plan-folder/v1",
  "planId": "00001",
  "folderName": "00001-2026-06-23-example-task",
  "title": "Example Task",
  "slug": "example-task",
  "created": "2026-06-23",
  "updated": "2026-06-23",
  "lifecycle": "draft",
  "planningState": "questions-pending",
  "status": "Draft",
  "riskLevel": "medium",
  "planScore": "Provisional 0/10",
  "codexEndGoal": "Implement the approved example task, verify the changed behavior, update required documentation, complete independent review, and hand off for user verification.",
  "sections": [
    {"order": 1, "file": "01-original-scope.md", "sectionId": "01-original-scope", "title": "Original Scope", "navLabel": "Scope", "layout": "article", "ownerRole": "planner", "editPolicy": "frozen-after-approval"},
    {"order": 2, "file": "02-planning-and-decisions.md", "sectionId": "02-planning-and-decisions", "title": "Planning and Decisions", "navLabel": "Planning", "layout": "decision-log", "ownerRole": "planner", "editPolicy": "frozen-after-approval"},
    {"order": 3, "file": "03-implementation-checklist.md", "sectionId": "03-implementation-checklist", "title": "Implementation Checklist", "navLabel": "Implementation", "layout": "checklist", "ownerRole": "planner", "editPolicy": "taskmanager-synced"},
    {"order": 4, "file": "04-testing-checklist.md", "sectionId": "04-testing-checklist", "title": "Testing Checklist", "navLabel": "Testing", "layout": "checklist", "ownerRole": "planner", "editPolicy": "taskmanager-synced"},
    {"order": 5, "file": "05-risk-rollback-acceptance.md", "sectionId": "05-risk-rollback-acceptance", "title": "Risk, Rollback, and Acceptance", "navLabel": "Acceptance", "layout": "matrix", "ownerRole": "planner", "editPolicy": "frozen-after-approval"},
    {"order": 6, "file": "06-executor-report.md", "sectionId": "06-executor-report", "title": "Executor Report", "navLabel": "Executor", "layout": "report", "ownerRole": "executor", "editPolicy": "role-owned"},
    {"order": 7, "file": "07-executor-evidence.md", "sectionId": "07-executor-evidence", "title": "Executor Evidence", "navLabel": "Evidence", "layout": "evidence", "ownerRole": "executor", "editPolicy": "role-owned"},
    {"order": 8, "file": "08-verification-handoff.md", "sectionId": "08-verification-handoff", "title": "Verification Handoff", "navLabel": "Verification", "layout": "matrix", "ownerRole": "executor", "editPolicy": "role-owned"},
    {"order": 9, "file": "09-r1-review.md", "sectionId": "09-r1-review", "title": "R1 Review", "navLabel": "R1 Review", "layout": "review", "ownerRole": "reviewer", "editPolicy": "role-owned"},
    {"order": 10, "file": "10-post-implementation-checklist.md", "sectionId": "10-post-implementation-checklist", "title": "Post-Implementation Checklist", "navLabel": "Post Checklist", "layout": "checklist", "ownerRole": "reviewer", "editPolicy": "taskmanager-synced"},
    {"order": 11, "file": "11-r2-closeout-review.md", "sectionId": "11-r2-closeout-review", "title": "R2 Closeout Review", "navLabel": "R2 Review", "layout": "review", "ownerRole": "reviewer", "editPolicy": "role-owned"},
    {"order": 12, "file": "12-comments.md", "sectionId": "12-comments", "title": "Comments", "navLabel": "Comments", "layout": "comments", "ownerRole": "all", "editPolicy": "append-only", "appendOnly": true}
  ]
}
```

Do not replace `sections` with `canonicalFiles`, `files`, `sectionFiles`, or any other alternate key. `planScore` must be a string, not an object. `codexEndGoal` must be a concise, concrete, outcome-level objective string with a clear completion guard, not a copied checklist, minimum-only target, or shortcut target. Each section must declare `ownerRole` and `editPolicy`.

## Codex End Goal and Goal Tool Contract

Every plan must define a clear, concise `Codex End Goal` in `plan.json.codexEndGoal`, `01-original-scope.md`, the Plan Quality Assessment, and the chat review when `taskSystemConfigSnapshot.config.codexGoal.requirePlanEndGoal` is true. The end goal is the exact objective the executor sets with the Codex goal feature when goal setting is enabled. It must be concise, outcome-level, bounded to approved scope, and state the core completion guard without repeating the implementation plan, testing checklist, documentation checklist, review process, or every detailed item in the plan. It must not be satisfiable by a minimum-only, shortcut, placeholder, or partial-delivery implementation.

At execution start, the executor must read the `Codex End Goal` and the plan's config snapshot. If `taskSystemConfigSnapshot.config.codexGoal.enabled` is true, confirm the goal is concise, outcome-level, and not a copied checklist, minimum-only target, or shortcut target, call `get_goal`, and then call `create_goal` with that objective when no unfinished goal is active. If an active goal already matches, adopt it and record that fact. If an unrelated unfinished goal is active, do not overwrite or falsely complete it; stop before editing and report a tooling blocker. If goal setting is disabled, record `Codex goal setting disabled by task-system.config.yaml` and skip goal tool calls. Do not call `update_goal(status="complete")` until the objective is actually achieved and no required work remains; do not call `update_goal(status="blocked")` except under the Codex repeated-blocker rule.

Executors must confirm it is concise, outcome-level, and not a copied checklist, minimum-only target, or shortcut target before using goal tools. Executors must do not call `update_goal(status="complete")` until the objective is actually achieved and no required work remains.

## TaskManager Checklist Rendering Rule

TaskManager progress is based on live checklist files, not prose PASS summaries. Only these files should contain progress checkboxes:

- `03-implementation-checklist.md`
- `04-testing-checklist.md`
- `10-post-implementation-checklist.md`

Executor/reviewer reports, evidence, verification handoff, review history, comments, and lifecycle prose must use tables or normal bullets instead of duplicate `- [x]` result lists.

## Render-Friendly Markdown Contract

Each section file starts with YAML frontmatter:

```yaml
---
schema: task-plan-section/v1
section_id: 03-implementation-checklist
nav_label: Implementation
order: 3
layout: checklist
owner_role: planner
edit_policy: taskmanager-synced
summary: One sentence summary for the task manager UI.
status: draft
---
```

Then include one `#` heading matching the section title, a short `> At a Glance` block, stable subheadings, and tables/checklists where useful.


## Visible Plan Review and Quality Score

Every planning run must produce both a plan artifact and a human-readable chat review before approval or lifecycle movement. Every chat response that asks for approval, `move to pending`, `move to approved`, execution, parking, next-step choices, or lifecycle movement must repeat the full review in the same message, including after user answers are recorded or decisions are locked. The chat review and `02-planning-and-decisions.md` must include:

- what is good about the request/plan;
- what is risky or not good;
- what was not accounted for yet;
- assumptions;
- recommended path;
- Codex End Goal;
- plan score out of 10;
- why the plan is not 10/10;
- approval readiness and next-step choices.

`plan.json.planScore` is not enough by itself. The readable `Plan Quality Assessment` is required so the user can approve without opening the plan folder. A response that only says files were updated, answers were recorded, or asks the user to say `move to pending`, `move to approved`, `execute`, or `park` is incomplete.

## Executor Review Wait Handoff

The executor/build agent must stay active after handing implementation to an independent reviewer:

1. Move completed implementation to `docs/tasks/planning/review`.
2. Spawn one independent review sub-agent directly when sub-agent tooling is available.
3. Immediately call the platform wait tool for the spawned reviewer. In Codex multi-agent mode, use `wait_agent` with the reviewer agent ID and a long timeout rather than busy polling.
4. Do not end the executor turn with only a passive “reviewer started” handoff. The executor remains responsible for receiving the reviewer result and acting on it.
5. If the reviewer rejects or requests correction, executor actions the feedback, reruns verification, moves the plan back to review, spawns a fresh independent reviewer, and waits again.
6. If the reviewer approves, executor proceeds to the commit gate and user-verification handoff.
7. If wait-capable tooling is unavailable or fails, record the blocker in `08-verification-handoff.md` and report it with the high-visibility blocked format.

## Non-Blocking Commit Action Needed Format

When implementation is complete, independent R1 approved, documentation/log/observation handoff is complete, and the plan has moved to `user-verification`, unresolved local commit ambiguity is not a task blocker. It is a commit follow-up. Do not use the big `# 🚨 BLOCKED — ACTION REQUIRED` banner for that state.

Use this response format instead:

```markdown
# ✅ TASK READY FOR USER VERIFICATION — COMMIT ACTION NEEDED

**Status:** Implementation, verification, R1 review, documentation, and user-verification handoff are complete.
**Plan:** <plan path>
**Commit issue:** <one sentence explaining why a safe local commit was not made>
**What I already completed:**
- <brief bullets>

**Commit is the only unresolved follow-up.**

## Choose one commit option
1. Commit only these named task files: `<agent lists exact candidate paths>`.
2. Include all current dirty files in one commit.
3. Stash unrelated files, commit task files, then restore the stash.
4. Waive the local commit and leave the task in user verification.
```

The final visible section must be `## Choose one commit option` with numbered choices. Do not bury the choices in prose or earlier details.

## R1 Commit and User Verification Gate

After independent R1 implementation approval, keep the review decision and commit boundary completely separate:

1. Reviewers review only the work that was done against the approved plan, required tests, evidence, and checklist state.
2. Reviewers MUST NOT inspect, judge, approve, reject, block, or comment on repository-wide dirty-tree state, unrelated dirty files, staging safety, stash safety, commit feasibility, or whether a commit should be attempted.
3. Reviewers MUST NOT run commit-boundary commands for decision-making, including broad `git status` audits for unrelated files, `git add`, `git stash`, or `git commit`.
4. If executor evidence does not identify task-scoped changes well enough to review the work, reviewers may reject for missing task evidence, not for dirty-tree or commit-boundary reasons.
5. The executor/build agent, not the reviewer, handles the commit gate after R1 approval.
6. Confirm implementation/testing live checklists are synchronized.
7. Executor runs `git status --porcelain` and identifies task-related paths from the approved plan, executor evidence, and changed-file list.
8. If no Git repo exists, run `git init` in the project root before staging.
9. Executor stages only files clearly related to the task. Do not run broad `git add -A` when unrelated or ambiguous dirty files exist.
10. Executor must not use `git stash` or `git stash -u` without explicit user approval. Stashing can interfere with concurrent agents by removing their in-progress files from the shared worktree.
11. If task-related files are unambiguous, create one local commit with a generated task-specific message.
12. If unrelated or ambiguous dirty files prevent a safe task-only commit but implementation, R1 approval, documentation/log/observation handoff, and user-verification movement are complete, executor reports `# ✅ TASK READY FOR USER VERIFICATION — COMMIT ACTION NEEDED` and ends with the numbered `## Choose one commit option` choices.
13. If a technical commit command fails after a safe staging decision, record the exact error and continue the lifecycle; commit failure alone must not block user verification.
14. Complete documentation, task log, observation, and plan updates.
15. Check `User Verification Required` last in `10-post-implementation-checklist.md`.
16. Move the plan to `docs/tasks/planning/user-verification`.

Never push without explicit user approval.

## Browser and Verification Boundary

Task workflow files may record verification status and evidence references, but browser/tool policy is owned by the verification system package. Do not invent Atlas, Chromium, Playwright, screenshot, or lock rules here. If verification is required, read `docs/tasks/verification.md` and `docs/tasks/browser-verification-policy.md` when present.

## Package Update Discipline

When this package changes, the generator must install the package version that is on disk at generation time. Agents must not rely on stale copies from an older project. If the installed workflow conflicts with a package manifest, the manifest and package files win, and the install report must list the repaired file.

## Conflict Handling

If a destination file contains custom content and no managed marker, preserve it unless the user explicitly asks to run the generator update across saved TaskManager projects. For an explicit generator update, create backups before replacement and record the files repaired.

## Live Checklist Synchronization

- Executors must tick the original live implementation/testing checklist items as each item is completed.
- Result summaries and evidence logs must use tables or normal bullets, not duplicate `- [x]` lists.
- Historical rejected/failed/superseded states must be normal bullets or comments, not unchecked boxes.
- Reviewers must return a plan if PASS evidence exists but original live checklist items remain unchecked.
- `User Verification Required` remains the final post-implementation checklist item after R1 approval, commit attempt, and documentation/log updates.
## High-Visibility Blocked Response Contract

When execution, reviewer handoff, independent review, verification, commit attempt, documentation handoff, lifecycle movement, or required tooling is blocked, the agent's next chat response MUST begin with this exact high-visibility Markdown format as the first visible content:

```markdown
# 🚨 BLOCKED — ACTION REQUIRED

**Blocked stage:** <execution | reviewer handoff | independent review | verification | commit | documentation handoff | lifecycle movement | tooling>
**Plan:** <plan id/title/path>
**Blocking issue:** <one sentence, concrete blocker>
**What I tried:** <1-3 bullets or one sentence>
**What is not verified/complete:** <specific remaining risk>
**Required user/agent action:** <exact next action needed>
**Work status:** <stopped | safe partial progress saved | returned for correction>

## Details
<brief supporting details, links, evidence paths, or logs>
```

Rules:
- The `# 🚨 BLOCKED — ACTION REQUIRED` heading MUST be the first visible line of the response. Do not put greetings, summaries, Applied lessons, status prose, or citations before it.
- Use this format for any blocker that prevents safe progress, review delegation, R1/R2 approval, verification completion, lifecycle movement, or user-verification handoff. Do not use it when the task is already in user verification and the only unresolved follow-up is local commit ambiguity; use the non-blocking commit action needed format instead.
- If multiple blockers exist, list the most blocking issue first and put the rest under `## Details`.
- Do not bury blocked status at the end of a normal progress update.
- Do not use softer headings such as `Note`, `Important`, `Issue`, or `Partial` for true blockers.
- Record the same blocker in the appropriate plan file (`06-executor-report.md`, `08-verification-handoff.md`, `09-r1-review.md`, `10-post-implementation-checklist.md`, `11-r2-closeout-review.md`, or `12-comments.md`) after emitting the blocked chat response.

