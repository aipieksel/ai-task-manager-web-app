#!/usr/bin/env python3
from __future__ import annotations

import contextlib
import os
import socket
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "app"
OUTPUT = ROOT / "documentation" / "qa" / "previews"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


@contextlib.contextmanager
def server():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    handler = lambda *args, **kwargs: QuietHandler(*args, directory=str(APP), **kwargs)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}/index.html"
    finally:
        httpd.shutdown()
        thread.join(timeout=5)


OUTPUT.mkdir(parents=True, exist_ok=True)
for stale in OUTPUT.glob("*.png"):
    stale.unlink()

with server() as base, sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        executable_path=os.environ.get("CHROMIUM_EXECUTABLE", "/usr/bin/chromium"),
    )
    page = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
    captures = [
        ("#/", "overview-empty-desktop.png"),
        ("#/", "queue-empty-desktop.png"),
        ("#/questions", "questions-empty-desktop.png"),
        ("#/task", "plan-empty-desktop.png"),
        ("#/projects", "projects-empty-desktop.png"),
        ("#/settings", "settings-desktop.png"),
    ]
    for fragment, filename in captures:
        page.goto(f"{base}{fragment}", wait_until="networkidle")
        page.screenshot(path=str(OUTPUT / filename), full_page=True)

    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(f"{base}#/", wait_until="networkidle")
    page.screenshot(path=str(OUTPUT / "queue-empty-mobile.png"), full_page=True)
    browser.close()

print(f"capture_previews.py: wrote {len(list(OUTPUT.glob('*.png')))} previews")
