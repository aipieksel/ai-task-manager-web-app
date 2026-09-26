---
name: plan-task
description: "Create or update a Codex task plan folder under docs/tasks/planning/draft without implementing. Every plan must begin by reading documentation/AGENTS.md and following its current documentation route, then remain evidence-grounded, modular, robust, contract-driven, migration-safe, testable, and protected by explicit planning and lifecycle gates. This skill is mandatory for explicit planning requests and for broad, multi-part, cross-cutting, high-risk, or ambiguous software change requests, even when the user phrases them as direct implementation such as updating, fixing, refactoring, replacing, or changing many things."
---

# Plan Task Skill

## Mission and Activation Contract

The agent MUST use this skill whenever the user asks to plan work, create a task plan, prepare implementation steps before coding, design an implementation path, or convert a concrete software change into an approval-ready task folder.

The agent MUST also use this skill whenever the user requests a broad, multi-part, cross-cutting, high-impact, high-risk, or ambiguous software change, even when the request is phrased as direct implementation rather than planning. Requests such as `update...{list of changes}`, `make all of these changes`, `fix everything in this list`, `refactor this across the project`, `overhaul this subsystem`, or any semantically equivalent request MUST be treated as plan-required intent.

The agent MUST produce a practical, implementation-ready plan for the concrete target while preserving existing working behavior, defining modular boundaries, designing robustness into the target, and avoiding unrelated project-wide analysis.

This skill MUST remain planning-only. The agent MUST NOT implement source changes, migrations, generated artifacts, runtime configuration changes, dependency changes, or deployment changes while this skill is active.

The agent MUST recommend one decisive path by default. The agent MUST provide alternatives only when the user explicitly requests alternatives or when a documented decision cannot be made without user selection.

## Explicit Mode Invocation Contract

Agents MUST recognize explicit task-mode parameters when the user invokes or references this skill, including `$plan-task --quick`, `@plan-task --quick`, `/plan-task --quick`, `plan-task --quick`, `$plan-task --standard`, `@plan-task --standard`, `/plan-task --standard`, `plan-task --standard`, `$plan-task --full`, `@plan-task --full`, `/plan-task --full`, and `plan-task --full`.

Mode meanings:

- `--quick` requests Quick Fix Mode and should route to `.agents/skills/quick-fix/SKILL.md` instead of creating a 12-file plan, but only when the Quick Fix hard exclusions do not apply. `--quick` MUST NOT bypass safety, documentation, pre-flight readiness, verification, or hard exclusions.
- `--standard` requests the normal 12-file Standard Plan Mode. The agent MUST create a normal plan folder even if the request might otherwise qualify for Quick Fix Mode.
- `--full` or `--robust` requests Full Robust Plan Mode. The agent MUST use the normal plan folder plus deeper architecture, compatibility, rollback, migration, robustness, and verification detail.

If the explicit mode conflicts with the request's risk, the safer higher-rigor mode wins. In particular, `--quick` may be refused or escalated to Standard/Full when the change is broad, ambiguous, high-risk, or excluded from Quick Fix Mode. Record the requested mode, effective mode, and reason in `02-planning-and-decisions.md` or the quick-fix log.

If no explicit mode is supplied, use `docs/tasks/task-system.config.yaml` `planning.defaultMode`. If that value is `auto`, apply the normal Task Mode Triage.

## Quick Fix Triage Gate

Before creating a plan folder, the agent MUST classify the request as `Quick Fix`, `Standard Plan`, or `Full Robust Plan`.


Invocation modes and `planning.defaultMode` are evaluated before automatic triage. Explicit `--standard` forces Standard Plan Mode; explicit `--full`/`--robust` forces Full Robust Plan Mode; explicit `--quick` requests Quick Fix Mode but cannot bypass hard exclusions.

Use `.agents/skills/quick-fix/SKILL.md` instead of this skill only when the request is a single-purpose, isolated, low-risk change with an obvious target, normally one to three touched files, no material compatibility boundary, no migration or rollout concern, no security/auth/provider/data/schema/deployment risk, no broad UI or cross-module coordination, and one straightforward verification path.

Quick Fix Mode still requires a proportional inspect-first workflow, the `Pre-flight Readiness Gate`, targeted verification, and a quick-fix log entry under `docs/tasks/quick-fixes/YYYY-MM-DD.md`. It does not create a 12-file plan folder.

If there is any uncertainty about scope, risk, dependencies, compatibility, or verification, the request MUST stay in `plan-task`. Do not use Quick Fix Mode to avoid planning for broad or ambiguous work.

Standard Plan uses this `plan-task` skill and the normal TaskManager lifecycle. Full Robust Plan is the same lifecycle with deeper architecture, rollback, compatibility, and verification detail for high-risk work.

## Automatic Planning Trigger Contract

The agent MUST classify every incoming software-change request by its actual scope, coordination needs, compatibility impact, and risk. The agent MUST NOT decide activation only by searching for the words `plan`, `planning`, `task plan`, or `implementation steps`.

This skill MUST activate when any one of the following conditions is true:

1. The user explicitly asks for planning, a task plan, implementation steps, an architecture plan, a migration plan, a rollout plan, a review plan, or an approval-ready task.
2. The user requests multiple material changes that require coordinated sequencing, shared decisions, cross-file work, cross-module work, or more than one verification path.
3. The user uses broad or cumulative wording such as `a lot of things`, `many changes`, `several updates`, `all of these`, `everything listed`, `across the project`, `throughout the system`, `whole subsystem`, `batch update`, `sweep`, `overhaul`, or semantically equivalent wording.
4. The request affects or can reasonably affect more than one feature, module, package, service, API, workflow, data model, integration, configuration boundary, persistence boundary, runtime consumer, or deployment surface.
5. The request affects or can reasonably affect a public contract, saved data, schema, migration, import/export format, external integration, permissions, security boundary, concurrency behavior, infrastructure, deployment, rollback, or other high-risk compatibility surface.
6. The requested scope is open-ended, ambiguous, insufficiently bounded, or cannot be safely isolated without first reading project documentation and inspecting relevant code and tests.
7. A safe response requires phased implementation, explicit dependencies, compatibility handling, rollback points, stop conditions, or multiple automated or manual verification checks.
8. The agent is uncertain whether the request is a single isolated edit or a broader task. Uncertainty MUST be resolved in favor of activating this skill.

Direct implementation wording MUST NOT bypass this contract. Verbs such as `implement`, `update`, `change`, `fix`, `add`, `remove`, `replace`, `refactor`, `rebuild`, `redesign`, `migrate`, `integrate`, `harden`, or `overhaul` MUST still activate this skill whenever any trigger above applies.

When this skill activates from a direct implementation request, the agent MUST record the requested implementation as the desired eventual outcome, MUST create the planning artifact, and MUST remain planning-only. The agent MUST NOT begin implementation merely because the user used imperative implementation language or requested immediate execution.

The agent MUST NOT avoid activation by splitting one broad request into a series of isolated edits, handling only the easiest items, or silently discarding cross-cutting consequences. The agent MUST evaluate the complete user request as one scope before deciding whether planning is required.

Only a single-purpose, isolated, low-risk change with an obvious target, no material compatibility boundary, no migration or rollout concern, and one straightforward verification path MAY proceed without this skill, and it MUST use `.agents/skills/quick-fix/SKILL.md` when that skill exists. This exception MUST NOT apply when any activation condition above is present.


## Same-Message Plan Review and Next-Step Choice Guard

After recording user answers, locking decisions, or changing `planningState`/`status`, repeat the full consolidated plan review in the same chat response before asking the user what to do next.

Never ask only for `move to pending`, `approve`, `approved`, `execute`, `park`, or `next step` without that review.

Any chat response that asks the user for approval, `move to pending`, `move to approved`, execution, parking, lifecycle movement, or a next-step decision must include the full consolidated plan review in that same response.

This applies after initial plan creation, after questions are answered, after decisions are locked, and after `plan.json` status/planning state changes.

When the plan is approval-ready and the agent asks what to do next, the final visible choice block MUST be exactly:

```markdown
## Choose next step
1. Move to approved and execute the plan using the execute-plan skill.
2. Move to pending.
3. Park.

Reply with `1`, `2`, or `3`.
```

The agent MUST treat `1` as explicit approval to move the plan to `approved` and immediately execute it with `.agents/skills/execute-plan/SKILL.md`, `2` as explicit approval to move the plan to `pending`, and `3` as explicit approval to move the plan to `parked` with a parking reason recorded.

## Full-Context Clarification Question Contract

When asking clarification questions, the agent MUST ask every question whose answer would materially affect architecture, compatibility, migration, risk, testing, scope, implementation order, or acceptance. The agent MUST limit the question set to six when possible; if more than six material questions are unavoidable, the agent MUST group them by decision area and state why more than six are required.

Each question MUST include the full question, the full explanation and reasoning for why the question matters, one recommended answer, and exactly three clear answer options. The options MUST be self-contained and include trade-offs or consequences; do not use terse labels that require opening the plan file to understand.

Use this chat format for each question:

```markdown
### Q<n> — <full question>
Why this matters: <full explanation and reasoning, including what changes based on the answer>.
Recommended: <recommended option and why it is the best scalable/current/relevant/accurate choice>.
Options:
A. <clear answer option with trade-off/context>.
B. <clear answer option with trade-off/context>.
C. <clear answer option with trade-off/context>.
```

When there are six or fewer questions, the agent MUST include a recommended-answer bundle after the questions: "Reply `recommended` to proceed with all recommended answers, or answer individually using `Q1=A, Q2=B`." The same full question text, reasoning, options, recommendations, and any recommended bundle MUST be recorded in `02-planning-and-decisions.md`.

## Task-System Configuration Gate

Before creating or updating a plan, read `docs/tasks/task-system.config.yaml` when it exists. If it is missing, use the package defaults from the generated seed file and record that the config file was missing.

This config is user-editable and preserved by generator updates. It controls future task behavior until the user changes it again.

The planner MUST snapshot the effective config into `plan.json.taskSystemConfigSnapshot` when a plan is created or materially re-planned. Existing plans use their snapshot so later config changes do not silently alter already-created task behavior.

The effective config controls:

- `codexGoal.enabled`: whether executors call Codex goal tools. If false, the plan may still contain a readable `Codex End Goal`, but execution records that goal setting is disabled and skips `get_goal`, `create_goal`, and `update_goal`.
- `codexGoal.requirePlanEndGoal`: whether approval-ready plans must include the `Codex End Goal` field and visible section.
- `review.requireIndependentR1`: whether executor self-approval is forbidden and R1 must be independent.
- `review.autoSpawnSubagent`: whether the executor spawns a reviewer sub-agent automatically after moving to review.
- `review.waitForSpawnedReviewer`: whether the executor must wait for an auto-spawned reviewer.
- `lifecycle.userVerification.treatAsDoneForAgentWork`: whether tasks left in `user-verification` should be treated as agent-complete/done for work selection instead of dirty, stale, or active.
- `lifecycle.userVerification.requireExplicitFailureToReopen`: whether a task in `user-verification` may only be reopened when the user explicitly reports verification failure, asks for follow-up work, or requests lifecycle closeout.

When `lifecycle.userVerification.treatAsDoneForAgentWork` is true, agents and coordinators MUST NOT mark a plan dirty, blocked, incomplete, or eligible for more executor work merely because it remains under `docs/tasks/planning/user-verification`. User-verification is a successful handoff state, not a dirty state.

## Codex End Goal Contract

Every task plan MUST define a clear `Codex End Goal` before it can become approval-ready. The end goal is the exact objective that the executor/build agent will set with the Codex goal feature when execution begins.

The `Codex End Goal` MUST be:

- one concise, concrete, outcome-based objective in plain language, usually one or two sentences;
- a definition of done for the task outcome, not a repeat of the implementation plan, testing checklist, documentation checklist, review process, or every file/panel/item in the plan;
- bounded to the approved task scope and non-scope using summary nouns for the target surface, such as `every affected page`, `each configured provider`, or `all approved import flows`, instead of copying detailed checklist items;
- complete enough that it cannot be satisfied by a minimum-only, partial, shortcut, placeholder, or "good enough" implementation;
- explicit about the main completion guard, for example: `If any in-scope table does not match the approved dynamic data structure, the goal is not complete.`;
- specific enough that an executor can tell whether the outcome is complete without rereading the user's chat history;
- free of vague wording such as `fix things`, `improve stuff`, `continue work`, `do the task`, `minimum`, `basic`, `quick`, `at least`, or `MVP` unless the user explicitly made that limitation part of the approved scope;
- free of token-budget language unless the user explicitly requested a token budget.

The planner MUST record the same end goal in all of these places:

1. `plan.json.codexEndGoal`;
2. `01-original-scope.md` under `## Codex End Goal`;
3. the `Plan Quality Assessment` in `02-planning-and-decisions.md`;
4. the consolidated chat review before approval or movement.

The planner MUST treat a missing, vague, over-detailed, checklist-like, untestable, minimum-only, shortcut-oriented, partial, or scope-mismatched `Codex End Goal` as a plan-quality failure. A plan without a valid concise outcome-level `Codex End Goal` is not approval-ready, even if every other section exists.

## Mandatory Interpretation Contract

Every instruction in this file is mandatory. The agent MUST treat every `MUST`, `MUST NOT`, `ONLY`, `NEVER`, required list, ordered workflow step, contract, and gate as non-bypassable.

The agent MUST NOT treat time pressure, token pressure, tool limitations, prior familiarity, user urgency, a seemingly small task, or confidence in an assumed solution as permission to skip a required step.

When a required step cannot be completed, the agent MUST:

1. record the exact blocker and attempted evidence in `02-planning-and-decisions.md`;
2. mark the affected plan content as unverified or incomplete;
3. keep the plan in the draft lifecycle;
4. set approval readiness to `Questions pending` or `Not ready`;
5. refrain from requesting approval or lifecycle movement until the blocking gate is satisfied.

The agent MUST NOT silently substitute an assumption for available evidence. When evidence is unavailable, the agent MUST state the assumption explicitly, identify its risk, and define the verification needed before implementation.

## Non-Negotiables

- The agent MUST evaluate the complete incoming software-change request against the Automatic Planning Trigger Contract before deciding to implement anything. When any trigger matches, this skill MUST activate and the request MUST enter the planning workflow.
- The agent MUST NOT treat direct implementation language, urgency, or a request to change many things as permission to bypass planning.
- The agent MUST make the first task-planning repository action locating, opening, and completely reading `documentation/AGENTS.md`. The agent MUST follow the current documentation route defined by that file before creating or updating a plan artifact, asking a planning question, inspecting implementation code, or making an architecture decision.
- After the documentation-first route and draft initialization, but before making planning decisions or asking questions, the agent MUST run the path-aware lessons lookup using recent task logs, `docs/tasks/todo.md`, `docs/tasks/lessons-active.md`, `docs/tasks/lessons-index.json`, and only matched `docs/tasks/lessons.md` entries that need extra context.
- The agent MUST record and chat-present matched lesson IDs/titles as `Relevant Lessons`; when nothing matches, it MUST explicitly write `Relevant lessons: none.`
- The agent MUST create or update a draft plan folder before asking the user any planning question in chat.
- The agent MUST use the fixed root `docs/tasks` unless an existing project install explicitly substituted another task root.
- The agent MUST create plans as folders and MUST NOT create a standalone Markdown plan as a substitute.
- The agent MUST NOT implement source changes while planning.
- The agent MUST present all questions and approval or next-step choices in plain chat and MUST record every full question, why-it-matters reasoning, three options, recommendation, user answer, and next-step choice in the plan.
- The agent MUST preserve the complete question and decision history in `02-planning-and-decisions.md`.
- The agent MUST use role-owned plan files: planner-owned files define approved scope, executor-owned files record execution, reviewer-owned files record R1/R2 review, and `plan.json` stores machine/task-manager state.
- The agent MUST include a visible `## Plan Quality Assessment` in `02-planning-and-decisions.md` for every plan, including plans with open questions.
- After creating or updating a plan, the agent MUST present a consolidated human-readable plan review in chat before requesting approval, approved-and-execute movement, pending movement, parking, or any lifecycle movement. The user MUST NOT be required to open plan files to understand the plan.
- After recording user answers, locking decisions, or changing `planningState` or `status`, the agent MUST repeat the full consolidated plan review in the same chat response before requesting approval, approved-and-execute movement, pending movement, parking, or any lifecycle movement.
- The agent MUST NEVER ask only for `move to pending`, `move to approved`, `execute`, `park`, `approve`, `next step`, or equivalent lifecycle action without the complete review and numbered next-step choice block required by this file.
- The agent MUST keep the task scope narrow and MUST follow the target lifecycle outward only until required dependencies and consumers are understood.
- The agent MUST NOT audit, redesign, refactor, or impose architecture rules on unrelated areas.
- The agent MUST preserve existing public APIs, saved data, file formats, events, configuration shapes, deployment flows, permissions, UX, and user-visible behavior unless the plan explicitly identifies a breaking change and the user explicitly approves it.
- The agent MUST separate observed evidence, user decisions, and assumptions in every planner-owned file.
- The agent MUST NOT fabricate files, symbols, APIs, schemas, models, migrations, tests, commands, consumers, or repository conventions.
- Every implementation phase MUST include at least one concrete verification command, automated check, runtime check, migration dry run, smoke test, or explicit manual verification.
- Every material risk MUST map to a prevention control, detection check, rollback or recovery action, acceptance criterion, and owner.

## Scope and Architecture Depth Gate

The agent MUST apply the modular and robustness analysis in this file to every plan, but MUST scale the depth to the concrete target.

For a concrete feature, module, package, service, API, workflow, data model, configuration system, integration, background job, automation tool, repository subsystem, or domain boundary, the agent MUST complete the full modular architecture and robustness contracts.

For a routine, isolated, or low-risk change, the agent MUST still assess every required modularity and robustness category. The agent MUST mark a category `Not applicable` only when it records a target-specific reason. The agent MUST NOT omit the category or use `Not applicable` as a shortcut.

For a broad or ambiguous request, the agent MUST narrow the plan to the first concrete module, subsystem, feature, workflow, integration, or pain point that can be planned safely. The agent MUST record excluded areas as non-scope. The agent MUST NOT create a whole-project redesign unless the user explicitly requests a whole-project architecture engagement.

When a broad request contains an explicit finite list of related changes, the agent MUST preserve every listed change in `01-original-scope.md`, MUST map each item to a plan phase or an explicit evidence-based exclusion, and MUST NOT silently reduce the request to only the first or easiest item. The agent MUST narrow only genuinely open-ended, unrelated, or unresolved scope.

The agent MUST NOT introduce a plugin framework, event bus, service mesh, queue, generator, schema platform, dependency-injection container, microservice boundary, distributed lock, cache layer, circuit breaker, or other major abstraction unless inspected evidence and the user goal require it.

## Mandatory Gate Sequence

The agent MUST satisfy the following gates in order. The agent MUST NOT treat any later gate as complete before every earlier gate is complete.

| Gate | Mandatory result | Failure behavior |
|---|---|---|
| G1 — Documentation-First | `documentation/AGENTS.md` has been read first and completely; every file it currently routes the agent to, including its selected documentation index, has been read in the required order; all matched project, task-system, architecture, target, contract, test, migration, and operational documentation has been read; findings are retained for immediate recording after draft creation. | When `documentation/AGENTS.md` or a file it requires is missing, inaccessible, ambiguous, or internally inconsistent, the agent MUST record the exact path, search attempt, and blocker in a draft created only for that record, MUST mark the plan `Not ready`, and MUST NOT inspect implementation code, ask planning questions, make architecture decisions, or continue to G3. |
| G2 — Draft Artifact and Lessons Context | The correctly named draft folder, `plan.json`, and all twelve required section files exist with valid ownership metadata; G1 paths, findings, conflicts, and gaps are recorded; recent task context and the path-aware lesson match are recorded under `## Relevant Lessons`. | The agent MUST NOT ask the user questions or perform a target code scan. When a required lesson file is missing or inaccessible, the agent MUST record the exact path, keep the plan `Not ready`, and MUST NOT silently fall back to reading only the archive. |
| G3 — Initial Purpose and Constraint Interview | All material target, purpose, failure, compatibility, consumer, robustness, and output questions are answered or explicitly pending in the decision log using the Full-Context Clarification Question Contract. | The agent MUST ask every unresolved material question, each with full reasoning, exactly three options, a recommendation, and the recommended-answer bundle when six or fewer questions are asked; then stop before the target evidence scan. |
| G4 — Targeted Evidence Scan | Relevant entry points, lifecycle, boundaries, contracts, dependencies, risks, tests, commands, and local patterns are inspected and recorded. | The agent MUST mark the plan unverified and MUST NOT finalize architecture. |
| G5 — Evidence-Based Decisions | Material uncertainties discovered by the scan are resolved by evidence, a user answer, or an explicit bounded assumption. | The agent MUST ask focused follow-up questions and MUST stop before finalizing the implementation plan when the answer changes architecture or risk. |
| G6 — Modular Architecture | Boundary, ownership, public contracts, private internals, dependency direction, adapters, composition root, source of truth, and compatibility seam are defined or marked not applicable with evidence. | The plan MUST remain `Not ready`. |
| G7 — Robustness | Validation, errors, idempotency, retries/timeouts, consistency, concurrency, trust boundaries, observability, performance, migration, and tests are assessed and mapped to implementation and verification. | The plan MUST remain `Not ready`. |
| G8 — Implementation and Verification Plan | Ordered implementation, testing, risk, rollback, acceptance, post-implementation, stop-condition, and evidence requirements are complete. | The plan MUST remain `Not ready`. |
| G9 — Quality and Consistency | All files are reopened and validated; `planScore` matches; question history and all contracts are present; no prohibited claims exist. | The agent MUST correct the plan and repeat validation. |
| G10 — Human Review | The complete consolidated plan review is shown in chat. | The agent MUST NOT request approval or movement. |
| G11 — Pending Movement | The plan is complete, approval-ready, and explicitly approved for movement. | The agent MUST keep the plan in draft. |

## Documentation-First Gate

### Canonical Documentation Entry-Point Contract

The first task-planning repository action MUST be locating and opening `documentation/AGENTS.md`. The first task-planning repository file read MUST be `documentation/AGENTS.md`.

The agent MUST read `documentation/AGENTS.md` completely before it creates or updates the plan folder, scans implementation code, asks the user a planning question, inspects historical task plans, reads generated reports, or makes an architecture decision.

The agent MUST re-read `documentation/AGENTS.md` for every new plan and every resumed plan whose documentation pass is not current. The agent MUST NOT rely on a prior reading, cached memory, copied routing rules, or assumptions about what the file currently contains.

`documentation/AGENTS.md` MUST be treated as the canonical and controllable entry point for project documentation discovery. The agent MUST follow every instruction, prerequisite, link, route, search rule, authority rule, and verification rule that the current file defines, in the exact order it defines them.

The agent MUST NOT duplicate, replace, weaken, reinterpret, or bypass the downstream routing logic owned by `documentation/AGENTS.md`. A future change to `documentation/AGENTS.md` MUST take effect without requiring a corresponding change to this skill, unless that change conflicts with a higher-priority instruction.

When `documentation/AGENTS.md` directs the agent to a documentation index, the agent MUST read that routed index immediately after `documentation/AGENTS.md` and before any implementation-code inspection. In the current repository structure, this route is expected to include `documentation/0-index.md`; however, the path and routing behavior declared by the current `documentation/AGENTS.md` MUST remain authoritative.

The agent MUST NOT bypass `documentation/AGENTS.md` by opening `documentation/0-index.md`, another index, a README, source code, an old task plan, a report, a screenshot, generated output, or any other project file first. The agent MUST NOT treat direct knowledge of the target as permission to skip the entry point.

If `documentation/AGENTS.md` is missing, unreadable, inaccessible, empty, ambiguous, or internally inconsistent, the agent MUST:

1. check the exact path and filename casing;
2. record the exact path, failure, and search performed;
3. create or update the draft plan only to record the documentation blocker;
4. set approval readiness to `Not ready`;
5. refrain from scanning implementation code, asking planning questions, designing architecture, completing implementation checklists, or requesting lifecycle movement;
6. refuse to silently substitute `documentation/0-index.md` or another file as the canonical entry point.

### Routed Documentation Pass

After completely reading `documentation/AGENTS.md`, the agent MUST execute the documentation workflow it defines. The agent MUST read every routed primary document and every supporting document required by the task's matched terms, source paths, lifecycle boundaries, contracts, risks, and verification surfaces before inspecting implementation code for those areas.

The routed documentation pass MUST inspect the relevant subset of:

- repository instruction files, including applicable `AGENTS.md` files and equivalent agent instructions;
- root and package-level `README` files;
- contribution and development setup documentation;
- documentation indexes and route maps;
- task-management, planning, lifecycle, and helper documentation;
- architecture overviews and architecture decision records;
- target-specific feature, module, API, schema, configuration, integration, or workflow documentation;
- public contract and compatibility documentation;
- test strategy, test command, and quality-gate documentation;
- migration, deployment, rollback, operations, monitoring, and incident documentation when relevant.

After the canonical entry-point chain is complete, the agent MUST follow the reading order declared by `documentation/AGENTS.md` and its routed index. When that route does not define an order for a lower-level instruction set, the agent MUST read from the documentation root toward the target and MUST apply the most specific applicable instruction when multiple instruction files exist.

Before G2 begins, the agent MUST retain the exact entry-point path, every routed index and documentation path, matched task terms, source routes, findings, conflicts, and gaps. Immediately after G2 creates the draft files, the agent MUST record the following in `02-planning-and-decisions.md` before G3 begins:

1. confirmation that `documentation/AGENTS.md` was the first task-planning repository file read;
2. every documentation path read, including every file routed by `documentation/AGENTS.md`;
3. the matched request terms, source paths, and documentation routes used;
4. the instruction or architectural finding that affects the plan;
5. the plan section or decision affected by the finding;
6. any documentation conflict, ambiguity, staleness, missing route, or missing documentation;
7. any official external documentation that must be verified because framework, SDK, runtime, deployment, model, or tool behavior is uncertain or likely to have changed.

When implementation evidence later exposes a new feature term, UI label, widget name, command, data path, source path, contract, or lifecycle boundary that was not covered by the first documentation pass, the agent MUST pause the code scan, return to `documentation/AGENTS.md`, follow its current routing workflow for the new evidence, read every newly matched document, record the additional route, and only then resume implementation inspection.

When no relevant routed documentation exists, the agent MUST record the exact locations, filename patterns, index terms, aliases, and source-path routes checked. The absence of documentation MUST NOT be treated as evidence of intended behavior.

## Path-Aware Lessons Gate

After the canonical documentation route is complete and immediately after G2 creates the draft files, but before G3 planning decisions or questions, the agent MUST:

1. read the latest one or two task logs in `docs/tasks/logs/` when present;
2. read `docs/tasks/todo.md` for overlapping or in-progress work;
3. read `docs/tasks/lessons-active.md` as the first-pass evergreen lesson set;
4. use `docs/tasks/lessons-index.json` to match lessons by task keywords from the user request, likely or confirmed touched paths, and the planning workflow type;
5. read `docs/tasks/lessons.md` only for matched lesson IDs that need extra context;
6. record the matched lesson IDs, titles, and one-line reasons immediately in the draft plan.

The initial lookup MUST use expected paths inferred from the request and documentation. After the targeted evidence scan confirms actual paths, the agent MUST re-run the lookup and update the match result whenever scope changes or a touched path was not covered by the initial lookup.

`02-planning-and-decisions.md` MUST contain this section:

```markdown
## Relevant Lessons

- `<lesson-id>` — <lesson title>: <one-line reason it applies>
```

When no lesson matches, the section MUST contain exactly `Relevant lessons: none.` The same `Relevant Lessons` result MUST appear in the planning chat summary before approval or lifecycle movement.

If `docs/tasks/lessons-active.md` or `docs/tasks/lessons-index.json` is missing or inaccessible, the agent MUST record the exact path and blocker, keep the plan in draft with approval readiness `Not ready`, and MUST NOT silently substitute a full read of `docs/tasks/lessons.md`.

## Folder Name

The agent MUST name every plan folder using:

`<five-digit-sequential-id>-<yyyy-mm-dd>-<kebab-task-name>`

The agent MUST calculate the next ID by scanning all lifecycle folders under `docs/tasks/planning/*`.

The agent MUST NOT reuse an existing ID, skip the lifecycle-folder scan, derive the ID from only the draft folder, or create a nonconforming folder name.

## Plan Folder Creation Helper Contract

The canonical helper for creating a new plan folder is:

```bash
python3 docs/tasks/task-system-helpers/create-plan-folder.py \
  --project-root . \
  --title "<task title>" \
  --codex-end-goal "<concise outcome-level goal with completion guard>"
```

The planner MUST use this helper for new plan-folder creation whenever it exists. The helper scans every lifecycle folder, calculates the next five-digit ID, creates `plan.json`, writes `codexEndGoal`, and creates all twelve canonical section files. The helper creates scaffolding only; the planner MUST still populate the planner-owned sections with documentation findings, questions, evidence, checklists, risks, acceptance criteria, and the Plan Quality Assessment.

The planner MUST NOT say there is no plan-folder creation helper unless it has checked exactly `docs/tasks/task-system-helpers/create-plan-folder.py`. If the helper is missing or fails, record the exact path, command, and failure in `02-planning-and-decisions.md`, then create the canonical folder directly as a fallback while preserving the same manifest and `codexEndGoal` contract. Direct folder creation is only a fallback after recording the exact helper path and failure.

## Required Files

Every plan folder MUST contain all of the following canonical plan files:

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
```

The agent MUST create every required file during draft creation. The agent MUST NOT defer creation of executor or reviewer files until execution or review.

## Role Ownership Contract

- `plan.json` MUST remain TaskManager/helper-owned machine state. Agents MUST NOT hand-edit arbitrary JSON except through an explicit lifecycle/helper operation.
- `01` through `05` MUST remain planner-owned and MUST freeze after approval except for controlled lifecycle/status synchronization.
- `03-implementation-checklist.md` and `04-testing-checklist.md` MUST contain the live implementation/testing checklist source.
- `06-executor-report.md`, `07-executor-evidence.md`, and `08-verification-handoff.md` MUST remain executor-owned. Executors MUST record summaries and evidence there with tables or normal bullets and MUST NOT create duplicate progress checkboxes.
- `09-r1-review.md` and `11-r2-closeout-review.md` MUST remain reviewer-owned. Reviewers MUST NOT rewrite executor reports except to quote the minimum text required for a finding.
- `10-post-implementation-checklist.md` MUST remain reviewer/task-manager synchronized and MUST keep `User Verification Required` as the final live checklist item.
- `12-comments.md` MUST remain append-only for user and sub-agent comments.
- The planner MUST NOT write execution claims, test-passed claims, review findings, verification evidence, or closeout claims into executor-owned or reviewer-owned files.

## Strict plan.json Contract

`plan.json` MUST include:

- `schema: "task-plan-folder/v1"`
- `planId`, `folderName`, `title`, `slug`, `created`, `updated`
- `lifecycle`, `planningState`, `status`, `riskLevel`
- `planScore` as a string such as `Provisional 0/10` or `Score 8/10`
- `codexEndGoal` as a concise, concrete, outcome-level objective string with a clear completion guard that the executor sets through the Codex goal feature, unless `taskSystemConfigSnapshot.config.codexGoal.requirePlanEndGoal` is explicitly false
- `taskSystemConfigSnapshot` as the effective task-system config captured from `docs/tasks/task-system.config.yaml` or package defaults at plan creation time
- `sections` as the exact ordered twelve-object manifest
- each section object with `order`, `file`, `sectionId`, `title`, `navLabel`, `layout`, `ownerRole`, and `editPolicy`
- `appendOnly: true` on the comments section

The agent MUST NEVER use `canonicalFiles`, `files`, `sectionFiles`, or another replacement for `sections`.

The agent MUST NEVER write `planScore` as an object.

The agent MUST use the project TaskManager/helper or explicit lifecycle/helper operation for creation and state transitions. The agent MUST NOT improvise alternate state fields or edit policies.

## Canonical Section Manifest

The `sections` value MUST match this exact ordered manifest:

```json
[
  {
    "order": 1,
    "file": "01-original-scope.md",
    "sectionId": "01-original-scope",
    "title": "Original Scope",
    "navLabel": "Scope",
    "layout": "article",
    "ownerRole": "planner",
    "editPolicy": "frozen-after-approval"
  },
  {
    "order": 2,
    "file": "02-planning-and-decisions.md",
    "sectionId": "02-planning-and-decisions",
    "title": "Planning and Decisions",
    "navLabel": "Planning",
    "layout": "decision-log",
    "ownerRole": "planner",
    "editPolicy": "frozen-after-approval"
  },
  {
    "order": 3,
    "file": "03-implementation-checklist.md",
    "sectionId": "03-implementation-checklist",
    "title": "Implementation Checklist",
    "navLabel": "Implementation",
    "layout": "checklist",
    "ownerRole": "planner",
    "editPolicy": "taskmanager-synced"
  },
  {
    "order": 4,
    "file": "04-testing-checklist.md",
    "sectionId": "04-testing-checklist",
    "title": "Testing Checklist",
    "navLabel": "Testing",
    "layout": "checklist",
    "ownerRole": "planner",
    "editPolicy": "taskmanager-synced"
  },
  {
    "order": 5,
    "file": "05-risk-rollback-acceptance.md",
    "sectionId": "05-risk-rollback-acceptance",
    "title": "Risk, Rollback, and Acceptance",
    "navLabel": "Acceptance",
    "layout": "matrix",
    "ownerRole": "planner",
    "editPolicy": "frozen-after-approval"
  },
  {
    "order": 6,
    "file": "06-executor-report.md",
    "sectionId": "06-executor-report",
    "title": "Executor Report",
    "navLabel": "Executor",
    "layout": "report",
    "ownerRole": "executor",
    "editPolicy": "role-owned"
  },
  {
    "order": 7,
    "file": "07-executor-evidence.md",
    "sectionId": "07-executor-evidence",
    "title": "Executor Evidence",
    "navLabel": "Evidence",
    "layout": "evidence",
    "ownerRole": "executor",
    "editPolicy": "role-owned"
  },
  {
    "order": 8,
    "file": "08-verification-handoff.md",
    "sectionId": "08-verification-handoff",
    "title": "Verification Handoff",
    "navLabel": "Verification",
    "layout": "matrix",
    "ownerRole": "executor",
    "editPolicy": "role-owned"
  },
  {
    "order": 9,
    "file": "09-r1-review.md",
    "sectionId": "09-r1-review",
    "title": "R1 Review",
    "navLabel": "R1 Review",
    "layout": "review",
    "ownerRole": "reviewer",
    "editPolicy": "role-owned"
  },
  {
    "order": 10,
    "file": "10-post-implementation-checklist.md",
    "sectionId": "10-post-implementation-checklist",
    "title": "Post-Implementation Checklist",
    "navLabel": "Post Checklist",
    "layout": "checklist",
    "ownerRole": "reviewer",
    "editPolicy": "taskmanager-synced"
  },
  {
    "order": 11,
    "file": "11-r2-closeout-review.md",
    "sectionId": "11-r2-closeout-review",
    "title": "R2 Closeout Review",
    "navLabel": "R2 Review",
    "layout": "review",
    "ownerRole": "reviewer",
    "editPolicy": "role-owned"
  },
  {
    "order": 12,
    "file": "12-comments.md",
    "sectionId": "12-comments",
    "title": "Comments",
    "navLabel": "Comments",
    "layout": "comments",
    "ownerRole": "all",
    "editPolicy": "append-only",
    "appendOnly": true
  }
]
```

## Markdown Section Contract

Every Markdown section file MUST start with frontmatter containing:

- `schema`
- `section_id`
- `nav_label`
- `order`
- `layout`
- `owner_role`
- `edit_policy`
- `summary`
- `status`

Every Markdown section file MUST then include:

1. one `#` heading matching the section title;
2. an `At a Glance` block;
3. render-friendly tables, checklists, or structured subsections required by that section;
4. no claims owned by a later lifecycle role.

The agent MUST keep frontmatter values synchronized with the canonical manifest and plan state.

## Required Planner Content by File

### `01-original-scope.md`

The planner MUST include:

- the user's original request without silently narrowing or expanding it;
- the interpreted concrete target;
- the required outcome;
- a `## Codex End Goal` section containing the exact objective string also stored in `plan.json.codexEndGoal`;
- explicit in-scope and non-scope boundaries;
- behavior and contracts that must remain compatible;
- the requested output and the planning-only limitation;
- unresolved user-intent facts that cannot be determined from documentation or repository evidence.

### `02-planning-and-decisions.md`

The planner MUST include:

- documentation paths and routed findings;
- the exact `## Relevant Lessons` section with matched lesson IDs/titles and applicability reasons, or `Relevant lessons: none.`;
- the complete question and answer history;
- the evidence scan inventory;
- the current lifecycle map;
- current module boundaries and ownership;
- observed weaknesses tied to evidence;
- target architecture and dependency direction;
- public contracts, private internals, adapters, composition root, and source of truth;
- robustness decisions and applicability rationale;
- decisions, rejected directions, assumptions, and unresolved questions;
- the exact `Plan Quality Assessment` section required by this file, including the `Codex End Goal`.

### `03-implementation-checklist.md`

The planner MUST create an ordered, atomic implementation checklist. Every live checklist item MUST identify or link to:

- the intended deliverable;
- the owning module or boundary;
- affected files, symbols, schemas, routes, commands, or runtime paths when known;
- prerequisite decisions and dependencies;
- contract, compatibility, or migration obligations;
- the verification check for that item;
- the rollback point or stop condition when the item is risky.

The checklist MUST place tests, contracts, schema checks, or safety harnesses before risky internal changes. It MUST add a seam before moving behavior, preserve compatibility until parity is proven, and use a first vertical slice when the target supports one.

### `04-testing-checklist.md`

The planner MUST include all applicable unit, integration, contract, schema, migration, snapshot, property, smoke, end-to-end, security, performance, and manual verification checks.

Every test item MUST name:

- the behavior or contract proved;
- the test location or command when known;
- required fixtures, environments, providers, or test data;
- expected result;
- failure interpretation;
- evidence the executor must capture.

The planner MUST NOT rely only on snapshots or happy-path tests for a target with failure, migration, security, concurrency, or compatibility risk.

### `05-risk-rollback-acceptance.md`

The planner MUST include:

- a risk matrix with likelihood, impact, evidence, prevention, detection, owner, and response;
- rollback prerequisites and exact rollback triggers;
- compatibility, migration, and data recovery requirements;
- stop conditions for every high-impact phase;
- measurable acceptance criteria for behavior, contracts, tests, operations, and user outcomes;
- explicit residual risks and the user decision required for any accepted high risk.

### `06-executor-report.md`, `07-executor-evidence.md`, and `08-verification-handoff.md`

The planner MUST create these files with valid metadata and empty role-appropriate structures. The planner MUST NOT populate them with execution claims or fabricated evidence.

### `09-r1-review.md` and `11-r2-closeout-review.md`

The planner MUST create these files with valid metadata and empty role-appropriate review structures. The planner MUST NOT pre-author review findings, approval decisions, or closeout claims.

### `10-post-implementation-checklist.md`

The planner MUST include the post-implementation checks required to prove deployment, runtime behavior, migration state, observability, rollback readiness, documentation accuracy, and acceptance criteria.

The final live checklist item MUST be exactly `User Verification Required`.

### `12-comments.md`

The planner MUST initialize this file as append-only. The planner and all later agents MUST preserve every existing comment and MUST append rather than rewrite.

## Mandatory Question and Decision Contract

This section replaces all previous plan-task question logic. The agent MUST use the purpose-and-constraint interview and evidence-based follow-up logic defined here. The agent MUST NOT use a fixed three-question questionnaire.

### Initial Purpose and Constraint Interview

After G1 documentation reading and G2 draft creation, but before the target implementation scan, the agent MUST resolve the following seven categories:

1. **Target:** the exact feature, module, service, workflow, API, data model, integration, tool, package, subsystem, or system boundary being changed.
2. **Purpose:** the user, operator, or developer outcome the plan must enable and the measurable success criteria that prove the outcome.
3. **Failure or pain:** what is fragile, duplicated, slow, unsafe, hard to extend, hard to test, unclear, or currently failing.
4. **Compatibility constraints:** the public API, database schema, saved data format, event, configuration shape, deployment flow, permissions, UX, performance, provider contract, or other behavior that must not break.
5. **Consumers:** the UI, API, CLI, background jobs, workers, external providers, data pipelines, automation, tests, operators, packages, or users that depend on the target.
6. **Robustness priorities:** the user's risk tolerance and the risks that matter most, including invalid input, retries, partial failure, concurrency, data integrity, permissions, observability, rollback, scalability, migration, or operational support.
7. **Required output:** the exact planning deliverable, including an implementation-ready task plan, architecture decision, migration path, rollout plan, or review checklist. This skill MUST still remain planning-only.

The agent MUST infer answers already supplied by the user or proven by documentation. The agent MUST record those answers as resolved and MUST NOT ask the user to repeat them.

The agent MUST ask between three and seven initial questions only when three to seven material user decisions remain unresolved. When fewer than three material user decisions remain, the agent MUST ask only those unresolved questions. When no material user decision remains, the agent MUST record all seven categories as resolved and MUST proceed without inventing questions.

Every question MUST be specific to the request and MUST be capable of changing architecture, compatibility, scope, risk handling, migration, acceptance criteria, or implementation sequence.

The agent MUST NOT ask:

- generic questions that do not affect the plan;
- questions answered by the user's request;
- questions answered by documentation already read;
- repository-fact questions that the targeted evidence scan can answer;
- questions whose only purpose is to delay planning;
- questions about implementation authorization, because this skill is planning-only.

### Question Record Contract

Before asking any question in chat, the agent MUST add it to `02-planning-and-decisions.md` using a durable decision-log structure containing:

| Field | Mandatory content |
|---|---|
| Question ID | Stable sequential identifier. |
| Stage | `Initial interview` or `Evidence-based follow-up`. |
| Category | One of the seven initial categories or a named evidence issue. |
| Question | The exact plain-chat question. |
| Why it changes the plan | The architecture, compatibility, risk, migration, testing, or scope consequence. |
| Recommended answer | One decisive recommendation and its evidence-based rationale. |
| User answer | Exact or faithful recorded answer; `Pending` until answered. |
| Decision status | `Pending`, `Resolved`, `Assumed`, or `Superseded`. |
| Affected sections | Plan files and checklist items that depend on the answer. |

The agent MUST preserve the complete history. The agent MUST NOT delete a prior question, overwrite a prior user answer, or erase a superseded decision. The agent MUST append the new decision and mark the prior entry `Superseded` with a reference.

When a material initial question is pending, the agent MUST stop after updating the draft and presenting the required plan review plus the questions in chat. The agent MUST NOT perform the target implementation scan until the answer is received.

### Evidence-Based Follow-Up Questions

After G4, the agent MUST ask a follow-up question only when the scan reveals an uncertainty whose answer materially changes architecture or implementation. Material triggers MUST include:

- competing implementations for the same responsibility;
- an unclear authoritative source of truth;
- a public contract that may require compatibility support;
- saved data, generated output, or migrations that can break existing users;
- hidden or external consumers not safely inferable from evidence;
- ambiguous ownership between configuration, domain logic, adapters, and storage;
- missing tests around risky behavior;
- provider constraints involving authentication, rate limits, retries, webhooks, timeouts, idempotency, or audit logs;
- generated files whose edit ownership is unclear;
- conflicting domain vocabulary or duplicated concepts;
- a migration seam whose rollout policy requires a user choice;
- a breaking change, data loss risk, security tradeoff, or operational risk requiring explicit acceptance.

The agent MUST NOT ask a follow-up question when evidence can resolve it or when the answer is unlikely to change the plan. In that case, the agent MUST proceed with a documented, bounded assumption and a verification requirement.

When a material follow-up question is pending, the agent MUST update all affected planner-owned files, set approval readiness to `Questions pending`, present the complete consolidated review, ask the focused question in plain chat, and stop before finalizing the affected architecture or checklist items.

## Targeted Evidence Scan Contract

After the initial interview gate is resolved, the agent MUST inspect only the implementation evidence required for the concrete target. The agent MUST start at the target and widen the scan only when the target lifecycle requires it.

The agent MUST begin implementation inspection only after the documentation route for the target has been completed. Whenever the implementation scan reveals a new term, path, contract, consumer, or boundary, the agent MUST re-enter the documentation workflow through `documentation/AGENTS.md` before continuing inspection of that newly discovered area.

The scan MUST follow this order:

1. locate relevant entry points, public interfaces, package exports, routes, commands, jobs, handlers, schemas, migrations, configuration, documentation, and tests;
2. map the lifecycle as `input -> validation -> orchestration -> domain logic -> adapters -> storage or side effects -> output -> observability` and mark absent stages explicitly;
3. identify module boundaries and ownership for creation, validation, transformation, persistence, publication, rendering, observation, retries, and domain concepts;
4. identify contracts, including types, interfaces, schemas, events, API payloads, configuration formats, database constraints, adapter protocols, generated outputs, and CLI inputs;
5. trace dependency direction and identify inward infrastructure dependencies, circular imports, hidden globals, service locators, direct cross-module calls, and bypassed public contracts;
6. identify robustness gaps, including weak validation, unsafe defaults, missing idempotency, ambiguous errors, swallowed failures, unbounded retries, race conditions, missing authorization, missing observability, missing rollback, and insufficient tests;
7. inspect repository patterns that already work for the same type of boundary, contract, adapter, validation, migration, or test;
8. inspect available commands and tests that can verify the target and record missing safety harnesses;
9. check official documentation or primary source references when framework, SDK, runtime, model, deployment, or tool behavior remains uncertain or likely to have changed.

The agent MUST use lightweight, targeted inspection first, including directory listings, filename searches, text searches, package manifests, route maps, schema files, migration folders, documentation indexes, test lists, and dependency manifests.

The agent MUST NOT perform an expensive or repository-wide scan unless the target lifecycle cannot be understood without it. The agent MUST record why every widened scan was required.

The evidence record MUST name concrete files, symbols, classes, functions, packages, schemas, commands, tests, consumers, and runtime paths when they exist. The agent MUST label inferred relationships as inferences.

## Current Lifecycle and Weakness Contract

The agent MUST produce a current-state lifecycle and module map before proposing the target architecture.

Every claimed weakness MUST cite repository evidence inside the plan by file, symbol, contract, command, test gap, or runtime path. The agent MUST NOT use generic claims such as `not modular`, `not robust`, `poor separation`, or `needs validation` without identifying the observed condition and consequence.

The current-state analysis MUST identify:

- the current entry point and output boundary;
- the source of truth currently used;
- responsibility ownership and duplicated ownership;
- public and de facto contracts;
- direct and transitive consumers;
- dependency direction;
- side effects and external systems;
- validation and error paths;
- persistence and consistency boundaries;
- existing tests and verification commands;
- compatibility, migration, and operational constraints.

## Modular Architecture Contract

The agent MUST design the smallest architecture that solves the target problem and creates clear, testable seams for required future change.

The target architecture MUST define:

- the exact module or subsystem boundary;
- what the module owns;
- what the module MUST NOT own;
- public contracts, including applicable interfaces, DTOs, events, schemas, configuration, package exports, API routes, file formats, or CLI inputs;
- private internals that consumers MUST NOT access directly;
- dependency direction;
- adapters for external providers, storage, queues, file systems, CLI, UI, framework glue, generated formats, and legacy code when applicable;
- the composition root or wiring location for concrete implementations;
- the named source of truth for domain vocabulary, configuration, contracts, and generated output;
- extension points that are required by known use cases;
- a compatibility or migration seam when replacing existing behavior;
- verification points that prove the boundary.

The agent MUST keep domain rules and system policy independent from UI, framework glue, provider SDKs, databases, global state, queues, file systems, and generated artifacts whenever the repository target requires a seam and no deliberate local pattern proves otherwise.

The agent MUST use ports and adapters, thin entry points, use-case handlers, repositories or gateways, anti-corruption layers, contract-first schemas, normalized internal representations, feature flags, compatibility adapters, or stable package exports only when inspected evidence justifies the pattern.

The agent MUST NOT create abstraction for hypothetical future requirements. Every proposed abstraction MUST map to an observed boundary, current pain, required consumer, compatibility obligation, known extension, or material risk.

## Public Contract Gate

Every value or behavior that crosses a module, process, persistence, provider, deployment, or user boundary MUST have a named contract in the plan.

For each public contract, the plan MUST specify:

- owner;
- authoritative source;
- consumers;
- input and output shape;
- validation rules;
- error behavior;
- compatibility policy;
- versioning or migration requirement when applicable;
- test or verification method;
- deprecation path when applicable.

The plan MUST identify de facto contracts even when the repository does not declare them formally.

The agent MUST NOT allow consumers to depend directly on private internals in the target design.

## Source-of-Truth Gate

The plan MUST name one authoritative source of truth for every domain concept, public contract, configuration definition, generated artifact, state transition, or persisted value affected by the task.

The source of truth MUST be owned, consumed consistently, and versioned when compatibility requires versioning.

When multiple current sources conflict, the plan MUST identify the conflict, choose the target authority, define synchronization or migration behavior, and include a parity or consistency check.

For configuration, manifest, schema, generated-contract, or import systems, the plan MUST use the following lifecycle when applicable:

`compact source -> strict validation -> reference or preset resolution -> normalized internal representation -> runtime consumers`

The normalized representation MUST be deterministic, generated or derived by one owned path, versionable when required, and directly testable.

Configuration MUST express stable intent, values, capabilities, mappings, and constraints. Runtime branching, authorization, orchestration, side effects, and complex behavior MUST remain in code with tests.

## Robustness Design Contract

The planner MUST assess every category below. Every category MUST be marked `Applicable` or `Not applicable` with target-specific evidence. Every applicable category MUST produce implementation checklist items, testing checklist items, risk controls, rollback or recovery behavior, and acceptance criteria.

### Validation

The plan MUST define early validation for invalid input, unknown keys when strictness is required, invalid references, duplicates, incompatible combinations, missing required values, unsafe defaults, malformed external payloads, and invalid state transitions.

### Error Handling

The plan MUST define typed or structured errors when supported by the project, preserve actionable context, prevent swallowed failures, separate user-safe from operator-safe messages, and map failures to observable states.

### Idempotency

The plan MUST define idempotency for every retryable webhook, background job, external write, import, payment, provisioning action, email, deployment automation step, or duplicate-prone side effect. When idempotency is not applicable, the plan MUST state why duplicate execution cannot occur or cannot cause harm.

### Retries and Timeouts

The plan MUST define bounded timeouts and retries only for operations proven safe to retry. It MUST define retry classification, attempt limits, backoff behavior when applicable, terminal failure behavior, observability, and duplicate protection.

### Transactions and Consistency

The plan MUST define atomic boundaries, database transactions, compensation, reconciliation, or eventual-consistency behavior for multi-step state changes and side effects. It MUST state what happens after partial success.

### Concurrency

The plan MUST assess locking, deduplication, optimistic concurrency, stale writes, race-prone state transitions, queue semantics, parallel workers, and re-entrant handlers where applicable.

### Permissions and Trust Boundaries

The plan MUST identify trust boundaries, authenticate and authorize before side effects, validate external inputs at the boundary, protect sensitive data, and keep security decisions in tested code rather than scattered configuration.

### Observability

The plan MUST define the applicable logs, metrics, traces, audit records, correlation identifiers, health checks, alert conditions, and actionable failure states required to operate the target. It MUST prohibit logging secrets and sensitive payloads.

### Performance and Capacity

The plan MUST define scale assumptions, hot paths, query or I/O risks, memory bounds, batch limits, caching rules, backpressure, and load verification only when evidence shows a performance or capacity constraint. It MUST NOT add performance mechanisms without a measurable requirement.

### Migration and Rollout

The plan MUST define compatibility layers, schema or data migrations, backfills, feature flags, dual reads or writes, generated-output diffs, parity tests, dry runs, rollout order, rollback, and stop conditions whenever existing users, data, contracts, or deployment flows can be affected.

### Tests and Verification

The plan MUST select the test types required to prove public contracts, validation, behavior, failure modes, adapter behavior, migrations, concurrency, permissions, operations, and rollback. It MUST NOT use test quantity as a substitute for coverage of the identified risks.

## Migration and Compatibility Gate

When the target affects an existing public API, stored data, schema, event, configuration, generated file, provider integration, deployment path, or user behavior, the plan MUST include a migration and compatibility strategy.

The strategy MUST specify:

- the old and new contract or behavior;
- the compatibility seam;
- data transformation or backfill behavior;
- ordering constraints;
- parity checks;
- dry-run behavior;
- rollout stages;
- stop conditions;
- rollback triggers and exact rollback action;
- cleanup criteria for transitional code;
- evidence required before removing compatibility support.

The plan MUST keep legacy compatibility until parity is proven unless the user explicitly approves a breaking cutover and accepts the recorded risk.

The plan MUST treat migration as part of architecture and MUST NOT relegate migration to an unverified final step.

## Implementation Plan Contract

Before the plan can be approval-ready, it MUST include:

1. target scope and non-scope;
2. evidence inspected, including files, symbols, commands, schemas, tests, documentation, and runtime paths;
3. current lifecycle and module map;
4. current weaknesses tied to evidence;
5. target modular architecture;
6. public contracts and source-of-truth decisions;
7. robustness design for validation, failures, recovery, migration, operations, and verification;
8. ordered implementation phases;
9. files or symbols to change first;
10. files, generated artifacts, or unrelated areas the executor MUST avoid;
11. a verification command or check for every phase;
12. stop conditions and rollback points;
13. measurable acceptance criteria;
14. unresolved questions that genuinely affect implementation.

Each implementation phase MUST:

- produce one coherent, reviewable outcome;
- preserve a runnable or recoverable state;
- identify prerequisites;
- identify contract changes;
- define tests before or with risky behavior changes;
- define executor evidence;
- define a stop condition;
- define rollback when the phase can affect existing behavior or data.

The plan MUST require incremental execution after approval. It MUST use tests, contracts, schema checks, or safety harnesses first when risk is high; establish a seam before moving behavior; preserve legacy compatibility until parity is proven; implement one vertical slice first when applicable; and remove transitional code only after verification.

The plan MUST prohibit opportunistic refactoring of unrelated code and MUST prohibit new dependencies unless the project lacks a reasonable existing option and the benefit, cost, security impact, and rollback are documented.

## Verification Contract

Every implementation and testing checklist item MUST have an objective completion signal.

Allowed verification signals MUST include one or more of:

- unit test;
- integration test;
- contract test;
- schema validation;
- migration dry run;
- generated-output diff;
- typecheck;
- lint check;
- static analysis;
- security check;
- smoke test;
- runtime health check;
- log, metric, trace, or audit verification;
- explicit manual verification with reproducible steps and expected result.

The plan MUST name the exact command when the command is known from project evidence. The agent MUST NOT invent a command. When the command cannot be found, the plan MUST identify the missing command as a gap and MUST define how the executor will discover or confirm it before running the phase.

Every high-risk change MUST have both a pre-change safety check and a post-change verification check.

Every rollback path MUST have a verification step proving restoration.

## TaskManager Checklist Rendering Rule

Only live checklist files MUST contain Markdown checkbox syntax for progress:

- `03-implementation-checklist.md`
- `04-testing-checklist.md`
- `10-post-implementation-checklist.md`

When detail tables are included, they MUST supplement the live checkboxes and MUST NOT replace them as the checklist representation.

Executor reports, executor evidence, verification handoffs, reviewer reports, decision history, and comments MUST use normal bullets or tables and MUST NOT use progress checkboxes.

## Plan Quality Assessment Contract

Every plan MUST include this exact section in `02-planning-and-decisions.md` before the plan is considered approval-ready:

```markdown
## Plan Quality Assessment

**Plan Score:** <score>/10

### What is good
- <clear strengths of the request/plan>

### What is risky / not good
- <risks, weak spots, complexity, unclear areas>

### What was not accounted for yet
- <known omissions, unknowns, dependencies, edge cases, or verification gaps>

### Assumptions
- <assumptions being made, or `None — no unstated assumptions`>

### Recommended path
- <recommended implementation/planning route and why it is best>

### Codex End Goal
- <the exact concise outcome-level objective the executor must set with the Codex goal feature; include the core completion guard and do not repeat the plan checklist>

### Why this is not 10/10
- <concrete reason; if 10/10, explain why no known gaps remain>

### Approval readiness
- <Ready for approval | Questions pending | Not ready> with reason.
```

`plan.json.planScore` MUST match the visible score. `plan.json.codexEndGoal` MUST match the visible concise outcome-level `Codex End Goal`.

A plan MUST be treated as incomplete when it records `planScore` only in JSON without the readable assessment above.

The planner MUST score the plan against documentation coverage, question resolution, evidence quality, scope clarity, modular boundary clarity, contract completeness, robustness coverage, migration safety, verification completeness, rollback quality, and acceptance measurability.

The planner MUST use `Ready for approval` only when:

- every mandatory gate through G9 is complete;
- no material question remains pending;
- no unsupported critical assumption remains;
- every implementation phase has verification and a stop condition;
- every applicable migration and rollback requirement is complete;
- the visible score is at least `8/10`;
- the plan can be implemented by another agent without repeating discovery.

A score below `8/10` MUST result in `Questions pending` or `Not ready`.

A score of `10/10` MUST be used only when no known gap, unresolved dependency, unverified contract, material assumption, migration uncertainty, or verification gap remains.

## Required Chat Presentation Before Approval or Movement

Any chat response that asks the user for approval, `move to pending`, lifecycle movement, or a next-step decision MUST include the full consolidated plan review in that same response.

This requirement MUST apply after initial plan creation, after questions are answered, after decisions are locked, and after `plan.json` status or planning state changes.

The chat review MUST include:

1. plan path;
2. target scope and non-scope;
3. documentation and evidence scanned;
4. current architecture or lifecycle summary;
5. target modular architecture;
6. public contracts and source of truth;
7. robustness, migration, and verification approach;
8. what is good;
9. what is risky or not good;
10. what was not accounted for yet;
11. assumptions;
12. recommended path;
13. Codex End Goal;
14. plan score out of 10;
15. why it is not 10/10;
16. open questions, if any;
17. approval readiness;
18. approval or next-step choices in plain chat.

The chat review MUST also include the plan's `Relevant Lessons` result with matched IDs/titles and applicability reasons, or the exact statement `Relevant lessons: none.`

The agent MUST NOT tell the user only that files were created, questions were recorded, or decisions were locked.

The agent MUST NOT ask only for `move to pending`, `approve`, or `next step`.

The agent MUST NOT require the user to open the plan folder to understand or approve the plan.

## Planning Flow

The agent MUST execute this workflow in the exact order below:

1. **Read `documentation/AGENTS.md` and complete its documentation route first.** The agent MUST make `documentation/AGENTS.md` the first task-planning repository file it opens, MUST read it completely, and MUST follow its current instructions in order. When it routes to an index, including the current `documentation/0-index.md` route, the agent MUST read that index next, search it using the task wording and initial planning terms required by the entry point, and read every matched primary and supporting document before inspecting implementation code. The agent MUST retain the exact entry-point path, routed files, matched terms, source routes, findings, conflicts, and gaps for immediate recording after draft creation. The agent MUST NOT perform any other repository planning action before this step.
2. **Read task-system configuration and resolve mode.** Read `docs/tasks/task-system.config.yaml` when present, or use package defaults when missing. Resolve requested mode from `--quick`, `--standard`, `--full`/`--robust`, then from `planning.defaultMode`, then from automatic triage. Record requested mode, effective mode, config source, and the user-verification treatment rule in `02-planning-and-decisions.md` after draft creation.
3. **Resolve the task root and create the draft with the helper.** Confirm `docs/tasks` or the explicitly substituted root, then use `python3 docs/tasks/task-system-helpers/create-plan-folder.py --project-root . --title "<task title>" --codex-end-goal "<concise outcome-level goal with completion guard>"` to scan lifecycle folders, calculate the next five-digit sequential ID, snapshot `task-system.config.yaml`, and create the draft plan folder.
4. **Verify or fallback-create the draft plan folder.** Reopen the helper-created folder and verify `plan.json`, `taskSystemConfigSnapshot`, plus all twelve required files with valid metadata before asking any user question. If and only if the helper is missing or fails, record the exact helper failure and create the same canonical files directly, including the config snapshot.
5. **Restate original scope and Codex End Goal.** Record the original request, interpreted target, outcome, `## Codex End Goal`, scope, non-scope, compatibility requirements, and planning-only constraint in `01-original-scope.md`, and keep the end goal synchronized with `plan.json.codexEndGoal`.
6. **Record documentation findings.** Route documentation instructions, architecture findings, conflicts, missing documentation, and external verification needs into `02-planning-and-decisions.md`. Immediately after this recording and before Step 7, run the path-aware lessons lookup and write the `## Relevant Lessons` section.
7. **Run the initial purpose-and-constraint interview.** Resolve the seven mandatory question categories, record every full question with why-it-matters reasoning, exactly three clear options, a recommended answer, and the user answer. Ask every unresolved material question in plain chat, limit to six when possible, and include the recommended-answer bundle when six or fewer questions are asked.
8. **Stop for material initial answers when required.** When a material initial question remains pending, update the draft, write a provisional Plan Quality Assessment, present the complete consolidated review, ask the questions, and stop. The agent MUST NOT perform the target evidence scan before receiving the required answer.
9. **Perform the targeted evidence scan.** Inspect the relevant implementation in the mandatory scan order and record concrete evidence, lifecycle, boundaries, contracts, dependencies, consumers, local patterns, risks, tests, and commands. Re-run the path-aware lessons lookup using confirmed touched paths and update `Relevant Lessons` before continuing whenever the evidence changes the initial match.
10. **Run the evidence-based follow-up gate.** Ask every follow-up question whose answer materially changes architecture, compatibility, migration, risk, testing, or scope. Use the Full-Context Clarification Question Contract, record and present the complete question blocks before stopping, and resolve all other uncertainty with explicit bounded assumptions and verification requirements.
11. **Design the modular architecture.** Define boundary, ownership, non-ownership, public contracts, private internals, dependency direction, adapters, composition root, source of truth, extension points, compatibility seams, and verification points.
12. **Design robustness.** Assess every robustness category, mark applicability with evidence, and map every applicable risk to prevention, detection, recovery, verification, and acceptance.
13. **Build the implementation checklist.** Define ordered, atomic, incremental phases with files or symbols, contracts, dependencies, verification, evidence, rollback, and stop conditions. Do not add execution claims.
14. **Build the testing checklist.** Define the exact automated and manual checks required to prove behavior, contracts, failure handling, migrations, operations, and rollback. Do not add passed-test claims.
15. **Build risk, rollback, acceptance, and post-implementation sections.** Complete the risk matrix, migration strategy, rollback plan, acceptance criteria, operational checks, and final `User Verification Required` item.
16. **Initialize role-owned future sections.** Ensure executor, evidence, handoff, R1, R2, and comments files contain valid metadata and role-appropriate empty structures without fabricated claims.
17. **Write the Plan Quality Assessment.** Record score, strengths, risks, omissions, assumptions, recommended path, Codex End Goal, why the plan is not 10/10, and approval readiness. Synchronize `plan.json.planScore` and `plan.json.codexEndGoal` through the permitted helper operation.
18. **Run the full consistency validation.** Reopen `plan.json` and all twelve files. Validate schema, manifest order, ownership, metadata, question history, evidence, architecture, robustness, checklists, rollback, acceptance, Codex End Goal consistency, score, prohibited claims, and the current `Relevant Lessons` result.
19. **Present the consolidated plan review in chat.** Include every required review item in the same response before requesting any approval or movement, then end with the required `## Choose next step` block.
20. **Apply only an explicit numbered next-step choice.** After every gate through G10 is satisfied, honor only the user's explicit `1`, `2`, or `3` reply: `1` moves the plan to `approved` and invokes execute-plan, `2` moves the plan to `pending`, and `3` moves the plan to `parked`.

The agent MUST NOT reorder, collapse, bypass, or implicitly satisfy these steps.

## Draft-First Question Handling

When the task needs clarification, the agent MUST still create the complete draft plan folder before asking the user questions.

The agent MUST put open questions, full why-it-matters reasoning, exactly three options per question, recommended answers, affected decisions, risks, assumptions, recommended-answer bundle, and provisional plan content in `02-planning-and-decisions.md` before asking in chat.

The agent MUST NOT stop before creating the artifact.

The agent MUST NOT treat silence, lack of objection, or an inferred preference as approval.

## Planning-Only Execution Boundary

This skill MUST stop at planning. It MUST NOT edit application code, tests, schemas, migrations, infrastructure, runtime configuration, generated outputs, package manifests, or deployment files.

The plan MUST define how a later executor will implement incrementally after approval, but the planner MUST NOT perform those implementation steps.

The planner MUST NOT pre-check implementation, testing, or post-implementation checklist items.

The planner MUST NOT populate executor or reviewer files with anticipated results.

## Approval and Lifecycle Movement Gate

The agent MUST NOT request plan approval or pending movement unless:

- G1 through G10 are complete;
- the plan path is valid;
- every required file exists;
- all material questions are resolved;
- approval readiness is `Ready for approval`;
- `plan.json.planScore` matches the visible assessment;
- `plan.json.codexEndGoal` matches the visible `Codex End Goal` and is concise, outcome-level, bounded, verifiable, not checklist-like, and not a minimum-only or shortcut target;
- the plan score is at least `8/10`;
- the `Codex End Goal` is present, concise, outcome-level, not minimum-only, and has a clear completion guard;
- the implementation and testing checklists are complete;
- applicable modularity, robustness, compatibility, migration, rollback, and operational requirements are complete;
- acceptance criteria are measurable;
- the current `Relevant Lessons` result appears in both `02-planning-and-decisions.md` and the same chat response;
- the complete consolidated review appears in the same chat response.

The agent MUST move a plan to `approved`, `pending`, or `parked` only after the user replies with the explicit numbered next-step choice for that movement.

The agent MUST NOT equate approval of an individual decision, recommended-answer bundle, or answered question with approval of the entire plan or a lifecycle move.

The agent MUST NOT move an incomplete, provisional, question-pending, or not-ready plan to `approved`, `pending`, or `parked` except that explicit user choice `3` may park incomplete work with the reason recorded.

## Completion Check Before Approved, Pending, or Parked

Before moving a plan to `approved` or `pending`, the agent MUST reopen `plan.json` and all twelve section files. Before moving to `parked`, it MUST record the parking reason and preserve all current blockers/questions.

The agent MUST confirm:

- the schema is correct;
- the exact canonical section list and order are present;
- role ownership metadata and edit policies are correct;
- comments remain last and append-only;
- `documentation/AGENTS.md` is recorded as the first task-planning repository file read and the canonical documentation entry point;
- every index and documentation file routed by `documentation/AGENTS.md`, including the matched terms, source routes, and findings, is recorded;
- complete question and decision history is preserved;
- the targeted evidence scan is concrete and scoped;
- current and target architecture maps are present;
- public contracts and source-of-truth decisions are complete;
- every robustness category is assessed;
- implementation and testing checklists are complete and use checkbox syntax;
- executor and reviewer files contain no fabricated claims or duplicate progress checkboxes;
- risk, migration, rollback, stop conditions, and acceptance criteria are complete;
- the post-implementation checklist exists and ends with `User Verification Required`;
- the current `## Relevant Lessons` section exists and contains matched IDs/titles with reasons or exactly `Relevant lessons: none.`;
- the exact `Plan Quality Assessment` exists;
- `plan.json.planScore` matches the visible score;
- `plan.json.codexEndGoal` matches the visible concise outcome-level `Codex End Goal`;
- lifecycle gates are satisfied;
- the chat-presentable approval summary is complete.

When any check fails, the agent MUST correct the plan, rerun the entire completion check, and MUST NOT request or perform approved or pending movement. Parking remains allowed only with an explicit user `3` choice and a recorded reason.

## Architecture Decision Rules

### Boundaries Before Abstractions

The agent MUST treat a module as modular only when ownership, public contracts, private internals, dependency direction, and verification points are explicit. The agent MUST NOT equate additional folders with modularity.

### Contracts Before Cleverness

The agent MUST define explicit contracts for every boundary-crossing API payload, event, configuration, database constraint, file format, provider request, package export, CLI input, and generated artifact affected by the target.

### Core Before Adapters

The agent MUST keep business rules and system policy in the core or application layer and MUST keep framework glue, provider SDKs, persistence, file-system access, UI rendering, queues, and external formats behind adapters whenever the target requires that seam.

### Source of Truth Must Be Named

The agent MUST name and assign ownership to the source of truth for every affected domain concept, schema, table, generated artifact, configuration, event contract, API route, package export, or service.

### Configuration Is Intent; Code Is Behavior

The agent MUST keep stable intent, values, capabilities, mappings, and constraints in configuration. The agent MUST keep runtime branching, security rules, orchestration, side effects, and complex behavior in code with tests.

### Normalize Before Consuming

The agent MUST introduce strict validation, reference resolution, and a deterministic normalized internal representation before runtime consumption when the target uses compact configuration, manifests, schemas, generated contracts, or imported data.

### Robustness Is Scoped

The agent MUST add a robustness mechanism only where the corresponding failure mode exists and where a verification check can prove the mechanism. The agent MUST NOT spread retries, queues, circuit breakers, caching, locks, service extraction, or observability across unrelated code.

### Migration Is Architecture

The agent MUST design compatibility, migration, dry runs, parity, rollout, stop conditions, rollback, and transitional cleanup as part of the architecture whenever existing behavior or data can change.

### Tests Prove the Boundary

The agent MUST require tests that prove public contracts, validation, behavior, failure modes, migrations, permissions, concurrency, and adapter behavior. The agent MUST NOT rely only on snapshots or happy paths for a robust target.

### Small Steps Beat Grand Rewrites

The agent MUST use the smallest safe seam, contract, validation layer, compatibility adapter, and vertical slice that solves the target. The agent MUST NOT plan a project-wide rewrite unless the user explicitly accepts that scope and risk.

## Agent Safety Rules

- The agent MUST NOT bypass the Automatic Planning Trigger Contract by reclassifying a broad, multi-part, cross-cutting, high-risk, or ambiguous request as a routine implementation task.
- The agent MUST NOT fabricate files, APIs, models, schemas, tests, commands, providers, consumers, runtime behavior, or evidence.
- The agent MUST NOT make global claims from a narrow scan.
- The agent MUST NOT scan implementation code before `documentation/AGENTS.md` and its complete routed documentation chain have been read, recorded, and satisfied, or before the initial purpose-and-constraint interview is resolved, except for task-system operations strictly required by G2.
- The agent MUST NOT change source files while this skill is active.
- The plan MUST prohibit unrelated refactoring during implementation.
- The plan MUST preserve public behavior or explicitly document and obtain approval for a breaking change.
- The plan MUST NOT convert all behavior into configuration.
- The plan MUST NOT convert every seam into a framework.
- The plan MUST NOT add resilience mechanisms that obscure failure or make recovery harder to understand.
- The agent MUST follow existing repository conventions unless evidence shows that a convention conflicts with the stated goal, a public contract, or an observed material risk.
- The agent MUST NOT ask questions that documentation or repository evidence can answer.
- The agent MUST state every unresolved uncertainty and MUST define a verification path.
- The agent MUST NOT claim a test, command, migration, deployment, rollback, or runtime check passed during planning.

## Output Quality Bar

A compliant plan MUST be specific enough that another agent can implement it without repeating documentation discovery, target discovery, architecture analysis, or risk analysis.

The plan MUST name concrete files, functions, classes, packages, schemas, commands, tests, contracts, consumers, and runtime paths when they are available.

The plan MUST distinguish observed evidence, user decisions, recommendations, assumptions, and unresolved questions.

The plan MUST include verification and stop conditions for every phase, migration and rollback safety for every affected existing contract or data path, and measurable acceptance criteria.

The plan MUST improve modularity and robustness for the concrete target without spreading generic architecture rules across unrelated code.
