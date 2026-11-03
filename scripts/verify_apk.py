#!/usr/bin/env python3
"""Verify APK artifact signature, package metadata, selected permissions and resources."""
from __future__ import annotations
import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path


def fail(message: str) -> None:
    print(f"NEXABUILDER_APK_VERIFY_ERROR: {message}", file=sys.stderr)
    raise SystemExit(2)


def run(args: list[str]) -> str:
    try:
        completed = subprocess.run(args, check=False, capture_output=True, text=True, timeout=90)
    except (OSError, subprocess.TimeoutExpired) as error:
        fail(f"Tidak dapat menjalankan {' '.join(args[:2])}: {error}")
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "perintah tidak memberikan detail").strip()[-1800:]
        fail(f"Perintah {' '.join(args[:2])} gagal (exit {completed.returncode}): {detail}")
    return completed.stdout + completed.stderr


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", required=True, type=Path)
    parser.add_argument("--package-id", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--version-code", required=True, type=int)
    parser.add_argument("--internet-mode", choices=("online", "offline"), required=True)
    parser.add_argument("--camera", action="store_true")
    parser.add_argument("--wake-lock", action="store_true")
    parser.add_argument("--vibrate", action="store_true")
    parser.add_argument("--build-tools", type=Path, required=True)
    args = parser.parse_args()
    apk = args.apk.resolve()
    if not apk.is_file() or apk.stat().st_size < 1024:
        fail("File APK tidak ditemukan atau ukurannya terlalu kecil untuk APK valid.")

    apksigner = args.build_tools / "apksigner"
    aapt = args.build_tools / "aapt"
    if not apksigner.is_file() or not aapt.is_file():
        fail("Android Build Tools harus menyediakan apksigner dan aapt.")
    signature_output = run([str(apksigner), "verify", "--verbose", str(apk)])
    if re.search(r"DOES NOT VERIFY|ERROR|FAILED", signature_output, re.I):
        fail("apksigner tidak menyatakan APK valid.")

    badging = run([str(aapt), "dump", "badging", str(apk)])
    package_match = re.search(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']*)'", badging, re.M)
    if not package_match:
        fail("Metadata package/version tidak dapat dibaca dari APK.")
    actual_package, actual_code, actual_version = package_match.groups()
    if actual_package != args.package_id or actual_version != args.version or int(actual_code) != args.version_code:
        fail(f"Metadata APK tidak cocok: package={actual_package}, version={actual_version}, code={actual_code}.")
    if not re.search(r"^application-label:'[^']+'", badging, re.M):
        fail("Nama aplikasi/label launcher tidak ditemukan pada metadata APK.")
    if not re.search(r"^application-icon-\d+:", badging, re.M) and not re.search(r"^application:.*icon='[^']+'", badging, re.M):
        fail("Referensi launcher icon tidak ditemukan dalam metadata APK.")

    permissions_output = run([str(aapt), "dump", "permissions", str(apk)])
    permissions = set(re.findall(r"uses-permission: name='([^']+)'", permissions_output))
    expected = set()
    if args.internet_mode == "online":
        expected.update({"android.permission.INTERNET", "android.permission.ACCESS_NETWORK_STATE"})
    if args.camera:
        expected.add("android.permission.CAMERA")
    if args.wake_lock:
        expected.add("android.permission.WAKE_LOCK")
    if args.vibrate:
        expected.add("android.permission.VIBRATE")
    missing = sorted(expected - permissions)
    if missing:
        fail("Permission yang diminta tidak ditemukan dalam APK: " + ", ".join(missing))
    if args.internet_mode == "offline" and ({"android.permission.INTERNET", "android.permission.ACCESS_NETWORK_STATE"} & permissions):
        fail("APK offline masih meminta permission jaringan.")

    entries = set(run([str(aapt), "list", str(apk)]).splitlines())
    required_entries = {"AndroidManifest.xml", "classes.dex", "resources.arsc"}
    missing_entries = sorted(required_entries - entries)
    if missing_entries:
        fail("Struktur APK tidak lengkap: " + ", ".join(missing_entries))
    if not any(re.match(r"res/mipmap[^/]*/ic_launcher(?:_round)?(?:\.png|\.xml)$", entry) for entry in entries):
        fail("Resource launcher icon tidak ditemukan dalam isi APK.")

    print("NEXABUILDER_APK_VERIFIED:")
    print(f"  file={apk.name}; bytes={apk.stat().st_size}")
    print(f"  package={actual_package}; version={actual_version}; versionCode={actual_code}")
    print(f"  signature=verified; launcher_icon=present; permissions={len(permissions)}")


if __name__ == "__main__":
    main()
