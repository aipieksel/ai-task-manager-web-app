#!/usr/bin/env python3
"""Create a canonical Codex TaskManager plan folder.

This helper is intentionally small and dependency-free so agents can create the
required plan.json + twelve section files without improvising the manifest.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import re
import sys
from pathlib import Path

LIFECYCLES = [
    "draft",
    "pending",
    "approved",
    "in-progress",
    "review",
    "user-verification",
    "failed-user-verification",
    "completed",
    "archive",
    "parked",
    "blocker",
]

SECTIONS = [
    {"order": 1, "file": "01-original-scope.md", "sectionId": "01-original-scope", "title": "Original Scope", "navLabel": "Scope", "layout": "article", "ownerRole": "planner", "editPolicy": "frozen-after-approval"},
    {"order": 2, "file": "02-planning-and-decisions.md", "sectionId": "02-planning-and-decisions", "title": "Planning and Decisions", "navLabel": "Planning", "layout": "decision-log", "ownerRole": "planner", "editPolicy": "frozen-after-approval"},
    {"order": 3, "file": "03-implementation-checklist.md", "sectionId": "03-implementation-checklist", "title": "Implementation Checklist", "navLabel": "Implementation", "layout": "checklist", "ownerRole": "planner", "editPolicy": "taskmanager-synced"},
    {"order": 4, "file": "04-testing-checklist.md", "sectionId": "04-testing-checklist", "title": "Testing Checklist", "navLabel": "Testing", "layout": "checklist", "ownerRole": "planner", "editPolicy": "taskmanager-synced"},
    {"order": 5, "file": "05-risk-rollback-acceptance.md", "sectionId": "05-risk-rollback-acceptance", "title": "Risk, Rollback, and Acceptance", "navLabel": "Acceptance", "layout": "matrix", "ownerRole": "planner", "editPolicy": "frozen-after-approval"},
    {"order": 6, "file": "06-executor-report.md", "sectionId": "06-executor-report", "title": "Executor Report", "navLabel": "Executor", "layout": "report", "ownerRole": "executor", "editPolicy": "role-owned"},
    {"order": 7, "file": "07-executor-evidence.md", "sectionId": "07-executor-evidence", "title": "Executor Evidence", "navLabel": "Evidence", "layout": "evidence", "ownerRole": "executor", "editPolicy": "role-owned"},
    {"order": 8, "file": "08-verification-handoff.md", "sectionId": "08-verification-handoff", "title": "Verification Handoff", "navLabel": "Verification", "layout": "matrix", "ownerRole": "executor", "editPolicy": "role-owned"},
    {"order": 9, "file": "09-r1-review.md", "sectionId": "09-r1-review", "title": "R1 Review", "navLabel": "R1 Review", "layout": "review", "ownerRole": "reviewer", "editPolicy": "role-owned"},
    {"order": 10, "file": "10-post-implementation-checklist.md", "sectionId": "10-post-implementation-checklist", "title": "Post-Implementation Checklist", "navLabel": "Post Checklist", "layout": "checklist", "ownerRole": "reviewer", "editPolicy": "taskmanager-synced"},
    {"order": 11, "file": "11-r2-closeout-review.md", "sectionId": "11-r2-closeout-review", "title": "R2 Closeout Review", "navLabel": "R2 Review", "layout": "review", "ownerRole": "reviewer", "editPolicy": "role-owned"},
    {"order": 12, "file": "12-comments.md", "sectionId": "12-comments", "title": "Comments", "navLabel": "Comments", "layout": "comments", "ownerRole": "all", "editPolicy": "append-only", "appendOnly": True},
]

FRONTMATTER_KEY_MAP = {
    "sectionId": "section_id",
    "navLabel": "nav_label",
    "ownerRole": "owner_role",
    "editPolicy": "edit_policy",
}



DEFAULT_TASK_SYSTEM_CONFIG = {
    "schema": "codex-task-system-config/v1",
    "version": 1,
    "planning": {
        "defaultMode": "auto",
        "allowInvocationModeOverride": True,
        "supportedInvocationModes": ["quick", "standard", "full"],
        "quickModeSafety": "quick-mode-cannot-bypass-hard-exclusions",
    },
    "codexGoal": {
        "enabled": True,
        "requirePlanEndGoal": True,
        "disabledBehavior": "record-disabled-and-skip-goal-tools",
    },
    "review": {
        "requireIndependentR1": True,
        "autoSpawnSubagent": True,
        "waitForSpawnedReviewer": True,
        "whenAutoSpawnDisabled": "move-to-review-and-stop",
    },
    "lifecycle": {
        "userVerification": {
            "treatAsDoneForAgentWork": True,
            "excludeFromActiveAssignment": True,
            "requireExplicitFailureToReopen": True,
            "doNotMarkDirtyBecauseStillInUserVerification": True,
        }
    },
}


def deep_merge(base: dict[str, object], override: dict[str, object]) -> dict[str, object]:
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged[key], value)  # type: ignore[arg-type]
        else:
            merged[key] = value
    return merged


def strip_yaml_comment(line: str) -> str:
    quote: str | None = None
    escaped = False
    for index, char in enumerate(line):
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if quote:
            if char == quote:
                quote = None
            continue
        if char in {'"', "'"}:
            quote = char
            continue
        if char == "#":
            return line[:index]
    return line


def parse_yaml_scalar(value: str) -> object:
    value = value.strip()
    lower = value.lower()
    if lower == "true":
        return True
    if lower == "false":
        return False
    if lower in {"null", "none", "~"}:
        return None
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return []
        return [parse_yaml_scalar(part.strip()) for part in inner.split(",")]
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    if re.fullmatch(r"-?\d+", value):
        return int(value)
    return value


def parse_simple_yaml_mapping(text: str) -> dict[str, object]:
    root: dict[str, object] = {}
    stack: list[tuple[int, dict[str, object]]] = [(-1, root)]
    for raw_line in text.splitlines():
        uncommented = strip_yaml_comment(raw_line).rstrip()
        if not uncommented.strip():
            continue
        indent = len(uncommented) - len(uncommented.lstrip(" "))
        stripped = uncommented.strip()
        if ":" not in stripped:
            raise ValueError(f"unsupported YAML line: {raw_line!r}")
        key, value = stripped.split(":", 1)
        key = key.strip()
        value = value.strip()
        while stack and indent <= stack[-1][0]:
            stack.pop()
        if not stack:
            raise ValueError(f"invalid YAML indentation near: {raw_line!r}")
        current = stack[-1][1]
        if not value:
            child: dict[str, object] = {}
            current[key] = child
            stack.append((indent, child))
        else:
            current[key] = parse_yaml_scalar(value)
    return root


def load_task_system_config(task_root: Path) -> dict[str, object]:
    yaml_path = task_root / "task-system.config.yaml"
    legacy_json_path = task_root / "task-system.config.json"
    if yaml_path.exists():
        try:
            raw = parse_simple_yaml_mapping(yaml_path.read_text(errors="replace"))
        except ValueError as exc:
            raise SystemExit(f"invalid task-system config YAML at {yaml_path}: {exc}") from exc
        source = "docs/tasks/task-system.config.yaml"
        source_path = yaml_path
    elif legacy_json_path.exists():
        try:
            raw = json.loads(legacy_json_path.read_text(errors="replace"))
        except json.JSONDecodeError as exc:
            raise SystemExit(f"invalid legacy task-system config JSON at {legacy_json_path}: {exc}") from exc
        source = "docs/tasks/task-system.config.json (legacy fallback)"
        source_path = legacy_json_path
    else:
        return {
            "schema": "codex-task-system-config-snapshot/v1",
            "source": "defaults-no-config-file",
            "sourcePath": str(yaml_path),
            "config": DEFAULT_TASK_SYSTEM_CONFIG,
        }
    if not isinstance(raw, dict) or raw.get("schema") != "codex-task-system-config/v1":
        got = raw.get("schema") if isinstance(raw, dict) else type(raw).__name__
        raise SystemExit(f"invalid task-system config schema at {source_path}: {got!r}")
    config = deep_merge(DEFAULT_TASK_SYSTEM_CONFIG, raw)
    return {
        "schema": "codex-task-system-config-snapshot/v1",
        "source": source,
        "sourcePath": str(source_path),
        "config": config,
    }


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return re.sub(r"-+", "-", slug) or "task"


def next_plan_id(task_root: Path) -> str:
    max_id = 0
    planning = task_root / "planning"
    for lifecycle in LIFECYCLES:
        folder = planning / lifecycle
        if not folder.exists():
            continue
        for child in folder.iterdir():
            if not child.is_dir():
                continue
            match = re.match(r"^(\d{5})-", child.name)
            if match:
                max_id = max(max_id, int(match.group(1)))
    return f"{max_id + 1:05d}"


def yaml_scalar(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value).replace('"', '\\"')
    return f'"{text}"'


def section_frontmatter(section: dict[str, object], *, summary: str, status: str) -> str:
    fields = {
        "schema": "task-plan-section/v1",
        "section_id": section["sectionId"],
        "nav_label": section["navLabel"],
        "order": section["order"],
        "layout": section["layout"],
        "owner_role": section["ownerRole"],
        "edit_policy": section["editPolicy"],
        "summary": summary,
        "status": status,
    }
    lines = ["---"]
    for key, value in fields.items():
        lines.append(f"{key}: {yaml_scalar(value)}")
    lines.append("---")
    return "\n".join(lines) + "\n\n"


def section_body(section: dict[str, object], title: str, goal: str, lifecycle: str) -> str:
    heading = section["title"]
    file_name = section["file"]
    at = f"> **At a Glance:** {heading} for `{title}`. Status: `{lifecycle}`.\n\n"
    if file_name == "01-original-scope.md":
        return (
            f"# {heading}\n\n"
            f"{at}"
            "## Original Request\n\n_To be recorded by the planner._\n\n"
            "## Interpreted Target\n\n_To be completed after documentation routing._\n\n"
            "## Required Outcome\n\n_To be completed by the planner._\n\n"
            "## Codex End Goal\n\n"
            f"{goal}\n\n"
            "## In Scope\n\n_To be completed by the planner._\n\n"
            "## Non-Scope\n\n_To be completed by the planner._\n"
        )
    if file_name == "02-planning-and-decisions.md":
        return (
            f"# {heading}\n\n"
            f"{at}"
            "## Documentation Route\n\n_To be completed by the planner._\n\n"
            "## Relevant Lessons\n\nRelevant lessons: none.\n\n"
            "## Questions and Decisions\n\n_To be completed by the planner._\n\n"
            "## Evidence Scan\n\n_To be completed by the planner._\n\n"
            "## Plan Quality Assessment\n\n"
            "**Plan Score:** Provisional 0/10\n\n"
            "### What is good\n- _To be completed by the planner._\n\n"
            "### What is risky / not good\n- _To be completed by the planner._\n\n"
            "### What was not accounted for yet\n- _To be completed by the planner._\n\n"
            "### Assumptions\n- _To be completed by the planner._\n\n"
            "### Recommended path\n- _To be completed by the planner._\n\n"
            "### Codex End Goal\n"
            f"- {goal}\n\n"
            "### Why this is not 10/10\n- _Draft not fully planned yet._\n\n"
            "### Approval readiness\n- Not ready — draft initialization only.\n"
        )
    if file_name == "03-implementation-checklist.md":
        return f"# {heading}\n\n{at}- [ ] Define implementation checklist after documentation route and evidence scan.\n"
    if file_name == "04-testing-checklist.md":
        return f"# {heading}\n\n{at}- [ ] Define testing and verification checklist after evidence scan.\n"
    if file_name == "05-risk-rollback-acceptance.md":
        return f"# {heading}\n\n{at}## Risk Matrix\n\n_To be completed by the planner._\n\n## Rollback\n\n_To be completed by the planner._\n\n## Acceptance Criteria\n\n_To be completed by the planner._\n"
    if file_name == "10-post-implementation-checklist.md":
        return f"# {heading}\n\n{at}- [ ] Documentation/log updates complete.\n- [ ] User Verification Required\n"
    if file_name == "12-comments.md":
        return f"# {heading}\n\n{at}## Comments\n\n_Append-only comments from user and sub-agents._\n"
    return f"# {heading}\n\n{at}## Status\n\n_Not started. This file is owned by `{section['ownerRole']}` during its lifecycle stage._\n"


def create_plan(args: argparse.Namespace) -> dict[str, object]:
    project_root = Path(args.project_root).resolve()
    task_root = (project_root / args.task_root).resolve()
    date = args.date or _dt.date.today().isoformat()
    title = args.title.strip()
    if not title:
        raise SystemExit("--title is required")
    goal = args.codex_end_goal.strip()
    if len(goal) < 40:
        raise SystemExit("--codex-end-goal must be a concrete outcome-level sentence of at least 40 characters")
    plan_id = args.plan_id or next_plan_id(task_root)
    if not re.fullmatch(r"\d{5}", plan_id):
        raise SystemExit("--plan-id must be five digits")
    slug = args.slug or slugify(title)
    folder_name = f"{plan_id}-{date}-{slug}"
    lifecycle = args.lifecycle
    if lifecycle not in LIFECYCLES:
        raise SystemExit(f"invalid lifecycle {lifecycle!r}; expected one of {', '.join(LIFECYCLES)}")
    plan_dir = task_root / "planning" / lifecycle / folder_name
    if plan_dir.exists() and not args.update_existing:
        raise SystemExit(f"plan folder already exists: {plan_dir}")
    for lc in LIFECYCLES:
        (task_root / "planning" / lc).mkdir(parents=True, exist_ok=True)
    plan_dir.mkdir(parents=True, exist_ok=True)
    now = date
    config_snapshot = load_task_system_config(task_root)
    config_snapshot["capturedAt"] = _dt.datetime.now().isoformat(timespec="seconds")
    plan_json = {
        "schema": "task-plan-folder/v1",
        "planId": plan_id,
        "folderName": folder_name,
        "title": title,
        "slug": slug,
        "created": now,
        "updated": now,
        "lifecycle": lifecycle,
        "planningState": args.planning_state,
        "status": args.status,
        "riskLevel": args.risk_level,
        "planScore": args.plan_score,
        "codexEndGoal": goal,
        "taskSystemConfigSnapshot": config_snapshot,
        "sections": SECTIONS,
    }
    (plan_dir / "plan.json").write_text(json.dumps(plan_json, indent=2) + "\n")
    for section in SECTIONS:
        path = plan_dir / str(section["file"])
        if path.exists() and not args.update_existing:
            continue
        summary = f"{section['title']} for {title}."
        body = section_frontmatter(section, summary=summary, status=lifecycle)
        body += section_body(section, title, goal, lifecycle)
        path.write_text(body)
    return {"planPath": str(plan_dir), "planId": plan_id, "folderName": folder_name, "lifecycle": lifecycle}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Create a canonical TaskManager plan folder")
    parser.add_argument("--project-root", default=".", help="Project root; default current directory")
    parser.add_argument("--task-root", default="docs/tasks", help="Task root relative to project root")
    parser.add_argument("--title", required=True, help="Human-readable task title")
    parser.add_argument("--codex-end-goal", required=True, help="Concise outcome-level goal with completion guard")
    parser.add_argument("--slug", help="Optional kebab-case slug; derived from title when omitted")
    parser.add_argument("--date", help="YYYY-MM-DD; defaults to today")
    parser.add_argument("--plan-id", help="Optional five-digit id; defaults to next id across lifecycle folders")
    parser.add_argument("--lifecycle", default="draft", choices=LIFECYCLES)
    parser.add_argument("--planning-state", default="questions-pending")
    parser.add_argument("--status", default="Draft")
    parser.add_argument("--risk-level", default="medium")
    parser.add_argument("--plan-score", default="Provisional 0/10")
    parser.add_argument("--update-existing", action="store_true", help="Overwrite plan.json and section seeds in an existing folder")
    args = parser.parse_args(argv[1:])
    result = create_plan(args)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
