#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKIP_DIRS = {".git", "node_modules", "dist", "build", "release", "__pycache__"}
TEXT_SUFFIXES = {"", ".cjs", ".css", ".html", ".js", ".json", ".md", ".mjs", ".py", ".sh", ".swift", ".txt", ".webmanifest", ".yaml", ".yml"}
FORBIDDEN_PATH_PARTS = {
    "data/archive",
    "data/reference-mockup",
    "data/temp",
    "features/prompt-manager",
    "features/voice-manager",
    "native/voice-whisper-helper",
}
FORBIDDEN_TEXT = {
    "prompt-manager": re.compile(r"prompt-manager", re.I),
    "voice-manager": re.compile(r"voice-manager", re.I),
    "manager API": re.compile(r"/api/managers/", re.I),
    "native voice helper": re.compile(r"voice[-_ ]whisper|WhisperKit", re.I),
    "legacy bundle ID": re.compile(r"com\.aipieksel\.taskmanager(?:\.pwa)?", re.I),
    "legacy app-data path": re.compile(r"Application Support[\\/]TaskManager(?:[\\/]|['\"])", re.I),
    "removed registry migration headers": re.compile(r"X-TaskManager-Registry-Migration", re.I),
    "removed registry merge helper": re.compile(r"mergeProjectPayloads|merge_project_payloads"),
    "removed media permission bridge": re.compile(r"mediaPermissionRequestArmedUntil|setPermissionRequestHandler"),
    "private macOS path": re.compile(r"/(?:Users|Volumes)/[^\s'\"`]+"),
    "secret assignment": re.compile(r"(?i)(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*['\"][^'\"]{8,}['\"]"),
}
REQUIRED = {
    "LICENSE",
    "NOTICE",
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "CODE_OF_CONDUCT.md",
    "PUBLIC_RETAIN_MANIFEST.json",
    ".github/PULL_REQUEST_TEMPLATE.md",
}

errors: list[str] = []
reviewed_files = 0
for path in ROOT.rglob("*"):
    relative = path.relative_to(ROOT).as_posix()
    if any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
        continue
    if path.is_dir():
        if any(part in relative for part in FORBIDDEN_PATH_PARTS):
            errors.append(f"forbidden directory: {relative}")
        continue
    if any(part in relative for part in FORBIDDEN_PATH_PARTS):
        errors.append(f"forbidden file: {relative}")
    if path.suffix.lower() not in TEXT_SUFFIXES:
        continue
    if relative in {"tooling/qa/public_release_audit.py", "tooling/qa/demo_fixture.test.py"}:
        continue
    reviewed_files += 1
    text = path.read_text(encoding="utf-8", errors="replace")
    for label, pattern in FORBIDDEN_TEXT.items():
        for match in pattern.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            errors.append(f"{label}: {relative}:{line}")

for required in sorted(REQUIRED):
    if not (ROOT / required).is_file():
        errors.append(f"missing public repository file: {required}")

projects = json.loads((ROOT / "src/taskmanager/data/runtime/projects.json").read_text())
if projects != {"version": 1, "projects": []}:
    errors.append("projects.json is not the empty version-1 seed")

result = {"ok": not errors, "reviewedFiles": reviewed_files, "errors": sorted(set(errors))}
print(json.dumps(result, indent=2))
if errors:
    sys.exit(1)
