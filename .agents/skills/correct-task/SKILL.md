---
name: correct-task
description: "Correct a task after failed user verification or reviewer feedback by applying scoped fixes, updating evidence, and resubmitting through review."
---

# Correct Task Skill

Claim failed-user-verification plans after user feedback, apply bounded corrections, and return them through review and user verification.

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

## Path-aware correction pre-flight

- Read the complete failed-verification plan and its `Relevant Lessons` section.
- Read recent `docs/tasks/logs/` entries and `docs/tasks/todo.md` when present.
- Read `docs/tasks/lessons-active.md`, match `docs/tasks/lessons-index.json` by the correction keywords, confirmed touched paths, and correction workflow type, and read `docs/tasks/lessons.md` only for matched IDs needing extra context.
- State `Applied lessons` before correction implementation. If nothing matches, state `Applied lessons: none.`
- Re-run the lookup if feedback changes scope or introduces a newly touched path.

## Mandatory self-improvement loop

- After any user correction, append a reusable recurrence-prevention lesson to `docs/tasks/lessons.md`.
- Add or update its keyword, path-glob, and workflow entry in `docs/tasks/lessons-index.json`.
- If the lesson is evergreen and reusable, promote it to `docs/tasks/lessons-active.md` using the same stable lesson ID.
- Validate `docs/tasks/lessons-index.json` as parseable JSON after editing it and before returning the correction to review.
- Never skip the lessons update after a correction. If any required lesson file is missing or inaccessible, stop and report the exact path.

## Role-owned correction rules

- Fix only the feedback-bounded issue unless the user approves broader work.
- Add correction notes in `06-executor-report.md` and correction evidence in `07-executor-evidence.md`.
- Keep planner-owned scope files frozen unless the user explicitly changes scope.
- Tick original checklist items that remain valid; add new live checklist items only for new correction requirements.
- Convert superseded rejected/failed checklist lines to normal historical bullets.
- Do not use checked result lists as a substitute for original checklist progress.
