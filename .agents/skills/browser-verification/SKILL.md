---
name: browser-verification
description: "Run Agent browser verification with isolated Chromium by default and Atlas only behind a lock."
---

# Browser Verification Skill

Use a connected Browser/Chrome tool or isolated Playwright Chrome for Testing by default. Use system Chromium only as a last resort with `--disable-features=MacAppCodeSignClone`. Use Atlas / Computer Use only when explicitly required by the approved plan or user.

## Mandatory Browser Lifecycle

Every browser run must have a timeout and `try/finally` cleanup. Close all pages, contexts, browsers, windows, and tabs created by the task even after failure or interruption. Use a unique temporary profile; never share a persistent profile between agents or tasks.


## Coordination With Task Workflow

This skill owns browser and visual verification policy only. Task scope, lifecycle movement, review approval, commit decisions, and user-verification handoff remain owned by the task-system skills.

When a task plan or review requires browser evidence, use this skill's browser mode, lock, dev-server, and screenshot rules. Store proof in the relevant task plan's `evidence/proof-screenshots/` folder and report the evidence path back to the task plan files.

## Default Chromium MCP Command

```bash
scripts/mcp-browser-clean/mcp-chromium-agent-wrapper.sh --agent-id "$AGENT_ID"
```

## Atlas Lock Rule

Before using `com.openai.atlas`, acquire `docs/tasks/automation/browser-locks/atlas-browser-lock.json`, heartbeat it, and release it in `finally`. Snapshot pre-existing Atlas windows/tabs before opening anything. Close every task-created tab/window before releasing the lock and never close a pre-existing user tab. If the task launched Atlas with no pre-existing window, quit Atlas gracefully. Never let two agents use Atlas concurrently.

## Dev Server Boundary

Do not stop, kill, restart, or send SIGINT/SIGTERM to any project dev server as browser cleanup, including a temporary server started by the same task/agent. Close browser tabs/windows/profiles only. If you start a temporary dev server, record PID/port/command and leave it running unless the user explicitly tells you to stop that process.

## Screenshot Rule

Store only proof screenshots in `docs/tasks/planning/<lifecycle>/<plan-folder>/evidence/proof-screenshots/`. For long pages, capture desktop viewport sections and mobile viewport sections separately, inspect each image at readable zoom, and document findings.
- Do not use the global `docs/tasks/verification-evidence` path; each task owns its own evidence folder.
