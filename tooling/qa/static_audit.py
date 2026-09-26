#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "src" / "taskmanager"
DIST = ROOT / "dist"
PRODUCTION_ROOTS = [APP, DIST]

FORBIDDEN = [
    "Example Dashboard",
    "SEO Panel",
    "Example Private Website",
    "Agent Workbench",
    "Use the Grok design system",
    "/projects/seo-panel",
    "/workspace/example-dashboard",
]
TEXT_SUFFIXES = {".html", ".js", ".css", ".json", ".webmanifest", ".md"}
errors: list[str] = []
checks: list[str] = []


def check(condition: bool, message: str) -> None:
    if condition:
        checks.append(message)
    else:
        errors.append(message)


def hash_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit_production_tree(tree: Path) -> str:
    check(tree.is_dir(), f"production directory exists: {tree.name}/")
    manifest_path = tree / "manifest.webmanifest"
    check(manifest_path.is_file(), f"manifest exists: {tree.name}/manifest.webmanifest")
    if not manifest_path.is_file():
        return ""
    manifest = json.loads(manifest_path.read_text())
    check(manifest.get("display") == "standalone", f"manifest uses standalone display: {tree.name}")
    check(len(manifest.get("icons", [])) >= 3, f"manifest defines required icons: {tree.name}")
    for icon in manifest.get("icons", []):
        check((tree / icon["src"]).is_file(), f"manifest icon exists: {tree.name}/{icon['src']}")

    all_text = ""
    for path in tree.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        text = path.read_text(errors="replace")
        all_text += "\n" + text
        relative = path.relative_to(ROOT)
        for forbidden in FORBIDDEN:
            check(forbidden not in text, f"no production fixture string {forbidden!r} in {relative}")
        check("../reference-mockup" not in text and "reference-mockup/" not in text, f"no reference import in {relative}")
        check("../tests" not in text and "tests/" not in text, f"no test import in {relative}")

    check(not re.search(r"https?://", all_text), f"no external HTTP dependencies: {tree.name}")
    check("mockup" not in all_text.lower(), f"no mockup references: {tree.name}")
    check("dummy data" not in all_text.lower(), f"no dummy-data bootstrap: {tree.name}")

    seed_patterns = [
        r"(?:projects|tasks|questions|lessons|observations|completed)\s*:\s*\[\s*\{",
        r"(?:queue|activity)\s*:\s*\[\s*\{",
    ]
    for pattern in seed_patterns:
        check(not re.search(pattern, all_text, flags=re.I | re.S), f"no seeded domain collection matching {pattern}: {tree.name}")

    # Resolve static module imports.
    for module in (tree / "js").rglob("*.js"):
        text = module.read_text()
        for target in re.findall(r"from\s+['\"]([^'\"]+)['\"]|import\(['\"]([^'\"]+)['\"]\)", text):
            rel = next(item for item in target if item)
            if rel.startswith("."):
                resolved = (module.parent / rel).resolve()
                check(resolved.is_file(), f"module import resolves: {tree.name}/{module.name} -> {rel}")

    # Service-worker entries must be local, present, and production-only.
    sw_path = tree / "sw.js"
    check(sw_path.is_file(), f"service worker exists: {tree.name}")
    if sw_path.is_file():
        sw = sw_path.read_text()
        entries = re.findall(r"'\.\/([^']*)'", sw)
        for entry in entries:
            target = tree if not entry else tree / entry
            check(target.exists(), f"service worker asset exists: {tree.name}/{entry or './'}")
            check(not entry.startswith(("reference-mockup", "tests", "previews", "references")), f"service worker excludes non-production path: {tree.name}/{entry}")
    return all_text


combined_text = "\n".join(audit_production_tree(tree) for tree in PRODUCTION_ROOTS)

# dist/ must be a clean deploy boundary, not a second handoff tree.
for forbidden_dir in ["previews", "reference-mockup", "references", "tests"]:
    check(not (DIST / forbidden_dir).exists(), f"dist excludes {forbidden_dir}/")

# Deploy-manifest hashes must match every deploy file exactly.
deploy_manifest_path = ROOT / "DEPLOY_MANIFEST.json"
check(deploy_manifest_path.is_file(), "deploy manifest exists")
if deploy_manifest_path.is_file():
    deploy_manifest = json.loads(deploy_manifest_path.read_text())
    manifest_paths = {item["path"] for item in deploy_manifest.get("files", [])}
    actual_paths = {path.relative_to(DIST).as_posix() for path in DIST.rglob("*") if path.is_file()}
    check(manifest_paths == actual_paths, "deploy manifest file set matches dist")
    for item in deploy_manifest.get("files", []):
        path = DIST / item["path"]
        check(path.is_file(), f"deploy asset exists: {item['path']}")
        if path.is_file():
            check(path.stat().st_size == item["bytes"], f"deploy size matches: {item['path']}")
            check(hash_file(path) == item["sha256"], f"deploy hash matches: {item['path']}")

policy_sources = [ROOT / "START_HERE.md", ROOT / "README.md"]
policy_text = "\n".join(path.read_text(errors="replace") for path in policy_sources if path.is_file())
required_phrases = ["zero mockup data", "zero dummy data", "must not be deployed"]
for phrase in required_phrases:
    check(phrase.lower() in policy_text.lower(), f"Production policy contains blocking requirement: {phrase}")

# Public releases intentionally omit the private reference package entirely.
check(not (ROOT / "data" / "reference-mockup").exists(), "reference mockup source directory is absent")

result = {"passed": len(checks), "failed": len(errors), "checks": checks, "errors": errors}
output = ROOT / "documentation" / "qa" / "static-audit-results.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(result, indent=2) + "\n")
if errors:
    print("STATIC AUDIT FAILED")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)
print(f"static_audit.py: pass ({len(checks)} checks)")
