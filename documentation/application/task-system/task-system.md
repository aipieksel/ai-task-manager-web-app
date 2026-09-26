# Task system

The preferred generated root is `docs/tasks`, produced by Agent Workflow Kits `v1.0.0` using its **All** option. Task Manager validates the workflow, todo, planning, lessons, config, and verification markers before treating a canonical project as healthy. The Task Manager bootstrap files are onboarding metadata only and are never parsed as plans or offered to lifecycle automation.

The reusable task-system contract lives under `docs/tasks/`. Plans are twelve-section folders moved through draft, pending, approved, in-progress, review, user-verification, completion, parking, archive, failure, or blocker lifecycle directories.

`plan.json` is machine state; role-owned Markdown sections hold planning, execution, review, evidence, and comments. `docs/tasks/workflow.md`, `verification.md`, `browser-verification-policy.md`, and `review.md` are authoritative. New repositories begin with empty lifecycle directories, queue, lessons, and browser-lock state.
