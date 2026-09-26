#!/usr/bin/env python3
from __future__ import annotations

import argparse
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


def free_port() -> int:
  sock = socket.socket()
  sock.bind(("127.0.0.1", 0))
  port = sock.getsockname()[1]
  sock.close()
  return port


def wait(port: int) -> None:
  for _ in range(100):
    try:
      with urlopen(f"http://127.0.0.1:{port}/data/runtime/projects.json", timeout=.3):
        return
    except Exception:  # noqa: BLE001
      time.sleep(.1)
  raise RuntimeError("server did not start")


def wait_for_toast(page) -> None:
  page.wait_for_timeout(250)
  page.locator(".toast.show").wait_for(state="hidden", timeout=10000)


def sanitize_temp_paths(page) -> None:
  page.evaluate(r"""() => {
    const privatePath = /\/(?:private\/)?var\/folders\/[^\s<]+/g;
    document.querySelectorAll('body *').forEach((node) => {
      [...node.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE).forEach((child) => {
        child.textContent = child.textContent.replace(privatePath, '/workspace/launchpad-commerce');
      });
    });
  }""")


parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, default=ROOT / "documentation/assets/screenshots")
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
SERVED_PROJECTS = ROOT / "dist/data/runtime/projects.json"
SERVED_UI = ROOT / "dist/data/runtime/config/ui.json"
ORIGINAL_SERVED_PROJECTS = SERVED_PROJECTS.read_text() if SERVED_PROJECTS.exists() else None
ORIGINAL_SERVED_UI = SERVED_UI.read_text() if SERVED_UI.exists() else None

with tempfile.TemporaryDirectory() as temp_dir:
  temp = Path(temp_dir)
  project = temp / "launchpad-commerce"
  project.mkdir()
  registry = temp / "projects.json"
  registry.write_text(json.dumps({"version": 1, "projects": [{"id": "launchpad-commerce", "name": "Launchpad Commerce", "rootLabel": str(project)}]}, indent=2) + "\n")
  port = free_port()
  process = subprocess.Popen([os.environ.get("PYTHON", "python3"), str(ROOT / "tooling/scripts/serve-runtime.py"), "--directory", "dist", "--port", str(port), "--runtime-config", str(registry)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
  try:
    wait(port)
    with sync_playwright() as playwright:
      browser = playwright.chromium.launch(headless=True, executable_path=os.environ.get("CHROMIUM_EXECUTABLE", "/Applications/Chromium.app/Contents/MacOS/Chromium"))
      context = browser.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1, service_workers="block")
      page = context.new_page()
      page.goto(f"http://127.0.0.1:{port}/#/", wait_until="networkidle")
      expect(page.get_by_text("Launchpad Commerce needs Agent Workflow Kits")).to_be_visible(timeout=15000)
      page.screenshot(path=args.output / "workflow-kit-setup-required-desktop.png", full_page=True)
      page.get_by_role("button", name="Create setup task").first.click()
      expect(page.get_by_role("button", name="Copy agent instruction").first).to_be_visible(timeout=15000)
      wait_for_toast(page)
      page.screenshot(path=args.output / "workflow-kit-setup-task-desktop.png", full_page=True)
      subprocess.run([os.environ.get("PYTHON", "python3"), str(ROOT / "tooling/demo/create_populated_project.py"), str(project)], check=True, cwd=ROOT, capture_output=True)
      page.get_by_role("button", name="Check setup").first.click()
      expect(page.get_by_text("Build accessible checkout recovery flow").first).to_be_visible(timeout=15000)
      expect(page.get_by_text("Clarify payment review handoff states").first).to_be_visible(timeout=15000)
      wait_for_toast(page)
      page.screenshot(path=args.output / "populated-queue-desktop.png", full_page=True)
      page.locator('.ledger-row-shell', has_text="Build accessible checkout recovery flow").get_by_text("View task").click()
      expect(page.locator(".plan-section-card").first).to_be_visible(timeout=15000)
      decision_card = page.locator('.plan-section-card', has_text="Planning and Decisions").first
      decision_card.locator("summary").click()
      expect(page.get_by_text("Which customer experience should ship?").first).to_be_visible(timeout=15000)
      page.screenshot(path=args.output / "populated-plan-desktop.png", full_page=True)
      page.get_by_text("Verification run").last.click()
      expect(page.get_by_text("Inspect the complete generated plan").first).to_be_visible(timeout=15000)
      page.screenshot(path=args.output / "populated-verification-desktop.png", full_page=True)
      page.goto(f"http://127.0.0.1:{port}/#/questions", wait_until="networkidle")
      expect(page.get_by_text("Decision desk").first).to_be_visible(timeout=15000)
      page.screenshot(path=args.output / "populated-decisions-desktop.png", full_page=True)
      page.goto(f"http://127.0.0.1:{port}/#/projects", wait_until="networkidle")
      expect(page.get_by_text("100%").first).to_be_visible(timeout=15000)
      sanitize_temp_paths(page)
      page.screenshot(path=args.output / "populated-project-health-desktop.png", full_page=True)
      page.set_viewport_size({"width": 390, "height": 844})
      page.goto(f"http://127.0.0.1:{port}/#/", wait_until="networkidle")
      expect(page.get_by_text("Build accessible checkout recovery flow").first).to_be_visible(timeout=15000)
      page.screenshot(path=args.output / "populated-queue-mobile.png", full_page=True)
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

print(args.output)
