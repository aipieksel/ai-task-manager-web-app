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
SERVED_PROJECTS = ROOT / TARGET_NAME / "data/runtime/projects.json"
SERVED_UI = ROOT / TARGET_NAME / "data/runtime/config/ui.json"
ORIGINAL_SERVED_PROJECTS = SERVED_PROJECTS.read_text() if SERVED_PROJECTS.exists() else None
ORIGINAL_SERVED_UI = SERVED_UI.read_text() if SERVED_UI.exists() else None


def free_port() -> int:
  sock = socket.socket()
  sock.bind(("127.0.0.1", 0))
  port = sock.getsockname()[1]
  sock.close()
  return port


def wait_for_server(port: int) -> None:
  deadline = time.time() + 10
  while time.time() < deadline:
    try:
      with urlopen(f"http://127.0.0.1:{port}/data/runtime/projects.json", timeout=.5):
        return
    except Exception:  # noqa: BLE001
      time.sleep(.1)
  raise RuntimeError("runtime server did not start")


def assert_queue_geometry(page) -> None:
  result = page.evaluate("""() => {
    const overlap = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
    for (const shell of document.querySelectorAll('.ledger-row-shell')) {
      const shellBox = shell.getBoundingClientRect();
      const actions = shell.querySelector('.ledger-row-actions');
      const actionBox = actions?.getBoundingClientRect();
      if (actionBox && (actionBox.left < shellBox.left - 1 || actionBox.right > shellBox.right + 1 || actionBox.bottom > shellBox.bottom + 1)) return {ok:false, kind:'actions-outside', shell:shellBox.toJSON(), actions:actionBox.toJSON(), text:shell.innerText};
      const cells = [...shell.querySelectorAll('.ledger-row > *')].filter((node) => getComputedStyle(node).display !== 'none');
      for (let index = 0; index < cells.length; index += 1) {
        for (let other = index + 1; other < cells.length; other += 1) {
          if (overlap(cells[index].getBoundingClientRect(), cells[other].getBoundingClientRect())) return {ok:false, kind:'cell-overlap', first:cells[index].className, second:cells[other].className, a:cells[index].getBoundingClientRect().toJSON(), b:cells[other].getBoundingClientRect().toJSON(), text:shell.innerText};
        }
        if (actionBox && overlap(cells[index].getBoundingClientRect(), actionBox)) return {ok:false, kind:'action-overlap', cell:cells[index].className, a:cells[index].getBoundingClientRect().toJSON(), actions:actionBox.toJSON(), text:shell.innerText};
      }
    }
    return {ok:true};
  }""")
  assert result["ok"], f"queue geometry failure at {page.viewport_size}: {result}"


with tempfile.TemporaryDirectory() as temp_dir:
  temp = Path(temp_dir)
  project = temp / "launchpad-commerce"
  project.mkdir()
  registry = temp / "projects.json"
  registry.write_text(json.dumps({"version": 1, "projects": [{"id": "launchpad-commerce", "name": "Launchpad Commerce", "rootLabel": str(project)}]}, indent=2) + "\n")
  port = free_port()
  process = subprocess.Popen([os.environ.get("PYTHON", "python3"), str(ROOT / "tooling/scripts/serve-runtime.py"), "--directory", TARGET_NAME, "--port", str(port), "--runtime-config", str(registry)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
  try:
    wait_for_server(port)
    with sync_playwright() as playwright:
      browser = playwright.chromium.launch(headless=True, executable_path=os.environ.get("CHROMIUM_EXECUTABLE", "/usr/bin/chromium"))
      context = browser.new_context(viewport={"width": 1440, "height": 1000})
      context.grant_permissions(["clipboard-read", "clipboard-write"], origin=f"http://127.0.0.1:{port}")
      page = context.new_page()
      errors: list[str] = []
      page.on("pageerror", lambda error: errors.append(str(error)))
      page.on("console", lambda message: errors.append(message.text) if message.type == "error" and not message.text.startswith("Failed to load resource:") else None)
      page.goto(f"http://127.0.0.1:{port}/#/", wait_until="domcontentloaded")
      expect(page.get_by_text("Launchpad Commerce needs Agent Workflow Kits")).to_be_visible(timeout=15000)
      expect(page.get_by_text("Install the Agent Workflow Kits task system").first).to_be_visible()
      assert page.locator('.ledger-row-shell', has_text="Install the Agent Workflow Kits task system").count() == 1
      expect(page.get_by_text("Not automatable")).to_be_visible()
      page.get_by_role("button", name="Create setup task").first.click()
      expect(page.get_by_text("Setup task created. Copy it to your coding agent.")).to_be_visible(timeout=10000)
      expect(page.get_by_role("button", name="Copy agent instruction").first).to_be_visible()
      page.get_by_role("button", name="Copy agent instruction").first.click()
      expect(page.get_by_text("Agent Workflow Kits instruction copied.")).to_be_visible(timeout=10000)
      clipboard = page.evaluate("navigator.clipboard.readText()")
      assert "aipieksel/ai-agent-workflow-kits" in clipboard
      assert "Documentation → Task → Verification" in clipboard
      assert (project / "docs/tasks/.taskmanager-bootstrap.json").is_file()
      assert (project / "docs/tasks/onboarding/install-agent-workflow-kits.md").is_file()
      subprocess.run([os.environ.get("PYTHON", "python3"), str(ROOT / "tooling/demo/create_populated_project.py"), str(project)], check=True, cwd=ROOT, capture_output=True)
      page.get_by_role("button", name="Check setup").first.click()
      expect(page.get_by_text("Build accessible checkout recovery flow").first).to_be_visible(timeout=15000)
      expect(page.get_by_text("Clarify payment review handoff states").first).to_be_visible(timeout=15000)
      expect(page.get_by_text("1 healthy of 1").first).to_be_visible()
      assert page.locator('.ledger-row-shell', has_text="Install the Agent Workflow Kits task system").count() == 0
      assert "At a Glance" not in page.locator(".queue-row-list").inner_text()
      for width in (1920, 1440, 1180, 900, 390):
        page.set_viewport_size({"width": width, "height": 1000 if width > 390 else 844})
        assert_queue_geometry(page)
      page.reload(wait_until="domcontentloaded")
      expect(page.get_by_text("Build accessible checkout recovery flow").first).to_be_visible(timeout=15000)
      page.set_viewport_size({"width": 390, "height": 844})
      expect(page.get_by_text("Build accessible checkout recovery flow").first).to_be_visible()
      assert_queue_geometry(page)
      assert not errors, errors
      context.close()
      browser.close()
  finally:
    process.terminate()
    process.wait(timeout=5)
    if ORIGINAL_SERVED_PROJECTS is None:
      SERVED_PROJECTS.unlink(missing_ok=True)
    else:
      SERVED_PROJECTS.parent.mkdir(parents=True, exist_ok=True)
      SERVED_PROJECTS.write_text(ORIGINAL_SERVED_PROJECTS)
    if ORIGINAL_SERVED_UI is None:
      SERVED_UI.unlink(missing_ok=True)
    else:
      SERVED_UI.parent.mkdir(parents=True, exist_ok=True)
      SERVED_UI.write_text(ORIGINAL_SERVED_UI)

print(f"project_onboarding_e2e.py: pass ({TARGET_NAME})")
