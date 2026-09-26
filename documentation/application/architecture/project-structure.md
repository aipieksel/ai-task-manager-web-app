# Project structure

- `src/taskmanager/` — production web/PWA source.
- `src/taskmanager/js/app/` — boot, routing, and composition.
- `src/taskmanager/js/features/` — Task Manager route modules.
- `src/taskmanager/js/domain/` — Markdown and task-record parsing/writing.
- `src/taskmanager/js/services/` — runtime/project orchestration.
- `src/taskmanager/js/state/` — state and runtime configuration.
- `src/taskmanager/js/ui/` — reusable shell and view helpers.
- `electron/` — isolated desktop wrapper and runtime.
- `tooling/` — build, local runtime, automation, and QA.
- `docs/tasks/` — reusable task lifecycle and schema contracts.
- `documentation/` — durable product and engineering documentation.
- `dist/` — generated web output; never edit by hand.

Production builds exclude tests, reference material, task histories, live runtime data, caches, and generated operational evidence.
