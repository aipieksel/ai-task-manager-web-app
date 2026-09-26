---
name: review-task
description: "Perform independent R1 or R2 task reviews against the approved plan, evidence, tests, and lifecycle checklist without self-review."
---

# Review Task Skill

Review plans in `docs/tasks/planning/review`. R1 approval requires independent inspection of the work that was done, tests/evidence review, and an implementation approval token. The reviewer does not inspect, judge, block, or comment on dirty-tree or commit-boundary state; the executor/build agent owns the post-R1 commit gate.

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

## Config-aware review scope

Before review, read `plan.json.taskSystemConfigSnapshot.config` when present. If `review.requireIndependentR1` is false and the executor already recorded an explicit config override, verify only that the override was recorded and do not invent a dirty-tree or reviewer-spawn blocker.

When reviewing plans in `user-verification`, if `lifecycle.userVerification.treatAsDoneForAgentWork` is true, treat that lifecycle as an agent-complete handoff state. Do not mark the plan dirty, stale, blocked, or incomplete merely because the user left it in `user-verification`.

## Path-aware review pre-flight

- Read the complete plan, including its `Relevant Lessons` section, before reviewing evidence or code.
- Read recent `docs/tasks/logs/` entries and `docs/tasks/todo.md` when present.
- Read `docs/tasks/lessons-active.md`, match `docs/tasks/lessons-index.json` by task keywords, confirmed changed paths, and the review/verification/commit workflow types, and read `docs/tasks/lessons.md` only for matched IDs needing extra context.
- State `Applied lessons` before review work. If nothing matches, state `Applied lessons: none.`
- Re-run the lookup when review discovers a changed path or lifecycle action not covered by the initial match.

## Role-owned review rules

- Read planner-owned and executor-owned files, but do not rewrite executor reports/evidence except controlled status/lifecycle sync.
- Write R1 findings only in `09-r1-review.md`.
- Write R2 closeout findings only in `11-r2-closeout-review.md`.
- Update `10-post-implementation-checklist.md` only for live closeout checklist state.
- Reject or return the plan if original implementation/testing checklists remain unchecked while evidence says PASS.
- Reject or return the plan if duplicate checked result lists were used instead of live checklist synchronization.
- Convert stale rejected, failed, superseded, or historical checklist lines to normal bullets before user verification.
- Review only the task work: approved scope, implementation evidence, required tests, verification evidence, and checklist state.
- Do not inspect, judge, approve, reject, block, or comment on repository-wide dirty-tree state, unrelated dirty files, staging safety, stash safety, commit feasibility, or whether a commit should be attempted.
- Do not run commit-boundary commands for decision-making, including broad `git status` audits for unrelated files, `git add`, `git stash`, or `git commit`.
- If executor evidence does not identify task-scoped changes well enough to review the work, reject for missing task evidence, not for dirty-tree or commit-boundary reasons.
- `User Verification Required` must be the final checked post-implementation checklist item after R1 approval, commit attempt, and documentation/log handoff.
