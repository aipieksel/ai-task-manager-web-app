---
name: execute-plan
description: "Use when a build/executor agent is assigned an approved task plan to implement. Applies after user approval when a plan is in docs/tasks/planning/approved; the agent must execute the plan, keep executor-owned plan files current, move completed work to review, and spawn an independent review sub-agent instead of self-reviewing."
---

# Execute Plan Skill

Execute an approved plan from `docs/tasks/planning/approved`. Keep plan files current. When implementation is complete, move to `review` and spawn an independent review sub-agent. Do not skip testing, verification handoff records, or reviewer delegation. The executor/build agent must never review or approve its own implementation.

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
- Use this format for any blocker that prevents safe progress, review delegation, R1/R2 approval, verification completion, lifecycle movement, or user-verification handoff.
- If multiple blockers exist, list the most blocking issue first and put the rest under `## Details`.
- Do not bury blocked status at the end of a normal progress update.
- Do not use softer headings such as `Note`, `Important`, `Issue`, or `Partial` for true blockers.
- Record the same blocker in the appropriate plan file (`06-executor-report.md`, `08-verification-handoff.md`, `09-r1-review.md`, `10-post-implementation-checklist.md`, `11-r2-closeout-review.md`, or `12-comments.md`) after emitting the blocked chat response.

## Non-Blocking Commit Action Needed Response

When implementation is complete, independent R1 approved, documentation/log/observation handoff is complete, and the plan has moved to `user-verification`, an unresolved local commit is not a task blocker. Do not use the big blocked banner for this situation. Use this exact softer response shape, with numbered choices as the final visible section:

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

Rules:
- The first line MUST be `# ✅ TASK READY FOR USER VERIFICATION — COMMIT ACTION NEEDED`.
- Do not use `# 🚨 BLOCKED — ACTION REQUIRED` when commit is the only unresolved follow-up after user-verification handoff.
- The final visible section MUST be `## Choose one commit option` and the choices MUST be numbered.
- Put the exact candidate task file list in option 1 when it is available.

## Task-System Config Snapshot Contract

Before executing, read `plan.json.taskSystemConfigSnapshot.config`. If the snapshot is missing because the plan predates this contract, read `docs/tasks/task-system.config.yaml` as a legacy fallback, record the fallback in `06-executor-report.md`, and use those effective settings for this execution.

Config-driven execution rules:

- If `codexGoal.enabled` is false, do not call `get_goal`, `create_goal`, or `update_goal`. Record `Codex goal setting disabled by task-system.config.yaml` in `06-executor-report.md` and continue with the approved scope.
- If `codexGoal.enabled` is true, follow the Codex Goal Pre-flight Contract normally.
- If `review.requireIndependentR1` is true and `review.autoSpawnSubagent` is false, move the plan to `review`, record that automatic reviewer spawn is disabled by config, and stop/request manual TaskManager or coordinator review assignment. Do not self-review.
- If `review.requireIndependentR1` is true, `review.autoSpawnSubagent` is true, and `review.waitForSpawnedReviewer` is false, spawn the reviewer and move to `review`, but do not wait. Record that reviewer waiting is disabled by config.
- If `review.requireIndependentR1` is false, the executor may skip independent R1 only after recording the config override in `09-r1-review.md` and `10-post-implementation-checklist.md`. This is an explicit project-config override, not a default.
- If `lifecycle.userVerification.treatAsDoneForAgentWork` is true, moving to `user-verification` is considered agent-complete/done for active-work triage. Do not call it dirty, stale, blocked, or incomplete merely because the user leaves it there.
- If `lifecycle.userVerification.requireExplicitFailureToReopen` is true, do not reopen or continue executor work on a plan already in `user-verification` unless the user explicitly reports verification failure, asks for follow-up work, or requests lifecycle closeout.

The plan snapshot wins over later edits to `docs/tasks/task-system.config.yaml` for already-created plans.

## Codex Goal Pre-flight Contract

Before implementation begins, the executor/build agent MUST set the approved plan's `Codex End Goal` as the active Codex goal only when `taskSystemConfigSnapshot.config.codexGoal.enabled` is true.

If goal setting is disabled by config, skip all Codex goal tool calls and record the config-controlled skip in `06-executor-report.md` before implementation.

Codex goal tool sequence:

1. Read `plan.json.codexEndGoal` and cross-check it against `01-original-scope.md`, the approved scope summary, acceptance criteria, and the Plan Quality Assessment.
2. Confirm the goal is a concise outcome-level definition of done with a clear completion guard, not a copied plan checklist, process checklist, minimum-requirements target, or minimum-viable target.
3. If the field is missing, too narrow, or too detailed because the plan predates this contract, derive one concise outcome-level provisional goal from original scope plus acceptance criteria, record the derivation in `06-executor-report.md`, and set that provisional goal before editing.
4. call `get_goal` to inspect the current Codex goal state.
5. If there is no active unfinished goal, call `create_goal` with `objective` equal to the exact `Codex End Goal`; that exact value MUST be the concise outcome-level `Codex End Goal`. Do not set `token_budget` unless the user explicitly requested one.
6. If an active unfinished goal already exists and matches this plan's end goal, record that the existing goal was adopted and continue.
7. If an active unfinished goal exists and does not match this plan, do not overwrite or mark it complete. Stop before editing and report a `tooling` blocker asking for the previous goal to be completed, blocked by its owning context, or cleared by the user.
8. If the Codex goal tools are unavailable in the current runtime, record `Codex goal tool unavailable` in `06-executor-report.md` and continue only after preserving the plan's `Codex End Goal` in the executor report.

Goal closeout rules:

- The executor MUST NOT reinterpret the goal as a minimal path, partial delivery, shortcut, or subset of the approved outcome.
- Do not call `update_goal(status="complete")` until the concise outcome objective is actually achieved and no required work remains; this means the approved outcome is achieved, not a minimum subset.
- Do not call `update_goal(status="blocked")` unless the same blocking condition has repeated for at least three consecutive goal turns and no meaningful progress is possible without user input or external-state change.
- If execution only reaches review or user verification while R1/R2/user verification remains, leave the goal active and record what remains.
- When a budgeted goal is completed, report the final token usage from the tool result to the user.

## Pre-flight Readiness Gate

Before editing any implementation file, run a `Pre-flight Readiness Gate` for the approved plan's actual dependencies so database, server, service, credential, migration, package, port, or browser failures are discovered before implementation is halfway done.

This gate is proportional and dependency-specific. It is not permission to repair unrelated infrastructure.

The executor MUST:

1. Derive required runtime dependencies from `01-original-scope.md`, `03-implementation-checklist.md`, `04-testing-checklist.md`, `08-verification-handoff.md`, repository documentation, and the planned verification commands.
2. Confirm the exact project root and active checkout before running health checks.
3. Check package/install readiness only when commands/tests require it, using the project's documented command when available.
4. Check database/service/dev-server/provider/browser readiness only when the task implementation or verification depends on that dependency.
5. Prefer the cheapest documented health endpoint, readiness command, smoke command, or existing project helper over ad-hoc diagnosis.
6. Record the result in `06-executor-report.md` under `Pre-flight Readiness Gate`, including `not required` for dependencies that are irrelevant to the plan.
7. If a required dependency is down, missing, stale, locked, or ambiguous, stop before editing task code and report a `tooling` or `execution` blocker with the exact dependency and health check evidence.
8. Do not begin repairing databases, dev servers, ports, migrations, credentials, generated assets, or unrelated environment state unless the approved plan includes that repair or the user explicitly expands scope.
9. If a dependency becomes unhealthy after implementation starts, isolate whether it is task-caused or environmental; do not silently turn the task into an infrastructure repair.

The purpose is early readiness detection, not broader process overhead.

## Pre-flight gates

1. Read the approved plan folder completely, including `plan.json` and every canonical section file.
2. Read and record the Task-System Config Snapshot before editing.
3. Complete the Codex Goal Pre-flight Contract when enabled by config, or record the config-controlled skip before editing.
4. Complete the Pre-flight Readiness Gate and record dependency health or `not required` before editing.
5. Stop when any material open question remains, approval is unclear, the plan no longer matches current code/docs state, or a required runtime dependency is unhealthy.
6. Move the approved plan to the correct `in-progress` lifecycle state before implementation, preserving role ownership and controlled status synchronization.
7. Read the latest one or two files in `docs/tasks/logs/` when present and read `docs/tasks/todo.md` for conflicts or overlapping work.
8. Read the plan's `Relevant Lessons` section and carry those rules into execution.
9. Read `docs/tasks/lessons-active.md` first, then use `docs/tasks/lessons-index.json` to match lessons by task keywords, confirmed touched paths, and the execution workflow type.
10. Read `docs/tasks/lessons.md` only for matched lesson IDs that need extra context or when recording a new correction.
11. State `Applied lessons` with matched lesson IDs/titles before implementation. If nothing matches, state `Applied lessons: none.`
12. Re-run the lookup when implementation changes scope or touches a path not covered by the initial match, and state the newly applied lessons before continuing.

If a required lesson file is missing or inaccessible, stop and report the exact path rather than silently using only `lessons.md`.

## Post-Plan Change Preparation Gate

When the user gives additional changes after a plan has already been approved, executed, reviewed, or moved through user verification, the executor MUST NOT blindly implement them, even when the user phrases the request as a direct fix or small follow-up. This gate also applies when the agent decides a new plan is not required.

Before editing for any additional or out-of-original-scope change, the executor MUST:

1. Re-read the current `documentation/AGENTS.md` route and every relevant document named by the routed index for the new request terms and touched paths.
2. Scan the relevant codebase/source paths, tests, configuration, and current implementation state for the new change.
3. Compare the requested change against the approved plan scope, executor evidence, review notes, and user-verification feedback.
4. Record a `Post-plan change intake` entry in `06-executor-report.md` or `12-comments.md` with docs read, source paths scanned, current behavior, scope impact, and whether a new plan is required.
5. Ask clarification questions when an answer would materially affect architecture, compatibility, migration, risk, testing, scope, implementation order, or acceptance. Each question must include the full question, full why-it-matters reasoning, exactly three clear options, one recommended answer, and a recommended-answer bundle when six or fewer questions are asked.
6. Only then make the change, rerun the relevant tests/verification, and update documentation where needed.

If the new request materially changes approved scope, public contracts, migration/rollback risk, data shape, security boundaries, or verification obligations, the executor MUST either route back to `plan-task` for a new or amended plan, or record an explicit no-new-plan change addendum with the preparation evidence and the user's approval for that addendum before editing.

## Role-owned execution rules

- Read the planner-owned files, but do not rewrite approved scope/planning/risk files except controlled status/lifecycle sync.
- Tick live checklist items in `03-implementation-checklist.md` and `04-testing-checklist.md` only as the corresponding work/tests actually complete.
- Write execution narrative in `06-executor-report.md`.
- Write evidence references in `07-executor-evidence.md`.
- Write verification handoff details in `08-verification-handoff.md`.
- Do not create duplicate checked result lists. Reports/evidence use tables or normal bullets, not Markdown progress checkboxes.
- Before moving to review, confirm PASS evidence and live checklist state agree.

## Mandatory review sub-agent handoff and wait

- The executor/build agent must not review, approve, or move its own implementation to user verification.
- After implementation, executor verification, executor evidence, and checklist synchronization are complete, move the plan to `docs/tasks/planning/review`.
- If `review.requireIndependentR1` is true and `review.autoSpawnSubagent` is false, do not spawn a reviewer. Record `Automatic reviewer sub-agent spawn disabled by task-system.config.yaml`, leave the plan in `review`, and stop for TaskManager/coordinator/user assignment.
- If `review.requireIndependentR1` is true and `review.autoSpawnSubagent` is true, immediately spawn one independent review sub-agent and instruct it to use the `review-task` skill/workflow. Do this directly from the executor/build agent when sub-agent tooling is available; do not wait for heartbeat automation to discover the review item.
- If a reviewer is spawned and `review.waitForSpawnedReviewer` is true, immediately after spawning the reviewer call the platform wait tool for that reviewer. In Codex multi-agent mode, use `wait_agent` with the spawned reviewer agent ID and a long timeout rather than busy polling.
- If a reviewer is spawned and `review.waitForSpawnedReviewer` is false, record `Reviewer wait disabled by task-system.config.yaml` and do not wait.
- Keep the executor turn/session active while waiting only when config requires waiting. Do not end with only “reviewer started,” “reviewer assigned,” or a passive handoff when waiting is enabled.
- Keep the executor turn/session active while waiting. When `review.waitForSpawnedReviewer` is false, record the config-controlled skip instead of waiting.
- The review sub-agent must be a separate agent/context from the executor. It must not implement fixes. It must independently verify against the approved plan, live checklist state, executor evidence, `docs/tasks/review.md`, and `docs/tasks/verification.md`.
- Give the review sub-agent the exact project root, task root, review lifecycle plan path, implementation summary, changed files, verification evidence, and any known limitations/blockers.
- When the reviewer returns rejection or correction feedback, the executor/build agent must action it in the same active context, update executor-owned files, rerun executor verification, move the plan back to `review`, spawn a fresh independent reviewer, and wait again.
- When the reviewer returns R1 approval, the executor/build agent continues directly into the executor-owned commit gate, documentation/log/observation handoff, final `User Verification Required` checklist item, and lifecycle move.
- If the wait tool reaches a hard timeout while the reviewer is still running, record the wait state in `08-verification-handoff.md` and continue waiting with a longer/backoff wait when the platform allows; do not ask the user to babysit the review unless wait-capable tooling is unavailable or failed.
- If sub-agent spawning or wait-capable tooling is genuinely unavailable, record that reviewer handoff/wait is blocked in `08-verification-handoff.md` with the exact blocker and report it using the high-visibility blocked format. Do not self-review as a fallback.

## Post-R1 Executor Commit Gate

After the independent reviewer grants R1 implementation approval, the executor/build agent owns the commit boundary before user-verification handoff. The reviewer must not inspect, judge, block, or comment on dirty-tree or commit-boundary state; that is handled only here.

Commit gate rules:

1. Run `git status --porcelain` and compare dirty paths against the approved plan, executor evidence, and changed-file list.
2. If no Git repo exists, run `git init` in the project root before staging.
3. Stage only files clearly related to this task. Do not run broad `git add -A` when unrelated or ambiguous dirty files exist.
4. Do not use `git stash` or `git stash -u` without explicit user approval; stashing can remove another agent's in-progress files from the shared worktree.
5. If task-related files are unambiguous, create one local commit with a task-specific message.
6. If unrelated or ambiguous dirty files prevent a safe task-only commit but implementation, R1 approval, documentation/log/observation handoff, and user-verification movement are complete, do not report this as blocked. Use `# ✅ TASK READY FOR USER VERIFICATION — COMMIT ACTION NEEDED` and end with the numbered `## Choose one commit option` choices.
7. If a technical commit command fails after a safe staging decision, record the exact error and continue the lifecycle; commit failure alone must not block user verification.
8. Complete documentation/log/observation updates, then check `User Verification Required` last.

Never push without explicit user approval.
