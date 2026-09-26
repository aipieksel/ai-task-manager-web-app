#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import contextlib
import io
import json
import sys
import time
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
SPEC = importlib.util.spec_from_file_location("automation_assignments", ROOT / "scripts" / "automation_assignments.py")
automation_assignments = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(automation_assignments)
REGISTRY_SPEC = importlib.util.spec_from_file_location("taskmanager_registry", ROOT / "scripts" / "taskmanager_registry.py")
taskmanager_registry = importlib.util.module_from_spec(REGISTRY_SPEC)
assert REGISTRY_SPEC and REGISTRY_SPEC.loader
REGISTRY_SPEC.loader.exec_module(taskmanager_registry)


def run_cli(args):
    with contextlib.redirect_stdout(io.StringIO()):
        automation_assignments.main(args)


class AutomationAssignmentsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.registry = self.root / "automation-assignments.json"
        self.project = self.root / "project"
        self.task_root = self.project / "docs" / "task"
        for folder in [
            "planning/pending",
            "planning/approved",
            "planning/review",
            "planning/user-verification",
            "planning/failed-user-verification",
            "planning/in-progress",
        ]:
            (self.task_root / folder).mkdir(parents=True, exist_ok=True)
        self.projects_json = self.root / "projects.json"
        self.projects_json.write_text(json.dumps({
            "version": 1,
            "projects": [{
                "id": "p1",
                "name": "Project One",
                "rootLabel": str(self.project),
                "explicitTaskPath": "docs/task",
            }],
        }))
        (self.task_root / "todo.md").write_text("# Project One Tasks\n\n## Active\n")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_plan(self, relative: str, body: str) -> Path:
        path = self.task_root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body)
        return path

    def write_plan_folder(self, relative: str, status: str = "Pending", lifecycle: str = "pending") -> Path:
        folder = self.task_root / relative
        folder.mkdir(parents=True, exist_ok=True)
        manifest = {
            "schema": "task-plan-folder/v1",
            "planId": "00001",
            "title": "Folder Auto",
            "status": status,
            "lifecycle": lifecycle,
            "folderName": folder.name,
            "sections": [
                {"order": 1, "file": "01-original-scope.md", "sectionId": "01-original-scope", "title": "Original Scope"},
                {"order": 12, "file": "12-comments.md", "sectionId": "12-comments", "title": "Comments", "appendOnly": True},
            ],
        }
        (folder / "plan.json").write_text(json.dumps(manifest, indent=2) + "\n")
        (folder / "01-original-scope.md").write_text("---\nstatus: Pending\nlifecycle: pending\n---\n# Original Scope\n")
        (folder / "12-comments.md").write_text("# Comments\n")
        return folder

    def write_todo(self, body: str) -> Path:
        path = self.task_root / "todo.md"
        path.write_text(body)
        return path


    def write_ui_config(self, custom_order: dict) -> Path:
        ui = self.root / "ui.json"
        ui.write_text(json.dumps({
            "version": 1,
            "settings": {},
            "routes": {"queue": {"customOrder": custom_order}, "tasks": {}},
        }))
        return ui

    def test_claim_heartbeat_finish_and_plan_stamp(self) -> None:
        plan = self.write_plan("planning/approved/a.md", "# A\n\n> **Status:** Approved\n\nBody\n")
        args = [
            "--registry", str(self.registry),
            "claim",
            "--project-id", "p1",
            "--project-name", "Project One",
            "--project-root", str(self.project),
            "--task-root", str(self.task_root),
            "--plan-path", str(plan),
            "--role", "project-agent",
            "--agent-id", "agent-1",
            "--agent-nickname", "Ada",
            "--reason", "approved_execution",
            "--lease-minutes", "15",
            "--stamp-plan",
        ]
        run_cli(args)
        registry = automation_assignments.load_registry(self.registry)
        self.assertEqual(len(registry["assignments"]), 1)
        entry = registry["assignments"][0]
        self.assertEqual(entry["agentId"], "agent-1")
        self.assertIn("> **Automation Claimed:** true", plan.read_text())
        self.assertIn(entry["id"], plan.read_text())

        run_cli([
            "--registry", str(self.registry),
            "heartbeat",
            "--assignment-id", entry["id"],
            "--lease-minutes", "20",
            "--stamp-plan",
        ])
        refreshed = automation_assignments.load_registry(self.registry)["assignments"][0]
        self.assertEqual(refreshed["state"], "running")
        self.assertNotEqual(refreshed["leaseExpiresAt"], entry["leaseExpiresAt"])

        run_cli([
            "--registry", str(self.registry),
            "finish",
            "--assignment-id", entry["id"],
            "--state", "completed",
            "--clear-plan-stamp",
            "--leave-completion-marker",
        ])
        completed = automation_assignments.load_registry(self.registry)["assignments"][0]
        self.assertEqual(completed["state"], "completed")
        self.assertIn("> **Automation Claimed:** false", plan.read_text())

    def test_assignment_operator_actions_include_reclaim_semantics(self) -> None:
        assignment = {
            "id": "a1",
            "state": "expired",
            "lastHeartbeatAt": "2026-06-23T00:00:00Z",
            "leaseExpiresAt": "2026-06-23T00:30:00Z",
            "notes": "old",
        }
        previous, next_state, should_save = automation_assignments.apply_assignment_operator_action(
            assignment,
            "reclaim-orphan",
            "operator reclaimed orphan",
            "2026-06-23T06:40:00Z",
        )
        self.assertTrue(should_save)
        self.assertEqual(previous["state"], "expired")
        self.assertEqual(next_state["state"], "released")
        self.assertEqual(next_state["reclaimSemantics"], "released_for_reclaim")
        self.assertEqual(assignment["leaseExpiresAt"], "2026-06-23T06:40:00Z")
        self.assertTrue(automation_assignments.is_terminal_assignment(assignment))

        previous, next_state, should_save = automation_assignments.apply_assignment_operator_action(
            assignment,
            "cancel-assignment",
            "operator cancelled assignment",
            "2026-06-23T06:41:00Z",
        )
        self.assertTrue(should_save)
        self.assertEqual(previous["state"], "released")
        self.assertEqual(next_state["state"], "cancelled")
        self.assertNotIn("reclaimSemantics", assignment)

        previous, next_state, should_save = automation_assignments.apply_assignment_operator_action(
            assignment,
            "nudge-agent",
            "operator nudge",
            "2026-06-23T06:42:00Z",
        )
        self.assertFalse(should_save)
        self.assertEqual(previous, next_state)
        self.assertEqual(assignment["state"], "cancelled")

    def test_reconcile_classifies_unassigned_and_assigned_work(self) -> None:
        approved = self.write_plan("planning/approved/approved.md", "# Approved\n> **Status:** Approved\n")
        review = self.write_plan("planning/review/review.md", "# Review\n> **Status:** Review\n")
        review_rejected = self.write_plan(
            "planning/review/review-rejected.md",
            "# Review Rejected\n> **Status:** Review\n\n"
            "- R1 Implementation Review: Rejected — see review report.\n\n"
            "### Required correction before next R1\n",
        )
        self.write_plan("planning/user-verification/comment.md", "# Comment\n> **Status:** Sent to Agent\n")
        self.write_plan("planning/user-verification/waiting.md", "# Waiting\n> **Status:** User Verification\n")
        self.write_plan("planning/failed-user-verification/feedback.md", "# Feedback\n> **Status:** User Replied\n")
        self.write_plan("planning/in-progress/rejected.md", "# Rejected\n> **Status:** In Progress\n> **Review Status:** Rejected\n")
        self.write_plan(
            "planning/in-progress/r1-rejected.md",
            "# R1 Rejected\n> **Status:** In Progress\n\n"
            "- R1 Implementation Review: Rejected — see review report.\n\n"
            "### Required correction before next R1\n",
        )
        self.write_plan("planning/in-progress/legacy.md", "# Legacy\n> **Status:** In Progress\n")
        orphan = self.write_plan(
            "planning/in-progress/orphan.md",
            "# Orphan\n> **Status:** In Progress\n> **Automation Claimed:** true\n",
        )

        # Active assignment suppresses duplicate delegation for the approved plan.
        run_cli([
            "--registry", str(self.registry),
            "claim",
            "--project-id", "p1",
            "--project-name", "Project One",
            "--project-root", str(self.project),
            "--task-root", str(self.task_root),
            "--plan-path", str(approved),
            "--role", "project-agent",
            "--agent-id", "agent-1",
            "--reason", "approved_execution",
        ])

        result = automation_assignments.reconcile(self.projects_json, self.registry)
        reasons = {item["planBasename"]: item["reason"] for item in result["eligibleWork"]}
        self.assertEqual(reasons["approved.md"], "approved_execution")
        self.assertEqual(reasons["review.md"], "independent_review")
        self.assertEqual(reasons["review-rejected.md"], "reviewer_rejected_correction")
        self.assertEqual(reasons["comment.md"], "user_verification_sent_to_agent")
        self.assertEqual(reasons["feedback.md"], "user_replied_correction")
        self.assertEqual(reasons["rejected.md"], "reviewer_rejected_correction")
        self.assertEqual(reasons["r1-rejected.md"], "reviewer_rejected_correction")
        self.assertEqual(reasons["orphan.md"], "automation_claimed_orphaned_in_progress")
        self.assertNotIn("legacy.md", reasons)
        self.assertNotIn("waiting.md", reasons)
        assigned = {item["planBasename"]: item["assigned"] for item in result["eligibleWork"]}
        roles = {item["planBasename"]: item["role"] for item in result["eligibleWork"]}
        self.assertTrue(assigned["approved.md"])
        self.assertFalse(assigned["review.md"])
        self.assertFalse(assigned[orphan.name])
        self.assertEqual(roles[review.name], "reviewer-agent")
        self.assertEqual(roles[review_rejected.name], "project-agent")

    def test_corrected_review_folder_with_historic_rejection_routes_to_reviewer(self) -> None:
        corrected = self.write_plan_folder("planning/review/corrected-review", status="Review", lifecycle="review")
        (corrected / "08-testing-and-verification.md").write_text(
            "# Testing\n\n"
            "Technical verdict: Implementation Rejected.\n\n"
            "### Required correction before next R1\n\n"
            "## R1 correction verification — 2026-06-23\n\n"
            "R1 correction implemented; executor verification complete; awaiting fresh independent R1 review.\n"
        )
        result = automation_assignments.reconcile(self.projects_json, self.registry)
        item = next(item for item in result["eligibleWork"] if item["planBasename"] == corrected.name)
        self.assertEqual(item["role"], "reviewer-agent")
        self.assertEqual(item["reason"], "independent_review")

    def test_live_checklist_counts_ignore_executor_results_and_stale_rejection(self) -> None:
        checked, total = automation_assignments.live_checklist_counts(
            "# Implementation\n\n"
            "- [ ] Implement canonical resolver.\n"
            "- [x] Update UI diagnostics.\n\n"
            "## Executor implementation results — 2026-06-23\n\n"
            "- [x] Added canonical resolver.\n"
            "- [x] Updated UI diagnostics.\n\n"
            "## R1 rejection route — 2026-06-23\n\n"
            "- [ ] R1 Implementation Approved — NOT APPROVED; stale historical result.\n\n"
            "## Fresh R1 approval and user-verification routing — 2026-06-23\n\n"
            "- [x] R1 Implementation Approved — fresh approval.\n"
        )
        self.assertEqual((checked, total), (2, 3))

    def test_review_readiness_blocks_unsynced_original_checklist(self) -> None:
        plan = self.write_plan_folder("planning/review/unsynced-checklist", status="Review", lifecycle="review")
        (plan / "evidence" / "screenshots").mkdir(parents=True)
        (plan / "evidence" / "screenshots" / "proof.png").write_text("proof")
        (plan / "06-implementation-plan.md").write_text(
            "# Implementation Plan\n\n"
            "- [ ] Implement canonical resolver.\n"
            "- [ ] Update UI diagnostics.\n\n"
            "## Executor implementation results — 2026-06-23\n\n"
            "- [x] Added canonical resolver.\n"
            "- [x] Updated UI diagnostics.\n"
        )
        (plan / "08-testing-and-verification.md").write_text(
            "# Testing and Verification\n\n"
            "- [x] npm test.\n\n"
            "Executor verification: PASS\n"
        )
        ready, missing = automation_assignments.review_ready(plan, "")
        self.assertFalse(ready)
        self.assertIn("06-implementation-plan.md live checklist incomplete (0/2)", missing)

    def test_reconcile_auto_approves_pending_for_enabled_project(self) -> None:
        pending = self.write_plan(
            "planning/pending/auto.md",
            "# Auto\n\n> **Status:** Pending\n\nReady for automatic approval.\n",
        )
        self.write_todo(
            "# Project One Tasks\n\n## Active\n\n"
            "- [ ] **Auto**\n"
            "  - Type: `Task`\n"
            "  - Status: `Pending`\n"
            "  - Plan: `docs/task/planning/pending/auto.md`\n"
            "  - Scope: Ready for automatic approval.\n",
        )
        self.projects_json.write_text(json.dumps({
            "version": 1,
            "projects": [{
                "id": "p1",
                "name": "Project One",
                "rootLabel": str(self.project),
                "explicitTaskPath": "docs/task",
                "autoApprovePending": True,
            }],
        }))

        result = automation_assignments.reconcile(self.projects_json, self.registry)
        approved = self.task_root / "planning/approved/auto.md"

        self.assertFalse(pending.exists())
        self.assertTrue(approved.exists())
        self.assertIn("> **Status:** Approved", approved.read_text())
        self.assertEqual(result["autoApprovedWork"][0]["planBasename"], "auto.md")
        self.assertTrue(result["autoApprovedWork"][0]["ok"])
        reasons = {item["planBasename"]: item["reason"] for item in result["eligibleWork"]}
        self.assertEqual(reasons["auto.md"], "approved_execution")
        todo = (self.task_root / "todo.md").read_text()
        self.assertIn("Status: `Approved`", todo)
        self.assertIn("Plan: `docs/task/planning/approved/auto.md`", todo)

    def test_reconcile_auto_approves_pending_plan_folder_for_enabled_project(self) -> None:
        pending = self.write_plan_folder("planning/pending/00001-2026-06-22-folder-auto")
        self.write_todo(
            "# Project One Tasks\n\n## Active\n\n"
            "| ID | Title | Status | Plan | Owner | Updated | Scope |\n"
            "| --- | --- | --- | --- | --- | --- | --- |\n"
            f"| TASK-00001 | Folder Auto | Pending | [plan](docs/task/planning/pending/{pending.name}) | Codex | 2026-06-22 | Ready. |\n",
        )
        self.projects_json.write_text(json.dumps({
            "version": 1,
            "projects": [{
                "id": "p1",
                "name": "Project One",
                "rootLabel": str(self.project),
                "explicitTaskPath": "docs/task",
                "autoApprovePending": True,
            }],
        }))

        result = automation_assignments.reconcile(self.projects_json, self.registry)
        approved = self.task_root / "planning" / "approved" / pending.name

        self.assertFalse(pending.exists())
        self.assertTrue((approved / "plan.json").exists())
        manifest = json.loads((approved / "plan.json").read_text())
        self.assertEqual(manifest["status"], "Approved")
        self.assertEqual(manifest["lifecycle"], "approved")
        self.assertEqual(result["autoApprovedWork"][0]["planBasename"], pending.name)
        self.assertTrue(result["autoApprovedWork"][0]["ok"])
        reasons = {item["planBasename"]: item["reason"] for item in result["eligibleWork"]}
        self.assertEqual(reasons[pending.name], "approved_execution")
        todo = (self.task_root / "todo.md").read_text()
        self.assertIn("Approved", todo)
        self.assertIn(f"docs/task/planning/approved/{pending.name}", todo)

    def test_reconcile_leaves_pending_when_auto_approve_disabled(self) -> None:
        pending = self.write_plan(
            "planning/pending/manual.md",
            "# Manual\n\n> **Status:** Pending\n\nRequires manual approval.\n",
        )

        result = automation_assignments.reconcile(self.projects_json, self.registry)

        self.assertTrue(pending.exists())
        self.assertEqual(result["autoApprovedWork"], [])
        self.assertNotIn("manual.md", {item["planBasename"] for item in result["eligibleWork"]})

    def test_reconcile_reports_parked_and_blocker_as_non_eligible(self) -> None:
        parked = self.write_plan_folder("planning/parked/00002-parked", status="Parked", lifecycle="parked")
        blocker = self.write_plan("planning/blocker/blocked.md", "# Blocked\n> **Status:** Blocked\n")

        result = automation_assignments.reconcile(self.projects_json, self.registry)

        reasons = {item["planBasename"]: item["reason"] for item in result["nonEligibleWork"]}
        self.assertEqual(reasons[parked.name], "parked_non_buildable")
        self.assertEqual(reasons[blocker.name], "blocker_non_buildable")
        self.assertNotIn(parked.name, {item["planBasename"] for item in result["eligibleWork"]})
        self.assertNotIn(blocker.name, {item["planBasename"] for item in result["eligibleWork"]})

    def test_reconcile_orders_work_by_file_creation_time(self) -> None:
        older = self.write_plan("planning/approved/01-older.md", "# Older\n> **Status:** Approved\n")
        time.sleep(0.05)
        newer = self.write_plan("planning/approved/02-newer.md", "# Newer\n> **Status:** Approved\n")

        result = automation_assignments.reconcile(self.projects_json, self.registry)

        names = [item["planBasename"] for item in result["unassignedWork"]]
        self.assertEqual(names[:2], [older.name, newer.name])
        self.assertLessEqual(
            result["unassignedWork"][0]["createdAtMs"],
            result["unassignedWork"][1]["createdAtMs"],
        )

    def test_auto_approval_preserves_creation_priority_order(self) -> None:
        older = self.write_plan("planning/pending/01-older.md", "# Older\n> **Status:** Pending\n")
        time.sleep(0.05)
        newer = self.write_plan("planning/pending/02-newer.md", "# Newer\n> **Status:** Pending\n")
        self.projects_json.write_text(json.dumps({
            "version": 1,
            "projects": [{
                "id": "p1",
                "name": "Project One",
                "rootLabel": str(self.project),
                "explicitTaskPath": "docs/task",
                "autoApprovePending": True,
            }],
        }))

        result = automation_assignments.reconcile(self.projects_json, self.registry)

        self.assertEqual(
            [item["planBasename"] for item in result["autoApprovedWork"]],
            [older.name, newer.name],
        )
        self.assertEqual(
            [item["planBasename"] for item in result["unassignedWork"][:2]],
            [older.name, newer.name],
        )

    def test_reconcile_orders_numbered_tasks_by_creation_time_first(self) -> None:
        task_1 = self.write_plan("planning/approved/task-1.md", "# Task 1 — First\n> **Status:** Approved\n")
        time.sleep(0.05)
        task_10 = self.write_plan("planning/approved/task-10.md", "# Task 10 — Tenth\n> **Status:** Approved\n")
        time.sleep(0.05)
        task_2 = self.write_plan("planning/approved/task-2.md", "# Task 2 — Second\n> **Status:** Approved\n")

        result = automation_assignments.reconcile(self.projects_json, self.registry)

        self.assertEqual(
            [item["planBasename"] for item in result["unassignedWork"][:3]],
            [task_1.name, task_10.name, task_2.name],
        )
        self.assertEqual(
            [item["sequence"] for item in result["unassignedWork"][:3]],
            [1, 10, 2],
        )

    def test_plan_priority_uses_task_number_only_as_tiebreaker(self) -> None:
        task_1 = self.write_plan("planning/approved/task-1.md", "# Task 1 — First\n> **Status:** Approved\n")
        task_10 = self.write_plan("planning/approved/task-10.md", "# Task 10 — Tenth\n> **Status:** Approved\n")
        task_2 = self.write_plan("planning/approved/task-2.md", "# Task 2 — Second\n> **Status:** Approved\n")
        original = automation_assignments.file_created_at
        try:
            automation_assignments.file_created_at = lambda path: 1.0
            self.assertEqual(
                [path.name for path in sorted([task_10, task_2, task_1], key=automation_assignments.plan_priority_key)],
                [task_1.name, task_2.name, task_10.name],
            )
        finally:
            automation_assignments.file_created_at = original

    def test_auto_approval_orders_numbered_tasks_by_creation_time_first(self) -> None:
        task_1 = self.write_plan("planning/pending/task-1.md", "# Task 1 — First\n> **Status:** Pending\n")
        time.sleep(0.05)
        task_10 = self.write_plan("planning/pending/task-10.md", "# Task 10 — Tenth\n> **Status:** Pending\n")
        time.sleep(0.05)
        task_2 = self.write_plan("planning/pending/task-2.md", "# Task 2 — Second\n> **Status:** Pending\n")
        self.projects_json.write_text(json.dumps({
            "version": 1,
            "projects": [{
                "id": "p1",
                "name": "Project One",
                "rootLabel": str(self.project),
                "explicitTaskPath": "docs/task",
                "autoApprovePending": True,
            }],
        }))

        result = automation_assignments.reconcile(self.projects_json, self.registry)

        self.assertEqual(
            [item["planBasename"] for item in result["autoApprovedWork"]],
            [task_1.name, task_10.name, task_2.name],
        )
        self.assertEqual(
            [item["sequence"] for item in result["autoApprovedWork"]],
            [1, 10, 2],
        )

    def test_claim_rejects_later_created_approved_task_when_earlier_task_waits(self) -> None:
        earlier = self.write_plan("planning/approved/task-10.md", "# Task 10 — Created first\n> **Status:** Approved\n")
        time.sleep(0.05)
        later = self.write_plan("planning/approved/task-1.md", "# Task 1 — Created later\n> **Status:** Approved\n")

        with self.assertRaises(SystemExit) as raised:
            run_cli([
                "--registry", str(self.registry),
                "claim",
                "--project-id", "p1",
                "--project-name", "Project One",
                "--project-root", str(self.project),
                "--task-root", str(self.task_root),
                "--plan-path", str(later),
                "--role", "project-agent",
                "--agent-id", "agent-1",
                "--reason", "approved_execution",
            ])

        payload = json.loads(str(raised.exception))
        self.assertEqual(payload["error"], "project_created_time_blocked")
        self.assertEqual(payload["sequence"], 1)
        self.assertIn(earlier.name, [Path(item).name for item in payload["blockingPlans"]])
        self.assertIn("Earlier-created", payload["hint"])


    def test_reconcile_ignores_custom_all_order(self) -> None:
        a = self.write_plan("planning/approved/a.md", "# A\n> **Status:** Approved\n")
        b = self.write_plan("planning/approved/b.md", "# B\n> **Status:** Approved\n")
        c = self.write_plan("planning/approved/c.md", "# C\n> **Status:** Approved\n")
        ui = self.write_ui_config({
            "enabledScopes": {"all": True},
            "orders": {"all": [f"p1::{c.name}", f"p1::{a.name}"]},
        })

        result = automation_assignments.reconcile(self.projects_json, self.registry, ui_config_path=ui)

        self.assertEqual(
            [item["planBasename"] for item in result["unassignedWork"][:3]],
            [a.name, b.name, c.name],
        )

    def test_load_ui_config_uses_isolated_public_default(self) -> None:
        public_ui = self.root / "public-ui.json"
        public_ui.write_text(json.dumps({
            "version": 1,
            "routes": {"queue": {"customOrder": {
                "enabledScopes": {"project:p1": True, "all": True},
                "orders": {"project:p1": ["p1::new.md"], "all": ["p1::ignored.md"]},
            }}},
        }, indent=2))
        original_default = automation_assignments.DEFAULT_UI_CONFIG
        try:
            automation_assignments.DEFAULT_UI_CONFIG = public_ui
            config = automation_assignments.load_ui_config()
            custom = automation_assignments.queue_custom_order(config)
        finally:
            automation_assignments.DEFAULT_UI_CONFIG = original_default
        self.assertTrue(custom["enabledScopes"]["project:p1"])
        self.assertNotIn("all", custom["enabledScopes"])
        self.assertEqual(custom["orders"]["project:p1"], ["p1::new.md"])

    def test_default_projects_prefers_app_support_when_it_has_projects(self) -> None:
        repo_projects = self.root / "repo-projects.json"
        repo_projects.write_text(json.dumps({"version": 1, "projects": []}, indent=2))
        app_support_projects = self.root / "app-support-projects.json"
        app_support_projects.write_text(json.dumps({
            "version": 1,
            "projects": [{
                "id": "desktop-project",
                "name": "Desktop Project",
                "rootLabel": str(self.project),
                "explicitTaskPath": "docs/task",
            }],
        }, indent=2))
        original_default = automation_assignments.DEFAULT_PROJECTS
        original_app = automation_assignments.DEFAULT_APP_SUPPORT_PROJECTS
        try:
            automation_assignments.DEFAULT_PROJECTS = repo_projects
            automation_assignments.DEFAULT_APP_SUPPORT_PROJECTS = app_support_projects
            self.assertEqual(automation_assignments.resolved_projects_path(), app_support_projects.resolve())
        finally:
            automation_assignments.DEFAULT_PROJECTS = original_default
            automation_assignments.DEFAULT_APP_SUPPORT_PROJECTS = original_app

    def test_default_projects_does_not_import_repo_seed_when_public_registry_empty(self) -> None:
        repo_projects = self.root / "repo-projects.json"
        repo_projects.write_text(json.dumps({
            "version": 1,
            "projects": [{
                "id": "repo-project",
                "name": "Repo Project",
                "rootLabel": str(self.project),
                "explicitTaskPath": "docs/task",
            }],
        }, indent=2))
        app_support_projects = self.root / "app-support-projects.json"
        app_support_projects.write_text(json.dumps({"version": 1, "projects": []}, indent=2))
        original_default = automation_assignments.DEFAULT_PROJECTS
        original_app = automation_assignments.DEFAULT_APP_SUPPORT_PROJECTS
        try:
            automation_assignments.DEFAULT_PROJECTS = repo_projects
            automation_assignments.DEFAULT_APP_SUPPORT_PROJECTS = app_support_projects
            self.assertEqual(automation_assignments.resolved_projects_path(), app_support_projects.resolve())
            self.assertEqual(json.loads(app_support_projects.read_text()), {"version": 1, "projects": []})
            self.assertEqual(json.loads(repo_projects.read_text())["projects"][0]["id"], "repo-project")
        finally:
            automation_assignments.DEFAULT_PROJECTS = original_default
            automation_assignments.DEFAULT_APP_SUPPORT_PROJECTS = original_app

    def test_reconcile_matches_active_assignment_after_project_id_changes(self) -> None:
        plan = self.write_plan("planning/in-progress/a.md", "# A\n> **Status:** In Progress\n> **Automation Claimed:** true\n")
        registry = automation_assignments.empty_registry()
        registry["assignments"].append({
            "id": "old-project-assignment",
            "projectId": "old-project-id",
            "projectName": "Old Project",
            "projectRoot": str(self.project),
            "taskRoot": str(self.task_root),
            "planPath": str(plan),
            "planBasename": plan.name,
            "role": "project-agent",
            "agentId": "agent-1",
            "agentNickname": "agent-1",
            "state": "running",
            "claimedAt": "2026-06-23T00:00:00Z",
            "lastHeartbeatAt": "2026-06-23T00:00:00Z",
            "leaseExpiresAt": "2999-01-01T00:00:00Z",
            "handoffReason": "approved_execution",
            "completedAt": None,
            "notes": "",
        })
        automation_assignments.save_registry(registry, self.registry)
        self.projects_json.write_text(json.dumps({
            "version": 1,
            "projects": [{
                "id": "new-project-id",
                "name": "Project One",
                "rootLabel": str(self.project),
                "explicitTaskPath": "docs/task",
            }],
        }))

        result = automation_assignments.reconcile(self.projects_json, self.registry)

        item = next(item for item in result["eligibleWork"] if item["planBasename"] == plan.name)
        self.assertTrue(item["assigned"])
        self.assertEqual(item["assignmentId"], "old-project-assignment")
        self.assertEqual(item["agentId"], "agent-1")
        self.assertNotIn(plan.name, [entry["planBasename"] for entry in result["unassignedWork"]])

    def test_reconcile_uses_project_custom_order_when_enabled(self) -> None:
        a = self.write_plan("planning/approved/a.md", "# A\n> **Status:** Approved\n")
        b = self.write_plan("planning/approved/b.md", "# B\n> **Status:** Approved\n")
        c = self.write_plan("planning/approved/c.md", "# C\n> **Status:** Approved\n")
        ui = self.write_ui_config({
            "enabledScopes": {"project:p1": True},
            "orders": {"project:p1": [f"p1::{c.name}", f"p1::{a.name}"]},
        })

        result = automation_assignments.reconcile(self.projects_json, self.registry, ui_config_path=ui)

        self.assertEqual(
            [item["planBasename"] for item in result["unassignedWork"][:3]],
            [c.name, a.name, b.name],
        )

    def test_claim_rejects_later_custom_order_task_when_earlier_custom_waits(self) -> None:
        first = self.write_plan("planning/approved/custom-first.md", "# First\n> **Status:** Approved\n")
        second = self.write_plan("planning/approved/custom-second.md", "# Second\n> **Status:** Approved\n")
        ui = self.write_ui_config({
            "enabledScopes": {"project:p1": True},
            "orders": {"project:p1": [f"p1::{first.name}", f"p1::{second.name}"]},
        })

        with self.assertRaises(SystemExit) as raised:
            run_cli([
                "--registry", str(self.registry),
                "--ui-config", str(ui),
                "claim",
                "--project-id", "p1",
                "--project-name", "Project One",
                "--project-root", str(self.project),
                "--task-root", str(self.task_root),
                "--plan-path", str(second),
                "--role", "project-agent",
                "--agent-id", "agent-1",
                "--reason", "approved_execution",
            ])

        payload = json.loads(str(raised.exception))
        self.assertEqual(payload["error"], "project_custom_order_blocked")
        self.assertIn(first.name, [Path(item).name for item in payload["blockingPlans"]])
        self.assertIn("custom-ordered", payload["hint"])



    def test_reconcile_holds_paused_project_work_out_of_unassigned(self) -> None:
        approved = self.write_plan("planning/approved/paused.md", "# Paused\n> **Status:** Approved\n")
        control = self.root / "automation-control.json"
        control.write_text(json.dumps({
            "version": 1,
            "projects": {"p1": {"paused": True, "reason": "User stopped project automation."}},
            "reviewers": {},
            "threadLinks": {},
        }))

        result = automation_assignments.reconcile(self.projects_json, self.registry, control_path=control)

        self.assertIn(approved.name, [item["planBasename"] for item in result["eligibleWork"]])
        self.assertNotIn(approved.name, [item["planBasename"] for item in result["unassignedWork"]])
        hold = next(item for item in result["heldWork"] if item["planBasename"] == approved.name)
        self.assertEqual(hold["holdReason"], "project_paused")
        self.assertEqual(hold["recommendedAction"], "unpause_project")

    def test_reconcile_holds_stopped_reviewer_without_claiming_thread_identity(self) -> None:
        review = self.write_plan("planning/review/review.md", "# Review\n> **Status:** Review\n")
        control = self.root / "automation-control.json"
        control.write_text(json.dumps({
            "version": 1,
            "projects": {},
            "reviewers": {"p1": {"stopped": True, "reason": "User stopped reviewer."}},
            "threadLinks": {},
        }))

        result = automation_assignments.reconcile(self.projects_json, self.registry, control_path=control)

        item = next(item for item in result["eligibleWork"] if item["planBasename"] == review.name)
        self.assertEqual(item["role"], "reviewer-agent")
        self.assertEqual(item["codexThreadId"], "")
        self.assertNotIn(review.name, [entry["planBasename"] for entry in result["unassignedWork"]])
        hold = next(entry for entry in result["heldWork"] if entry["planBasename"] == review.name)
        self.assertEqual(hold["holdReason"], "reviewer_stopped")
        self.assertEqual(hold["recommendedAction"], "resume_reviewer")

    def test_reconcile_marks_expired_assignment(self) -> None:
        plan = self.write_plan("planning/in-progress/orphan.md", "# Orphan\n> **Status:** In Progress\n")
        id_ = automation_assignments.assignment_id("p1", "project-agent", str(plan))
        expired = automation_assignments.iso(automation_assignments.now_utc() - timedelta(minutes=1))
        self.registry.write_text(json.dumps({
            "version": 1,
            "updatedAt": expired,
            "assignments": [{
                "id": id_,
                "projectId": "p1",
                "projectName": "Project One",
                "projectRoot": str(self.project),
                "taskRoot": str(self.task_root),
                "planPath": str(plan),
                "planBasename": plan.name,
                "role": "project-agent",
                "agentId": "agent-old",
                "state": "running",
                "handoffReason": "approved_execution",
                "claimedAt": expired,
                "lastHeartbeatAt": expired,
                "leaseExpiresAt": expired,
            }],
        }))
        result = automation_assignments.reconcile(self.projects_json, self.registry, mark_expired=True)
        self.assertEqual(result["expiredAssignments"][0]["id"], id_)
        self.assertEqual(result["unassignedWork"][0]["reason"], "automation_claimed_orphaned_in_progress")
        registry = automation_assignments.load_registry(self.registry)
        self.assertEqual(registry["assignments"][0]["state"], "expired")

    def test_reconcile_reports_stale_active_assignments_without_expiring_them(self) -> None:
        plan = self.write_plan(
            "planning/in-progress/orphan.md",
            "# Orphan\n> **Status:** In Progress\n> **Automation Claimed:** true\n",
        )
        id_ = automation_assignments.assignment_id("p1", "project-agent", str(plan))
        old = automation_assignments.iso(automation_assignments.now_utc() - timedelta(minutes=61))
        future = automation_assignments.iso(automation_assignments.now_utc() + timedelta(minutes=30))
        self.registry.write_text(json.dumps({
            "version": 1,
            "updatedAt": old,
            "assignments": [{
                "id": id_,
                "projectId": "p1",
                "projectName": "Project One",
                "projectRoot": str(self.project),
                "taskRoot": str(self.task_root),
                "planPath": str(plan),
                "planBasename": plan.name,
                "role": "project-agent",
                "agentId": "agent-slow",
                "agentNickname": "Slowpoke",
                "state": "running",
                "handoffReason": "automation_claimed_orphaned_in_progress",
                "claimedAt": old,
                "lastHeartbeatAt": old,
                "leaseExpiresAt": future,
            }],
        }))

        result = automation_assignments.reconcile(
            self.projects_json,
            self.registry,
            mark_expired=True,
            stale_after_minutes=60,
        )

        self.assertEqual(result["staleAssignments"][0]["assignment"]["id"], id_)
        self.assertEqual(result["staleAssignments"][0]["recommendedAction"], "nudge_active_agent")
        self.assertGreaterEqual(result["staleAssignments"][0]["staleForMinutes"], 60)
        registry = automation_assignments.load_registry(self.registry)
        self.assertEqual(registry["assignments"][0]["state"], "running")

    def test_reconcile_does_not_requeue_finished_blocked_assignments(self) -> None:
        plan = self.write_plan(
            "planning/in-progress/blocked.md",
            "# Blocked\n> **Status:** In Progress\n\nRuntime blocker recorded.\n",
        )
        id_ = automation_assignments.assignment_id("p1", "project-agent", str(plan))
        finished = automation_assignments.iso(automation_assignments.now_utc() - timedelta(minutes=5))
        self.registry.write_text(json.dumps({
            "version": 1,
            "updatedAt": finished,
            "assignments": [{
                "id": id_,
                "projectId": "p1",
                "projectName": "Project One",
                "projectRoot": str(self.project),
                "taskRoot": str(self.task_root),
                "planPath": str(plan),
                "planBasename": plan.name,
                "role": "project-agent",
                "agentId": "agent-blocked",
                "state": "blocked",
                "handoffReason": "automation_claimed_orphaned_in_progress",
                "claimedAt": finished,
                "lastHeartbeatAt": finished,
                "leaseExpiresAt": finished,
                "completedAt": finished,
                "notes": "External service unavailable.",
            }],
        }))

        result = automation_assignments.reconcile(self.projects_json, self.registry, mark_expired=True)

        self.assertEqual(result["eligibleWork"], [])
        self.assertEqual(result["unassignedWork"], [])
        self.assertEqual(result["expiredAssignments"], [])
        registry = automation_assignments.load_registry(self.registry)
        self.assertEqual(registry["assignments"][0]["state"], "blocked")

    def test_reconcile_does_not_requeue_legacy_expired_finished_assignments(self) -> None:
        plan = self.write_plan(
            "planning/in-progress/legacy-expired.md",
            "# Blocked\n> **Status:** In Progress\n\nRuntime blocker recorded.\n",
        )
        id_ = automation_assignments.assignment_id("p1", "project-agent", str(plan))
        finished = automation_assignments.iso(automation_assignments.now_utc() - timedelta(minutes=5))
        self.registry.write_text(json.dumps({
            "version": 1,
            "updatedAt": finished,
            "assignments": [{
                "id": id_,
                "projectId": "p1",
                "projectName": "Project One",
                "projectRoot": str(self.project),
                "taskRoot": str(self.task_root),
                "planPath": str(plan),
                "planBasename": plan.name,
                "role": "project-agent",
                "agentId": "agent-blocked",
                "state": "expired",
                "handoffReason": "automation_claimed_orphaned_in_progress",
                "claimedAt": finished,
                "lastHeartbeatAt": finished,
                "leaseExpiresAt": finished,
                "completedAt": finished,
                "notes": "Legacy finished blocked assignment was rewritten to expired.",
            }],
        }))

        result = automation_assignments.reconcile(self.projects_json, self.registry, mark_expired=True)

        self.assertEqual(result["eligibleWork"], [])
        self.assertEqual(result["unassignedWork"], [])
        self.assertEqual(result["expiredAssignments"], [])


    def test_shared_registry_resolver_prefers_explicit_path(self) -> None:
        explicit = self.root / "explicit-projects.json"
        explicit.write_text(json.dumps({"version": 1, "projects": []}))
        resolution = taskmanager_registry.resolve_project_registry(explicit, root=self.root)
        self.assertEqual(resolution.active_path, explicit.resolve())
        self.assertEqual(resolution.source, "explicit")

    def test_shared_registry_resolver_uses_public_app_support_without_importing_seeds(self) -> None:
        repo_path = self.root / "repo-projects.json"
        app_support_path = self.root / "public-app-support" / "projects.json"
        repo_path.write_text(json.dumps({"version": 1, "projects": [{
            "id": "repo-only",
            "name": "Repo Only",
            "rootLabel": str(self.root / "repo-only"),
        }]}, indent=2))
        app_support_path.parent.mkdir(parents=True, exist_ok=True)
        app_support_path.write_text(json.dumps({"version": 1, "projects": [{
            "id": "public-only",
            "name": "Public Only",
            "rootLabel": str(self.root / "public-only"),
        }]}, indent=2))

        resolution = taskmanager_registry.resolve_project_registry(
            None,
            root=self.root,
            repo_path=repo_path,
            dist_path=self.root / "dist-projects.json",
            app_support_path=app_support_path,
        )

        self.assertEqual(resolution.active_path, app_support_path.resolve())
        self.assertEqual(resolution.source, "public-app-support")
        self.assertEqual(json.loads(app_support_path.read_text())["projects"][0]["id"], "public-only")
        self.assertEqual(json.loads(repo_path.read_text())["projects"][0]["id"], "repo-only")
        self.assertNotIn("ignoredPaths", resolution.as_dict())

    def test_shared_registry_resolver_seeds_only_the_public_registry(self) -> None:
        repo_path = self.root / "repo-projects.json"
        app_support_path = self.root / "new-public-app-support" / "projects.json"
        repo_path.write_text(json.dumps({"version": 1, "projects": [{"id": "repo-only"}]}, indent=2))

        resolution = taskmanager_registry.resolve_project_registry(
            None,
            root=self.root,
            repo_path=repo_path,
            dist_path=self.root / "dist-projects.json",
            app_support_path=app_support_path,
        )

        self.assertEqual(resolution.active_path, app_support_path.resolve())
        self.assertEqual(json.loads(app_support_path.read_text()), {"version": 1, "projects": []})
        self.assertEqual(json.loads(repo_path.read_text())["projects"], [{"id": "repo-only"}])
        self.assertNotIn("migration", resolution.as_dict())

    def test_shared_registry_resolver_does_not_migrate_explicit_path(self) -> None:
        explicit = self.root / "explicit-projects.json"
        repo_path = self.root / "repo-projects.json"
        explicit.write_text(json.dumps({"version": 1, "projects": []}, indent=2))
        repo_path.write_text(json.dumps({"version": 1, "projects": [{
            "id": "repo-only",
            "name": "Repo Only",
            "rootLabel": str(self.root / "repo-only"),
        }]}, indent=2))

        resolution = taskmanager_registry.resolve_project_registry(
            explicit,
            root=self.root,
            repo_path=repo_path,
            app_support_path=self.root / "app-projects.json",
            dist_path=self.root / "dist-projects.json",
        )

        self.assertNotIn("migration", resolution.as_dict())
        self.assertEqual(json.loads(explicit.read_text())["projects"], [])


    def test_reconcile_surfaces_blocked_user_reply_queue_paused_and_review_readiness(self) -> None:
        active = self.write_plan_folder("planning/in-progress/active-build", status="In Progress", lifecycle="in-progress")
        blocked = self.write_plan_folder("planning/in-progress/blocked-build", status="Blocked", lifecycle="in-progress")
        approved = self.write_plan_folder("planning/approved/queued-next", status="Approved", lifecycle="approved")
        reply = self.write_plan_folder("planning/user-verification/reply-needed", status="Sent to Agent", lifecycle="user-verification")
        review = self.write_plan_folder("planning/review/not-ready", status="Reviewing", lifecycle="review")
        registry = automation_assignments.empty_registry()
        registry["assignments"].append({
            "id": "active-assignment",
            "projectId": "p1",
            "projectName": "Project One",
            "projectRoot": str(self.project),
            "taskRoot": str(self.task_root),
            "planPath": str(active),
            "planBasename": active.name,
            "role": "project-agent",
            "agentId": "agent-active",
            "agentNickname": "agent-active",
            "state": "running",
            "claimedAt": "2026-06-23T00:00:00Z",
            "lastHeartbeatAt": "2999-01-01T00:00:00Z",
            "leaseExpiresAt": "2999-01-01T01:00:00Z",
            "handoffReason": "approved_execution",
            "completedAt": None,
            "notes": "Working active item.",
        })
        automation_assignments.save_registry(registry, self.registry)
        control = self.root / "automation-control.json"
        control.write_text(json.dumps({
            "version": 1,
            "projects": {},
            "reviewers": {},
            "threadLinks": {},
            "conflicts": {},
        }))

        result = automation_assignments.reconcile(self.projects_json, self.registry, control_path=control)

        self.assertEqual([item["planBasename"] for item in result["blockedWork"]], [blocked.name])
        self.assertIn(reply.name, [item["planBasename"] for item in result["priorityUserReplyWork"]])
        self.assertIn(approved.name, [item["planBasename"] for item in result["projectAgentQueue"]])
        self.assertIn(review.name, [item["planBasename"] for item in result["reviewReadinessFailures"]])
        self.assertNotIn(approved.name, [item["planBasename"] for item in result["unassignedWork"]])
        self.assertGreaterEqual(len(result["heartbeatNotifications"]), 4)

    def test_review_readiness_ignores_draft_matrix_after_executor_pass(self) -> None:
        review = self.write_plan_folder("planning/review/ready-with-draft-matrix", status="Reviewing", lifecycle="review")
        evidence = review / "evidence" / "screenshots"
        evidence.mkdir(parents=True)
        (evidence / "proof.png").write_text("proof")
        (review / "08-testing-and-verification.md").write_text(
            "---\nstatus: Reviewing\nlifecycle: review\n---\n"
            "# Testing and Verification\n\n"
            "## Browser verification matrix draft\n\n"
            "| BV ID | Executor Mode / Evidence | Reviewer Mode / Evidence | Result |\n"
            "| --- | --- | --- | --- |\n"
            "| BV-001 | Pending | Pending | Pending |\n\n"
            "## Executor verification results — 2026-06-23\n\n"
            "| Requirement | Status | Evidence |\n"
            "| --- | --- | --- |\n"
            "| BV coverage | Selected live verification (Playwright): PASS | Evidence captured. |\n\n"
            "Initially Tested: blocked work visibility and user replies.\n\n"
            "Executor verification: PASS pending independent R1 review.\n"
            "Final verification status: PASS pending independent R1 review.\n"
        )
        registry = automation_assignments.empty_registry()
        automation_assignments.save_registry(registry, self.registry)
        control = self.root / "automation-control.json"
        control.write_text(json.dumps({
            "version": 1,
            "projects": {},
            "reviewers": {},
            "threadLinks": {},
            "conflicts": {},
        }))

        result = automation_assignments.reconcile(self.projects_json, self.registry, control_path=control)

        self.assertIn(review.name, [item["planBasename"] for item in result["unassignedWork"]])
        self.assertNotIn(review.name, [item["planBasename"] for item in result["reviewReadinessFailures"]])

    def test_user_verification_body_sent_to_agent_text_is_not_actionable_reply(self) -> None:
        plan = self.write_plan_folder(
            "planning/user-verification/normal-user-verification",
            status="User Verification",
            lifecycle="user-verification",
        )
        (plan / "12-comments.md").write_text(
            "# Comments\n\n"
            "## R1 note\n\n"
            "The reviewer confirmed that this normal User Verification handoff "
            "contains historical text mentioning Sent to Agent and should not "
            "be treated as an actionable user reply.\n"
        )
        registry = automation_assignments.empty_registry()
        automation_assignments.save_registry(registry, self.registry)
        control = self.root / "automation-control.json"
        control.write_text(json.dumps({
            "version": 1,
            "projects": {},
            "reviewers": {},
            "threadLinks": {},
            "conflicts": {},
        }))

        result = automation_assignments.reconcile(self.projects_json, self.registry, control_path=control)

        self.assertNotIn(plan.name, [item["planBasename"] for item in result["eligibleWork"]])
        self.assertNotIn(plan.name, [item["planBasename"] for item in result["unassignedWork"]])
        self.assertNotIn(plan.name, [item["planBasename"] for item in result["priorityUserReplyWork"]])
        user_reply_notifications = [
            item for item in result["heartbeatNotifications"]
            if item.get("reason") == "user_reply_waiting"
        ]
        self.assertNotIn(plan.name, [item["planBasename"] for item in user_reply_notifications])

    def test_reconcile_separates_paused_work_and_detects_moved_plan_repairs(self) -> None:
        approved = self.write_plan_folder("planning/approved/paused-approved", status="Approved", lifecycle="approved")
        current = self.write_plan_folder("planning/review/moved-review", status="Reviewing", lifecycle="review")
        (current / "evidence" / "screenshots").mkdir(parents=True)
        (current / "evidence" / "screenshots" / "proof.txt").write_text("proof")
        (current / "08-testing-and-verification.md").write_text("---\nstatus: Reviewing\nlifecycle: review\n---\nFinal verification status: PASS\n")
        registry = automation_assignments.empty_registry()
        registry["assignments"].append({
            "id": "moved-assignment",
            "projectId": "p1",
            "projectName": "Project One",
            "projectRoot": str(self.project),
            "taskRoot": str(self.task_root),
            "planPath": str(self.task_root / "planning/in-progress/moved-review"),
            "planBasename": current.name,
            "role": "reviewer-agent",
            "agentId": "reviewer-active",
            "state": "running",
            "claimedAt": "2026-06-23T00:00:00Z",
            "lastHeartbeatAt": "2999-01-01T00:00:00Z",
            "leaseExpiresAt": "2999-01-01T01:00:00Z",
            "handoffReason": "independent_review",
            "completedAt": None,
            "notes": "Old path lease.",
        })
        automation_assignments.save_registry(registry, self.registry)
        control = self.root / "automation-control.json"
        control.write_text(json.dumps({
            "version": 1,
            "projects": {"p1": {"paused": True, "reason": "User paused project."}},
            "reviewers": {},
            "threadLinks": {},
            "conflicts": {},
        }))

        result = automation_assignments.reconcile(self.projects_json, self.registry, control_path=control)

        self.assertIn(approved.name, [item["planBasename"] for item in result["pausedIgnoredWork"]])
        self.assertIn(current.name, [item["planBasename"] for item in result["movedPlanRepairs"]])
        self.assertEqual(result["movedPlanRepairs"][0]["currentPlanPath"], str(current))

    def test_block_unblock_metadata_and_repair_actions_are_auditable(self) -> None:
        plan = self.write_plan_folder("planning/in-progress/blockable", status="In Progress", lifecycle="in-progress")
        previous, blocked = automation_assignments.set_plan_block_state(plan, blocked=True, reason="Need credentials", actor="tester", timestamp="2026-06-23T00:00:00Z")
        self.assertEqual(previous["status"], "In Progress")
        self.assertEqual(blocked["status"], "Blocked")
        manifest = json.loads((plan / "plan.json").read_text())
        self.assertTrue(manifest["block"]["blocked"])
        self.assertIn("Need credentials", (plan / "12-comments.md").read_text())
        _, unblocked = automation_assignments.set_plan_block_state(plan, blocked=False, reason="Credentials supplied", actor="tester", timestamp="2026-06-23T01:00:00Z")
        self.assertEqual(unblocked["status"], "In Progress")
        manifest = json.loads((plan / "plan.json").read_text())
        self.assertFalse(manifest["block"]["blocked"])
        self.assertIn("Credentials supplied", (plan / "12-comments.md").read_text())

        registry = automation_assignments.empty_registry()
        registry["assignments"].append({"id": "a1", "projectId": "p1", "role": "project-agent", "planPath": str(self.root / "old"), "planBasename": "old"})
        previous, repaired = automation_assignments.repair_assignment_plan_path(registry, "a1", str(plan), "Repair path", "2026-06-23T02:00:00Z")
        self.assertEqual(previous["planBasename"], "old")
        self.assertEqual(repaired["planPath"], str(plan.resolve()))
        self.assertEqual(repaired["planBasename"], plan.name)

    def test_reconcile_reports_shared_registry_resolution(self) -> None:
        result = automation_assignments.reconcile(self.projects_json, self.registry)
        # Direct reconcile uses the explicit path supplied by the caller; the CLI
        # command annotates shared-resolution diagnostics around this core result.
        self.assertEqual(result["projectsPath"], str(self.projects_json))



if __name__ == "__main__":
    unittest.main()
