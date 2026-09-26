#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import unquote, urlparse

from taskmanager_registry import resolve_project_registry
from automation_assignments import apply_assignment_operator_action, iso, now_utc, repair_assignment_plan_path, set_plan_block_state

ROOT = Path(__file__).resolve().parents[2]
REQUEST_JSON_MAX_BYTES = 2 * 1024 * 1024
BOOTSTRAP_PATH = "docs/tasks/.taskmanager-bootstrap.json"
SETUP_INSTRUCTION_PATH = "docs/tasks/onboarding/install-agent-workflow-kits.md"
WORKFLOW_KIT_TAG = "v1.0.0"
WORKFLOW_KIT_COMMIT = "928dd48b86385177d62646866acbaeaf13f5af77"
CANONICAL_TASK_MARKERS = [
  "docs/tasks/workflow.md",
  "docs/tasks/todo.md",
  "docs/tasks/planning",
  "docs/tasks/lessons-active.md",
  "docs/tasks/lessons-index.json",
  "docs/tasks/task-system.config.yaml",
  "docs/tasks/verification.md",
]

def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Serve TaskManager and allow data/runtime/projects.json updates.")
  parser.add_argument("--directory", default="dist", help="Static directory to serve, usually dist or app.")
  parser.add_argument("--port", type=int, default=8765)
  parser.add_argument("--host", default="127.0.0.1")
  parser.add_argument("--runtime-config", default="", help="Override projects.json path. Defaults to the shared TaskManager registry resolver.")
  return parser.parse_args()


class RuntimeConfigHandler(SimpleHTTPRequestHandler):
  runtime_config: Path
  served_runtime_config: Path
  registry_resolution: object

  def _send_json(self, status: int, payload: object) -> None:
    body = json.dumps(payload, indent=2).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json")
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)

  def _read_json(self) -> object:
    length = int(self.headers.get("Content-Length", "0"))
    if length < 0 or length > REQUEST_JSON_MAX_BYTES:
      raise ValueError("Runtime JSON request exceeds the supported size limit.")
    raw = self.rfile.read(length).decode("utf-8")
    return json.loads(raw or "{}")

  def end_headers(self) -> None:
    self.send_header("Cache-Control", "no-store")
    self.send_header("X-TaskManager-Runtime-Config-Write", "1")
    resolution = getattr(self, "registry_resolution", None)
    if resolution is not None:
      self.send_header("X-TaskManager-Runtime-Config-Path", str(getattr(resolution, "active_path", "")))
      self.send_header("X-TaskManager-Runtime-Config-Source", str(getattr(resolution, "source", "")))
    super().end_headers()

  def do_GET(self) -> None:  # noqa: N802 - stdlib hook name
    parsed = urlparse(self.path)
    request_path = unquote(parsed.path).lstrip("/")
    if request_path == "api/automation/summary":
      self._handle_automation_summary()
      return
    if request_path == "data/runtime/projects.json" or (request_path.startswith("data/runtime/config/") and request_path.endswith(".json")):
      self._handle_read_runtime_json_file(request_path, include_body=True)
      return
    super().do_GET()

  def do_HEAD(self) -> None:  # noqa: N802 - stdlib hook name
    parsed = urlparse(self.path)
    request_path = unquote(parsed.path).lstrip("/")
    if request_path == "data/runtime/projects.json" or (request_path.startswith("data/runtime/config/") and request_path.endswith(".json")):
      self._handle_read_runtime_json_file(request_path, include_body=False)
      return
    super().do_HEAD()

  def do_PUT(self) -> None:  # noqa: N802 - stdlib hook name
    parsed = urlparse(self.path)
    request_path = unquote(parsed.path).lstrip("/")
    if request_path == "api/files/text":
      self._handle_write_text()
      return
    if request_path == "data/runtime/projects.json":
      self._handle_write_runtime_projects()
      return
    if request_path.startswith("data/runtime/config/") and request_path.endswith(".json"):
      self._handle_write_runtime_config_file(request_path)
      return
    self.send_error(404, "Writable path not found")

  def _runtime_json_paths(self, request_path: str) -> tuple[Path, Path]:
    active_runtime_root = self.runtime_config.parent.resolve()
    runtime_path = self.runtime_config.resolve() if request_path == "data/runtime/projects.json" else (active_runtime_root / request_path.removeprefix("data/runtime/")).resolve()
    served_path = (Path(self.directory) / request_path).resolve()
    served_runtime_root = (Path(self.directory) / "data" / "runtime").resolve()
    if request_path != "data/runtime/projects.json":
      runtime_path.relative_to(active_runtime_root)
    served_path.relative_to(served_runtime_root)
    return runtime_path, served_path

  def _write_runtime_json_pair(self, request_path: str, payload: dict) -> None:
    text = json.dumps(payload, indent=2) + "\n"
    runtime_path, served_path = self._runtime_json_paths(request_path)
    runtime_path.parent.mkdir(parents=True, exist_ok=True)
    runtime_path.write_text(text)
    if served_path != runtime_path:
      served_path.parent.mkdir(parents=True, exist_ok=True)
      served_path.write_text(text)

  def _handle_read_runtime_json_file(self, request_path: str, include_body: bool) -> None:
    try:
      runtime_path, served_path = self._runtime_json_paths(request_path)
      if not runtime_path.exists():
        runtime_path.parent.mkdir(parents=True, exist_ok=True)
        runtime_path.write_text(json.dumps({"version": 1, "projects": []} if request_path == "data/runtime/projects.json" else {}, indent=2) + "\n")
      if served_path != runtime_path and (not served_path.exists() or served_path.read_text(encoding="utf-8", errors="replace") != runtime_path.read_text(encoding="utf-8", errors="replace")):
        served_path.parent.mkdir(parents=True, exist_ok=True)
        served_path.write_text(runtime_path.read_text(encoding="utf-8", errors="replace"), encoding="utf-8")
      body = runtime_path.read_bytes() if include_body else b""
      self.send_response(200)
      self.send_header("Content-Type", "application/json")
      self.send_header("Content-Length", str(len(body)))
      self.end_headers()
      if include_body:
        self.wfile.write(body)
    except Exception as error:  # noqa: BLE001
      self._send_json(400, {"ok": False, "error": str(error)})

  def _handle_write_runtime_projects(self) -> None:
    try:
      payload = self._read_json()
      if not isinstance(payload, dict) or not isinstance(payload.get("projects"), list):
        raise ValueError("projects.json must be an object with a projects array")
      # Preserve newer per-project automation settings when an older open tab
      # writes project config without the field. New clients send explicit
      # booleans, so users can still turn the setting off intentionally.
      existing_projects = {}
      for source in [self.runtime_config, self.served_runtime_config]:
        try:
          existing_payload = json.loads(source.read_text())
        except Exception:
          continue
        for project in existing_payload.get("projects", []) if isinstance(existing_payload, dict) else []:
          key = str(project.get("id") or project.get("rootLabel") or "").strip()
          if key:
            existing_projects[key] = project
      preserved_fields = ["autoApprovePending", "includeInAllQueue"]
      for project in payload.get("projects", []):
        if not isinstance(project, dict):
          continue
        key = str(project.get("id") or project.get("rootLabel") or "").strip()
        existing_project = existing_projects.get(key, {}) if key else {}
        for field in preserved_fields:
          if field not in project and field in existing_project:
            project[field] = bool(existing_project.get(field))
      self._write_runtime_json_pair("data/runtime/projects.json", payload)
      self._send_json(200, {"ok": True, "path": "data/runtime/projects.json"})
    except Exception as error:  # noqa: BLE001 - request handler should report all write failures
      self._send_json(400, {"ok": False, "error": str(error)})

  def _handle_write_runtime_config_file(self, request_path: str) -> None:
    try:
      payload = self._read_json()
      if not isinstance(payload, dict):
        raise ValueError("Runtime config file must be a JSON object")
      self._write_runtime_json_pair(request_path, payload)
      self._send_json(200, {"ok": True, "path": request_path})
    except Exception as error:  # noqa: BLE001
      self._send_json(400, {"ok": False, "error": str(error)})

  def do_POST(self) -> None:  # noqa: N802 - stdlib hook name
    parsed = urlparse(self.path)
    request_path = unquote(parsed.path).lstrip("/")
    handlers = {
      "api/automation/summary": self._handle_automation_summary,
      "api/automation/action": self._handle_automation_action,
      "api/projects/scan": self._handle_scan_project,
      "api/projects/bootstrap": self._handle_bootstrap_project,
      "api/files/read": self._handle_read_text,
      "api/files/copy-verify-delete": self._handle_copy_verify_delete,
      "api/folders/copy-verify-delete": self._handle_copy_verify_delete_folder,
      "api/system/select-directory": self._handle_select_directory,
    }
    handler = handlers.get(request_path)
    if not handler:
      self.send_error(404, "Runtime API not found")
      return
    handler()

  def _native_directory_picker_available(self) -> bool:
    if sys.platform == "darwin" and shutil.which("osascript"):
      return True
    try:
      import tkinter  # noqa: F401
      return True
    except Exception:  # noqa: BLE001
      return False

  def _select_directory_with_native_picker(self) -> Path:
    if sys.platform == "darwin" and shutil.which("osascript"):
      script = 'POSIX path of (choose folder with prompt "Select a TaskManager project folder")'
      result = subprocess.run(
        ["osascript", "-e", script],
        check=False,
        capture_output=True,
        text=True,
      )
      if result.returncode != 0:
        raise RuntimeError("Folder selection cancelled.")
      selected = result.stdout.strip()
    else:
      try:
        import tkinter as tk
        from tkinter import filedialog
      except Exception as error:  # noqa: BLE001
        raise RuntimeError("Native folder picker is unavailable on this runtime server.") from error
      root = tk.Tk()
      root.withdraw()
      root.attributes("-topmost", True)
      selected = filedialog.askdirectory(title="Select a TaskManager project folder")
      root.destroy()
      if not selected:
        raise RuntimeError("Folder selection cancelled.")
    path = Path(selected).expanduser().resolve()
    if not path.is_dir():
      raise FileNotFoundError(f"Selected path is not a directory: {selected}")
    return path

  def _handle_select_directory(self) -> None:
    try:
      payload = self._read_json()
      if isinstance(payload, dict) and payload.get("dryRun"):
        self._send_json(200, {"ok": True, "available": self._native_directory_picker_available()})
        return
      selected = self._select_directory_with_native_picker()
      self._send_json(200, {"ok": True, "path": str(selected), "name": selected.name})
    except Exception as error:  # noqa: BLE001
      status = 409 if "cancelled" in str(error).lower() else 400
      self._send_json(status, {"ok": False, "error": str(error)})



  def _automation_paths(self) -> dict[str, Path]:
    runtime_dir = self.runtime_config.parent
    return {
      "registry": runtime_dir / "automation-assignments.json",
      "control": runtime_dir / "automation-control.json",
      "audit": runtime_dir / "automation-audit.jsonl",
      "ui": runtime_dir / "config" / "ui.json",
    }

  def _read_json_file(self, path: Path, fallback: dict) -> dict:
    try:
      return json.loads(path.read_text())
    except Exception:
      return fallback

  def _write_json_file(self, path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")

  def _append_audit(self, event: dict) -> dict:
    paths = self._automation_paths()
    payload = {"version": 1, "timestamp": __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat().replace('+00:00','Z'), "source": "serve-runtime", **event}
    paths["audit"].parent.mkdir(parents=True, exist_ok=True)
    with paths["audit"].open("a", encoding="utf-8") as handle:
      handle.write(json.dumps(payload, sort_keys=True) + "\n")
    return payload

  def _read_audit(self, limit: int = 120) -> list[dict]:
    path = self._automation_paths()["audit"]
    if not path.is_file():
      return []
    rows = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines()[-limit:]:
      if not line.strip():
        continue
      try:
        rows.append(json.loads(line))
      except json.JSONDecodeError:
        rows.append({"action": "unparseable", "reason": line})
    return list(reversed(rows))

  def _automation_summary(self) -> dict:
    paths = self._automation_paths()
    helper = ROOT / "tooling/scripts/automation_assignments.py"
    if helper.is_file():
      try:
        result = subprocess.run([
          sys.executable,
          str(helper),
          "--registry", str(paths["registry"]),
          "--control", str(paths["control"]),
          "--ui-config", str(paths["ui"]),
          "reconcile",
          "--projects", str(self.runtime_config),
          "--stale-after-minutes", "60",
        ], cwd=ROOT, check=True, capture_output=True, text=True, timeout=15)
        payload = json.loads(result.stdout)
      except Exception as error:  # noqa: BLE001
        payload = {"ok": False, "error": str(error), "eligibleWork": [], "heldWork": [], "activeAssignments": []}
    else:
      payload = {"ok": True, "fallback": True, "eligibleWork": [], "heldWork": [], "activeAssignments": []}
    resolution = getattr(self, "registry_resolution", None)
    if resolution is not None:
      payload["registryResolution"] = resolution.as_dict()
    payload["auditEvents"] = self._read_audit()
    payload["assignments"] = self._read_json_file(paths["registry"], {"assignments": []}).get("assignments", [])
    return payload

  def _handle_automation_summary(self) -> None:
    self._send_json(200, self._automation_summary())

  def _handle_automation_action(self) -> None:
    try:
      payload = self._read_json()
      paths = self._automation_paths()
      action = str(payload.get("action") or "")
      project_id = str(payload.get("projectId") or "")
      reason = str(payload.get("reason") or "No reason recorded.")
      actor = str(payload.get("actor") or "operator")
      control = self._read_json_file(paths["control"], {"version": 1, "projects": {}, "reviewers": {}, "threadLinks": {}, "conflicts": {}})
      control.setdefault("projects", {})
      control.setdefault("reviewers", {})
      control.setdefault("threadLinks", {})
      control.setdefault("conflicts", {})
      previous_state = {}
      next_state = {}
      if action in {"pause-project", "unpause-project"}:
        previous_state = dict((control.get("projects") or {}).get(project_id) or {})
        next_state = {**previous_state, "paused": action == "pause-project", "reason": reason, "updatedAt": self.date_time_string(), "updatedBy": actor}
        control.setdefault("projects", {})[project_id] = next_state
        self._write_json_file(paths["control"], control)
      elif action in {"stop-reviewer", "resume-reviewer"}:
        key = str(payload.get("reviewerKey") or project_id)
        previous_state = dict((control.get("reviewers") or {}).get(key) or {})
        next_state = {**previous_state, "stopped": action == "stop-reviewer", "reason": reason, "updatedAt": self.date_time_string(), "updatedBy": actor}
        control.setdefault("reviewers", {})[key] = next_state
        self._write_json_file(paths["control"], control)
      elif action in {"release-assignment", "cancel-assignment", "nudge-agent", "reclaim-orphan"}:
        registry = self._read_json_file(paths["registry"], {"version": 1, "assignments": []})
        assignment = next((entry for entry in registry.get("assignments", []) if entry.get("id") == payload.get("assignmentId")), None)
        if assignment is None:
          if action != "nudge-agent":
            raise ValueError(f"Assignment not found: {payload.get('assignmentId')}")
          previous_state = {}
          next_state = {"nudged": True, "projectId": project_id, "planPath": payload.get("planPath") or "", "reason": reason}
        else:
          timestamp = iso(now_utc())
          previous_state, next_state, should_save = apply_assignment_operator_action(assignment, action, reason, timestamp)
          if should_save:
            self._write_json_file(paths["registry"], registry)
      elif action in {"block-plan", "unblock-plan"}:
        plan_path = Path(str(payload.get("planPath") or "")).expanduser().resolve(strict=False)
        previous_state, next_state = set_plan_block_state(plan_path, blocked=action == "block-plan", reason=reason, actor=actor, timestamp=iso(now_utc()))
      elif action in {"mark-conflict", "clear-conflict"}:
        key = str(payload.get("conflictKey") or payload.get("assignmentId") or hashlib.sha256(f'{project_id}\0{payload.get("planPath") or ""}'.encode("utf-8")).hexdigest()[:20])
        previous_state = dict((control.get("conflicts") or {}).get(key) or {})
        next_state = {**previous_state, "projectId": project_id, "planPaths": [str(payload.get("planPath") or "")], "reason": reason, "cleared": action == "clear-conflict", "updatedAt": iso(now_utc()), "updatedBy": actor}
        control.setdefault("conflicts", {})[key] = next_state
        self._write_json_file(paths["control"], control)
      elif action == "repair-moved-plan":
        registry = self._read_json_file(paths["registry"], {"version": 1, "assignments": []})
        previous_state, next_state = repair_assignment_plan_path(registry, str(payload.get("assignmentId") or ""), str(payload.get("currentPlanPath") or payload.get("planPath") or ""), reason, iso(now_utc()))
        self._write_json_file(paths["registry"], registry)
      else:
        raise ValueError(f"Unsupported automation action: {action}")
      event = self._append_audit({"actor": actor, "action": action, "projectId": project_id, "role": payload.get("role") or "", "planPath": payload.get("planPath") or "", "assignmentId": payload.get("assignmentId") or "", "previousState": previous_state, "nextState": next_state, "reason": reason})
      self._send_json(200, {"ok": True, "auditEvent": event, "summary": self._automation_summary()})
    except Exception as error:  # noqa: BLE001
      self._send_json(400, {"ok": False, "error": str(error)})

  def _project_root(self, payload: dict) -> Path:
    project = payload.get("project") if isinstance(payload.get("project"), dict) else payload
    root_label = str(project.get("rootLabel") or project.get("rootPath") or "").strip()
    if not root_label:
      raise ValueError("Project rootLabel is required for server-backed filesystem access.")
    root = Path(root_label).expanduser().resolve()
    if not root.is_dir():
      raise FileNotFoundError(f"Project root does not exist or is not a directory: {root_label}")
    return root

  def _safe_project_path(self, root: Path, relative_path: str) -> Path:
    rel = str(relative_path or "").strip().replace("\\", "/").lstrip("/")
    cursor = root
    for part in Path(rel).parts:
      cursor = cursor / part
      if cursor.is_symlink():
        raise ValueError(f"Symbolic links are not allowed in confined project paths: {relative_path}")
    path = (root / rel).resolve()
    try:
      path.relative_to(root)
    except ValueError as error:
      raise ValueError(f"Path escapes project root: {relative_path}") from error
    return path

  def _hash_text(self, text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

  def _file_record(self, root: Path, path: Path, task_root_path: str = "") -> dict:
    text = path.read_text(encoding="utf-8", errors="replace")
    relative_path = path.relative_to(root).as_posix()
    relative_to_task_root = ""
    if task_root_path:
      task_root = self._safe_project_path(root, task_root_path)
      try:
        relative_to_task_root = path.relative_to(task_root).as_posix()
      except ValueError:
        relative_to_task_root = Path(os.path.relpath(path, task_root)).as_posix()
    stat = path.stat()
    created_seconds = getattr(stat, "st_birthtime", None)
    if created_seconds is None:
      # POSIX does not expose creation time everywhere. Fall back to the older
      # of ctime/mtime so sortable creation order remains stable enough for
      # non-Darwin development and CI fixtures.
      created_seconds = min(stat.st_ctime, stat.st_mtime)
    return {
      "path": relative_path,
      "relativeToTaskRoot": relative_to_task_root,
      "text": text,
      "hash": self._hash_text(text),
      "size": stat.st_size,
      "createdAt": int(created_seconds * 1000),
      "lastModified": int(stat.st_mtime * 1000),
      "serverBacked": True,
    }

  def _looks_like_task_root(self, path: Path) -> bool:
    markers = [
      (path / "todo.md").is_file(),
      (path / "workflow.md").is_file(),
      (path / "planning").is_dir(),
      (path / "lessons.md").is_file(),
    ]
    return sum(1 for marker in markers if marker) >= 2 and (markers[0] or markers[1])

  def _candidate_paths(self, settings: dict, explicit_path: str) -> list[str]:
    docs = settings.get("documentationFolderNames") or ["docs", "documentation"]
    tasks = settings.get("taskFolderNames") or ["task"]
    candidates: list[str] = []
    if explicit_path:
      candidates.append(explicit_path.strip("/"))
    candidates.append("")
    candidates.extend(str(task).strip("/") for task in tasks)
    for docs_name in docs:
      for task_name in tasks:
        candidates.append(f"{str(docs_name).strip('/')}/{str(task_name).strip('/')}".strip("/"))
    unique: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
      normalized = candidate.replace("\\", "/").strip("/")
      key = normalized.lower()
      if key not in seen:
        unique.append(normalized)
        seen.add(key)
    return unique

  def _find_task_root(self, root: Path, settings: dict, explicit_path: str) -> tuple[Path, str] | None:
    for candidate in self._candidate_paths(settings, explicit_path):
      path = self._safe_project_path(root, candidate) if candidate else root
      if path.is_dir() and self._looks_like_task_root(path):
        return path, candidate or "."
    docs_names = {str(name).lower() for name in settings.get("documentationFolderNames", ["docs", "documentation"])}
    task_names = {str(name).lower() for name in settings.get("taskFolderNames", ["task"])}
    queue: list[tuple[Path, int]] = [(root, 0)]
    while queue:
      current, depth = queue.pop(0)
      if self._looks_like_task_root(current):
        rel = current.relative_to(root).as_posix()
        return current, rel or "."
      if depth >= 3:
        continue
      try:
        children = sorted(child for child in current.iterdir() if child.is_dir())
      except OSError:
        continue
      for child in children:
        lower = child.name.lower()
        should_descend = depth == 0 or lower in docs_names or lower in task_names or depth < 2
        if should_descend:
          queue.append((child, depth + 1))
    return None

  def _setup_revision(self, root: Path) -> str:
    parts: list[str] = []
    for relative in sorted(set([*CANONICAL_TASK_MARKERS, BOOTSTRAP_PATH, SETUP_INSTRUCTION_PATH])):
      path = self._safe_project_path(root, relative)
      if path.is_file():
        parts.append(f"{relative}:file:{hashlib.sha256(path.read_bytes()).hexdigest()}")
      elif path.is_dir():
        parts.append(f"{relative}:dir")
      else:
        parts.append(f"{relative}:missing")
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()

  def _classify_project_setup(self, root: Path) -> dict:
    missing = []
    for relative in CANONICAL_TASK_MARKERS:
      marker = self._safe_project_path(root, relative)
      valid = marker.is_dir() if relative == "docs/tasks/planning" else marker.is_file() and bool(marker.read_text(encoding="utf-8", errors="replace").strip())
      if valid and relative == "docs/tasks/lessons-index.json":
        try:
          valid = isinstance(json.loads(marker.read_text(encoding="utf-8")), dict)
        except Exception:
          valid = False
      if not valid:
        missing.append(relative)
    manifest_path = self._safe_project_path(root, BOOTSTRAP_PATH)
    instruction_path = self._safe_project_path(root, SETUP_INSTRUCTION_PATH)
    conflicts: list[str] = []
    bootstrap = None
    if manifest_path.exists():
      if not manifest_path.is_file():
        conflicts.append(BOOTSTRAP_PATH)
      else:
        try:
          bootstrap = json.loads(manifest_path.read_text(encoding="utf-8"))
          if bootstrap.get("schema") != "taskmanager-project-bootstrap/v1" or bootstrap.get("kit", {}).get("tag") != WORKFLOW_KIT_TAG:
            conflicts.append(BOOTSTRAP_PATH)
        except Exception:
          conflicts.append(BOOTSTRAP_PATH)
    if instruction_path.exists() and not instruction_path.is_file():
      conflicts.append(SETUP_INSTRUCTION_PATH)
    elif instruction_path.is_file():
      instruction = instruction_path.read_text(encoding="utf-8", errors="replace")
      expected_hash = str((bootstrap or {}).get("instruction", {}).get("sha256") or "")
      if not bootstrap or not expected_hash or self._hash_text(instruction) != expected_hash:
        conflicts.append(SETUP_INSTRUCTION_PATH)
    any_setup_content = any(self._safe_project_path(root, relative).exists() for relative in CANONICAL_TASK_MARKERS)
    state = "healthy" if not missing else "conflict" if conflicts else "setup-incomplete" if (bootstrap or any_setup_content) else "setup-required"
    return {
      "state": state,
      "missing": missing,
      "conflicts": sorted(set(conflicts)),
      "revision": self._setup_revision(root),
      "bootstrap": bootstrap,
      "kit": {"repository": "aipieksel/ai-agent-workflow-kits", "tag": WORKFLOW_KIT_TAG, "commit": WORKFLOW_KIT_COMMIT},
    }

  def _walk_text_files(self, root: Path, directory: Path, task_root_path: str, max_depth: int = 6, depth: int = 0) -> list[dict]:
    records: list[dict] = []
    try:
      children = sorted(directory.iterdir())
    except OSError:
      return records
    for child in children:
      if child.is_file() and child.suffix.lower() in {".md", ".json"}:
        records.append(self._file_record(root, child, task_root_path))
      elif child.is_dir() and depth < max_depth:
        records.extend(self._walk_text_files(root, child, task_root_path, max_depth, depth + 1))
    return records

  def _handle_scan_project(self) -> None:
    try:
      payload = self._read_json()
      root = self._project_root(payload)
      project = payload.get("project") if isinstance(payload.get("project"), dict) else {}
      settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else {}
      setup = self._classify_project_setup(root)
      found = None
      if setup["state"] == "healthy":
        found = (self._safe_project_path(root, "docs/tasks"), "docs/tasks")
      else:
        legacy = self._find_task_root(root, settings, str(project.get("explicitTaskPath") or ""))
        if legacy and legacy[1].lower() != "docs/tasks":
          found = legacy
          setup = {**setup, "state": "healthy", "contract": "compatible-legacy", "missing": [], "conflicts": []}
      if not found:
        self._send_json(200, {"ok": True, "taskRootPath": "docs/tasks", "files": [], "setup": setup})
        return
      task_root, task_root_path = found
      files = self._walk_text_files(root, task_root, task_root_path, max_depth=6)
      observations = task_root.parent / "agent-observations"
      if observations.is_dir():
        files.extend(self._walk_text_files(root, observations, task_root_path, max_depth=4))
      self._send_json(200, {
        "ok": True,
        "taskRootPath": task_root_path,
        "files": files,
        "setup": {**setup, "state": "healthy", "contract": setup.get("contract", "agent-workflow-kits-v1")},
      })
    except Exception as error:  # noqa: BLE001
      self._send_json(400, {"ok": False, "error": str(error)})

  def _handle_bootstrap_project(self) -> None:
    try:
      payload = self._read_json()
      root = self._project_root(payload)
      instruction = str(payload.get("instruction") or "")
      if len(instruction.encode("utf-8")) > 100_000 or "aipieksel/ai-agent-workflow-kits" not in instruction or WORKFLOW_KIT_TAG not in instruction:
        raise ValueError("Bootstrap instruction does not match the supported Agent Workflow Kits release.")
      setup = self._classify_project_setup(root)
      expected_revision = str(payload.get("expectedRevision") or "")
      if expected_revision and expected_revision != setup["revision"]:
        self._send_json(409, {"ok": False, "error": "Project setup changed after the last scan. Check setup before retrying.", "setup": setup})
        return
      if setup["state"] == "healthy":
        self._send_json(409, {"ok": False, "error": "This project already has a healthy task system.", "setup": setup})
        return
      if setup["conflicts"]:
        self._send_json(409, {"ok": False, "error": "Task Manager bootstrap paths contain conflicting content.", "setup": setup})
        return
      instruction_path = self._safe_project_path(root, SETUP_INSTRUCTION_PATH)
      manifest_path = self._safe_project_path(root, BOOTSTRAP_PATH)
      if instruction_path.is_file() and instruction_path.read_text(encoding="utf-8", errors="replace") == instruction and manifest_path.is_file():
        self._send_json(200, {"ok": True, "created": False, "idempotent": True, "setup": self._classify_project_setup(root)})
        return
      dry_run = bool(payload.get("dryRun"))
      if dry_run:
        self._send_json(200, {"ok": True, "dryRun": True, "created": False, "paths": [BOOTSTRAP_PATH, SETUP_INSTRUCTION_PATH], "setup": setup})
        return
      created_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
      manifest = {
        "schema": "taskmanager-project-bootstrap/v1",
        "version": 1,
        "status": "instruction-ready",
        "kit": {"repository": "aipieksel/ai-agent-workflow-kits", "tag": WORKFLOW_KIT_TAG, "commit": WORKFLOW_KIT_COMMIT},
        "createdAt": created_at,
        "updatedAt": created_at,
        "instruction": {"path": SETUP_INSTRUCTION_PATH, "sha256": self._hash_text(instruction)},
        "detectedContractVersion": None,
      }
      manifest_text = json.dumps(manifest, indent=2) + "\n"
      staged: list[tuple[Path, Path, str]] = []
      for final, text in [(manifest_path, manifest_text), (instruction_path, instruction)]:
        final.parent.mkdir(parents=True, exist_ok=True)
        temporary = final.parent / f".{final.name}.taskmanager-{uuid.uuid4().hex}.tmp"
        temporary.write_text(text, encoding="utf-8")
        if temporary.read_text(encoding="utf-8") != text:
          raise IOError(f"Bootstrap staging verification failed: {final.relative_to(root).as_posix()}")
        staged.append((temporary, final, text))
      committed: list[Path] = []
      try:
        for temporary, final, text in staged:
          if final.exists():
            if final.is_file() and final.read_text(encoding="utf-8", errors="replace") == text:
              temporary.unlink(missing_ok=True)
              continue
            raise FileExistsError(f"Bootstrap conflict: {final.relative_to(root).as_posix()}")
          temporary.replace(final)
          committed.append(final)
      except Exception:
        for path in committed:
          path.unlink(missing_ok=True)
        raise
      finally:
        for temporary, _, _ in staged:
          temporary.unlink(missing_ok=True)
      self._send_json(200, {"ok": True, "created": True, "idempotent": False, "paths": [BOOTSTRAP_PATH, SETUP_INSTRUCTION_PATH], "setup": self._classify_project_setup(root)})
    except Exception as error:  # noqa: BLE001
      self._send_json(400, {"ok": False, "error": str(error)})

  def _handle_read_text(self) -> None:
    try:
      payload = self._read_json()
      root = self._project_root(payload)
      path = self._safe_project_path(root, str(payload.get("path") or ""))
      if not path.is_file():
        raise FileNotFoundError(f"File not found: {payload.get('path')}")
      self._send_json(200, {"ok": True, "file": self._file_record(root, path, str(payload.get("taskRootPath") or ""))})
    except Exception as error:  # noqa: BLE001
      self._send_json(400, {"ok": False, "error": str(error)})

  def _handle_write_text(self) -> None:
    try:
      payload = self._read_json()
      root = self._project_root(payload)
      path = self._safe_project_path(root, str(payload.get("path") or ""))
      expected_hash = str(payload.get("expectedHash") or "")
      if path.exists() and expected_hash:
        current = path.read_text(encoding="utf-8", errors="replace")
        if self._hash_text(current) != expected_hash:
          self._send_json(409, {"ok": False, "error": "The file changed after the last scan. Rescan before writing."})
          return
      path.parent.mkdir(parents=True, exist_ok=True)
      text = str(payload.get("text") or "")
      path.write_text(text, encoding="utf-8")
      saved = path.read_text(encoding="utf-8", errors="replace")
      if saved != text:
        raise IOError("Write verification failed: saved content differs from requested content.")
      self._send_json(200, {"ok": True, "file": self._file_record(root, path, str(payload.get("taskRootPath") or ""))})
    except Exception as error:  # noqa: BLE001
      self._send_json(400, {"ok": False, "error": str(error)})

  def _handle_copy_verify_delete(self) -> None:
    try:
      payload = self._read_json()
      root = self._project_root(payload)
      source = self._safe_project_path(root, str(payload.get("sourcePath") or ""))
      destination = self._safe_project_path(root, str(payload.get("destinationPath") or ""))
      if not source.is_file():
        raise FileNotFoundError(f"Source plan does not exist: {payload.get('sourcePath')}")
      source_text = source.read_text(encoding="utf-8", errors="replace")
      source_hash = self._hash_text(source_text)
      expected_hash = str(payload.get("expectedSourceHash") or "")
      if expected_hash and source_hash != expected_hash:
        self._send_json(409, {"ok": False, "error": "The source plan changed after the last scan. Rescan before changing its lifecycle."})
        return
      if destination.exists():
        raise FileExistsError(f"Destination plan already exists: {payload.get('destinationPath')}")
      destination_text = str(payload.get("destinationText") or "")
      destination.parent.mkdir(parents=True, exist_ok=True)
      destination.write_text(destination_text, encoding="utf-8")
      if destination.read_text(encoding="utf-8", errors="replace") != destination_text:
        raise IOError("Destination verification failed.")
      source.unlink()
      if source.exists():
        raise IOError(f"Source file still exists after deletion: {payload.get('sourcePath')}")
      self._send_json(200, {
        "ok": True,
        "sourceHash": source_hash,
        "file": self._file_record(root, destination, str(payload.get("taskRootPath") or "")),
      })
    except Exception as error:  # noqa: BLE001
      self._send_json(400, {"ok": False, "error": str(error)})

  def _handle_copy_verify_delete_folder(self) -> None:
    try:
      payload = self._read_json()
      root = self._project_root(payload)
      source = self._safe_project_path(root, str(payload.get("sourcePath") or ""))
      destination = self._safe_project_path(root, str(payload.get("destinationPath") or ""))
      task_root_path = str(payload.get("taskRootPath") or "")
      if not source.is_dir():
        raise FileNotFoundError(f"Source plan folder does not exist: {payload.get('sourcePath')}")
      source_manifest = source / "plan.json"
      if not source_manifest.is_file():
        raise FileNotFoundError(f"Source plan folder is missing plan.json: {payload.get('sourcePath')}")
      source_manifest_text = source_manifest.read_text(encoding="utf-8", errors="replace")
      source_manifest_hash = self._hash_text(source_manifest_text)
      expected_hash = str(payload.get("expectedManifestHash") or "")
      if expected_hash and source_manifest_hash != expected_hash:
        self._send_json(409, {"ok": False, "error": "The source plan manifest changed after the last scan. Rescan before changing its lifecycle."})
        return
      if destination.exists():
        raise FileExistsError(f"Destination plan folder already exists: {payload.get('destinationPath')}")
      destination.parent.mkdir(parents=True, exist_ok=True)
      shutil.copytree(source, destination)

      updates = payload.get("updates") if isinstance(payload.get("updates"), dict) else {}
      updated_files: list[dict] = []
      for relative, text in updates.items():
        relative_text = str(relative or "").strip().replace("\\", "/").lstrip("/")
        if not relative_text:
          continue
        target = (destination / relative_text).resolve()
        try:
          target.relative_to(destination.resolve())
        except ValueError as error:
          raise ValueError(f"Folder update escapes destination: {relative}") from error
        target.parent.mkdir(parents=True, exist_ok=True)
        requested_text = str(text)
        target.write_text(requested_text, encoding="utf-8")
        if target.read_text(encoding="utf-8", errors="replace") != requested_text:
          raise IOError(f"Folder update verification failed: {relative}")
        updated_files.append(self._file_record(root, target, task_root_path))

      destination_manifest = destination / "plan.json"
      if not destination_manifest.is_file():
        raise IOError("Destination plan folder verification failed: plan.json missing.")
      shutil.rmtree(source)
      if source.exists():
        raise IOError(f"Source folder still exists after deletion: {payload.get('sourcePath')}")
      self._send_json(200, {
        "ok": True,
        "folderPath": destination.relative_to(root).as_posix(),
        "sourceManifestHash": source_manifest_hash,
        "manifest": self._file_record(root, destination_manifest, task_root_path),
        "updatedFiles": updated_files,
      })
    except Exception as error:  # noqa: BLE001
      self._send_json(400, {"ok": False, "error": str(error)})


def main() -> None:
  args = parse_args()
  directory = (ROOT / args.directory).resolve()
  explicit_runtime_config = (ROOT / args.runtime_config).resolve() if args.runtime_config else None
  registry_resolution = resolve_project_registry(explicit_runtime_config)
  runtime_config = registry_resolution.active_path
  served_runtime_config = (directory / "data/runtime/projects.json").resolve()
  if not runtime_config.exists():
    runtime_config.parent.mkdir(parents=True, exist_ok=True)
    runtime_config.write_text(json.dumps({"version": 1, "projects": []}, indent=2) + "\n")
  served_runtime_config.parent.mkdir(parents=True, exist_ok=True)
  if not served_runtime_config.exists() or served_runtime_config.read_text() != runtime_config.read_text():
    served_runtime_config.write_text(runtime_config.read_text())

  handler = lambda *handler_args, **handler_kwargs: RuntimeConfigHandler(
    *handler_args,
    directory=str(directory),
    **handler_kwargs,
  )
  RuntimeConfigHandler.runtime_config = runtime_config
  RuntimeConfigHandler.served_runtime_config = served_runtime_config
  RuntimeConfigHandler.registry_resolution = registry_resolution
  server = ThreadingHTTPServer((args.host, args.port), handler)
  print(f"Serving {directory} at http://{args.host}:{args.port}/")
  print(f"Writing runtime project config to {runtime_config}")
  print(f"Registry source: {registry_resolution.source}")
  try:
    server.serve_forever()
  except KeyboardInterrupt:
    print("\nStopping server.")
  finally:
    server.server_close()


if __name__ == "__main__":
  main()
