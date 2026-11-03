#!/usr/bin/env python3
"""Reassemble GitHub upload chunks only after validating the manifest and SHA-256."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import stat
import sys
from pathlib import Path

MAX_PROJECT_BYTES = 40 * 1024 * 1024
CHUNK_BYTES = 2 * 1024 * 1024
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
SHA256_RE = re.compile(r"^[0-9a-f]{64}$", re.I)


def fail(message: str) -> None:
    print(f"NEXABUILDER_UPLOAD_ERROR: {message}", file=sys.stderr)
    raise SystemExit(2)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--upload-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--upload-id", required=True)
    parser.add_argument("--expected-size", required=True, type=int)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--expected-chunks", required=True, type=int)
    args = parser.parse_args()
    # Never leave an older archive at the target path if the current upload fails validation.
    args.output.unlink(missing_ok=True)

    if not UUID_RE.fullmatch(args.upload_id):
        fail("ID upload tidak valid.")
    if not 1 <= args.expected_size <= MAX_PROJECT_BYTES:
        fail("Ukuran arsip dari workflow berada di luar batas 1 byte–40 MiB.")
    if not SHA256_RE.fullmatch(args.expected_sha256):
        fail("SHA-256 dari workflow tidak valid.")
    wanted_chunks = (args.expected_size + CHUNK_BYTES - 1) // CHUNK_BYTES
    if args.expected_chunks != wanted_chunks or not 1 <= args.expected_chunks <= 20:
        fail("Jumlah chunk tidak cocok dengan ukuran arsip yang dilaporkan browser.")

    root = args.upload_dir.resolve()
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file() or manifest_path.is_symlink():
        fail("Manifest upload tidak ditemukan atau bukan file biasa.")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        fail(f"Manifest upload rusak/tidak dapat dibaca: {error}")

    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != 1:
        fail("Versi skema manifest upload tidak didukung.")
    if manifest.get("uploadId") != args.upload_id:
        fail("ID upload pada manifest tidak cocok dengan workflow.")
    if manifest.get("byteSize") != args.expected_size or str(manifest.get("sha256", "")).lower() != args.expected_sha256.lower():
        fail("Ukuran arsip atau checksum SHA-256 manifest tidak cocok dengan parameter workflow.")
    if manifest.get("chunkSize") != CHUNK_BYTES or manifest.get("chunkCount") != args.expected_chunks:
        fail("Konfigurasi chunk pada manifest tidak sesuai.")

    parts = manifest.get("parts")
    if not isinstance(parts, list) or len(parts) != args.expected_chunks:
        fail("Daftar chunk pada manifest hilang atau jumlahnya salah.")
    parts_dir = root / "parts"
    if not parts_dir.is_dir() or parts_dir.is_symlink():
        fail("Folder parts upload tidak ditemukan atau tidak aman.")
    expected_names = {f"part-{i:03d}.bin" for i in range(args.expected_chunks)}
    actual_names = {p.name for p in parts_dir.iterdir()}
    if actual_names != expected_names:
        fail("Ada chunk yang hilang, duplikat, bernama salah, atau file tambahan pada folder upload.")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    total = 0
    try:
        with args.output.open("wb") as output:
            for index, item in enumerate(parts):
                name = f"part-{index:03d}.bin"
                expected_part_size = min(CHUNK_BYTES, args.expected_size - index * CHUNK_BYTES)
                if not isinstance(item, dict) or item.get("index") != index or item.get("name") != name or item.get("size") != expected_part_size:
                    fail(f"Metadata chunk ke-{index + 1} tidak cocok dengan urutan/ukuran yang diharapkan.")
                part_path = parts_dir / name
                st = part_path.lstat()
                if not stat.S_ISREG(st.st_mode) or st.st_size != expected_part_size:
                    fail(f"Chunk {name} bukan file biasa atau ukurannya berubah.")
                with part_path.open("rb") as source:
                    while True:
                        block = source.read(1024 * 1024)
                        if not block:
                            break
                        total += len(block)
                        digest.update(block)
                        output.write(block)
    except OSError as error:
        args.output.unlink(missing_ok=True)
        fail(f"Gagal membaca/menulis chunk: {error}")

    actual_sha = digest.hexdigest()
    if total != args.expected_size:
        args.output.unlink(missing_ok=True)
        fail(f"Ukuran gabungan {total} byte tidak sama dengan ukuran upload {args.expected_size} byte.")
    if actual_sha.lower() != args.expected_sha256.lower():
        args.output.unlink(missing_ok=True)
        fail("SHA-256 arsip hasil gabungan tidak cocok. ZIP ditolak agar build tidak memakai data rusak.")
    print(f"NEXABUILDER_UPLOAD_VERIFIED: chunks={args.expected_chunks}; bytes={total}; sha256={actual_sha}")


if __name__ == "__main__":
    main()
