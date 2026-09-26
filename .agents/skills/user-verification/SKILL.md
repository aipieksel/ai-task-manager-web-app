---
name: user-verification
description: "Handle the user verification lifecycle gate, record user feedback, and route passed or failed verification outcomes correctly."
---

# User Verification Skill

Present the user-facing verification checklist and acceptance criteria for plans in `docs/tasks/planning/user-verification`.

- Read `10-post-implementation-checklist.md`, `08-verification-handoff.md`, `09-r1-review.md`, `11-r2-closeout-review.md`, and `12-comments.md`.
- Read the plan's `Relevant Lessons`, then read `docs/tasks/lessons-active.md` and match `docs/tasks/lessons-index.json` by task keywords, confirmed paths, and verification workflow type. Read `docs/tasks/lessons.md` only for matched IDs needing more context.
- State `Applied lessons` before presenting verification. If nothing matches, state `Applied lessons: none.`
- Do not edit executor or reviewer-owned files.
- User replies and verification outcomes must be appended to `12-comments.md` and reflected through controlled lifecycle/status updates.
## Config-aware user-verification handling

Read `plan.json.taskSystemConfigSnapshot.config` when present, falling back to `docs/tasks/task-system.config.yaml` first, then legacy `docs/tasks/task-system.config.json`, for legacy plans.

If `lifecycle.userVerification.treatAsDoneForAgentWork` is true, a plan in `docs/tasks/planning/user-verification` is treated as confirmed agent-complete/done for active-work triage. Do not label it dirty, stale, blocked, or incomplete solely because the user has not moved it to `completed`.

If `lifecycle.userVerification.requireExplicitFailureToReopen` is true, only reopen or route work out of `user-verification` when the user explicitly reports verification failure, asks for a follow-up change, or requests lifecycle closeout/R2 movement.

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

