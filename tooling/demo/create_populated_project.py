#!/usr/bin/env python3
"""Create deterministic, sanitized TaskManager screenshot data outside production output."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


TODO = """# Launchpad Commerce — Active Tasks

## Active

Active work is represented by the plan folders in this deterministic public demonstration.
"""


TASKS = [
    {
        "id": "00007", "slug": "checkout-recovery", "title": "Build accessible checkout recovery flow",
        "lifecycle": "in-progress", "status": "In Progress", "risk": "Medium", "score": "9.2/10",
        "summary": "Preserve the cart after a payment failure and present clear retry and alternate-payment actions.",
        "decision": "Keep the cart and present retry plus alternate-payment actions", "answer": True,
        "checks": (True, True, False), "planning": "Execution active", "execution": "Browser verification in progress",
    },
    {
        "id": "00008", "slug": "order-notifications", "title": "Add order-status notification preferences",
        "lifecycle": "pending", "status": "Pending", "risk": "Low", "score": "8.8/10",
        "summary": "Let shoppers choose email or SMS updates for each order without changing account-wide defaults.",
        "decision": "Offer email and SMS with email selected by default", "answer": False,
        "checks": (True, False, False), "planning": "Awaiting product decision", "execution": "Not started",
    },
    {
        "id": "00009", "slug": "mobile-cart-performance", "title": "Verify mobile cart performance budget",
        "lifecycle": "review", "status": "Review", "risk": "Medium", "score": "9.0/10",
        "summary": "Keep cart quantity updates responsive under realistic mobile CPU and network conditions.",
        "decision": "Use the p75 mobile interaction budget as the release gate", "answer": True,
        "checks": (True, True, True), "planning": "Review ready", "execution": "Implementation complete",
    },
    {
        "id": "00010", "slug": "release-verification", "title": "Approve checkout recovery release evidence",
        "lifecycle": "user-verification", "status": "User Verification", "risk": "Low", "score": "9.5/10",
        "summary": "Confirm automated, accessibility, and responsive evidence before the checkout recovery release is accepted.",
        "decision": "Require automated and visual evidence before acceptance", "answer": True,
        "checks": (True, True, True), "planning": "User verification", "execution": "Verified and handed off",
    },
    {
        "id": "00011", "slug": "inventory-reservations", "title": "Handle expiring inventory reservations",
        "lifecycle": "approved", "status": "Approved", "risk": "High", "score": "9.1/10",
        "summary": "Warn shoppers before a limited-stock reservation expires and preserve a clear recovery path.",
        "decision": "Show a two-minute warning with a one-click reservation refresh", "answer": True,
        "checks": (True, False, False), "planning": "Approved for execution", "execution": "Queued for agent",
    },
    {
        "id": "00012", "slug": "returns-triage", "title": "Design self-service returns triage",
        "lifecycle": "draft", "status": "Draft", "risk": "Medium", "score": "8.6/10",
        "summary": "Route return requests by eligibility, reason, and fulfillment state while keeping policy decisions reviewable.",
        "decision": "Start with eligibility and fulfillment checks before asking for a reason", "answer": False,
        "checks": (False, False, False), "planning": "Questions open", "execution": "Not started",
    },
    {
        "id": "00013", "slug": "address-validation", "title": "Add international address validation recovery",
        "lifecycle": "in-progress", "status": "In Progress", "risk": "Medium", "score": "9.0/10",
        "summary": "Explain address corrections without blocking customers who need to preserve a valid local format.",
        "decision": "Suggest corrections while allowing an explicit keep-original action", "answer": True,
        "checks": (True, True, False), "planning": "Execution active", "execution": "Implementation in progress",
    },
    {
        "id": "00014", "slug": "fraud-review-handoff", "title": "Clarify payment review handoff states",
        "lifecycle": "pending", "status": "Pending", "risk": "High", "score": "8.9/10",
        "summary": "Give support teams a consistent timeline when an order moves into manual payment review.",
        "decision": "Show customer-safe milestones without exposing fraud rules", "answer": True,
        "checks": (True, False, False), "planning": "Ready for approval", "execution": "Not started",
    },
]


def checked(value: bool) -> str:
    return "x" if value else " "


def write_plan(tasks: Path, spec: dict) -> None:
    folder = tasks / "planning" / spec["lifecycle"] / f'{spec["id"]}-{spec["slug"]}'
    folder.mkdir(parents=True, exist_ok=True)
    sections = [
        (1, "01-original-scope.md", "Original Scope", "Scope", "article"),
        (2, "02-planning-and-decisions.md", "Planning and Decisions", "Decisions", "decision-log"),
        (3, "03-implementation-checklist.md", "Implementation Checklist", "Implementation", "checklist"),
        (4, "04-testing-checklist.md", "Testing Checklist", "Testing", "checklist"),
        (7, "07-executor-evidence.md", "Executor Evidence", "Evidence", "evidence"),
        (9, "09-r1-review.md", "R1 Review", "Review", "review"),
        (12, "12-comments.md", "Comments", "Comments", "comments"),
    ]
    manifest = {
        "schema": "task-plan-folder/v1", "planId": spec["id"], "folderName": folder.name,
        "title": spec["title"], "lifecycle": spec["lifecycle"], "status": spec["status"],
        "riskLevel": spec["risk"], "planScore": spec["score"], "planningState": spec["planning"],
        "executionState": spec["execution"], "userVerificationOutcome": "Awaiting user" if spec["lifecycle"] == "user-verification" else "Not required yet",
        "reviewerSeal": "R1 implementation approved" if spec["lifecycle"] in {"review", "user-verification"} else "Review not started",
        "r1ImplementationApproval": "Approved" if spec["lifecycle"] in {"review", "user-verification"} else "Pending",
        "created": "2026-08-01", "updated": "2026-08-13",
        "automation": {
            "claimed": spec["lifecycle"] == "in-progress", "assignmentId": f'launchpad-{spec["id"]}',
            "agentRole": "build-agent", "agentNickname": "Launchpad build agent",
            "lastHeartbeatAt": "2026-08-13T00:32:00Z", "state": spec["execution"],
        },
        "sections": [
            {"order": order, "file": filename, "sectionId": filename.removesuffix(".md"), "title": title, "navLabel": nav, "layout": layout, "appendOnly": filename == "12-comments.md"}
            for order, filename, title, nav, layout in sections
        ],
    }
    (folder / "plan.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (folder / "01-original-scope.md").write_text(f"""# Original Scope

## Outcome

{spec['summary']}

## Success measure

The customer can understand the current state, recover without losing entered information, and complete the flow with keyboard and mobile access.
""")
    answer = spec["decision"] if spec["answer"] else "pending"
    source = "Product decision" if spec["answer"] else "pending"
    (folder / "02-planning-and-decisions.md").write_text(f"""# Planning and Decisions

## Question History / Decision Log

- [{checked(spec['answer'])}] **Q1: Which customer experience should ship?**
  - Decision: Recovery interaction
  - Why this matters: It changes customer trust, state preservation, and verification coverage.
  - Options:
    - (a) {spec['decision']} *(recommended)*
    - (b) Show a generic error and restart the flow
    - (c) Return the shopper to the catalog
  - Agent recommendation: (a) — It preserves intent while keeping the next action clear.
  - Answer: {answer}
  - Answer source: {source}
""")
    a, b, c = spec["checks"]
    (folder / "03-implementation-checklist.md").write_text(f"""# Implementation Checklist

- [{checked(a)}] Define the customer-facing state contract and recovery copy.
- [{checked(b)}] Implement the responsive interaction and keyboard behavior.
- [{checked(c)}] Complete review feedback and prepare the release handoff.
""")
    (folder / "04-testing-checklist.md").write_text(f"""# Testing Checklist

## Verification Plan — BLOCKING

- [{checked(a)}] Verify the primary flow with contract tests.
- [{checked(b)}] Inspect desktop and 390-pixel mobile layouts in isolated Chromium.
- [{checked(c)}] Capture accessibility, console, network, and reload evidence.
""")
    (folder / "07-executor-evidence.md").write_text(f"""# Executor Evidence

## Evidence summary

| Check | Evidence | Result |
| --- | --- | --- |
| Contract | Automated state-transition suite | {'PASS' if a else 'QUEUED'} |
| Responsive | Desktop and mobile browser run | {'PASS' if b else 'QUEUED'} |
| Release | Reload, console, and network inspection | {'PASS' if c else 'QUEUED'} |
""")
    (folder / "09-r1-review.md").write_text(f"""# R1 Review

## Status

{'Implementation Approved' if spec['lifecycle'] in {'review', 'user-verification'} else 'Review pending after implementation.'}
""")
    (folder / "12-comments.md").write_text(f"""# Comments

## 2026-08-13 — Agent update

- Reply: {spec['execution']}. The current evidence remains source-backed and ready for the next lifecycle gate.
""")


def create(root: Path) -> None:
    tasks = root / "docs/tasks"
    for lifecycle in ["draft", "pending", "approved", "in-progress", "review", "user-verification", "failed-user-verification", "completed", "archive", "parked", "blocker"]:
        (tasks / "planning" / lifecycle).mkdir(parents=True, exist_ok=True)
    (tasks / "workflow.md").write_text("# Launchpad Commerce Task Workflow\n\nPlan → approve → build → review → verify.\n")
    (tasks / "todo.md").write_text(TODO)
    (tasks / "lessons-active.md").write_text("# Active Lessons\n\n- Verify the real mobile recovery path before release.\n- Keep row actions in a stable responsive layout area.\n")
    (tasks / "lessons-index.json").write_text(json.dumps({"version": 1, "entries": []}, indent=2) + "\n")
    (tasks / "task-system.config.yaml").write_text("schema: codex-task-system-config/v1\nversion: 1\n")
    (tasks / "verification.md").write_text("# Verification\n\nUse isolated Chromium for customer-facing flows and retain curated proof screenshots.\n")
    for spec in TASKS:
        write_plan(tasks, spec)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    create(args.output.resolve())
    print(args.output.resolve())
