---
name: one-shot-documentation
description: "Deeply document a project under the fixed documentation root without asking for reconfirmation."
---

# One-Shot Documentation Skill

Use this skill after the documentation-system generator installs or updates the package, and whenever the user explicitly asks for a deep one-shot documentation pass.

## Authorization Rule

If invoked by the generator, authorization has already been granted. Do not ask whether to begin, whether to run one-shot, whether to scan deeply, or whether to update existing documentation. Start the work. Ask only for a genuinely missing fact that cannot be discovered safely and materially affects scope.

## Fixed Root

Write generated documentation under:

```text
documentation/
```

Do not use `docs/` as the active root. If `docs/` exists, inventory it as legacy or existing documentation and route/preserve useful content under the fixed `documentation` system without deleting the original unless the user explicitly approved migration.

## Mission

Create a source-backed, searchable documentation system that explains what the project is, how it is structured, which files own which behaviors, how to maintain it, and where future agents should look before changing behavior.

## Mandatory Workflow

1. Confirm project root, git state, and relevant instruction files.
2. Read `AGENTS.md` and any nearest nested instruction files.
3. Read package/build/config manifests.
4. Inventory source directories, tests, scripts, schemas, migrations, docs, and runtime entrypoints.
5. Inventory existing documentation including `docs/`, `documentation/`, README files, wiki/manual folders, generated reports, and task docs.
6. Build a source-context map before writing claims.
7. Classify docs as current, historical, planned, stale, duplicate, or unknown.
8. Create or update `documentation/0-index.md`.
9. Create or update `documentation/project-overview.md`.
10. Maintain source-context routing inside `documentation/0-index.md` and the relevant application docs; do not create a separate source-context-map file for this project.
11. Add or update keyword/source routes directly in `documentation/0-index.md`.
12. Create feature docs for user-visible workflows with source references.
13. Create architecture docs for modules, data flows, APIs, commands, and ownership boundaries.
14. Preserve legacy documentation context without silent deletion.
15. Add keyword routes for important project terms.
16. Validate links, routed source paths, the single index contract, and status labels.
17. Run available documentation/static checks when safe.
18. Write `documentation/reports/documentation/one-shot-documentation-report.md`.
19. Re-read every generated/updated doc before reporting success.

## Required Output Shape

Generated docs should use stable headings and render-friendly Markdown:

- one `#` title;
- a concise summary near the top;
- status label;
- source paths;
- maintenance notes;
- tables for route maps and file inventories;
- explicit gaps or blockers.

## Root Index Contract

`documentation/0-index.md` must include:

- project name;
- authority order;
- status legend;
- domain index table;
- quick keyword lookup;
- quick reference map;
- architecture vs feature guide;
- source context and provenance;
- documentation maintenance section;
- historical/preserved documentation section.

## Single Index Contract

This TaskManager documentation set intentionally does not use a separate JSON search index. `documentation/0-index.md` is the only routing/search index and must contain searchable keywords, primary documentation routes, source paths to inspect, supporting-document routes, status/provenance notes, and documentation maintenance guidance.

## Source Truth Contract

Do not write “implemented”, “supported”, “available”, “uses”, or “stores” unless source or runtime evidence proves it. When behavior is inferred, say `Inference:` and explain the basis.

## Preservation Contract

Do not delete existing docs. If restructuring is needed, create redirects or preserved notes. If a file is stale but historically useful, label it `Historical` and route it from the preserved documentation section.

## Final Response

Report:

```text
One-shot documentation completed.
Documentation root: documentation
Files created: <count>
Files updated: <count>
Files preserved: <count>
Legacy docs inventoried: <count>
Single routing index valid: yes/no
Root index valid: yes/no
Source coverage: <summary>
Blocked items: none | <list>
Report: documentation/reports/documentation/one-shot-documentation-report.md
```


## Evidence Ledger Requirements

Maintain a visible evidence ledger while documenting. The ledger should list every source directory, config file, build manifest, test folder, schema, runtime entrypoint, and existing documentation source inspected. For each row, record whether it produced a documentation route, was intentionally skipped as unrelated, was preserved as historical context, or was blocked by access/tooling. The final one-shot report must summarize this ledger so a reviewer can see that the documentation was source-led rather than invented.

## Project-Specific Completeness Rules

Do not stop after writing only a root index. A useful one-shot pass normally needs a project overview, source-context routes inside `documentation/0-index.md`, feature routes, and architecture/module notes for the most important implementation areas. Small projects may have compact files, but they still need source paths, status labels, index routes, and maintenance notes. Large projects should prefer multiple focused docs over one huge undifferentiated overview.

## Render Quality Rules

Write documentation as pages that can render cleanly in a task or documentation manager UI. Use concise summaries, stable section headings, route tables, source-path tables, status badges in text form, and explicit blockers. Avoid dumping raw scratch notes. If a table is long, add a short explanation before it so readers understand why it exists.

## Reviewer Readiness Rules

Before final response, verify that another agent could start from `documentation/0-index.md`, find the right document by keyword from the single routing index, reach the relevant source paths, understand current versus planned behavior, and know which workflow to run after future implementation changes. If that is not true, continue improving the indexes and routes before reporting completion.
