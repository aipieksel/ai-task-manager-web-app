# Browser Verification Policy

## Mode 1 — Automated Isolated Chromium / Playwright

Default for normal UI verification. Prefer Chrome for Testing over the system Chromium app. Each agent must use a unique `AGENT_ID`, unique temporary browser profile, and non-colliding port/session. Every launch requires a timeout and `try/finally` cleanup that closes all task-created pages, contexts, and browsers.

## Mode 2 — Headed Isolated Chromium

Use for visual/manual fallback when visible browser behavior matters but Atlas is not explicitly required. Open a dedicated Chromium session for the agent. Do not reuse another window or tab.

## Mode 3 — Atlas / Computer Use Restricted Special Case

Use only when the plan explicitly requires real ChatGPT Atlas behavior.

Rules:

- Target bundle id `com.openai.atlas`.
- Acquire `atlas-browser-lock` before touching Atlas.
- Heartbeat while using Atlas.
- Release the lock and close created windows/tabs when finished.
- Snapshot pre-existing Atlas windows/tabs before verification.
- Close every task-created tab/window in `finally`; never close a pre-existing user tab.
- If the task launched Atlas with no pre-existing window, quit Atlas gracefully.
- If the lock is held, continue non-Atlas work or block/wait.

## Chromium MCP Wrapper

Use:

```bash
scripts/mcp-browser-clean/mcp-chromium-agent-wrapper.sh --agent-id "$AGENT_ID"
```

The wrapper owns its profiles and locks under `$TMPDIR/mcp-chromium-agent`, refuses duplicate active agent IDs, launches isolated Chromium, and cleans only wrapper-owned paths.

## Dev Server Boundary

Browser verification cleanup is limited to browser tabs/windows/profiles and browser-wrapper artifacts. After browser/test cleanup, leave the project dev server running for user verification. Do not stop it as cleanup.

## Window Ownership

Agents must not reuse an existing user or agent browser window for verification. Isolated Chromium sessions are owned by the current agent ID. Atlas windows are owned only by the lock holder. After review and documentation are complete, close windows/tabs created for that verification pass.

System Chromium is a last resort. When used, pass `--disable-features=MacAppCodeSignClone`, use an isolated temporary profile, and close it before the task ends.

## Reviewer Enforcement

Reviewers check that the evidence label matches the tool actually used, that screenshots correspond to the same app state as accessibility/click evidence, and that no agent claimed Atlas verification from Playwright or isolated Chromium output.
