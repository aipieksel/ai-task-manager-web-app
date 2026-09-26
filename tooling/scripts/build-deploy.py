#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "src" / "taskmanager"
DESTINATION = ROOT / "dist"
MANIFEST_PATH = ROOT / "DEPLOY_MANIFEST.json"
RUNTIME_PROJECTS = ROOT / "data" / "runtime" / "projects.json"
RUNTIME_CONFIG_DIR = ROOT / "data" / "runtime" / "config"

EXCLUDED_NAMES = {"previews", ".DS_Store", "__pycache__"}
TEXT_SUFFIXES = {".html", ".js", ".css", ".json", ".webmanifest", ".md", ".txt"}
FORBIDDEN_STRINGS = {
    "Example Dashboard",
    "SEO Panel",
    "Example Private Website",
    "Agent Workbench",
    "Use the Grok design system",
    "/projects/seo-panel",
    "/workspace/example-dashboard",
    "reference-mockup",
    "dummy data",
}


def should_exclude(path: Path) -> bool:
    relative = path.relative_to(SOURCE)
    if relative.as_posix() == "assets/js/filesystem.js":
        return True
    return any(part in EXCLUDED_NAMES for part in relative.parts)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fail(message: str) -> None:
    print(f"build-deploy.py: FAIL — {message}", file=sys.stderr)
    raise SystemExit(1)


if not SOURCE.is_dir():
    fail("src/taskmanager/ does not exist")

if DESTINATION.exists():
    shutil.rmtree(DESTINATION)
DESTINATION.mkdir(parents=True)

for source_path in sorted(SOURCE.rglob("*")):
    if should_exclude(source_path):
        continue
    relative = source_path.relative_to(SOURCE)
    destination_path = DESTINATION / relative
    if source_path.is_dir():
        destination_path.mkdir(parents=True, exist_ok=True)
    elif source_path.is_file():
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, destination_path)

required = [
    "index.html",
    "manifest.webmanifest",
    "sw.js",
    "css/styles.css",
    "js/app/main.js",
    "assets/icons/icon-192.png",
    "assets/icons/icon-512.png",
    "assets/icons/icon-maskable-512.png",
]
for relative in required:
    if not (DESTINATION / relative).is_file():
        fail(f"missing required deploy asset: {relative}")

if RUNTIME_PROJECTS.is_file():
    try:
        json.loads(RUNTIME_PROJECTS.read_text())
    except json.JSONDecodeError as error:
        fail(f"invalid data/runtime/projects.json: {error}")
    runtime_destination = DESTINATION / "data" / "runtime" / "projects.json"
    runtime_destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(RUNTIME_PROJECTS, runtime_destination)

if RUNTIME_CONFIG_DIR.is_dir():
    runtime_config_destination = DESTINATION / "data" / "runtime" / "config"
    runtime_config_destination.mkdir(parents=True, exist_ok=True)
    for config_file in sorted(RUNTIME_CONFIG_DIR.glob("*.json")):
        try:
            json.loads(config_file.read_text())
        except json.JSONDecodeError as error:
            fail(f"invalid {config_file.relative_to(ROOT)}: {error}")
        shutil.copy2(config_file, runtime_config_destination / config_file.name)

for path in DESTINATION.rglob("*"):
    relative = path.relative_to(DESTINATION)
    if any(part in {"reference-mockup", "tests", "previews", "references"} for part in relative.parts):
        fail(f"non-production path copied into dist/: {relative}")
    if path.is_file() and path.suffix.lower() in TEXT_SUFFIXES:
        text = path.read_text(errors="replace")
        lowered = text.lower()
        for forbidden in FORBIDDEN_STRINGS:
            if forbidden.lower() in lowered:
                fail(f"forbidden production string {forbidden!r} in {relative}")

# Guard against obvious seeded domain collections. Empty defaults and route/static configuration are allowed.
seed_patterns = [
    r"(?:projects|tasks|questions|lessons|observations|completed)\s*:\s*\[\s*\{",
    r"(?:queue|activity)\s*:\s*\[\s*\{",
]
for path in (DESTINATION / "js").rglob("*.js"):
    text = path.read_text(errors="replace")
    for pattern in seed_patterns:
        if re.search(pattern, text, flags=re.I | re.S):
            fail(f"possible seeded domain collection in {path.relative_to(DESTINATION)}")

files = []
for path in sorted(DESTINATION.rglob("*")):
    if path.is_file():
        files.append({
            "path": path.relative_to(DESTINATION).as_posix(),
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
        })
manifest = {
    "version": 1,
    "source": "src/taskmanager/",
    "destination": "dist/",
    "excluded": sorted(EXCLUDED_NAMES),
    "files": files,
}
MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
print(f"build-deploy.py: pass ({len(files)} production files)")
