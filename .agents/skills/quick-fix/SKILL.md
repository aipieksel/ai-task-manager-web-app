---
name: quick-fix
description: "Use for a single-purpose, isolated, low-risk code or documentation fix that is too small for a full 12-file task plan. Runs a proportional inspect-first workflow with a pre-flight readiness gate, targeted verification, and a quick-fix log entry under docs/tasks/quick-fixes."
---

# Quick Fix Skill

## Purpose

Use this skill to keep small, obvious fixes fast without weakening safety. Quick Fix Mode exists for changes where a full `plan-task` folder would add delay without improving the outcome.

This skill is still inspect-first. It does not allow blind edits, skipped verification, or undocumented follow-up work.

## Activation Criteria

Use Quick Fix Mode only when all of these are true:

1. The request is single-purpose and has one obvious target outcome.
2. The expected source change is small and localized, normally one to three files.
3. There is no schema, migration, persistence, auth, permission, security, deployment, provider, queue, billing, data-loss, concurrency, package-generator, or public API compatibility risk.
4. The change does not affect multiple features, modules, applications, services, routes, packages, or external integrations.
5. The acceptance check is straightforward and can be verified with one focused test, lint, build, browser check, or direct file inspection.
6. No material clarification is needed before safely editing.
7. The user did not explicitly ask for a plan, architecture, migration, rollout, review plan, or approval-ready TaskManager plan.

If any item is false, or if the agent is uncertain, do not use Quick Fix Mode. Route to `.agents/skills/plan-task/SKILL.md`.

## Hard Exclusions

Do not use Quick Fix Mode for:

- broad, multi-step, cross-cutting, ambiguous, or high-impact requests;
- changes to saved data shape, import/export formats, migrations, schemas, secrets, credentials, auth, roles, permissions, payment or billing flows, provider transports, queues, deployment, infrastructure, or concurrency behavior;
- tasks requiring multiple independent verification modes, rollback strategy, staged rollout, or reviewer coordination;
- generator-package or workflow-contract changes unless the user explicitly says to patch a single typo or single wording bug;
- visual redesigns, route rewrites, settings overhauls, or multi-panel UI changes;
- any task where a failed runtime dependency would change implementation direction rather than only block verification.

## Required Response Posture

At the start of a Quick Fix response, state that Quick Fix Mode is being used and why it qualifies in one short sentence. If the user asked for direct implementation and the task qualifies, no full plan folder is required.

If the task stops qualifying at any point, stop editing, preserve what has been learned, and escalate to `plan-task` with a short explanation.

## Pre-flight Readiness Gate

Before editing, run a proportional `Pre-flight Readiness Gate` so environment failures are found before implementation is halfway done.

The gate MUST check only the dependencies that matter for the requested fix. Do not turn a tiny fix into a broad environment audit.

Minimum quick-fix pre-flight:

1. Confirm the exact project root with `pwd` or equivalent and ensure you are not in a temporary or unintended checkout.
2. Read root `AGENTS.md` when present and any directly relevant documentation entry point required by that file.
3. Identify whether the fix requires a live dependency to edit or verify, such as a database, dev server, package install, migration state, port, local service, external service, browser, credentials, or generated assets.
4. If a live dependency is required, run the cheapest documented health/readiness check for it before editing. Prefer project-provided health commands or endpoints over ad-hoc probes.
5. If the required dependency is down, missing, stale, locked, or ambiguous, stop early and report a pre-flight environment blocker. Do not repair unrelated infrastructure unless the user explicitly expands scope.
6. If no live dependency is required, record `Pre-flight Readiness Gate: no runtime dependency required for this quick fix.` in the quick-fix log.

Environment blockers are not implementation failures. They are early stop conditions that prevent wasted work and accidental infrastructure changes.

## Inspect-First Gate

Before editing:

1. Inspect the relevant source file, test, route, config, or documentation section directly.
2. Understand current behavior from code/docs, not memory.
3. Ask a concise clarification question only when the answer would materially change the fix.
4. Keep the scope to the requested fix. Do not opportunistically clean nearby code.

## Implementation Rules

1. Make the smallest safe change that satisfies the request.
2. Do not rewrite unrelated files, generated outputs, lockfiles, or formatting outside the touched scope unless required by the fix.
3. If a tool formats a larger area, inspect the diff and confirm the extra changes are safe and related.
4. Preserve user work and unrelated dirty files. Do not stage, stash, commit, or reset unrelated changes unless the user explicitly asks.
5. If the fix reveals a broader design or lifecycle problem, stop and escalate to `plan-task` rather than stretching Quick Fix Mode.

## Targeted Verification Gate

After editing, run the smallest verification that proves the fix:

- a targeted unit/integration test when available;
- a lint/type/build check when that is the relevant guard;
- a focused browser or app check when rendered behavior matters;
- a direct parser/schema command when the fix is a config, JSON, YAML, markdown, or workflow contract change;
- no-op verification only when the change is documentation-only and direct review of the rendered/source text is sufficient.

If the targeted check fails because of an unrelated pre-existing failure, isolate the task-relevant result, record the unrelated failure clearly, and do not repair unrelated failures unless the user expands scope.

## Quick-Fix Log

After a successful quick fix, append a short entry to `docs/tasks/quick-fixes/YYYY-MM-DD.md`. Create the folder or date file when missing.

Use this structure:

```markdown
## <HH:MM> — <short fix title>

- Mode: Quick Fix
- Request: <one sentence>
- Pre-flight Readiness Gate: <checked dependency or no runtime dependency required>
- Files changed: <relative paths>
- Verification: <command/check and result>
- Documentation updated: <paths or none>
- Escalation needed: <none or reason>
```

The quick-fix log is not a plan folder and must not contain live progress checkboxes.

## Final Response

The final response must be concise and include:

1. the changed files;
2. the pre-flight readiness result;
3. the verification result;
4. the quick-fix log path;
5. any follow-up or escalation needed.

Do not claim that a full TaskManager plan was executed. Do not move lifecycle folders for Quick Fix Mode.
