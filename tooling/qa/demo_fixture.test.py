#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GENERATOR = ROOT / "tooling/demo/create_populated_project.py"


def digest_tree(root: Path) -> str:
  digest = hashlib.sha256()
  for path in sorted(item for item in root.rglob("*") if item.is_file()):
    digest.update(path.relative_to(root).as_posix().encode())
    digest.update(b"\0")
    digest.update(path.read_bytes())
    digest.update(b"\0")
  return digest.hexdigest()


with tempfile.TemporaryDirectory() as temp_dir:
  temp = Path(temp_dir)
  first = temp / "first"
  second = temp / "second"
  subprocess.run([sys.executable, str(GENERATOR), str(first)], cwd=ROOT, check=True, capture_output=True)
  subprocess.run([sys.executable, str(GENERATOR), str(second)], cwd=ROOT, check=True, capture_output=True)
  assert digest_tree(first) == digest_tree(second), "demo output must be byte-stable"
  combined = "\n".join(path.read_text(errors="replace") for path in first.rglob("*") if path.is_file())
  assert not re.search(r"/(?:Users|Volumes)/", combined), "demo must not contain machine paths"
  assert not re.search(r"prompt-manager|voice-manager|api[_-]?key|access[_-]?token", combined, re.I), "demo must not contain excluded product or secret text"
  assert (first / "docs/tasks/planning/in-progress/00007-checkout-recovery/plan.json").is_file()

print("demo_fixture.test.py: pass")
