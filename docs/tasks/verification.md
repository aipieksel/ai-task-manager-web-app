# Verification System

This is the canonical verification entrypoint for Agent tasks in this project. The default lane is isolated Chromium or Playwright. Atlas / Computer Use is restricted to tasks that explicitly require real Atlas behavior.

All browser launches require a bounded timeout and guaranteed `try/finally` cleanup. Close all task-created pages, contexts, tabs, windows, and browser processes. Prefer Chrome for Testing; system Chromium is last resort and requires `--disable-features=MacAppCodeSignClone`.

## Required Evidence Labels

- `Playwright` for Playwright checks.
- `isolated Chromium` or `Chromium MCP` for isolated Chromium checks.
- `headed isolated Chromium` for headed Chromium fallback.
- `Atlas` only when ChatGPT Atlas was actually used while holding the Atlas lock.

Do not claim Atlas verification unless real Atlas was used.

## Dev Server Boundary

The project dev server is not part of browser cleanup. After browser/test cleanup, leave the project dev server running for user verification. Do not stop it as cleanup.

## Evidence Storage

Proof screenshots belong under the task plan folder: `docs/tasks/planning/<lifecycle>/<plan-folder>/evidence/proof-screenshots/`. Only save screenshots needed as proof. Do not dump exploratory screenshots there.

## Visual Pass Method

For long pages, do not use one full-page screenshot as the only visual proof. Use normal desktop viewport screenshots, scroll section by section, inspect each image at readable zoom, then repeat for mobile viewport when mobile layout matters.

Do not create or use a global `docs/tasks/verification-evidence` folder. Evidence belongs to the relevant plan folder so it moves with the task lifecycle.
