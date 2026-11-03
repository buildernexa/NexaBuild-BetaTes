#!/usr/bin/env python3
"""Write a JSON Capacitor config without introducing a TypeScript requirement."""
from __future__ import annotations
import argparse
import json
import re
import sys
from pathlib import Path

APP_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$")


def fail(message: str) -> None:
    print(f"NEXABUILDER_CAPACITOR_CONFIG_ERROR: {message}", file=sys.stderr)
    raise SystemExit(2)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-id", required=True)
    parser.add_argument("--app-name", required=True)
    parser.add_argument("--web-dir", default="www")
    parser.add_argument("--output", default="capacitor.config.json")
    args = parser.parse_args()

    app_id = args.app_id.strip()
    app_name = args.app_name.strip()
    web_dir = Path(args.web_dir)
    output = Path(args.output)

    if not APP_ID_RE.fullmatch(app_id) or len(app_id) > 150:
        fail("Application ID tidak valid untuk konfigurasi Capacitor.")
    if not app_name or len(app_name) > 48 or any(ord(ch) < 32 or ch in "<>" for ch in app_name):
        fail("Nama aplikasi harus 1–48 karakter dan tidak boleh berisi karakter kontrol.")
    if web_dir.is_absolute() or ".." in web_dir.parts or not web_dir.is_dir() or not (web_dir / "index.html").is_file():
        fail("webDir harus berupa folder relatif yang berisi index.html hasil persiapan.")
    if output.name != "capacitor.config.json" or output.parent != Path("."):
        fail("Output konfigurasi harus bernama capacitor.config.json di root project.")

    config = {"appId": app_id, "appName": app_name, "webDir": web_dir.as_posix()}
    try:
        output.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        parsed = json.loads(output.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        fail(f"Konfigurasi JSON tidak dapat ditulis/diverifikasi: {error}")
    if parsed != config:
        fail("Konfigurasi JSON hasil tulis tidak identik dengan metadata build.")
    print(f"NEXABUILDER_CAPACITOR_CONFIG_READY: {output}; appId={app_id}; webDir={web_dir.as_posix()}")


if __name__ == "__main__":
    main()
