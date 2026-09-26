# QA Tests

Run from the package root:

    tooling/qa/run_all.sh

The runner rebuilds the clean deploy directory, checks JavaScript syntax, executes parser/writer and virtual-filesystem tests, audits production data, and runs the browser suites against both `src/taskmanager/` and `dist/`.

## Files

- `parser_writer.test.mjs` — generated-plan, todo, question, and targeted-write contracts.
- `filesystem.test.mjs` — discovery, text reads, copy-verify-delete, stale-source blocking, and existing-destination blocking through an in-memory filesystem adapter.
- `automation_assignments.test.py` — durable project/reviewer assignment leases, metadata stamping, expired assignment recovery, and orphaned in-progress reconciliation.
- `static_audit.py` — manifest, modules, service-worker paths, source-reference integrity, deploy-boundary, external-dependency, and zero-fixture checks.
- `browser_smoke.py` — all ten routes, settings persistence, tabs, responsive drawer, service worker, and offline reload.
- `browser_filesystem_e2e.py` — real browser FileSystemDirectoryHandle integration using the origin-private filesystem: connection, discovery, full-plan rendering, interactive question writes, conflict blocking, external-change detection, lifecycle transfer, lessons, observations, verification, instruction capture, project editing, and disconnect.

Browser tests require Playwright and a Chromium executable. The File System Access test uses origin-private filesystem handles, so it does not open an operating-system picker or touch user files.
