# Test suite

Project-onboarding coverage includes the pure instruction/virtual-task contract, Electron runtime bootstrap and classification attacks, and source/dist browser flows. `project_onboarding_e2e.py` exercises setup-required → create → simulated external kit output → check setup → healthy populated queue, reload, and mobile rendering. It also inspects realistic queue geometry at 1920, 1440, 1180, 900, and 390 pixel widths and fails if visible cells/actions overlap or escape row bounds. Demo screenshot tooling remains outside the production tree and is checked by static/public-release audits.

`npm test` runs the deploy build, JavaScript syntax checks, parser/writer contracts, Task Manager filesystem/runtime parity, automation tests, static production audit, identity/public-release audits, and source/dist browser smoke plus filesystem E2E checks.

Browser verification uses isolated Chromium by default. Required release coverage includes desktop/mobile layouts, all retained routes, queue/detail/questions/user-verification workflows, lifecycle writes, project/settings persistence, reload/reopen, service-worker offline behavior, console errors, and unexpected network requests.

Publication evidence additionally requires individual readable-zoom inspection. Screenshots containing transient toasts, raw Markdown chrome, contradictory scenario totals/gates, stale internal screenshot paths, empty evidence placeholders, or private machine paths are rejected even when route and geometry tests pass.

`tooling/qa/public_release_audit.py` is the publication boundary check. It rejects excluded product modules, private absolute paths, legacy app identity, live runtime/operational directories, secret-like values, and missing legal/community files.
