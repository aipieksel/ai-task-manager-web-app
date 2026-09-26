#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "src" / "taskmanager" / "assets" / "icons" / "icon-512.png"
OUT = ROOT / "build" / "icons"
ICONSET = OUT / "AgenticAIProjectsTaskManager.iconset"
ICNS = OUT / "AgenticAIProjectsTaskManager.icns"

SIZES = [
    (16, "icon_16x16.png"),
    (32, "icon_16x16@2x.png"),
    (32, "icon_32x32.png"),
    (64, "icon_32x32@2x.png"),
    (128, "icon_128x128.png"),
    (256, "icon_128x128@2x.png"),
    (256, "icon_256x256.png"),
    (512, "icon_256x256@2x.png"),
    (512, "icon_512x512.png"),
    (1024, "icon_512x512@2x.png"),
]


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def main() -> None:
    if not SOURCE.is_file():
        raise FileNotFoundError(f"Missing icon source: {SOURCE}")
    OUT.mkdir(parents=True, exist_ok=True)
    if ICONSET.exists():
        shutil.rmtree(ICONSET)
    ICONSET.mkdir(parents=True)
    for size, name in SIZES:
        run(["sips", "-z", str(size), str(size), str(SOURCE), "--out", str(ICONSET / name)])
    run(["iconutil", "-c", "icns", str(ICONSET), "-o", str(ICNS)])
    shutil.rmtree(ICONSET)
    print(ICNS)


if __name__ == "__main__":
    main()
