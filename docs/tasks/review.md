---
schema: verification-review-entrypoint/v1
project: aipieksel-task-tracker
generated: 2026-06-22
generator: generate-verification-system.prompt.md
ruleset: verification-system-v2-extracted-complete
---

# Verification Review

Independent technical verification review entrypoint. Read together with `docs/tasks/verification.md` and `docs/tasks/browser-verification-policy.md`.

## Review Report Contract

Every review records:
- task/plan identifier and fingerprint
- selected mode and exact tool/application target
- executor AGENT_ID/session/profile
- reviewer AGENT_ID/session/profile
- environment URL and auth role
- required row count, passed row count, blocked/failed/not-run row count
- evidence IDs/paths/tool-response references
- screenshot inspection notes
- fixture creation/cleanup
- console/network/runtime findings
- cleanup status
- exact blocker language
- technical verdict
- stale-evidence invalidation notes
- no false Atlas claim confirmation

## Allowed Technical Verdicts

- `Implementation Approved`
- `Implementation Rejected`
- `Implementation Review Blocked`
- `Final Closeout Approved`
- `Final Closeout Rejected`
- `Final Closeout Blocked`

## R1 Technical Review

1. Independently read the plan, implementation diff, task workflow, and this verification entrypoint.
2. Use a fresh agent context, unique AGENT_ID/profile/session (separate from executor).
3. Re-execute every required browser verification matrix row.
4. Verify evidence/session consistency: screenshots, accessibility output, clicks, URLs, auth state, and project must match.
5. Reject false mode labels and stale/fingerprint-mismatched evidence.
6. R1 technical approval requires ALL required current-fingerprint rows pass.
7. Do not mark executor-owned fields; executor cannot mark reviewer-owned fields.

## R2 Closeout Review

1. Verify that final documentation/closeout accurately reflects actual verification and unresolved limits.
2. Do not retroactively convert blocked technical evidence into pass.
3. R2 pass writes `FINAL CLOSEOUT REVIEW APPROVED` only when all required technical gates pass.

## Review Enforcement Checklist

- [ ] Did the executor use the correct verification mode?
- [ ] Did each agent use isolated browser state?
- [ ] Did Chromium MCP use a unique `--agent-id`?
- [ ] Did any agent falsely claim Atlas verification?
- [ ] If Atlas was required, was lock acquired/heartbeated/released?
- [ ] Did screenshots/accessibility/click evidence come from same browser/session/project?
- [ ] Were desktop and mobile viewport-by-viewport screenshots used?
- [ ] Were screenshots opened and inspected at readable zoom?
- [ ] Are all required matrix rows passed for the current fingerprint?
- [ ] Is cleanup status recorded?

## Stale Evidence Invalidation

Any implementation change after a technical verification pass invalidates affected evidence and reviewer approval. Return to affected verification step and rerun required rows against new fingerprint.

## R1 Technical Review — Detailed Process

1. **Pre-Review Setup**
   - Read the plan, implementation diff, task workflow, verification entrypoint, and this review entrypoint.
   - Confirm the plan is in `review/` lifecycle and has not been previously R1-approved for the current fingerprint.
   - Generate a unique reviewer `AGENT_ID` (separate from executor): `<plan-slug>-reviewer-<short-suffix>`.
   - Prepare an isolated browser profile/session using the reviewer's AGENT_ID.

2. **Evidence Consistency Verification**
   - Verify screenshots, accessibility output, clicks, URLs, auth state, and project all match the same session and plan.
   - Confirm every piece of browser evidence comes from the correct mode (Chromium MCP, Playwright, headed Chromium, or Atlas).
   - Reject any evidence where the mode label is false (e.g., Chromium screenshot labeled as Atlas).
   - Reject any evidence where the fingerprint does not match the current implementation state.

3. **Independent Retest**
   - Re-execute every required browser verification matrix row from scratch.
   - Use the reviewer's own isolated browser session/profile — never reuse the executor's session.
   - For each row, capture independent evidence and record pass/fail/blocked.
   - Reviewer evidence must come from the same mode required by the row.

4. **Mode Verification**
   - If the row requires isolated Chromium, verify the wrapper was invoked with a unique `--agent-id`.
   - If the row requires Playwright, verify a unique profile and noncolliding port were used.
   - If the row requires Atlas, verify the Atlas lock was acquired, heartbeated, and released, and that no concurrent Atlas use occurred.
   - Confirm no agent falsely claimed Atlas verification.

5. **Screenshot Inspection**
   - Open each proof screenshot individually at readable zoom.
   - Verify desktop and mobile viewport-by-viewport coverage for long pages.
   - Confirm before/after pairs were explicitly compared when applicable.

6. **Cleanup Verification**
   - Confirm browser cleanup status is recorded: `closed`, `not created`, or `blocked — <reason>`.
   - Confirm Chromium/Playwright cleanup was profile-scoped (no global browser process kills).

7. **Verdict**
   - `Implementation Approved`: ALL required current-fingerprint rows pass.
   - `Implementation Rejected`: one or more required rows fail and cannot be resolved without implementation changes.
   - `Implementation Review Blocked`: external dependency prevents completion (e.g., Atlas lock held, environment unavailable).

## R2 Closeout Review — Detailed Process

1. Verify that final documentation/closeout accurately reflects actual verification results.
2. Confirm no blocked technical evidence was retroactively converted into a pass.
3. Verify all required verification status labels are exact and qualified.
4. Confirm the untested reconciliation gate was completed with `Final Not Tested: none` or legitimate external blockers.
5. Verify the no-waiver contract was honored: no missing verification was waived into `Complete`.
6. R2 pass writes `FINAL CLOSEOUT REVIEW APPROVED` only when all required technical and lifecycle gates pass.

## Browser Session Verification Checklist

Reviewers must additionally verify:

- [ ] Executor and reviewer used separate AGENT_IDs, profiles, and sessions.
- [ ] No browser session was reused from a prior agent or user.
- [ ] Chromium MCP sessions used the wrapper with a unique `--agent-id`.
- [ ] Playwright/headed Chromium sessions used unique profiles and noncolliding ports.
- [ ] No agent navigated, closed, or altered unrelated browser sessions.
- [ ] Task-created tabs/windows were confined to the dedicated session.
- [ ] Cleanup was profile-scoped; no global Chromium/Playwright/browser process kills occurred.
- [ ] Atlas actions (if any) occurred under the global Atlas lock with proper acquire/heartbeat/release.

## Exact Blocker Reporting

When verification is blocked, report:

```text
BLOCKED — <exact reason>
Affected rows: <BV-IDs>
Attempted approaches: <list>
What remains unverified: <specific items>
```

Do not hide a blocker in observations or documentation. Do not use unqualified completion language while blocked.
