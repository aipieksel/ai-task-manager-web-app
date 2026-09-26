#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.request import urlopen

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
TARGET_NAME = os.environ.get("TARGET_DIR", "src/taskmanager")
TARGET = ROOT / TARGET_NAME


def free_port() -> int:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def wait_for_server(port: int) -> None:
    deadline = time.time() + 10
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            with urlopen(f"http://127.0.0.1:{port}/data/runtime/projects.json", timeout=0.5) as response:
                response.read()
            return
        except Exception as error:  # noqa: BLE001
            last_error = error
            time.sleep(0.1)
    raise RuntimeError(f"runtime server did not start: {last_error}")


def write_fixture(project_root: Path) -> None:
    task = project_root / "documentation" / "task"
    pending = task / "planning" / "pending"
    review = task / "planning" / "review"
    for path in [task / "planning" / "draft", pending, task / "planning" / "approved", task / "planning" / "in-progress", review, task / "planning" / "user-verification", task / "planning" / "failed-user-verification", task / "planning" / "completed", task / "planning" / "archive"]:
        path.mkdir(parents=True, exist_ok=True)
    (task / "todo.md").write_text("""# QA Project — Active Tasks

## Active

- [ ] **Server-backed fixture workflow**
  - Category: `Bug`
  - Type: `Task`
  - Status: `Pending`
  - Plan: `documentation/task/planning/pending/server-backed-fixture.md`
  - Plan Score: `9/10`
  - Verification Method: `runtime-server`
  - Scope: Verify the runtime server reads task files from disk.
  - Closeout: `Not started`
  - Blocker: `none`

- [ ] **Completed removal fixture**
  - Category: `Maintenance`
  - Type: `Task`
  - Status: `Review`
  - Plan: `documentation/task/planning/review/completed-removal-fixture.md`
  - Plan Score: `10/10`
  - Verification Method: `runtime-server`
  - Scope: Verify completed tasks are removed from active todo after user verification.
  - Closeout: `Complete`
  - Blocker: `none`

- [ ] **Archive fixture**
  - Category: `Maintenance`
  - Type: `Task`
  - Status: `Pending`
  - Plan: `documentation/task/planning/pending/archive-fixture.md`
  - Plan Score: `8/10`
  - Verification Method: `runtime-server`
  - Scope: Verify archived tasks are removed from active todo.
  - Closeout: `Not started`
  - Blocker: `none`

- [ ] **Pending questions fixture**
  - Category: `Planning`
  - Type: `Task`
  - Status: `Questions Pending`
  - Plan: `documentation/task/planning/pending/pending-questions-fixture.md`
  - Plan Score: `6/10`
  - Verification Method: `runtime-server`
  - Scope: Verify pending placeholder answers remain open in the decision desk.
  - Closeout: `Not started`
  - Blocker: `none`
""")
    (task / "workflow.md").write_text("# QA Project — Task Workflow\n")
    (task / "verification.md").write_text("# Verification\n\n## Selected Method\n\nRuntime server\n")
    (task / "lessons-active.md").write_text("# Active Lessons\n")
    (task / "lessons.md").write_text("# Lessons Learned\n")
    (task / "lessons-index.json").write_text(json.dumps({"version": 1, "entries": []}, indent=2))
    (pending / "server-backed-fixture.md").write_text("""# Plan: Server-backed fixture workflow

> **Status:** Pending
> **Created:** 2026-06-21
> **Estimated steps:** 1
> **Risk level:** Low
> **Plan score:** 9/10

## Original User Request

Verify server-backed filesystem loading.

## Question History / Decision Log

- [x] **Q1: Which persistence scope should be used?**
  - Decision: Persistence scope
  - Why this matters: It changes reload behavior.
  - Options:
    - (a) Runtime server filesystem *(recommended)*
    - (b) Browser session only
  - Agent recommendation: (a) — It avoids browser-backed project state.
  - Answer: Runtime server filesystem
  - Answer source: TaskManager interactive choice
""")
    (pending / "archive-fixture.md").write_text("""# Plan: Archive fixture

> **Status:** Pending
> **Created:** 2026-06-21
> **Estimated steps:** 1
> **Risk level:** Low
> **Plan score:** 8/10

## Original User Request

Verify archive status removes active todo after the terminal archive transition.

## Question History / Decision Log

- [x] **Q1: Archive fixture?**
  - Decision: Archive fixture
  - Why this matters: It verifies archive behavior.
  - Options:
    - (a) Archive *(recommended)*
    - (b) Keep active
  - Agent recommendation: (a) — Exercises archive.
  - Answer: Archive
  - Answer source: TaskManager interactive choice
""")
    (pending / "pending-questions-fixture.md").write_text("""# Plan: Pending questions fixture

> **Status:** Questions Pending
> **Created:** 2026-06-21
> **Estimated steps:** 1
> **Risk level:** Low
> **Plan score:** 6/10

## Original User Request

Verify pending placeholder answers are not treated as completed decisions.

## Question History / Decision Log

- [x] **Q1: Which pending placeholder style should be treated as unanswered?**
  - Decision: Pending punctuation
  - Why this matters: Generated plans often write Pending with punctuation.
  - Options:
    - (a) Pending with a trailing full stop *(recommended)*
    - (b) A real selected answer
  - Agent recommendation: (a) — This is the regression case.
  - Answer: Pending.

- [ ] **Q2: Should lowercase pending remain unanswered too?**
  - Decision: Pending casing
  - Why this matters: Older generators use lowercase pending.
  - Options:
    - (a) lowercase pending *(recommended)*
    - (b) A real selected answer
  - Agent recommendation: (a) — Keeps the parser case-insensitive.
  - Answer: pending
""")
    (review / "completed-removal-fixture.md").write_text("""# Plan: Completed removal fixture

> **Status:** Review
> **Created:** 2026-06-21
> **Estimated steps:** 1
> **Risk level:** Low
> **Plan score:** 10/10

## Original User Request

Verify completed todo removal through the TaskManager status dropdown.

## Implementation Steps

- [x] **Step 1: Prepare completion fixture**

## Verification Plan — BLOCKING

- [x] Verify completed status removes active todo item.

## Closeout Review

- Final status: Complete
""")


served_config = TARGET / "data" / "runtime" / "projects.json"
original_served = served_config.read_text() if served_config.exists() else None

with tempfile.TemporaryDirectory() as temp_dir:
    temp = Path(temp_dir)
    project_root = temp / "qa-project"
    write_fixture(project_root)
    runtime_config = temp / "projects.json"
    runtime_config.write_text(json.dumps({
        "version": 1,
        "projects": [{
            "id": "qa-project",
            "name": "qa-project",
            "rootLabel": str(project_root),
            "explicitTaskPath": "documentation/task",
        }],
    }, indent=2) + "\n")
    port = free_port()
    process = subprocess.Popen([
        os.environ.get("PYTHON", "python3"),
        str(ROOT / "tooling" / "scripts" / "serve-runtime.py"),
        "--directory", TARGET_NAME,
        "--port", str(port),
        "--runtime-config", str(runtime_config),
    ], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_for_server(port)
        with sync_playwright() as playwright:
            executable = os.environ.get("CHROMIUM_EXECUTABLE", "/usr/bin/chromium")
            browser = playwright.chromium.launch(headless=True, executable_path=executable)
            context = browser.new_context(viewport={"width": 1440, "height": 1000}, service_workers="block")
            page = context.new_page()
            errors: list[str] = []
            dialogs: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("console", lambda message: errors.append(message.text) if message.type == "error" and not message.text.startswith("Failed to load resource:") else None)
            page.on("dialog", lambda dialog: (dialogs.append(dialog.message), dialog.accept()))
            page.goto(f"http://127.0.0.1:{port}/#/", wait_until="domcontentloaded")
            expect(page.get_by_text("Server-backed fixture workflow").first).to_be_visible(timeout=15000)
            expect(page.get_by_text("1 healthy of 1").first).to_be_visible(timeout=15000)
            assert page.get_by_text("Rescan folders").count() == 0
            expect(page.locator(".status-filter-tabs")).to_be_visible(timeout=15000)
            expect(page.locator(".status-filter-tab", has_text="All").first).to_be_visible(timeout=15000)
            expect(page.locator(".status-filter-tab", has_text="Pending").first).to_be_visible(timeout=15000)
            assert page.get_by_text("Task ledger").count() == 0
            workflow_row = page.locator(".ledger-row-shell", has_text="Server-backed fixture workflow").first
            before_hover_height = workflow_row.bounding_box()["height"]
            workflow_row.hover()
            after_hover_height = workflow_row.bounding_box()["height"]
            assert abs(before_hover_height - after_hover_height) <= 1
            pending_questions_row = page.locator(".ledger-row-shell", has_text="Pending questions fixture").first
            expect(pending_questions_row).to_be_visible(timeout=15000)
            expect(pending_questions_row.locator(".ledger-questions").get_by_text("2 open")).to_be_visible(timeout=15000)
            pending_questions_row.get_by_text("View questions").click()
            expect(page.get_by_text("0 of 2 answered").first).to_be_visible(timeout=15000)
            assert page.get_by_text("All answered").count() == 0
            expect(page.get_by_text("Save answer").first).to_be_visible(timeout=15000)
            page.goto(f"http://127.0.0.1:{port}/#/", wait_until="domcontentloaded")
            status_select = page.locator(".ledger-row-shell", has_text="Server-backed fixture workflow").locator("[data-task-status-select]").first
            expect(status_select).to_be_visible(timeout=15000)
            status_select.select_option("approved")
            expect(page.get_by_text("Task status changed to Approved.").first).to_be_visible(timeout=15000)
            approved_plan = project_root / "documentation" / "task" / "planning" / "approved" / "server-backed-fixture.md"
            pending_plan = project_root / "documentation" / "task" / "planning" / "pending" / "server-backed-fixture.md"
            assert approved_plan.is_file()
            assert not pending_plan.exists()
            todo_text = (project_root / "documentation" / "task" / "todo.md").read_text()
            assert "Status: `Approved`" in todo_text
            assert "Plan: `documentation/task/planning/approved/server-backed-fixture.md`" in todo_text
            assert "> **Status:** Approved" in approved_plan.read_text()
            status_select = page.locator(".ledger-row-shell", has_text="Server-backed fixture workflow").locator("[data-task-status-select]").first
            status_select.select_option("in-progress")
            expect(page.get_by_text("Task status changed to In progress.").first).to_be_visible(timeout=15000)
            in_progress_plan = project_root / "documentation" / "task" / "planning" / "in-progress" / "server-backed-fixture.md"
            assert in_progress_plan.is_file()
            assert not approved_plan.exists()
            status_select = page.locator(".ledger-row-shell", has_text="Server-backed fixture workflow").locator("[data-task-status-select]").first
            status_select.select_option("review")
            expect(page.get_by_text("Task status changed to Review.").first).to_be_visible(timeout=15000)
            review_plan = project_root / "documentation" / "task" / "planning" / "review" / "server-backed-fixture.md"
            assert review_plan.is_file()
            assert not in_progress_plan.exists()
            todo_text = (project_root / "documentation" / "task" / "todo.md").read_text()
            assert "Status: `Review`" in todo_text
            assert "Plan: `documentation/task/planning/review/server-backed-fixture.md`" in todo_text
            assert "> **Status:** Review" in review_plan.read_text()
            status_select = page.locator(".ledger-row-shell", has_text="Server-backed fixture workflow").locator("[data-task-status-select]").first
            status_select.select_option("reviewing")
            expect(page.get_by_text("Task status changed to Reviewing.").first).to_be_visible(timeout=15000)
            assert review_plan.is_file()
            assert "> **Status:** Reviewing" in review_plan.read_text()
            todo_text = (project_root / "documentation" / "task" / "todo.md").read_text()
            assert "Status: `Reviewing`" in todo_text
            assert "Plan: `documentation/task/planning/review/server-backed-fixture.md`" in todo_text
            status_select = page.locator(".ledger-row-shell", has_text="Server-backed fixture workflow").locator("[data-task-status-select]").first
            status_select.select_option("user-verification")
            expect(page.get_by_text("Task status changed to User verification.").first).to_be_visible(timeout=15000)
            user_verification_plan = project_root / "documentation" / "task" / "planning" / "user-verification" / "server-backed-fixture.md"
            assert user_verification_plan.is_file()
            assert not review_plan.exists()
            todo_text = (project_root / "documentation" / "task" / "todo.md").read_text()
            assert "Status: `User Verification`" in todo_text
            assert "Plan: `documentation/task/planning/user-verification/server-backed-fixture.md`" in todo_text
            page.locator(".ledger-row-shell", has_text="Server-backed fixture workflow").get_by_text("View task").click()
            comment_panel = page.locator("[data-user-verification-comment-panel]:visible").first
            expect(comment_panel).to_be_visible(timeout=15000)
            comment_panel.locator("summary").click()
            expect(comment_panel.locator("[data-user-verification-comment-text]")).to_be_visible(timeout=15000)
            comment_panel.locator("[data-user-verification-comment-text]").fill("Please explain exactly what was verified before I close this.")
            comment_panel.locator("[data-action='send-user-verification-comment']").click()
            expect(page.get_by_text("Comment sent to agent.").first).to_be_visible(timeout=15000)
            assert user_verification_plan.is_file()
            verification_text = user_verification_plan.read_text()
            assert "> **Status:** Sent to Agent" in verification_text
            assert "## User Verification Comments" in verification_text
            assert "Please explain exactly what was verified" in verification_text
            todo_text = (project_root / "documentation" / "task" / "todo.md").read_text()
            assert "Status: `Sent to Agent`" in todo_text
            page.goto(f"http://127.0.0.1:{port}/#/", wait_until="domcontentloaded")
            status_select = page.locator(".ledger-row-shell", has_text="Server-backed fixture workflow").locator("[data-task-status-select]").first
            status_select.select_option("failed-user-verification")
            expect(page.get_by_text("Task status changed to Request feedback / changes.").first).to_be_visible(timeout=15000)
            failed_plan = project_root / "documentation" / "task" / "planning" / "failed-user-verification" / "server-backed-fixture.md"
            assert failed_plan.is_file()
            assert not user_verification_plan.exists()
            todo_text = (project_root / "documentation" / "task" / "todo.md").read_text()
            assert "Status: `Requesting User Feedback`" in todo_text
            assert "Plan: `documentation/task/planning/failed-user-verification/server-backed-fixture.md`" in todo_text
            page.locator(".ledger-row-shell", has_text="Server-backed fixture workflow").get_by_text("View task").click()
            feedback_panel = page.locator("[data-user-feedback-panel]:visible").first
            expect(feedback_panel).to_be_visible(timeout=15000)
            feedback_panel.locator("summary").click()
            expect(feedback_panel.locator("[data-user-feedback-text]")).to_be_visible(timeout=15000)
            feedback_panel.locator("[data-user-feedback-text]").fill("Still broken on mobile preview after reviewer approval.")
            feedback_panel.locator("[data-action='save-user-feedback']").click()
            expect(page.get_by_text("User feedback saved and status set to User Replied.").first).to_be_visible(timeout=15000)
            assert failed_plan.is_file()
            failed_text = failed_plan.read_text()
            assert "> **Status:** User Replied" in failed_text
            assert "## User Verification Feedback" in failed_text
            assert "Still broken on mobile preview" in failed_text
            todo_text = (project_root / "documentation" / "task" / "todo.md").read_text()
            assert "Status: `User Replied`" in todo_text
            page.goto(f"http://127.0.0.1:{port}/#/", wait_until="domcontentloaded")

            status_select = page.locator(".ledger-row-shell", has_text="Completed removal fixture").locator("[data-task-status-select]").first
            expect(status_select).to_be_visible(timeout=15000)
            status_select.select_option("user-verification")
            expect(page.get_by_text("Task status changed to User verification.").first).to_be_visible(timeout=15000)
            user_complete_plan = project_root / "documentation" / "task" / "planning" / "user-verification" / "completed-removal-fixture.md"
            review_complete_plan = project_root / "documentation" / "task" / "planning" / "review" / "completed-removal-fixture.md"
            assert user_complete_plan.is_file()
            assert not review_complete_plan.exists()
            status_select = page.locator(".ledger-row-shell", has_text="Completed removal fixture").locator("[data-task-status-select]").first
            status_select.select_option("completed")
            expect(page.get_by_text("Task status changed to Completed.").first).to_be_visible(timeout=15000)
            completed_plan = project_root / "documentation" / "task" / "planning" / "completed" / "completed-removal-fixture.md"
            assert completed_plan.is_file()
            assert not user_complete_plan.exists()
            todo_text = (project_root / "documentation" / "task" / "todo.md").read_text()
            assert "Completed removal fixture" not in todo_text
            assert "> **Status:** Complete" in completed_plan.read_text()

            status_select = page.locator(".ledger-row-shell", has_text="Archive fixture").locator("[data-task-status-select]").first
            expect(status_select).to_be_visible(timeout=15000)
            status_select.select_option("archive")
            expect(page.get_by_text("Task status changed to Archived.").first).to_be_visible(timeout=15000)
            archive_plan = project_root / "documentation" / "task" / "planning" / "archive" / "archive-fixture.md"
            pending_archive_plan = project_root / "documentation" / "task" / "planning" / "pending" / "archive-fixture.md"
            assert archive_plan.is_file()
            assert not pending_archive_plan.exists()
            todo_text = (project_root / "documentation" / "task" / "todo.md").read_text()
            assert "Archive fixture" not in todo_text
            assert "> **Status:** Archived" in archive_plan.read_text()
            page.goto(f"http://127.0.0.1:{port}/#/projects", wait_until="domcontentloaded")
            expect(page.get_by_text("Runtime server").first).to_be_visible(timeout=15000)
            expect(page.get_by_text("No browser directory handle is required.").first).to_be_visible(timeout=15000)
            assert not dialogs, f"Unexpected confirmation dialog(s) while changing status: {dialogs}"
            assert not errors, errors
            browser.close()
    finally:
        process.terminate()
        process.wait(timeout=5)
        if original_served is None:
            try:
                served_config.unlink()
            except FileNotFoundError:
                pass
        else:
            served_config.parent.mkdir(parents=True, exist_ok=True)
            served_config.write_text(original_served)

print(f"browser_filesystem_e2e.py: pass ({TARGET_NAME})")
