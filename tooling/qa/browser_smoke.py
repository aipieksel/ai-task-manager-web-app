#!/usr/bin/env python3
from __future__ import annotations

import contextlib
import os
import re
import socket
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / os.environ.get("TARGET_DIR", "src/taskmanager")


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


routes = {
    "/": "Instruction queue",
    "/task": "Plan workspace",
    "/questions": "Decision desk",
    "/verification": "Verification run",
    "/activity": "Change feed",
    "/agents": "Agent Control Center",
    "/lessons": "Lessons library",
    "/observations": "Observation triage",
    "/projects": "Project registry",
    "/settings": "General settings",
}

with server() as base, sync_playwright() as playwright:
    executable = os.environ.get("CHROMIUM_EXECUTABLE")
    browser = playwright.chromium.launch(headless=True, executable_path=executable)
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    browser_errors: list[str] = []
    requested_urls: set[str] = set()
    page.on("pageerror", lambda error: browser_errors.append(str(error)))
    page.on("console", lambda message: browser_errors.append(message.text) if message.type == "error" else None)
    page.on("request", lambda request: requested_urls.add(request.url))

    for route, heading in routes.items():
        page.goto(f"{base}#{route}", wait_until="networkidle")
        assert page.locator("h1").first.text_content() == heading
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

    page.goto(f"{base}#/tasks", wait_until="networkidle")
    assert page.locator("h1").first.text_content() == "Instruction queue"
    assert page.get_by_role("link", name=re.compile("Task ledger")).count() == 0

    for removed_route in ("prompt" + "-manager", "voice" + "-manager"):
        page.goto(f"{base}#/{removed_route}", wait_until="networkidle")
        assert page.locator("h1").first.text_content() == "Instruction queue"

    assert page.locator("[data-manager" + "-toggle]").count() == 0

    page.goto(f"{base}#/", wait_until="networkidle")
    page.locator("[data-scope-toggle]").click()
    assert page.locator("[data-scope-menu]").is_visible()

    page.goto(f"{base}#/settings", wait_until="networkidle")
    form = page.locator('[data-form="add-doc-alias"]')
    form.locator("input").fill("project-docs")
    form.locator("button").click()
    page.get_by_text("project-docs", exact=True).wait_for()
    assert page.get_by_text("project-docs", exact=True).count() >= 1

    page.goto(f"{base}#/activity?tab=agent", wait_until="networkidle")
    assert page.locator(".tab.active").inner_text() == "Agent writes"
    page.goto(f"{base}#/lessons?tab=index", wait_until="networkidle")
    assert page.locator(".tab.active").inner_text() == "Index"
    page.goto(f"{base}#/observations?tab=anomaly", wait_until="networkidle")
    assert page.locator(".tab.active").inner_text() == "Anomalies"

    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(f"{base}#/", wait_until="networkidle")
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
    page.locator("[data-open-drawer]").click()
    assert page.locator("body").evaluate("node => node.classList.contains('drawer-open')")
    page.keyboard.press("Escape")
    assert not page.locator("body").evaluate("node => node.classList.contains('drawer-open')")

    body = page.locator("body").inner_text()
    for forbidden in ["Example Dashboard", "SEO Panel", "Example Private Website", "Agent Workbench"]:
        assert forbidden not in body

    page.set_viewport_size({"width": 1440, "height": 1000})
    page.goto(f"{base}#/", wait_until="networkidle")
    page.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller")
    context.set_offline(True)
    page.reload(wait_until="domcontentloaded")
    assert page.locator("h1").first.text_content() == "Instruction queue"
    context.set_offline(False)

    assert not browser_errors, browser_errors
    base_origin = urlparse(base)
    unexpected_requests = sorted(
        url for url in requested_urls
        if (parsed := urlparse(url)).scheme not in {"data", "blob"}
        and (parsed.scheme, parsed.hostname, parsed.port) != (base_origin.scheme, base_origin.hostname, base_origin.port)
    )
    assert not unexpected_requests, unexpected_requests
    browser.close()

print(f"browser_smoke.py: pass ({APP.name})")
