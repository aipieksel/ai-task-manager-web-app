# Project onboarding

Task Manager accepts both configured and unconfigured local software projects. An unconfigured folder is registered normally and receives a structured `setup-required` state instead of a generic scan error.

## Supported setup flow

Task Manager supports [Agent Workflow Kits](https://github.com/aipieksel/ai-agent-workflow-kits) `v1.0.0` as the setup authority. It does not download or execute the kit. After an explicit user action, the runtime writes a versioned bootstrap record and one agent-neutral instruction:

- `docs/tasks/.taskmanager-bootstrap.json`
- `docs/tasks/onboarding/install-agent-workflow-kits.md`

The setup entity is virtual and non-buildable. It appears once in the queue but cannot enter plan lifecycle automation, assignment, review, or user-verification records.

## Setup states

| State | Meaning |
| --- | --- |
| `setup-required` | No supported task contract or Task Manager bootstrap is present. |
| `setup-incomplete` | Bootstrap exists or generation started, but required markers are missing. |
| `conflict` | An owned bootstrap path is malformed or differs from its recorded hash. |
| `healthy` | The canonical `docs/tasks` contract or a compatible detected legacy root is valid. |
| `missing-root` | The registered filesystem root no longer exists. |

The canonical contract requires workflow, todo, planning, active lessons, lesson index, task-system config, and verification markers under `docs/tasks`. A bootstrap-only folder never passes this validator.

## Runtime safety

`POST /api/projects/bootstrap` has equivalent Python and Electron implementations. It accepts a dry run and expected setup revision, permits only the two fixed destinations, rejects project-root and symlink escapes, stages and verifies temporary files before atomic rename, compensates created files if a later write fails, and never overwrites conflicting content. An identical retry is idempotent.

The browser service generates deterministic instruction text, sends it to the local runtime, rescans after creation, and emits only relative-path activity records. The instruction pins the kit tag and commit, selects **All** in Documentation → Task → Verification order, requires preservation and validation, and prohibits commit/push.

## Public demonstration

`tooling/demo/create_populated_project.py` creates eight sanitized representative plans across draft, pending, approved, in-progress, review, and user-verification states in a caller-selected disposable directory. The fixture includes decisions, operational metadata, review states, and source-backed evidence so release screenshots demonstrate the working product rather than an empty shell. `tooling/demo/capture_populated_screenshots.py` captures queue, plan, decision, verification, project-health, setup, and mobile views after transient feedback has disappeared. Neither path is production source, and build/service-worker audits keep demo content out of `dist/` and runtime seeds.

## Queue presentation contract

The instruction queue progressively removes secondary columns before available width becomes unsafe. Wide views keep the full ledger; ordinary desktop views keep instruction, project, status, questions, and a dedicated action row; mobile views become identity-first cards with lifecycle status and actions. Task summaries remove Markdown chrome such as the `At a Glance` prefix, emphasis markers, links, and heading-only fragments before rendering in the ledger.

Release verification uses realistic long titles/project names and checks 1920, 1440, 1180, 900, and 390 pixel widths. Browser geometry assertions require every visible data cell and action area to remain within its row without intersecting adjacent cells.
