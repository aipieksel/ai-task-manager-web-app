---
name: update-documentation
description: "Update the fixed-root documentation system after source or behavior changes."
---

# Update Documentation Skill

Use this skill after implementation changes, configuration changes, workflow changes, release changes, or documentation-only corrections that affect the fixed documentation system.

## Fixed Root

The active documentation root is:

```text
documentation/
```

Do not route active documentation updates to `docs/` unless preserving legacy context or the user explicitly requested a separate migration.

## Trigger Gate

Run this workflow when changes affect:

- user-visible behavior;
- source architecture or module ownership;
- APIs, commands, hooks, jobs, extension messages, events, or integrations;
- data models, schemas, migrations, storage, import/export, caching, or retention;
- configuration, environment, build, release, packaging, or deployment behavior;
- verification, permissions, security, privacy, or error handling;
- docs indexes, search routes, task workflows, or agent instructions.

## Workflow

1. Read `documentation/AGENTS.md` and `documentation/0-index.md`.
2. Inspect the current git diff and changed files.
3. Classify documentation impact as required, not required, audit-only, or blocked.
4. Route through existing indexes before creating new files.
5. Update the smallest accurate set of docs.
6. Update source paths, status labels, keywords, and route entries in `documentation/0-index.md`.
7. Preserve old claims when useful but label stale/historical content honestly.
8. Validate links, routed source paths, and the single index contract.
9. Write an audit report under `documentation/reports/documentation/` when the update is non-trivial.
10. Re-read updated docs before reporting completion.

## Skip Rule

You may skip durable documentation edits only when existing docs remain accurate. Record the exact evidence, such as changed files inspected and relevant docs checked.

## Final Response

Report files updated, files checked but unchanged, `documentation/0-index.md` route updates, validation results, and any blocked or unverified items.


## Index-First Update Rule

Always route through `documentation/AGENTS.md` and `documentation/0-index.md` before editing a documentation page. If the correct destination is missing, update `documentation/0-index.md` as part of the same change. A documentation update that leaves a new or changed page unreachable from the single routing index is incomplete.

## Diff-Aware Maintenance Rule

When a git diff is available, list the changed paths and map each path to affected docs. When no diff is available, inspect the user request and relevant source files directly. In both cases, record why each changed path does or does not require documentation updates.

## Accuracy Over Volume

Prefer the smallest accurate documentation update. Do not rewrite broad pages just because a small section changed. Do not preserve stale claims for politeness; either update them, label them historical, or record a blocker explaining why the truth cannot be established.
