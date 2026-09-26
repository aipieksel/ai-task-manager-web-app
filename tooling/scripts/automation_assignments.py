#!/usr/bin/env python3
"""Durable TaskManager automation assignment registry.

This helper keeps project/reviewer agent ownership durable across heartbeat turns so
plans that were claimed by automation can be recovered instead of being left in
planning/in-progress/ forever.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from taskmanager_registry import PUBLIC_APP_SUPPORT_RUNTIME_DIR, resolve_project_registry

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REGISTRY = PUBLIC_APP_SUPPORT_RUNTIME_DIR / "automation-assignments.json"
DEFAULT_PROJECTS = ROOT / "src" / "taskmanager" / "data" / "runtime" / "projects.json"
DEFAULT_APP_SUPPORT_PROJECTS = PUBLIC_APP_SUPPORT_RUNTIME_DIR / "projects.json"
DEFAULT_UI_CONFIG = PUBLIC_APP_SUPPORT_RUNTIME_DIR / "config" / "ui.json"
DEFAULT_CONTROL = PUBLIC_APP_SUPPORT_RUNTIME_DIR / "automation-control.json"
DEFAULT_AUDIT = PUBLIC_APP_SUPPORT_RUNTIME_DIR / "automation-audit.jsonl"
DEFAULT_STALE_AFTER_MINUTES = 60
ACTIVE_STATES = {"running"}
TERMINAL_STATES = {"completed", "released", "cancelled", "blocked"}
AUTOMATION_METADATA_PREFIXES = (
    "> **Automation Claimed:**",
    "> **Automation Assignment ID:**",
    "> **Automation Agent Role:**",
    "> **Automation Agent ID:**",
    "> **Automation Agent Nickname:**",
    "> **Automation Lease Expires:**",
    "> **Automation Last Heartbeat:**",
    "> **Automation Handoff Reason:**",
    "> **Automation State:**",
    "> **Automation Notes:**",
    "> **Automation Completed At:**",
)

STATUS_PATTERNS = [
    re.compile(r"^>\s*\*\*Status:\*\*\s*(.+)$", re.I | re.M),
    re.compile(r"^>\s*Status:\s*(.+)$", re.I | re.M),
    re.compile(r"^\*\*Status\*\*:\s*(.+)$", re.I | re.M),
    re.compile(r"^Status:\s*(.+)$", re.I | re.M),
]
PLAN_FOLDER_PATTERN = re.compile(
    r"(?P<prefix>^|/)(?P<base>planning)/pending/(?P<name>[^/]+(?:\.md)?)$",
    re.I,
)


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def normalized_path(value: str | Path) -> str:
    return str(Path(value).expanduser().resolve(strict=False))


def assignment_id(project_id: str, role: str, plan_path: str) -> str:
    raw = f"{project_id}\0{role}\0{normalized_path(plan_path)}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:20]


def empty_registry() -> dict[str, Any]:
    return {"version": 1, "updatedAt": iso(now_utc()), "assignments": []}



def empty_control() -> dict[str, Any]:
    return {"version": 1, "updatedAt": iso(now_utc()), "projects": {}, "reviewers": {}, "threadLinks": {}, "conflicts": {}}


def load_control(path: Path = DEFAULT_CONTROL) -> dict[str, Any]:
    if not path.exists():
        return empty_control()
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise ValueError(f"Automation control policy must be an object: {path}")
    data.setdefault("version", 1)
    data.setdefault("projects", {})
    data.setdefault("reviewers", {})
    data.setdefault("threadLinks", {})
    data.setdefault("conflicts", {})
    return data


def save_control(control: dict[str, Any], path: Path = DEFAULT_CONTROL) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    control["updatedAt"] = iso(now_utc())
    path.write_text(json.dumps(control, indent=2, sort_keys=True) + "\n")


def append_audit(event: dict[str, Any], path: Path = DEFAULT_AUDIT) -> dict[str, Any]:
    payload = {
        "version": 1,
        "timestamp": iso(now_utc()),
        "source": "automation_assignments.py",
        **event,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, sort_keys=True) + "\n")
    return payload


def reviewer_policy_keys(item: dict[str, Any]) -> list[str]:
    project_id = str(item.get("projectId") or "")
    plan = str(item.get("planBasename") or "")
    return [f"{project_id}::{plan}", project_id]


def policy_hold_for_item(item: dict[str, Any], control: dict[str, Any]) -> dict[str, Any] | None:
    project_id = str(item.get("projectId") or "")
    project_policy = (control.get("projects") or {}).get(project_id) or {}
    if project_policy.get("paused"):
        return {
            **item,
            "held": True,
            "holdReason": "project_paused",
            "holdLabel": "Held: project paused by user",
            "recommendedAction": "unpause_project",
            "policy": project_policy,
        }
    if item.get("role") == "reviewer-agent":
        reviewers = control.get("reviewers") or {}
        for key in reviewer_policy_keys(item):
            reviewer_policy = reviewers.get(key) or {}
            if reviewer_policy.get("stopped"):
                return {
                    **item,
                    "held": True,
                    "holdReason": "reviewer_stopped",
                    "holdLabel": "Held: reviewer stopped by user",
                    "recommendedAction": "resume_reviewer",
                    "policy": reviewer_policy,
                }
    return None


def active_assignment_hold(item: dict[str, Any]) -> dict[str, Any] | None:
    if not item.get("assigned"):
        return None
    return {
        **item,
        "held": True,
        "holdReason": "active_assignment_exists",
        "holdLabel": "Held: active assignment already exists",
        "recommendedAction": "nudge_active_agent",
    }


def stale_assignment_hold(summary: dict[str, Any]) -> dict[str, Any]:
    assignment = summary.get("assignment") or {}
    return {
        "projectId": assignment.get("projectId", ""),
        "projectName": assignment.get("projectName", ""),
        "projectRoot": assignment.get("projectRoot", ""),
        "taskRoot": assignment.get("taskRoot", ""),
        "role": assignment.get("role", ""),
        "reason": assignment.get("handoffReason", ""),
        "folderState": "assignment",
        "status": assignment.get("state", ""),
        "planPath": assignment.get("planPath", ""),
        "planBasename": assignment.get("planBasename", ""),
        "assignmentId": assignment.get("id", ""),
        "agentId": assignment.get("agentId", ""),
        "leaseExpiresAt": assignment.get("leaseExpiresAt", ""),
        "held": True,
        "holdReason": "stale_assignment_cleanup",
        "holdLabel": "Held: stale assignment needs cleanup or recovery",
        "recommendedAction": summary.get("recommendedAction", "recover_or_resume_assignment"),
        "staleForMinutes": summary.get("staleForMinutes", 0),
    }


def non_eligible_hold(item: dict[str, Any]) -> dict[str, Any]:
    return {
        **item,
        "held": True,
        "holdReason": "non_buildable_lifecycle",
        "holdLabel": f"Held: {item.get('folderState', 'lifecycle')} is non-buildable",
        "recommendedAction": "leave_until_status_changes",
    }

def load_registry(path: Path = DEFAULT_REGISTRY) -> dict[str, Any]:
    if not path.exists():
        return empty_registry()
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise ValueError(f"Registry must be an object: {path}")
    if data.get("version") != 1:
        raise ValueError(f"Unsupported registry version in {path}: {data.get('version')}")
    data.setdefault("assignments", [])
    return data


def save_registry(registry: dict[str, Any], path: Path = DEFAULT_REGISTRY) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    registry["updatedAt"] = iso(now_utc())
    path.write_text(json.dumps(registry, indent=2, sort_keys=True) + "\n")


def is_expired(entry: dict[str, Any], at: datetime | None = None) -> bool:
    at = at or now_utc()
    lease = parse_time(entry.get("leaseExpiresAt"))
    return bool(lease and lease < at)


def is_active(entry: dict[str, Any], at: datetime | None = None) -> bool:
    return entry.get("state") in ACTIVE_STATES and not is_expired(entry, at)


def is_terminal_assignment(entry: dict[str, Any]) -> bool:
    """Return true when an assignment should not be automatically recovered."""
    if entry.get("state") in TERMINAL_STATES:
        return True
    # Older registry versions could mark a finished blocked assignment as
    # expired because finish() set leaseExpiresAt to completedAt. A completed
    # timestamp means the agent intentionally closed the assignment, so it is
    # not an orphan to recover even if the state has already been rewritten.
    return bool(entry.get("state") == "expired" and entry.get("completedAt"))


def assignment_progress_time(entry: dict[str, Any]) -> datetime | None:
    """Return the latest known agent progress signal for an assignment."""
    return parse_time(entry.get("lastHeartbeatAt")) or parse_time(entry.get("claimedAt"))


def stale_assignment_summary(
    entry: dict[str, Any],
    *,
    at: datetime | None = None,
    stale_after_minutes: int = DEFAULT_STALE_AFTER_MINUTES,
) -> dict[str, Any] | None:
    """Return stale-assignment metadata when an assignment has not checked in recently."""
    if is_terminal_assignment(entry):
        return None
    at = at or now_utc()
    progress_at = assignment_progress_time(entry)
    if not progress_at:
        return None
    stale_for = at - progress_at
    if stale_for < timedelta(minutes=stale_after_minutes):
        return None
    return {
        "assignment": entry,
        "lastProgressAt": iso(progress_at),
        "staleForMinutes": int(stale_for.total_seconds() // 60),
        "staleAfterMinutes": stale_after_minutes,
        "expired": is_expired(entry, at),
        "recommendedAction": "nudge_active_agent" if is_active(entry, at) else "recover_or_resume_assignment",
    }


def apply_assignment_operator_action(assignment: dict[str, Any], action: str, reason: str, timestamp: str) -> tuple[dict[str, Any], dict[str, Any], bool]:
    """Apply a UI/runtime assignment action with explicit reclaim semantics.

    release-assignment and reclaim-orphan both release the lease so reconcile can
    offer the work for a fresh claim. cancel-assignment explicitly cancels the
    current assignment lease. nudge-agent is audit-only and does not mutate the
    registry entry.
    """
    previous_state = dict(assignment)
    if action == "nudge-agent":
        return previous_state, dict(assignment), False
    if action not in {"release-assignment", "cancel-assignment", "reclaim-orphan"}:
        raise ValueError(f"Unsupported assignment action: {action}")
    assignment["state"] = "cancelled" if action == "cancel-assignment" else "released"
    assignment["completedAt"] = timestamp
    assignment["lastHeartbeatAt"] = timestamp
    assignment["leaseExpiresAt"] = timestamp
    assignment["notes"] = reason
    if action == "reclaim-orphan":
        assignment["reclaimedAt"] = timestamp
        assignment["reclaimSemantics"] = "released_for_reclaim"
    else:
        assignment.pop("reclaimedAt", None)
        assignment.pop("reclaimSemantics", None)
    return previous_state, dict(assignment), True


def find_assignment(
    registry: dict[str, Any],
    *,
    id_: str | None = None,
    project_id: str | None = None,
    role: str | None = None,
    plan_path: str | None = None,
) -> dict[str, Any] | None:
    normalized = normalized_path(plan_path) if plan_path else None
    for entry in registry.get("assignments", []):
        if id_ and entry.get("id") != id_:
            continue
        if project_id and entry.get("projectId") != project_id:
            continue
        if role and entry.get("role") != role:
            continue
        if normalized and normalized_path(entry.get("planPath", "")) != normalized:
            continue
        return entry
    return None


def parse_status(text: str) -> str:
    for pattern in STATUS_PATTERNS:
        match = pattern.search(text)
        if match:
            return match.group(1).strip()
    return ""


def replace_status(text: str, status: str) -> str:
    """Update or insert the plan status metadata line."""
    for pattern in STATUS_PATTERNS:
        match = pattern.search(text)
        if match:
            start, end = match.span(1)
            return f"{text[:start]}{status}{text[end:]}"
    lines = StringLines(text)
    insert_at = 1 if lines.lines and lines.lines[0].startswith("#") else 0
    lines.lines[insert_at:insert_at] = ["", f"> **Status:** {status}"]
    return lines.text()


class StringLines:
    """Small helper to preserve trailing newlines after line-based edits."""

    def __init__(self, text: str) -> None:
        self.trailing_newline = text.endswith("\n")
        self.lines = text.splitlines()

    def text(self) -> str:
        result = "\n".join(self.lines)
        if self.trailing_newline or not result.endswith("\n"):
            result += "\n"
        return result


def safe_relative(path: Path, base: Path) -> str:
    try:
        return path.relative_to(base).as_posix()
    except ValueError:
        return path.as_posix()


def project_truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on", "enabled"}


def projects_count(path: Path) -> int:
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return 0
    projects = data.get("projects") if isinstance(data, dict) else None
    return len(projects) if isinstance(projects, list) else 0


def resolved_projects_path(path: Path | None = None) -> Path:
    return resolve_project_registry(path, repo_path=DEFAULT_PROJECTS, app_support_path=DEFAULT_APP_SUPPORT_PROJECTS).active_path


def resolved_ui_config_path(path: Path | None = None) -> Path:
    return path or DEFAULT_UI_CONFIG


def load_ui_config(path: Path | None = None) -> dict[str, Any]:
    path = resolved_ui_config_path(path)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def unique_order_keys(values: Any) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values if isinstance(values, list) else []:
        key = str(value or "").strip()
        if key and key not in seen:
            seen.add(key)
            result.append(key)
    return result


def queue_custom_order(ui_config: dict[str, Any]) -> dict[str, Any]:
    raw = (((ui_config.get("routes") or {}).get("queue") or {}).get("customOrder") or {})
    enabled_scopes = raw.get("enabledScopes") if isinstance(raw, dict) else {}
    orders = raw.get("orders") if isinstance(raw, dict) else {}
    return {
        "enabledScopes": {
            str(scope): bool(enabled)
            for scope, enabled in (enabled_scopes or {}).items()
            if str(scope or "").strip().startswith("project:")
        },
        "orders": {
            str(scope): unique_order_keys(order)
            for scope, order in (orders or {}).items()
            if str(scope or "").strip().startswith("project:")
        },
    }


def custom_order_scope(project_id: str) -> str:
    return f"project:{project_id}"


def queue_custom_key(project_id: str, plan_basename: str) -> str:
    return f"{project_id}::{plan_basename}"


def custom_order_rank(project_id: str, plan_basename: str, ui_config: dict[str, Any]) -> tuple[int, int]:
    custom = queue_custom_order(ui_config)
    key = queue_custom_key(project_id, plan_basename)
    scope = custom_order_scope(project_id)
    if not custom["enabledScopes"].get(scope):
        return (2, 0)
    order = custom["orders"].get(scope, [])
    if key in order:
        return (0, order.index(key))
    # Ranked work must run before newly discovered/unranked work while the project scope is enabled.
    return (1, len(order))


def file_created_at(path: Path) -> float:
    stat = path.stat()
    created = getattr(stat, "st_birthtime", None)
    if created is None:
        created = min(stat.st_ctime, stat.st_mtime)
    return float(created)


def file_created_at_ms(path: Path) -> int:
    return int(file_created_at(path) * 1000)


def file_created_at_iso(path: Path) -> str:
    return iso(datetime.fromtimestamp(file_created_at(path), timezone.utc))


def natural_key(value: str) -> tuple[Any, ...]:
    parts = re.split(r"(\d+)", value.lower())
    return tuple(int(part) if part.isdigit() else part for part in parts)


def task_sequence_from_text(value: str) -> int | None:
    match = re.search(r"\btask\s*(\d+)\b", value, re.I)
    if match:
        return int(match.group(1))
    return None


def plan_sequence_number(path: Path) -> int | None:
    sequence = task_sequence_from_text(path.name)
    if sequence is not None:
        return sequence
    try:
        head = (path / "plan.json").read_text(errors="replace")[:4096] if path.is_dir() else path.read_text(errors="replace")[:4096]
    except OSError:
        return None
    return task_sequence_from_text(head)


def plan_json_path(path: Path) -> Path:
    return path / "plan.json" if path.is_dir() else path


def iter_plan_artifacts(directory: Path) -> list[Path]:
    if not directory.exists():
        return []
    artifacts = list(directory.glob("*.md"))
    artifacts.extend(child for child in directory.iterdir() if child.is_dir() and (child / "plan.json").is_file())
    return sorted(artifacts, key=plan_priority_key)


def read_plan_artifact_text(path: Path) -> str:
    if path.is_dir():
        manifest = path / "plan.json"
        if not manifest.is_file():
            return ""
        try:
            data = json.loads(manifest.read_text(errors="replace"))
        except json.JSONDecodeError:
            return manifest.read_text(errors="replace")
        parts = [json.dumps(data, indent=2)]
        for section in data.get("sections", []) if isinstance(data, dict) else []:
            file_name = section.get("file") if isinstance(section, dict) else ""
            section_path = path / str(file_name)
            if section_path.is_file():
                parts.append(section_path.read_text(errors="replace"))
        return "\n\n".join(parts)
    return path.read_text(errors="replace")


def parse_plan_artifact_status(path: Path, text: str = "") -> str:
    if path.is_dir():
        try:
            data = json.loads((path / "plan.json").read_text(errors="replace"))
            return str(data.get("status") or "")
        except (OSError, json.JSONDecodeError):
            return ""
    return parse_status(text)


def plan_priority_key(path: Path) -> tuple[int, int, float, int, tuple[Any, ...]]:
    sequence = plan_sequence_number(path)
    try:
        created = file_created_at(path)
    except OSError:
        created = 0
    # Filesystem creation time is the authoritative queue/scheduling priority.
    # Task numbers remain a deterministic tie-breaker only.
    return (0 if created else 1, 0 if sequence is not None else 1, created, sequence or 0, natural_key(path.name))


def blocking_earlier_created_plans(plan_path: Path, task_root: Path, project_id: str = "", ui_config: dict[str, Any] | None = None) -> list[Path]:
    if not task_root:
        return []
    ui_config = ui_config or {}
    plan_basename = plan_path.name
    plan_custom_rank = custom_order_rank(project_id, plan_basename, ui_config) if project_id else (2, 0)
    try:
        plan_created = file_created_at(plan_path)
    except OSError:
        plan_created = 0
    plan_priority = plan_priority_key(plan_path)
    blockers: list[Path] = []
    for folder in ["planning/approved", "planning/in-progress"]:
        directory = task_root / folder
        if not directory.exists():
            continue
        for candidate in iter_plan_artifacts(directory):
            if candidate.resolve() == plan_path.resolve():
                continue
            candidate_custom_rank = custom_order_rank(project_id, candidate.name, ui_config) if project_id else (2, 0)
            if candidate_custom_rank[0] < 2 or plan_custom_rank[0] < 2:
                if candidate_custom_rank < plan_custom_rank:
                    blockers.append(candidate)
                continue
            try:
                candidate_created = file_created_at(candidate)
            except OSError:
                candidate_created = 0
            if candidate_created and plan_created and candidate_created < plan_created:
                blockers.append(candidate)
            elif (not candidate_created or not plan_created) and plan_priority_key(candidate) < plan_priority:
                blockers.append(candidate)
    return sorted(blockers, key=lambda path: (custom_order_rank(project_id, path.name, ui_config) if project_id else (2, 0), plan_priority_key(path)))


def enforce_project_sequence_for_claim(args: argparse.Namespace) -> None:
    if args.force or args.role != "project-agent" or args.reason != "approved_execution" or not args.task_root:
        return
    plan_path = Path(normalized_path(args.plan_path))
    task_root = Path(normalized_path(args.task_root))
    blockers = blocking_earlier_created_plans(plan_path, task_root, args.project_id, load_ui_config(args.ui_config))
    if not blockers:
        return
    plan_created = file_created_at_ms(plan_path) if plan_path.exists() else 0
    raise SystemExit(
        json.dumps(
            {
                "ok": False,
                "error": "project_custom_order_blocked" if custom_order_rank(args.project_id, plan_path.name, load_ui_config(args.ui_config))[0] < 2 else "project_created_time_blocked",
                "planPath": str(plan_path),
                "planBasename": plan_path.name,
                "createdAtMs": plan_created,
                "sequence": plan_sequence_number(plan_path),
                "blockingPlans": [str(path) for path in blockers],
                "hint": "Earlier custom-ordered or Earlier-created project-agent work is still approved or in progress. Finish or explicitly --force that earlier work before claiming this one.",
            },
            indent=2,
        )
    )


def has_user_replied(status: str, text: str) -> bool:
    return bool(re.search(r"\buser\s*replied\b", status, re.I) or re.search(r"\buser\s*replied\b", text[:4000], re.I))


def is_sent_to_agent(status: str, text: str) -> bool:
    """Return whether authoritative status metadata requests agent action.

    User-verification plans can contain historical prose such as reviewer notes,
    rejection summaries, or evidence labels that mention "Sent to Agent". Those
    body mentions are not lifecycle state and must not requeue a normal
    ``status: User Verification`` handoff as actionable project-agent work.
    """
    return bool(
        re.search(r"\bsent\s+to\s+agent\b", status, re.I)
        or re.search(r"\bagent\s+(?:response\s+)?requested\b", status, re.I)
    )


def is_blocked_status(status: str, text: str = "") -> bool:
    first = text[:12000]
    return bool(
        re.search(r"\bblocked\b", status or "", re.I)
        or re.search(r"\bstatus\s*[:=]\s*blocked\b", first, re.I)
        or re.search(r'"status"\s*:\s*"blocked"', first, re.I)
        or re.search(r'"blocked"\s*:\s*true', first, re.I)
    )


def plan_manifest(path: Path) -> dict[str, Any]:
    if not path.is_dir():
        return {}
    manifest = path / "plan.json"
    if not manifest.is_file():
        return {}
    try:
        data = json.loads(manifest.read_text(errors="replace"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def plan_block_metadata(path: Path, text: str, status: str) -> dict[str, Any]:
    data = plan_manifest(path)
    raw = data.get("block") if isinstance(data.get("block"), dict) else {}
    if raw.get("blocked") or is_blocked_status(status, text):
        reason = str(raw.get("reason") or raw.get("blockedReason") or "").strip()
        if not reason:
            match = re.search(r"(?:blocked|blocker)\s*(?:reason)?\s*[:=]\s*([^\n]+)", text[:12000], re.I)
            reason = match.group(1).strip() if match else "Blocked status recorded without a structured reason."
        return {
            "blocked": True,
            "reason": reason,
            "blockedAt": str(raw.get("blockedAt") or raw.get("createdAt") or ""),
            "blockedBy": str(raw.get("blockedBy") or raw.get("actor") or ""),
            "unblockRequiredBy": str(raw.get("unblockRequiredBy") or raw.get("blockedBy") or "user_or_admin"),
            "history": raw.get("history") if isinstance(raw.get("history"), list) else [],
        }
    return {"blocked": False}


def last_agent_touch(existing: dict[str, Any] | None) -> str:
    if not existing:
        return ""
    return existing.get("lastHeartbeatAt") or existing.get("claimedAt") or existing.get("completedAt") or ""


def item_with_assignment_context(item: dict[str, Any], assignment: dict[str, Any] | None) -> dict[str, Any]:
    if not assignment:
        return dict(item)
    return {
        **item,
        "assignmentState": assignment.get("state", ""),
        "lastHeartbeatAt": assignment.get("lastHeartbeatAt", ""),
        "lastAgentTouchAt": last_agent_touch(assignment),
        "lastAgentNote": assignment.get("notes", ""),
        "claimedAt": assignment.get("claimedAt", ""),
        "completedAt": assignment.get("completedAt", ""),
    }


def _skip_checklist_heading(title: str) -> bool:
    return bool(re.search(
        r"executor\s+(?:implementation|verification)\s+results|implementation\s+results|verification\s+results|"
        r"correction\s+verification|review\s+evidence|r1\s+rejection|historical|superseded",
        title or "",
        re.I,
    ))


def _skip_checklist_line(text: str) -> bool:
    return bool(re.search(
        r"\bNOT\s+APPROVED\b|\bImplementation\s+Rejected\b|\brejected\b.*\bsuperseded\b|\bhistorical\b.*\bsuperseded\b",
        text or "",
        re.I,
    ))


def live_checklist_counts(text: str) -> tuple[int, int]:
    """Return checked/total for live plan checklist items.

    Execution/result/history sections are evidence records, not the source of
    truth for TaskManager progress. Agents must tick the original plan
    checklist items instead of adding duplicate checked result lists.
    """
    checked = 0
    total = 0
    heading = ""
    for line in text.splitlines():
        heading_match = re.match(r"\s*#{1,6}\s+(.+?)\s*$", line)
        if heading_match:
            heading = heading_match.group(1).strip()
        item = re.match(r"\s*-\s+\[([ xX])\]\s+(.+?)\s*$", line)
        if not item:
            continue
        body = item.group(2).strip()
        if re.match(r"\*\*Q[\w.-]+:", body):
            continue
        if _skip_checklist_heading(heading) or _skip_checklist_line(body):
            continue
        total += 1
        if item.group(1).lower() == "x":
            checked += 1
    return checked, total


def incomplete_live_checklists(path: Path, files: list[str]) -> list[str]:
    missing: list[str] = []
    for name in files:
        file_path = path / name
        if not file_path.is_file():
            continue
        checked, total = live_checklist_counts(file_path.read_text(errors="replace"))
        if total and checked < total:
            missing.append(f"{name} live checklist incomplete ({checked}/{total})")
    return missing


def review_ready(path: Path, text: str) -> tuple[bool, list[str]]:
    missing: list[str] = []
    if path.is_dir():
        evidence_dir = path / "evidence" / "screenshots"
        if not evidence_dir.is_dir() or not any(evidence_dir.iterdir()):
            missing.append("evidence/screenshots")
        missing.extend(incomplete_live_checklists(path, [
            "03-implementation-checklist.md",
            "04-testing-checklist.md",
            "05-implementation-plan.md",
            "06-implementation-plan.md",
            "06-testing-plan.md",
            "08-testing-and-verification.md",
            "10-post-implementation-checklist.md",
            "11-lifecycle-and-closeout.md",
        ]))
        verification_file = path / "08-testing-and-verification.md"
        if verification_file.is_file():
            text = verification_file.read_text(errors="replace")
    if not re.search(r"Executor verification\s*:\s*PASS|Final verification status\s*:\s*PASS|Selected live verification \([^)]+\)\s*:\s*PASS|Automated checks\s*:\s*PASS", text, re.I):
        missing.append("executor verification PASS status")
    closeout_match = re.search(r"##\s+Executor verification results\b(?P<body>.*)", text, re.I | re.S)
    verification_closeout = closeout_match.group("body") if closeout_match else text
    if re.search(r"Pending\s*\|\s*Pending|\|\s*(?:NOT RUN|BLOCKED|FAIL|PARTIAL)\s*\||Final verification status\s*:\s*(?:FAIL|PARTIAL|BLOCKED|NOT RUN)", verification_closeout, re.I):
        missing.append("no pending/blocked/failing verification rows")
    return not missing, missing


def plan_conflicts(path: Path, text: str, control: dict[str, Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    data = plan_manifest(path)
    raw_conflicts = data.get("conflicts") if isinstance(data.get("conflicts"), list) else []
    for conflict in raw_conflicts:
        if isinstance(conflict, dict):
            result.append({"source": "plan", **conflict})
        elif str(conflict or "").strip():
            result.append({"source": "plan", "reason": str(conflict).strip()})
    control_conflicts = (control.get("conflicts") or {}) if isinstance(control.get("conflicts"), dict) else {}
    for key, conflict in control_conflicts.items():
        if not isinstance(conflict, dict) or conflict.get("cleared"):
            continue
        paths = conflict.get("planPaths") if isinstance(conflict.get("planPaths"), list) else []
        if normalized_path(str(path)) in [normalized_path(str(item)) for item in paths]:
            result.append({"source": "control", "conflictKey": key, **conflict})
    explicit_text = re.findall(r"^\s*(?:[-*]\s*)?(?:explicit\s+)?conflicts?\s*(?:with|:)\s*([^\n]+)", text[:20000], re.I | re.M)
    for value in explicit_text:
        result.append({"source": "text", "reason": value.strip()})
    return result


def keyword_tokens(value: str) -> set[str]:
    stop = {"task", "plan", "approved", "review", "user", "verification", "agent", "lifecycle", "implementation", "project", "manager", "taskmanager", "00001", "00002", "00003", "00004", "00005"}
    return {token for token in re.findall(r"[a-z][a-z0-9-]{3,}", value.lower()) if token not in stop}


def summarize_item_for_notification(item: dict[str, Any], reason: str, severity: str, message: str) -> dict[str, Any]:
    return {
        "reason": reason,
        "severity": severity,
        "projectId": item.get("projectId", ""),
        "projectName": item.get("projectName", ""),
        "role": item.get("role", ""),
        "planPath": item.get("planPath", ""),
        "planBasename": item.get("planBasename", ""),
        "assignmentId": item.get("assignmentId", ""),
        "recommendedAction": item.get("recommendedAction", "inspect"),
        "message": message,
    }


def set_plan_block_state(plan_path: Path, *, blocked: bool, reason: str, actor: str, timestamp: str) -> tuple[dict[str, Any], dict[str, Any]]:
    if not plan_path.exists():
        raise FileNotFoundError(f"Plan path not found: {plan_path}")
    if not plan_path.is_dir():
        previous_text = plan_path.read_text(errors="replace")
        previous = {"path": str(plan_path), "status": parse_status(previous_text), "textHash": hashlib.sha256(previous_text.encode("utf-8")).hexdigest()[:12]}
        next_status = "Blocked" if blocked else (previous.get("status") if previous.get("status") and previous.get("status") != "Blocked" else "In Progress")
        updated = replace_status(previous_text, next_status)
        note = f"\n\n## {timestamp} — {'Blocked' if blocked else 'Unblocked'} by {actor}\n\nReason: {reason}\n"
        plan_path.write_text(updated.rstrip() + note + "\n")
        return previous, {**previous, "status": next_status, "blocked": blocked, "reason": reason}
    manifest = plan_path / "plan.json"
    data = json.loads(manifest.read_text(errors="replace"))
    previous = {"status": data.get("status", ""), "block": data.get("block", {})}
    history = []
    if isinstance(data.get("block"), dict):
        history = data["block"].get("history") if isinstance(data["block"].get("history"), list) else []
    event = {"blocked": blocked, "reason": reason, "actor": actor, "timestamp": timestamp}
    if blocked:
        data["block"] = {
            "blocked": True,
            "reason": reason,
            "blockedAt": timestamp,
            "blockedBy": actor,
            "statusBeforeBlock": data.get("status", ""),
            "history": [*history, event],
        }
        data["status"] = "Blocked"
    else:
        previous_block = data.get("block") if isinstance(data.get("block"), dict) else {}
        restore_status = previous_block.get("statusBeforeBlock") or "In Progress"
        data["block"] = {**previous_block, "blocked": False, "unblockedAt": timestamp, "unblockedBy": actor, "unblockReason": reason, "history": [*history, event]}
        data["status"] = restore_status if restore_status != "Blocked" else "In Progress"
    data["updated"] = timestamp[:10]
    manifest.write_text(json.dumps(data, indent=2) + "\n")
    comments = plan_path / "12-comments.md"
    if comments.is_file():
        with comments.open("a", encoding="utf-8") as handle:
            handle.write(f"\n## {timestamp} — {'Blocked' if blocked else 'Unblocked'} by {actor}\n\nReason: {reason}\n")
    return previous, {"status": data.get("status", ""), "block": data.get("block", {})}


def repair_assignment_plan_path(registry: dict[str, Any], assignment_id_value: str, current_path: str, reason: str, timestamp: str) -> tuple[dict[str, Any], dict[str, Any]]:
    assignment = next((entry for entry in registry.get("assignments", []) if entry.get("id") == assignment_id_value), None)
    if assignment is None:
        raise ValueError(f"Assignment not found: {assignment_id_value}")
    target = normalized_path(current_path)
    if not Path(target).exists():
        raise FileNotFoundError(f"Current plan path not found: {current_path}")
    previous = dict(assignment)
    assignment["planPath"] = target
    assignment["planBasename"] = Path(target).name
    assignment["lastHeartbeatAt"] = timestamp
    assignment["notes"] = reason
    return previous, dict(assignment)

def is_reviewer_rejected_in_progress(status: str, text: str) -> bool:
    first = text[:60000]
    plain = re.sub(r"[`*_>]", "", first)
    if re.search(r"correction\s+implemented.*awaiting\s+(?:fresh\s+)?independent\s+r1\s+review", plain, re.I | re.S):
        return False
    if re.search(r"awaiting\s+fresh\s+independent\s+r1\s+review", plain, re.I):
        return False
    return bool(
        re.search(r"review\s+status\s*:\s*rejected", plain, re.I)
        or re.search(r"r1\s+implementation\s+review\s*:\s*rejected", plain, re.I)
        or re.search(r"\bverdict\s*:\s*rejected\b", plain, re.I)
        or re.search(r"required\s+correction\s+before\s+next\s+r1", plain, re.I)
        or re.search(r"closeout\s*:\s*pending correction", plain, re.I)
        or re.search(r"correction required after r1 rejection", plain, re.I)
        or re.search(r"pending correction", status, re.I)
    )


def is_executor_correction_after_feedback(text: str) -> bool:
    return bool(re.search(r"executor correction after user feedback", text[:12000], re.I))


def has_automation_claim(text: str) -> bool:
    return bool(
        re.search(r"^>\s*\*\*Automation Claimed:\*\*\s*true\s*$", text[:5000], re.I | re.M)
        or re.search(r'"claimed"\s*:\s*true', text[:5000], re.I)
    )


def remove_automation_metadata(lines: list[str]) -> list[str]:
    return [line for line in lines if not any(line.startswith(prefix) for prefix in AUTOMATION_METADATA_PREFIXES)]


def stamp_plan_metadata(plan_path: Path, entry: dict[str, Any]) -> None:
    if not plan_path.exists():
        return
    state = str(entry.get("state") or "running")
    notes = str(entry.get("notes") or entry.get("handoffReason") or "").strip()
    heartbeat = str(entry.get("lastHeartbeatAt") or "")
    agent_label = str(entry.get("agentNickname") or entry.get("agentId") or "automation")
    if plan_path.is_dir():
        manifest = plan_path / "plan.json"
        if not manifest.is_file():
            return
        data = json.loads(manifest.read_text(errors="replace"))
        data["automation"] = {
            "claimed": True,
            "assignmentId": entry["id"],
            "agentRole": entry.get("role", ""),
            "agentId": entry.get("agentId", ""),
            "agentNickname": entry.get("agentNickname", ""),
            "leaseExpiresAt": entry.get("leaseExpiresAt", ""),
            "lastHeartbeatAt": entry.get("lastHeartbeatAt", ""),
            "handoffReason": entry.get("handoffReason", ""),
            "state": state,
            "notes": notes,
        }
        if state == "blocked":
            previous_block = data.get("block") if isinstance(data.get("block"), dict) else {}
            data["block"] = {
                **previous_block,
                "blocked": True,
                "reason": notes or "Agent reported blocked state.",
                "blockedAt": heartbeat,
                "blockedBy": agent_label,
                "statusBeforeBlock": previous_block.get("statusBeforeBlock") or data.get("status", ""),
            }
            data["status"] = "Blocked"
        elif isinstance(data.get("block"), dict) and data["block"].get("blocked") and data.get("status") == "Blocked":
            data["status"] = data["block"].get("statusBeforeBlock") or "In Progress"
            data["block"] = {**data["block"], "blocked": False, "unblockedAt": heartbeat, "unblockedBy": agent_label}
        manifest.write_text(json.dumps(data, indent=2) + "\n")
        update_todo_status_for_plan(plan_path, str(data.get("status") or ""))
        return
    source_text = plan_path.read_text(errors="replace")
    if state == "blocked":
        source_text = replace_status(source_text, "Blocked")
    lines = source_text.splitlines()
    had_trailing_newline = source_text.endswith("\n")
    lines = remove_automation_metadata(lines)
    metadata = [
        "> **Automation Claimed:** true",
        f"> **Automation Assignment ID:** {entry['id']}",
        f"> **Automation Agent Role:** {entry.get('role', '')}",
        f"> **Automation Agent ID:** {entry.get('agentId', '')}",
    ]
    if entry.get("agentNickname"):
        metadata.append(f"> **Automation Agent Nickname:** {entry['agentNickname']}")
    metadata.extend([
        f"> **Automation Lease Expires:** {entry.get('leaseExpiresAt', '')}",
        f"> **Automation Last Heartbeat:** {entry.get('lastHeartbeatAt', '')}",
        f"> **Automation Handoff Reason:** {entry.get('handoffReason', '')}",
        f"> **Automation State:** {state}",
    ])
    if notes:
        metadata.append(f"> **Automation Notes:** {notes}")

    insert_at = 1 if lines and lines[0].startswith("#") else 0
    # If the plan starts with a heading followed by blockquoted metadata, append after it.
    cursor = insert_at
    while cursor < len(lines) and (lines[cursor].startswith(">") or lines[cursor].strip() == ""):
        if lines[cursor].strip() == "" and cursor > insert_at:
            break
        cursor += 1
    insert_at = cursor
    new_lines = lines[:insert_at] + metadata + lines[insert_at:]
    text = "\n".join(new_lines)
    if had_trailing_newline or not text.endswith("\n"):
        text += "\n"
    plan_path.write_text(text)
    if state == "blocked":
        update_todo_status_for_plan(plan_path, "Blocked")


def clear_plan_metadata(plan_path: Path, assignment: dict[str, Any] | None = None) -> None:
    if not plan_path.exists():
        return
    if plan_path.is_dir():
        manifest = plan_path / "plan.json"
        if not manifest.is_file():
            return
        data = json.loads(manifest.read_text(errors="replace"))
        if assignment:
            data["automation"] = {
                "claimed": False,
                "assignmentId": assignment.get("id", ""),
                "completedAt": assignment.get("completedAt", ""),
            }
        else:
            data.pop("automation", None)
        manifest.write_text(json.dumps(data, indent=2) + "\n")
        return
    text = plan_path.read_text(errors="replace")
    lines = remove_automation_metadata(text.splitlines())
    insert_at = 1 if lines and lines[0].startswith("#") else 0
    if assignment:
        cleared = [
            "> **Automation Claimed:** false",
            f"> **Automation Assignment ID:** {assignment.get('id', '')}",
            f"> **Automation Completed At:** {assignment.get('completedAt', '')}",
        ]
        lines = lines[:insert_at] + cleared + lines[insert_at:]
    final = "\n".join(lines)
    if text.endswith("\n") or not final.endswith("\n"):
        final += "\n"
    plan_path.write_text(final)


def task_root_for_plan_path(plan_path: Path) -> Path | None:
    """Infer the generated task root from a plan path under planning/<lifecycle>/."""
    for parent in [plan_path, *plan_path.parents]:
        if parent.name == "planning":
            return parent.parent
    return None


def update_todo_status_for_plan(plan_path: Path, status: str) -> str:
    """Best-effort visible todo.md status sync for automation-stamped plan state."""
    task_root = task_root_for_plan_path(plan_path)
    if task_root is None:
        return "task root not found"
    todo = task_root / "todo.md"
    if not todo.is_file():
        return "todo.md not found"

    text = todo.read_text(errors="replace")
    lines = StringLines(text)
    plan_rel = safe_relative(plan_path, task_root).lower()
    plan_name = plan_path.name.lower()

    def split_table_row(line: str) -> list[str]:
        clean = line.strip()
        if not (clean.startswith("|") and clean.endswith("|")):
            return []
        return [cell.strip() for cell in clean[1:-1].split("|")]

    def format_table_row(cells: list[str]) -> str:
        return "| " + " | ".join(cells) + " |"

    def table_headers_for(row_index: int) -> list[str]:
        for header_index in range(row_index - 1, -1, -1):
            cells = split_table_row(lines.lines[header_index])
            if not cells or all(re.match(r"^:?-{3,}:?$", cell) for cell in cells):
                continue
            return [cell.lower() for cell in cells]
        return []

    def row_references_plan(value: str) -> bool:
        normalized = value.lower()
        return plan_rel in normalized or plan_name in normalized or str(plan_path).lower() in normalized

    for index, line in enumerate(lines.lines):
        cells = split_table_row(line)
        if not cells or all(re.match(r"^:?-{3,}:?$", cell) for cell in cells):
            continue
        if not row_references_plan(" ".join(cells)):
            continue
        headers = table_headers_for(index)
        changed = False
        for cell_index, header in enumerate(headers):
            if cell_index < len(cells) and header == "status":
                cells[cell_index] = status
                changed = True
        if changed:
            lines.lines[index] = format_table_row(cells)
            next_text = lines.text()
            if next_text != text:
                todo.write_text(next_text)
            return "todo table status updated"

    for index, line in enumerate(lines.lines):
        if not re.match(r"^\s{0,4}-\s+Plan:\s*", line, re.I):
            continue
        if not row_references_plan(line):
            continue
        start = index
        while start > 0 and not re.match(r"^\s*-\s+\[[ xX]\]\s+\*\*.+?\*\*\s*$", lines.lines[start]):
            start -= 1
        end = len(lines.lines)
        for next_index in range(start + 1, len(lines.lines)):
            if re.match(r"^\s*-\s+\[[ xX]\]\s+\*\*.+?\*\*\s*$", lines.lines[next_index]):
                end = next_index
                break
        for status_index in range(start + 1, end):
            match = re.match(r"^(\s{0,4}-\s+Status:\s*|Status:\s*)", lines.lines[status_index], re.I)
            if match:
                lines.lines[status_index] = f"{match.group(1)}`{status}`"
                todo.write_text(lines.text())
                return "todo bullet status updated"
        lines.lines.insert(index, f"  - Status: `{status}`")
        todo.write_text(lines.text())
        return "todo bullet status inserted"

    return "todo item not found"


def make_assignment(args: argparse.Namespace, registry: dict[str, Any]) -> dict[str, Any]:
    plan_path = normalized_path(args.plan_path)
    role = args.role
    id_ = args.assignment_id or assignment_id(args.project_id, role, plan_path)
    lease_minutes = int(args.lease_minutes)
    now = now_utc()
    existing = find_assignment(registry, id_=id_) or find_assignment(
        registry,
        project_id=args.project_id,
        role=role,
        plan_path=plan_path,
    )
    if existing and is_active(existing, now) and existing.get("agentId") != args.agent_id and not args.force:
        raise SystemExit(
            json.dumps(
                {
                    "ok": False,
                    "error": "assignment_conflict",
                    "existing": existing,
                    "hint": "Use --force only after confirming the existing agent is dead or has handed off.",
                },
                indent=2,
            )
        )
    if existing is None:
        existing = {"id": id_}
        registry.setdefault("assignments", []).append(existing)
    existing.update(
        {
            "id": id_,
            "projectId": args.project_id,
            "projectName": args.project_name,
            "projectRoot": normalized_path(args.project_root) if args.project_root else "",
            "taskRoot": normalized_path(args.task_root) if args.task_root else "",
            "planPath": plan_path,
            "planBasename": Path(plan_path).name,
            "role": role,
            "agentId": args.agent_id,
            "agentNickname": args.agent_nickname or "",
            "state": args.state,
            "handoffReason": args.reason,
            "claimedAt": existing.get("claimedAt") or iso(now),
            "lastHeartbeatAt": iso(now),
            "leaseExpiresAt": iso(now + timedelta(minutes=lease_minutes)),
            "completedAt": None,
            "notes": args.notes or existing.get("notes", ""),
        }
    )
    return existing


def command_claim(args: argparse.Namespace) -> None:
    enforce_project_sequence_for_claim(args)
    registry = load_registry(args.registry)
    entry = make_assignment(args, registry)
    if args.stamp_plan:
        stamp_plan_metadata(Path(entry["planPath"]), entry)
    save_registry(registry, args.registry)
    print(json.dumps({"ok": True, "assignment": entry}, indent=2))


def command_heartbeat(args: argparse.Namespace) -> None:
    registry = load_registry(args.registry)
    entry = find_assignment(registry, id_=args.assignment_id) or find_assignment(
        registry,
        project_id=args.project_id,
        role=args.role,
        plan_path=args.plan_path,
    )
    if not entry:
        raise SystemExit(json.dumps({"ok": False, "error": "assignment_not_found"}, indent=2))
    now = now_utc()
    entry["state"] = args.state or entry.get("state") or "running"
    entry["lastHeartbeatAt"] = iso(now)
    entry["leaseExpiresAt"] = iso(now + timedelta(minutes=int(args.lease_minutes)))
    if args.notes:
        entry["notes"] = args.notes
    if args.stamp_plan:
        stamp_plan_metadata(Path(entry["planPath"]), entry)
    save_registry(registry, args.registry)
    print(json.dumps({"ok": True, "assignment": entry}, indent=2))


def command_finish(args: argparse.Namespace) -> None:
    registry = load_registry(args.registry)
    entry = find_assignment(registry, id_=args.assignment_id) or find_assignment(
        registry,
        project_id=args.project_id,
        role=args.role,
        plan_path=args.plan_path,
    )
    if not entry:
        raise SystemExit(json.dumps({"ok": False, "error": "assignment_not_found"}, indent=2))
    entry["state"] = args.state
    entry["completedAt"] = iso(now_utc())
    entry["lastHeartbeatAt"] = entry["completedAt"]
    entry["leaseExpiresAt"] = entry["completedAt"]
    if args.notes:
        entry["notes"] = args.notes
    if args.state == "blocked":
        stamp_plan_metadata(Path(entry["planPath"]), entry)
    if args.clear_plan_stamp:
        clear_plan_metadata(Path(entry["planPath"]), entry if args.leave_completion_marker else None)
    save_registry(registry, args.registry)
    print(json.dumps({"ok": True, "assignment": entry}, indent=2))


def command_list(args: argparse.Namespace) -> None:
    registry = load_registry(args.registry)
    entries = registry.get("assignments", [])
    if args.active_only:
        entries = [entry for entry in entries if is_active(entry)]
    print(json.dumps({"ok": True, "assignments": entries}, indent=2))


def project_task_root(project: dict[str, Any]) -> Path:
    root = Path(project.get("rootLabel") or project.get("root") or "")
    explicit = project.get("explicitTaskPath") or project.get("taskRoot") or ""
    return root / explicit


def project_root(project: dict[str, Any]) -> Path:
    return Path(project.get("rootLabel") or project.get("root") or "")


def pending_destination(path: Path) -> Path | None:
    if not PLAN_FOLDER_PATTERN.search(path.as_posix()):
        return None
    return Path(PLAN_FOLDER_PATTERN.sub(r"\g<prefix>\g<base>/approved/\g<name>", path.as_posix()))


def todo_reference_for_destination(
    *,
    existing_reference: str,
    destination: Path,
    root: Path,
    task_root: Path,
) -> str:
    clean = str(existing_reference or "").strip().strip("`").split("|")[0].strip()
    if clean and not re.match(r"^planning/", clean, re.I):
        return safe_relative(destination, root)
    return safe_relative(destination, task_root)


def update_todo_for_auto_approval(project: dict[str, Any], source: Path, destination: Path) -> str:
    """Update the matching todo.md item for an automatic pending->approved move."""
    root = project_root(project)
    task_root = project_task_root(project)
    todo = task_root / "todo.md"
    if not todo.is_file():
        return "todo.md not found"

    text = todo.read_text(errors="replace")
    lines = StringLines(text)
    source_project_rel = safe_relative(source, root)
    source_task_rel = safe_relative(source, task_root)
    source_refs = {source_project_rel.lower(), source_task_rel.lower(), source.name.lower()}

    def split_table_row(line: str) -> list[str]:
        clean = line.strip()
        if not (clean.startswith("|") and clean.endswith("|")):
            return []
        return [cell.strip() for cell in clean[1:-1].split("|")]

    def format_table_row(cells: list[str]) -> str:
        return "| " + " | ".join(cells) + " |"

    def table_headers_for(row_index: int) -> list[str]:
        for header_index in range(row_index - 1, -1, -1):
            cells = split_table_row(lines.lines[header_index])
            if not cells or all(re.match(r"^:?-{3,}:?$", cell) for cell in cells):
                continue
            return [cell.lower() for cell in cells]
        return []

    def plan_value(line: str) -> str:
        match = re.match(r"^(\s*-\s+)?Plan:\s*(.*?)\s*$", line, re.I)
        if not match:
            match = re.match(r"^\s{2,}-\s+Plan:\s*(.*?)\s*$", line, re.I)
        if not match:
            return ""
        return match.group(2).strip().strip("`").split("|")[0].strip()

    plan_line_index = -1
    existing_plan = ""
    for index, line in enumerate(lines.lines):
        table_cells = split_table_row(line)
        if table_cells and not all(re.match(r"^:?-{3,}:?$", cell) for cell in table_cells):
            table_text = " ".join(table_cells)
            normalized_table = table_text.lower()
            if (
                source_project_rel.lower() in normalized_table
                or source_task_rel.lower() in normalized_table
                or source.name.lower() in normalized_table
            ):
                headers = table_headers_for(index)
                destination_ref = todo_reference_for_destination(
                    existing_reference=table_text,
                    destination=destination,
                    root=root,
                    task_root=task_root,
                )
                for cell_index, header in enumerate(headers):
                    if cell_index >= len(table_cells):
                        continue
                    if header == "status":
                        table_cells[cell_index] = "Approved"
                    elif header == "plan":
                        table_cells[cell_index] = f"[plan]({destination_ref})"
                lines.lines[index] = format_table_row(table_cells)
                next_text = lines.text()
                if next_text != text:
                    todo.write_text(next_text)
                    if todo.read_text(errors="replace") != next_text:
                        raise IOError(f"Todo write verification failed: {todo}")
                return "todo status and plan path updated"
        value = plan_value(line)
        if not value:
            continue
        normalized = value.lower()
        if normalized in source_refs or normalized.endswith(source_task_rel.lower()) or Path(value).name.lower() == source.name.lower():
            plan_line_index = index
            existing_plan = value
            break
    if plan_line_index < 0:
        return "todo item not found"

    start = plan_line_index
    while start > 0 and not re.match(r"^\s*-\s+\[[ xX]\]\s+\*\*.+?\*\*\s*$", lines.lines[start]):
        start -= 1
    if not re.match(r"^\s*-\s+\[[ xX]\]\s+\*\*.+?\*\*\s*$", lines.lines[start]):
        start = plan_line_index

    end = len(lines.lines)
    for index in range(start + 1, len(lines.lines)):
        if re.match(r"^\s*-\s+\[[ xX]\]\s+\*\*.+?\*\*\s*$", lines.lines[index]):
            end = index
            break

    status_line_index = -1
    for index in range(start + 1, end):
        if re.match(r"^\s{2,}-\s+Status:\s*", lines.lines[index], re.I) or re.match(r"^Status:\s*", lines.lines[index], re.I):
            status_line_index = index
            break

    plan_prefix = re.match(r"^(\s{2,}-\s+Plan:\s*)", lines.lines[plan_line_index], re.I)
    if plan_prefix:
        lines.lines[plan_line_index] = f"{plan_prefix.group(1)}`{todo_reference_for_destination(existing_reference=existing_plan, destination=destination, root=root, task_root=task_root)}`"
    else:
        lines.lines[plan_line_index] = f"Plan: `{todo_reference_for_destination(existing_reference=existing_plan, destination=destination, root=root, task_root=task_root)}`"

    if status_line_index >= 0:
        status_prefix = re.match(r"^(\s{2,}-\s+Status:\s*|Status:\s*)", lines.lines[status_line_index], re.I)
        lines.lines[status_line_index] = f"{status_prefix.group(1)}`Approved`"
    elif re.match(r"^\s*-\s+\[[ xX]\]\s+\*\*.+?\*\*\s*$", lines.lines[start]):
        lines.lines.insert(start + 1, "  - Status: `Approved`")
    else:
        lines.lines.insert(plan_line_index, "Status: `Approved`")

    next_text = lines.text()
    if next_text != text:
        todo.write_text(next_text)
        if todo.read_text(errors="replace") != next_text:
            raise IOError(f"Todo write verification failed: {todo}")
    return "todo status and plan path updated"


def auto_approve_pending_project(project: dict[str, Any]) -> list[dict[str, Any]]:
    """Promote pending plans for projects with autoApprovePending enabled."""
    if not project_truthy(project.get("autoApprovePending")):
        return []
    project_id = project.get("id") or ""
    name = project.get("name", "")
    root = project_root(project)
    task_root = project_task_root(project)
    pending_dir = task_root / "planning" / "pending"
    approved_dir = task_root / "planning" / "approved"
    if not pending_dir.is_dir():
        return []

    results: list[dict[str, Any]] = []
    for source in iter_plan_artifacts(pending_dir):
        destination = pending_destination(source)
        if destination is None:
            continue
        source_created_at = file_created_at(source)
        source_sequence = plan_sequence_number(source)
        item: dict[str, Any] = {
            "projectId": project_id,
            "projectName": name,
            "sourcePath": str(source),
            "destinationPath": str(destination),
            "planBasename": source.name,
            "sourceCreatedAt": iso(datetime.fromtimestamp(source_created_at, timezone.utc)),
            "sourceCreatedAtMs": int(source_created_at * 1000),
            "sequence": source_sequence,
            "ok": False,
        }
        try:
            if destination.exists():
                item.update({"skipped": True, "error": "destination_exists"})
                results.append(item)
                continue
            approved_dir.mkdir(parents=True, exist_ok=True)
            if source.is_dir():
                shutil.copytree(source, destination)
                manifest_path = destination / "plan.json"
                data = json.loads(manifest_path.read_text(errors="replace"))
                data["status"] = "Approved"
                data["lifecycle"] = "approved"
                data["updated"] = now_utc().date().isoformat()
                manifest_path.write_text(json.dumps(data, indent=2) + "\n")
                for section in data.get("sections", []) if isinstance(data, dict) else []:
                    section_file = destination / str(section.get("file", ""))
                    if section_file.is_file() and not section.get("appendOnly"):
                        section_file.write_text(replace_status(section_file.read_text(errors="replace"), "Approved"))
                shutil.rmtree(source)
            else:
                text = source.read_text(errors="replace")
                destination_text = replace_status(text, "Approved")
                destination.write_text(destination_text)
                if destination.read_text(errors="replace") != destination_text:
                    raise IOError(f"Destination verification failed: {destination}")
                source.unlink()
            if source.exists():
                raise IOError(f"Source still exists after deletion: {source}")
            item["todoDetail"] = update_todo_for_auto_approval(project, source, destination)
            item.update({
                "ok": True,
                "status": "Approved",
                "projectRoot": str(root),
                "taskRoot": str(task_root),
                "createdAt": file_created_at_iso(destination),
                "createdAtMs": file_created_at_ms(destination),
            })
        except Exception as error:  # noqa: BLE001 - reconcile should report and continue
            item["error"] = str(error)
        results.append(item)
    return results


def assignment_for_plan(registry: dict[str, Any], project_id: str, plan_path: Path, role: str) -> dict[str, Any] | None:
    assignment = find_assignment(
        registry,
        project_id=project_id,
        role=role,
        plan_path=str(plan_path),
    )
    if assignment:
        return assignment
    # Project records can be re-added through the desktop settings UI and receive
    # a new project id while an existing lease still points at the same absolute
    # plan path. Treat the plan path + role as the durable recovery identity so
    # reconcile does not spawn duplicate agents for a live assignment.
    return find_assignment(
        registry,
        role=role,
        plan_path=str(plan_path),
    )


def classify_file(kind: str, path: Path, text: str, status: str, registry: dict[str, Any], project_id: str) -> dict[str, Any] | None:
    role = "project-agent"
    reason = ""
    if kind == "approved":
        reason = "approved_execution"
    elif kind == "review" and is_reviewer_rejected_in_progress(status, text):
        reason = "reviewer_rejected_correction"
    elif kind == "review":
        role = "reviewer-agent"
        reason = "independent_review"
    elif kind == "failed-user-verification" and has_user_replied(status, text):
        reason = "user_replied_correction"
    elif kind == "user-verification" and is_sent_to_agent(status, text):
        reason = "user_verification_sent_to_agent"
    elif kind == "in-progress" and is_blocked_status(status, text):
        reason = "blocked_lifecycle_visibility"
    elif kind == "in-progress" and is_reviewer_rejected_in_progress(status, text):
        reason = "reviewer_rejected_correction"
    elif kind == "in-progress" and is_executor_correction_after_feedback(text):
        reason = "executor_correction_after_user_feedback"
    elif kind == "in-progress":
        existing = assignment_for_plan(registry, project_id, path, role)
        if has_automation_claim(text) or (existing and not is_terminal_assignment(existing)):
            reason = "automation_claimed_orphaned_in_progress"
        else:
            return None
    else:
        return None

    existing = assignment_for_plan(registry, project_id, path, role)
    expired = bool(existing and existing.get("state") in ACTIVE_STATES and is_expired(existing))
    assigned = bool(existing and is_active(existing))
    item = {
        "projectId": project_id,
        "role": role,
        "reason": reason,
        "folderState": kind,
        "status": status,
        "planPath": str(path),
        "planBasename": path.name,
        "sequence": plan_sequence_number(path),
        "createdAt": file_created_at_iso(path),
        "createdAtMs": file_created_at_ms(path),
        "assignmentId": existing.get("id") if existing else assignment_id(project_id, role, str(path)),
        "assigned": assigned,
        "expired": expired,
        "registryAgentId": existing.get("agentId") if existing else "",
        "agentId": existing.get("agentId") if existing else "",
        "codexThreadId": existing.get("codexThreadId", "") if existing else "",
        "leaseExpiresAt": existing.get("leaseExpiresAt") if existing else "",
    }
    block = plan_block_metadata(path, text, status)
    if block.get("blocked"):
        item["block"] = block
        item["blocked"] = True
    return item_with_assignment_context(item, existing)


def group_items_by_project(items: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        grouped.setdefault(str(item.get("projectId") or ""), []).append(item)
    return grouped


def reconcile(
    projects_path: Path,
    registry_path: Path,
    mark_expired: bool = False,
    stale_after_minutes: int = DEFAULT_STALE_AFTER_MINUTES,
    ui_config_path: Path = DEFAULT_UI_CONFIG,
    control_path: Path = DEFAULT_CONTROL,
) -> dict[str, Any]:
    registry = load_registry(registry_path)
    ui_config = load_ui_config(ui_config_path)
    control = load_control(control_path)
    now = now_utc()
    if not projects_path.exists():
        raise FileNotFoundError(projects_path)
    projects = json.loads(projects_path.read_text()).get("projects", [])
    eligible: list[dict[str, Any]] = []
    non_eligible: list[dict[str, Any]] = []
    projects_summary: list[dict[str, Any]] = []
    auto_approved_work: list[dict[str, Any]] = []

    expired_assignments = []
    for entry in registry.get("assignments", []):
        if entry.get("state") in ACTIVE_STATES and is_expired(entry, now):
            expired_assignments.append(entry)
            if mark_expired:
                entry["state"] = "expired"

    for project in projects:
        project_id = project.get("id") or ""
        task_root = project_task_root(project)
        if not task_root.exists():
            projects_summary.append({
                "projectId": project_id,
                "name": project.get("name", ""),
                "taskRoot": str(task_root),
                "exists": False,
                "eligibleCount": 0,
                "autoApprovePending": project_truthy(project.get("autoApprovePending")),
                "autoApprovedCount": 0,
            })
            continue
        auto_approved = auto_approve_pending_project(project)
        auto_approved_work.extend(auto_approved)
        project_items = []
        for kind, folder in [
            ("approved", "planning/approved"),
            ("review", "planning/review"),
            ("user-verification", "planning/user-verification"),
            ("failed-user-verification", "planning/failed-user-verification"),
            ("in-progress", "planning/in-progress"),
        ]:
            directory = task_root / folder
            if not directory.exists():
                continue
            for file_path in iter_plan_artifacts(directory):
                text = read_plan_artifact_text(file_path)
                status = parse_plan_artifact_status(file_path, text)
                item = classify_file(kind, file_path, text, status, registry, project_id)
                if item:
                    item.update({
                        "projectName": project.get("name", ""),
                        "projectRoot": project.get("rootLabel", ""),
                        "taskRoot": str(task_root),
                    })
                    eligible.append(item)
                    project_items.append(item)
        for kind, folder in [("parked", "planning/parked"), ("blocker", "planning/blocker")]:
            directory = task_root / folder
            if not directory.exists():
                continue
            for plan_path in iter_plan_artifacts(directory):
                text = read_plan_artifact_text(plan_path)
                non_eligible.append({
                    "projectId": project_id,
                    "projectName": project.get("name", ""),
                    "projectRoot": project.get("rootLabel", ""),
                    "taskRoot": str(task_root),
                    "folderState": kind,
                    "status": parse_plan_artifact_status(plan_path, text) or ("Parked" if kind == "parked" else "Blocked"),
                    "planPath": str(plan_path),
                    "planBasename": plan_path.name,
                    "reason": f"{kind}_non_buildable",
                    "eligible": False,
                })
        projects_summary.append({
            "projectId": project_id,
            "name": project.get("name", ""),
            "taskRoot": str(task_root),
            "exists": True,
            "eligibleCount": len(project_items),
            "autoApprovePending": project_truthy(project.get("autoApprovePending")),
            "autoApprovedCount": len([item for item in auto_approved if item.get("ok")]),
        })

    if mark_expired and expired_assignments:
        save_registry(registry, registry_path)

    stale_assignments = [
        summary
        for entry in registry.get("assignments", [])
        if (summary := stale_assignment_summary(entry, at=now, stale_after_minutes=stale_after_minutes))
    ]
    active_assignments = [entry for entry in registry.get("assignments", []) if is_active(entry, now)]
    active_project_agents_by_project: dict[str, list[dict[str, Any]]] = {}
    for entry in active_assignments:
        if entry.get("role") == "project-agent":
            active_project_agents_by_project.setdefault(str(entry.get("projectId") or ""), []).append(entry)

    artifact_paths = [Path(str(item.get("planPath"))) for item in [*eligible, *non_eligible] if item.get("planPath")]
    artifact_by_basename: dict[str, list[Path]] = {}
    for artifact in artifact_paths:
        artifact_by_basename.setdefault(artifact.name, []).append(artifact)

    blocked_work: list[dict[str, Any]] = []
    priority_user_reply_work: list[dict[str, Any]] = []
    project_agent_queue: list[dict[str, Any]] = []
    lease_mismatches: list[dict[str, Any]] = []
    moved_plan_repairs: list[dict[str, Any]] = []
    paused_ignored_work: list[dict[str, Any]] = []
    review_readiness_failures: list[dict[str, Any]] = []
    conflict_work_explicit: list[dict[str, Any]] = []
    conflict_work_suggested: list[dict[str, Any]] = []
    held_work: list[dict[str, Any]] = []

    for entry in active_assignments:
        plan_path_value = str(entry.get("planPath") or "")
        plan_path = Path(plan_path_value) if plan_path_value else Path("")
        if plan_path_value and not plan_path.exists():
            candidates = [candidate for candidate in artifact_by_basename.get(str(entry.get("planBasename") or plan_path.name), []) if candidate.exists()]
            if candidates:
                moved_plan_repairs.append({
                    "projectId": entry.get("projectId", ""),
                    "projectName": entry.get("projectName", ""),
                    "role": entry.get("role", ""),
                    "assignmentId": entry.get("id", ""),
                    "agentId": entry.get("agentId", ""),
                    "oldPlanPath": plan_path_value,
                    "currentPlanPath": str(candidates[0]),
                    "planBasename": entry.get("planBasename") or candidates[0].name,
                    "holdReason": "moved_plan_path_detected",
                    "recommendedAction": "repair_moved_plan_path",
                })

    for item in eligible:
        text = read_plan_artifact_text(Path(str(item.get("planPath")))) if item.get("planPath") else ""
        explicit_conflicts = plan_conflicts(Path(str(item.get("planPath"))), text, control) if item.get("planPath") else []
        for conflict in explicit_conflicts:
            conflict_work_explicit.append({**item, "conflict": conflict, "recommendedAction": "resolve_or_clear_conflict"})
        if item.get("reason") in {"user_verification_sent_to_agent", "user_replied_correction", "executor_correction_after_user_feedback"}:
            priority_user_reply_work.append({**item, "priorityReason": item.get("reason"), "recommendedAction": "deliver_to_project_agent"})
        if item.get("blocked") or is_blocked_status(str(item.get("status") or ""), text):
            hold = {
                **item,
                "held": True,
                "holdReason": "blocked_status",
                "holdLabel": "Held: plan is blocked",
                "recommendedAction": "unblock_plan_or_record_blocker",
            }
            blocked_work.append(hold)
            item.update({"held": True, "holdReason": hold["holdReason"], "holdLabel": hold["holdLabel"], "recommendedAction": hold["recommendedAction"]})
            held_work.append(hold)
            continue
        if hold := policy_hold_for_item(item, control):
            item["held"] = True
            item["holdReason"] = hold["holdReason"]
            item["holdLabel"] = hold["holdLabel"]
            item["recommendedAction"] = hold["recommendedAction"]
            if hold.get("holdReason") == "project_paused":
                paused_ignored_work.append({**hold, "paused": True})
            held_work.append(hold)
            continue
        if item.get("role") == "reviewer-agent":
            ready, missing = review_ready(Path(str(item.get("planPath"))), text)
            if not ready:
                failure = {
                    **item,
                    "held": True,
                    "holdReason": "review_readiness_failed",
                    "holdLabel": "Held: review readiness evidence is incomplete",
                    "recommendedAction": "return_to_build_agent_for_closeout",
                    "missingReadiness": missing,
                }
                item.update({"held": True, "holdReason": failure["holdReason"], "holdLabel": failure["holdLabel"], "recommendedAction": failure["recommendedAction"]})
                review_readiness_failures.append(failure)
                held_work.append(failure)
                continue
        project_active_agents = active_project_agents_by_project.get(str(item.get("projectId") or ""), [])
        different_active = [entry for entry in project_active_agents if normalized_path(entry.get("planPath", "")) != normalized_path(item.get("planPath", ""))]
        if item.get("role") == "project-agent" and not item.get("assigned") and different_active:
            active = different_active[0]
            queued = {
                **item,
                "held": True,
                "holdReason": "project_agent_active_queue",
                "holdLabel": "Queued: existing project build agent is active",
                "recommendedAction": "nudge_existing_project_agent",
                "activeAssignmentId": active.get("id", ""),
                "activeAgentId": active.get("agentId", ""),
                "activePlanPath": active.get("planPath", ""),
                "lastAgentTouchAt": last_agent_touch(active),
                "lastAgentNote": active.get("notes", ""),
            }
            item.update({"held": True, "holdReason": queued["holdReason"], "holdLabel": queued["holdLabel"], "recommendedAction": queued["recommendedAction"]})
            project_agent_queue.append(queued)
            held_work.append(queued)
            continue
        if hold := active_assignment_hold(item):
            held_work.append(hold)
        if item.get("assigned") and item.get("status") in {"Reviewing", "In Progress", "Blocked"} and not item.get("leaseExpiresAt"):
            lease_mismatches.append({**item, "mismatchReason": "status_without_active_lease", "recommendedAction": "repair_or_release_lease"})
        if has_automation_claim(text) and not item.get("assigned"):
            lease_mismatches.append({**item, "mismatchReason": "plan_stamp_without_active_lease", "recommendedAction": "claim_or_clear_plan_stamp"})

    for project_id, items in group_items_by_project(eligible).items():
        project_agent_items = [item for item in items if item.get("role") == "project-agent"]
        for index, first in enumerate(project_agent_items):
            first_tokens = keyword_tokens(f"{first.get('planBasename', '')} {first.get('status', '')}")
            for second in project_agent_items[index + 1:]:
                second_tokens = keyword_tokens(f"{second.get('planBasename', '')} {second.get('status', '')}")
                overlap = sorted(first_tokens & second_tokens)
                if len(overlap) >= 2:
                    conflict_work_suggested.append({
                        "projectId": project_id,
                        "projectName": first.get("projectName", ""),
                        "planPaths": [first.get("planPath", ""), second.get("planPath", "")],
                        "planBasenames": [first.get("planBasename", ""), second.get("planBasename", "")],
                        "overlapKeywords": overlap[:8],
                        "severity": "suggestion",
                        "recommendedAction": "inspect_and_mark_conflict_if_blocking",
                    })

    for summary in stale_assignments:
        held_work.append(stale_assignment_hold(summary))
    for item in non_eligible:
        hold = non_eligible_hold(item)
        held_work.append(hold)
        if item.get("folderState") == "blocker" or is_blocked_status(str(item.get("status") or "")):
            blocked_work.append({**hold, "block": plan_block_metadata(Path(str(item.get("planPath"))), read_plan_artifact_text(Path(str(item.get("planPath")))), str(item.get("status") or ""))})

    for repair in moved_plan_repairs:
        held_work.append({**repair, "held": True, "holdLabel": "Held: registry lease points at old lifecycle path"})

    heartbeat_notifications: list[dict[str, Any]] = []
    for item in blocked_work:
        heartbeat_notifications.append(summarize_item_for_notification(item, "blocked_work", "high", "Blocked lifecycle work needs unblock, blocker routing, or coordinator attention."))
    for item in priority_user_reply_work:
        heartbeat_notifications.append(summarize_item_for_notification(item, "user_reply_delivery", "high", "User reply needs delivery to the existing project build agent."))
    for item in project_agent_queue:
        heartbeat_notifications.append(summarize_item_for_notification(item, "same_project_queue", "medium", "Same-project work is queued for the existing build agent; nudge instead of spawning a second build thread."))
    for item in lease_mismatches:
        heartbeat_notifications.append(summarize_item_for_notification(item, "lease_mismatch", "high", "Plan status/stamp and registry lease do not match."))
    for item in moved_plan_repairs:
        heartbeat_notifications.append(summarize_item_for_notification(item, "moved_plan_repair", "medium", "Registry lease path appears stale after a lifecycle move."))
    for item in paused_ignored_work:
        heartbeat_notifications.append(summarize_item_for_notification(item, "paused_project_ignored", "info", "Project is paused; work is visible but ignored by automation."))
    for item in review_readiness_failures:
        heartbeat_notifications.append(summarize_item_for_notification(item, "review_readiness_failed", "high", "Review handoff is blocked because closeout/evidence is incomplete."))
    for item in conflict_work_explicit:
        heartbeat_notifications.append(summarize_item_for_notification(item, "explicit_conflict", "medium", "Explicit conflict metadata requires resolution before unblocking related work."))

    eligible.sort(key=lambda item: (
        custom_order_rank(str(item.get("projectId", "")), str(item.get("planBasename", "")), ui_config),
        0 if item.get("createdAtMs") else 1,
        int(item.get("createdAtMs") or 0),
        0 if item.get("sequence") is not None else 1,
        int(item.get("sequence") or 0),
        natural_key(str(item.get("planBasename", ""))),
    ))
    unassigned = [item for item in eligible if not item["assigned"] and not item.get("held")]

    return {
        "ok": True,
        "generatedAt": iso(now),
        "registry": str(registry_path),
        "projectsPath": str(projects_path),
        "projects": projects_summary,
        "autoApprovedWork": auto_approved_work,
        "eligibleWork": eligible,
        "unassignedWork": unassigned,
        "heldWork": held_work,
        "blockedWork": blocked_work,
        "priorityUserReplyWork": priority_user_reply_work,
        "projectAgentQueue": project_agent_queue,
        "leaseMismatches": lease_mismatches,
        "movedPlanRepairs": moved_plan_repairs,
        "pausedIgnoredWork": paused_ignored_work,
        "conflictWork": {"explicit": conflict_work_explicit, "suggested": conflict_work_suggested},
        "reviewReadinessFailures": review_readiness_failures,
        "heartbeatNotifications": heartbeat_notifications,
        "controlPolicy": control,
        "nonEligibleWork": non_eligible,
        "expiredAssignments": expired_assignments,
        "staleAssignments": stale_assignments,
        "activeAssignments": active_assignments,
    }



def command_control(args: argparse.Namespace) -> None:
    control = load_control(args.control)
    registry = load_registry(args.registry)
    project_id = args.project_id
    actor = args.actor or "operator"
    reason = args.reason or "No reason recorded."
    timestamp = iso(now_utc())
    if args.control_action in {"pause-project", "unpause-project"}:
        previous = dict((control.get("projects") or {}).get(project_id) or {})
        next_state = {
            **previous,
            "paused": args.control_action == "pause-project",
            "reason": reason,
            "updatedAt": timestamp,
            "updatedBy": actor,
        }
        control.setdefault("projects", {})[project_id] = next_state
        save_control(control, args.control)
    elif args.control_action in {"stop-reviewer", "resume-reviewer"}:
        key = args.reviewer_key or project_id
        previous = dict((control.get("reviewers") or {}).get(key) or {})
        next_state = {
            **previous,
            "stopped": args.control_action == "stop-reviewer",
            "reason": reason,
            "updatedAt": timestamp,
            "updatedBy": actor,
        }
        control.setdefault("reviewers", {})[key] = next_state
        save_control(control, args.control)
    elif args.control_action in {"block-plan", "unblock-plan"}:
        if not args.plan_path:
            raise SystemExit(json.dumps({"ok": False, "error": "plan_path_required"}, indent=2))
        previous, next_state = set_plan_block_state(Path(args.plan_path), blocked=args.control_action == "block-plan", reason=reason, actor=actor, timestamp=timestamp)
    elif args.control_action in {"mark-conflict", "clear-conflict"}:
        key = args.reviewer_key or args.assignment_id or hashlib.sha256(f"{project_id}\0{args.plan_path}".encode("utf-8")).hexdigest()[:20]
        previous = dict((control.get("conflicts") or {}).get(key) or {})
        next_state = {
            **previous,
            "projectId": project_id,
            "planPaths": [path for path in [args.plan_path] if path],
            "reason": reason,
            "cleared": args.control_action == "clear-conflict",
            "updatedAt": timestamp,
            "updatedBy": actor,
        }
        control.setdefault("conflicts", {})[key] = next_state
        save_control(control, args.control)
    elif args.control_action == "repair-moved-plan":
        if not args.assignment_id or not args.plan_path:
            raise SystemExit(json.dumps({"ok": False, "error": "assignment_id_and_plan_path_required"}, indent=2))
        previous, next_state = repair_assignment_plan_path(registry, args.assignment_id, args.plan_path, reason, timestamp)
        save_registry(registry, args.registry)
    else:
        raise SystemExit(json.dumps({"ok": False, "error": f"unsupported_control_action:{args.control_action}"}, indent=2))
    event = append_audit({
        "actor": actor,
        "action": args.control_action,
        "projectId": project_id,
        "role": "reviewer-agent" if "reviewer" in args.control_action else "project-agent",
        "planPath": args.plan_path or "",
        "assignmentId": args.assignment_id or "",
        "previousState": previous,
        "nextState": next_state,
        "reason": reason,
    }, args.audit)
    print(json.dumps({"ok": True, "policy": next_state, "auditEvent": event}, indent=2))

def command_reconcile(args: argparse.Namespace) -> None:
    resolution = resolve_project_registry(args.projects, repo_path=DEFAULT_PROJECTS, app_support_path=DEFAULT_APP_SUPPORT_PROJECTS)
    projects_path = resolution.active_path
    result = reconcile(
        projects_path,
        args.registry,
        mark_expired=args.mark_expired,
        stale_after_minutes=int(args.stale_after_minutes),
        ui_config_path=args.ui_config,
        control_path=args.control,
    )
    result["registryResolution"] = resolution.as_dict()
    print(json.dumps(result, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)
    parser.add_argument("--ui-config", type=Path, default=DEFAULT_UI_CONFIG)
    parser.add_argument("--control", type=Path, default=DEFAULT_CONTROL)
    sub = parser.add_subparsers(dest="command", required=True)

    claim = sub.add_parser("claim", help="Create or refresh a durable assignment lease.")
    claim.add_argument("--project-id", required=True)
    claim.add_argument("--project-name", default="")
    claim.add_argument("--project-root", default="")
    claim.add_argument("--task-root", default="")
    claim.add_argument("--plan-path", required=True)
    claim.add_argument("--role", choices=["project-agent", "reviewer-agent"], required=True)
    claim.add_argument("--agent-id", required=True)
    claim.add_argument("--agent-nickname", default="")
    claim.add_argument("--reason", required=True)
    claim.add_argument("--state", default="running", choices=["running", "blocked"])
    claim.add_argument("--lease-minutes", default="30")
    claim.add_argument("--assignment-id", default="")
    claim.add_argument("--notes", default="")
    claim.add_argument("--force", action="store_true")
    claim.add_argument("--stamp-plan", action="store_true")
    claim.set_defaults(func=command_claim)

    heartbeat = sub.add_parser("heartbeat", help="Refresh an existing assignment lease.")
    heartbeat.add_argument("--assignment-id", default="")
    heartbeat.add_argument("--project-id", default="")
    heartbeat.add_argument("--plan-path", default="")
    heartbeat.add_argument("--role", choices=["project-agent", "reviewer-agent"], default="project-agent")
    heartbeat.add_argument("--lease-minutes", default="30")
    heartbeat.add_argument("--state", choices=["running", "blocked"], default="")
    heartbeat.add_argument("--notes", default="")
    heartbeat.add_argument("--stamp-plan", action="store_true")
    heartbeat.set_defaults(func=command_heartbeat)

    finish = sub.add_parser("finish", help="Mark an assignment as completed/released/cancelled/blocked.")
    finish.add_argument("--assignment-id", default="")
    finish.add_argument("--project-id", default="")
    finish.add_argument("--plan-path", default="")
    finish.add_argument("--role", choices=["project-agent", "reviewer-agent"], default="project-agent")
    finish.add_argument("--state", choices=["completed", "released", "cancelled", "blocked"], default="completed")
    finish.add_argument("--notes", default="")
    finish.add_argument("--clear-plan-stamp", action="store_true")
    finish.add_argument("--leave-completion-marker", action="store_true")
    finish.set_defaults(func=command_finish)

    list_cmd = sub.add_parser("list", help="List assignments.")
    list_cmd.add_argument("--active-only", action="store_true")
    list_cmd.set_defaults(func=command_list)

    control_cmd = sub.add_parser("control", help="Write durable automation pause/resume policy and append an audit event.")
    control_cmd.add_argument("--control-action", required=True, choices=["pause-project", "unpause-project", "stop-reviewer", "resume-reviewer", "block-plan", "unblock-plan", "mark-conflict", "clear-conflict", "repair-moved-plan"])
    control_cmd.add_argument("--project-id", required=True)
    control_cmd.add_argument("--reviewer-key", default="")
    control_cmd.add_argument("--plan-path", default="")
    control_cmd.add_argument("--assignment-id", default="")
    control_cmd.add_argument("--actor", default="operator")
    control_cmd.add_argument("--reason", default="")
    control_cmd.add_argument("--audit", type=Path, default=DEFAULT_AUDIT)
    control_cmd.set_defaults(func=command_control)

    rec = sub.add_parser("reconcile", help="Scan configured projects and report eligible/unassigned work.")
    rec.add_argument("--projects", type=Path, default=None)
    rec.add_argument("--mark-expired", action="store_true")
    rec.add_argument("--stale-after-minutes", default=str(DEFAULT_STALE_AFTER_MINUTES))
    rec.set_defaults(func=command_reconcile)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
