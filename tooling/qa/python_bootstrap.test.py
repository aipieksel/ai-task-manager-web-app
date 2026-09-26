#!/usr/bin/env python3
from __future__ import annotations

import json
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
INSTRUCTION = "# Install Agent Workflow Kits\n\nUse aipieksel/ai-agent-workflow-kits at v1.0.0.\n"


def port() -> int:
  sock = socket.socket()
  sock.bind(("127.0.0.1", 0))
  value = sock.getsockname()[1]
  sock.close()
  return value


def request(base: str, path: str, payload: dict) -> tuple[int, dict]:
  data = json.dumps(payload).encode()
  try:
    with urlopen(Request(base + path, data=data, headers={"Content-Type": "application/json"}, method="POST"), timeout=5) as response:
      return response.status, json.loads(response.read())
  except HTTPError as error:
    return error.code, json.loads(error.read())


with tempfile.TemporaryDirectory() as temp_dir:
  temp = Path(temp_dir)
  static = temp / "static"
  (static / "data/runtime").mkdir(parents=True)
  (static / "data/runtime/projects.json").write_text('{"version":1,"projects":[]}\n')
  runtime = temp / "runtime.json"
  runtime.write_text('{"version":1,"projects":[]}\n')
  runtime_port = port()
  process = subprocess.Popen([sys.executable, str(ROOT / "tooling/scripts/serve-runtime.py"), "--directory", str(static), "--port", str(runtime_port), "--runtime-config", str(runtime)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
  base = f"http://127.0.0.1:{runtime_port}/"
  try:
    for _ in range(100):
      try:
        urlopen(base + "data/runtime/projects.json", timeout=.2).close()
        break
      except Exception:  # noqa: BLE001
        time.sleep(.05)
    project = temp / "project"
    project.mkdir()
    scan_status, scan = request(base, "api/projects/scan", {"project": {"rootLabel": str(project)}, "settings": {}})
    assert scan_status == 200 and scan["setup"]["state"] == "setup-required", scan
    status, dry = request(base, "api/projects/bootstrap", {"project": {"rootLabel": str(project)}, "instruction": INSTRUCTION, "expectedRevision": scan["setup"]["revision"], "dryRun": True})
    assert status == 200 and dry["dryRun"] and not (project / "docs").exists(), dry
    status, created = request(base, "api/projects/bootstrap", {"project": {"rootLabel": str(project)}, "instruction": INSTRUCTION, "expectedRevision": scan["setup"]["revision"]})
    assert status == 200 and created["setup"]["state"] == "setup-incomplete", created
    status, retry = request(base, "api/projects/bootstrap", {"project": {"rootLabel": str(project)}, "instruction": INSTRUCTION, "expectedRevision": created["setup"]["revision"]})
    assert status == 200 and retry["idempotent"], retry
    instruction_path = project / "docs/tasks/onboarding/install-agent-workflow-kits.md"
    instruction_path.write_text(INSTRUCTION + "changed\n")
    _, conflict = request(base, "api/projects/scan", {"project": {"rootLabel": str(project)}, "settings": {}})
    assert conflict["setup"]["state"] == "conflict", conflict

    stale = temp / "stale"
    stale.mkdir()
    _, before = request(base, "api/projects/scan", {"project": {"rootLabel": str(stale)}, "settings": {}})
    (stale / "docs/tasks").mkdir(parents=True)
    (stale / "docs/tasks/todo.md").write_text("# changed\n")
    status, _ = request(base, "api/projects/bootstrap", {"project": {"rootLabel": str(stale)}, "instruction": INSTRUCTION, "expectedRevision": before["setup"]["revision"]})
    assert status == 409

    outside = temp / "outside"
    outside.mkdir()
    linked = temp / "linked"
    linked.mkdir()
    (linked / "docs").symlink_to(outside, target_is_directory=True)
    status, _ = request(base, "api/projects/bootstrap", {"project": {"rootLabel": str(linked)}, "instruction": INSTRUCTION})
    assert status != 200 and not (outside / "tasks").exists()
  finally:
    process.terminate()
    process.wait(timeout=5)

print("python_bootstrap.test.py: pass")
