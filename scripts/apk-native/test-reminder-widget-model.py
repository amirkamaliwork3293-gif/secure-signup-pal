#!/usr/bin/env python3
"""Compile and run the pure-Java tests of the home-screen reminder widget (needs a JDK, no Android SDK)."""
from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent


def main() -> None:
    if not shutil.which("javac") or not shutil.which("java"):
        print("skip: javac/java not installed")
        return
    with tempfile.TemporaryDirectory() as out:
        subprocess.run(
            [
                "javac", "-encoding", "UTF-8", "-d", out,
                str(ROOT / "ReminderWidgetModel.java"),
                str(ROOT / "test" / "ReminderWidgetModelTest.java"),
            ],
            check=True,
        )
        result = subprocess.run(["java", "-cp", out, "ReminderWidgetModelTest"])
        if result.returncode != 0:
            sys.exit(result.returncode)


if __name__ == "__main__":
    main()
