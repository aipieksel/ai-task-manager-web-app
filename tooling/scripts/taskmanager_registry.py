#!/usr/bin/env python3
"""Resolve the isolated public project registry without legacy data migration."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC_APP_SUPPORT_RUNTIME_DIR = (
    Path.home()
    / "Library"
    / "Application Support"
    / "Agentic AI Projects Task Manager"
    / "data"
    / "runtime"
)


@dataclass(frozen=True)
class RegistryResolution:
    active_path: Path
    runtime_dir: Path
    source: str
    repo_path: Path
    app_support_path: Path
    dist_path: Path

    def as_dict(self) -> dict[str, Any]:
        return {
            "activePath": str(self.active_path),
            "runtimeDir": str(self.runtime_dir),
            "source": self.source,
            "repoPath": str(self.repo_path),
            "appSupportPath": str(self.app_support_path),
            "distPath": str(self.dist_path),
        }


def _resolved_env_path(name: str) -> Path | None:
    value = os.environ.get(name)
    return Path(value).expanduser().resolve(strict=False) if value else None


def ensure_registry_file(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(json.dumps({"version": 1, "projects": []}, indent=2) + "\n")


def resolve_project_registry(
    explicit: Path | None = None,
    *,
    root: Path = ROOT,
    repo_path: Path | None = None,
    app_support_path: Path | None = None,
    dist_path: Path | None = None,
) -> RegistryResolution:
    repo = repo_path or (root / "src" / "taskmanager" / "data" / "runtime" / "projects.json")
    dist = dist_path or (root / "dist" / "data" / "runtime" / "projects.json")
    app_support = (
        _resolved_env_path("AGENTIC_TASK_MANAGER_APP_SUPPORT_PROJECTS_FILE")
        or app_support_path
        or (PUBLIC_APP_SUPPORT_RUNTIME_DIR / "projects.json")
    )

    if explicit is not None:
        active = explicit.expanduser().resolve(strict=False)
        source = "explicit"
    elif os.environ.get("TASKMANAGER_PROJECTS_FILE"):
        active = Path(os.environ["TASKMANAGER_PROJECTS_FILE"]).expanduser().resolve(strict=False)
        source = "env:TASKMANAGER_PROJECTS_FILE"
    elif os.environ.get("TASKMANAGER_RUNTIME_DIR"):
        active = Path(os.environ["TASKMANAGER_RUNTIME_DIR"]).expanduser().resolve(strict=False) / "projects.json"
        source = "env:TASKMANAGER_RUNTIME_DIR"
    elif os.environ.get("AGENTIC_TASK_MANAGER_USE_REPO_DATA") == "1":
        active = repo.resolve(strict=False)
        source = "env:AGENTIC_TASK_MANAGER_USE_REPO_DATA"
    else:
        active = app_support.resolve(strict=False)
        source = "public-app-support"

    ensure_registry_file(active)
    return RegistryResolution(active, active.parent, source, repo, app_support, dist)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Print public task-manager registry diagnostics.")
    parser.add_argument("--projects", type=Path, default=None)
    args = parser.parse_args()
    print(json.dumps(resolve_project_registry(args.projects).as_dict(), indent=2))
