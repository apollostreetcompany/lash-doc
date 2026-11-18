#!/usr/bin/env python3
"""Local, one-shot disk admission before a covered build/test writer starts."""

from __future__ import annotations

import argparse
import json
import os
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

RESERVE_BYTES = 50_000_000_000
LARGE_RUN_BYTES = 5_000_000_000


class AdmissionError(Exception):
    """Unsafe path, invalid large-run declaration, or record write failure."""


def existing_output_ancestor(raw_path: str) -> tuple[Path, Path]:
    """Return an absolute proposed directory and its nearest existing directory.

    Existing symlink components are refused rather than following an ambiguous
    device path. A cold, not-yet-created output directory is supported.
    """
    proposed = Path(os.path.abspath(os.path.expanduser(raw_path)))
    parts = proposed.parts
    current = Path(parts[0])
    ancestor = current
    for part in parts[1:]:
        current = current / part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            continue
        except OSError as exc:
            raise AdmissionError(f"cannot inspect output-path component {current}: {exc.strerror}") from exc
        if stat.S_ISLNK(mode):
            raise AdmissionError(f"symlink output-path component: {current}")
        if not stat.S_ISDIR(mode):
            raise AdmissionError(f"non-directory output-path component: {current}")
        ancestor = current
    return proposed, ancestor


def _validate_growth(growth: int | None, reason: str | None, record_path: str | None) -> tuple[int, bool]:
    if growth is not None and growth < 0:
        raise AdmissionError("anticipated growth must be a nonnegative byte count")
    estimated = growth if growth is not None else 0
    declared = reason is not None or record_path is not None
    large = estimated > LARGE_RUN_BYTES or declared
    if large:
        if growth is None or growth <= 0:
            raise AdmissionError("large run requires a positive anticipated-growth-bytes estimate")
        if not reason or not reason.strip() or len(reason.strip()) > 512 or "\x00" in reason:
            raise AdmissionError("large run requires a concise nonempty large-run-reason")
        if not record_path:
            raise AdmissionError("large run requires a unique durable large-run-record path")
    return estimated, large


def _write_record(raw_path: str, result: dict[str, object], reason: str) -> None:
    record, parent = existing_output_ancestor(raw_path)
    if record == parent or not record.parent.is_dir() or record.parent != parent:
        raise AdmissionError("large-run-record parent must already exist as a directory")
    if record.exists() or record.is_symlink():
        raise AdmissionError("large-run-record already exists; use a unique path")
    payload = dict(result)
    payload["reason"] = reason.strip()
    payload["recorded_at_utc"] = datetime.now(timezone.utc).isoformat()
    payload["verdict"] = "ADMITTED"
    data = (json.dumps(payload, sort_keys=True, indent=2) + "\n").encode("utf-8")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(record, flags, 0o600)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
        except BaseException:
            try:
                record.unlink()
            except OSError:
                pass
            raise
    except OSError as exc:
        raise AdmissionError(f"cannot write large-run-record: {exc.strerror}") from exc


def check(
    output_root: str,
    anticipated_growth_bytes: int | None = None,
    large_run_reason: str | None = None,
    large_run_record: str | None = None,
    *,
    statvfs: Callable[[str], os.statvfs_result] = os.statvfs,
) -> dict[str, object]:
    """Return a snapshot verdict; no runtime reservation or OS quota is made."""
    proposed, ancestor = existing_output_ancestor(output_root)
    growth, large = _validate_growth(anticipated_growth_bytes, large_run_reason, large_run_record)
    try:
        fs = statvfs(str(ancestor))
    except OSError as exc:
        raise AdmissionError(f"cannot measure output filesystem: {exc.strerror}") from exc
    free = fs.f_bavail * fs.f_frsize
    need = RESERVE_BYTES + growth
    result: dict[str, object] = {
        "verdict": "ADMITTED" if free >= need else "DENIED",
        "output_root": str(proposed),
        "statvfs_ancestor": str(ancestor),
        "available_bytes": free,
        "reserve_bytes": RESERVE_BYTES,
        "anticipated_growth_bytes": growth,
        "required_available_bytes": need,
        "large_run": large,
        "large_run_threshold_bytes": LARGE_RUN_BYTES,
        "record_path": None,
        "scope": "local preflight snapshot; no runtime reservation",
    }
    if free < need:
        result["reason"] = "available output-filesystem bytes below reserve plus anticipated growth"
        return result
    if large:
        assert large_run_reason is not None and large_run_record is not None
        result["record_path"] = str(Path(os.path.abspath(os.path.expanduser(large_run_record))))
        _write_record(large_run_record, result, large_run_reason)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    admission = commands.add_parser("check", help="local output-filesystem admission snapshot")
    admission.add_argument("--output-root", required=True, help="intended writable output directory, may be cold")
    admission.add_argument("--anticipated-growth-bytes", type=int, help="expected additional bytes; defaults to zero")
    admission.add_argument("--large-run-reason", help="reason for an explicit or >5 GB growth run")
    admission.add_argument("--large-run-record", help="unique existing-parent file for durable large-run declaration")
    args = parser.parse_args(argv)
    try:
        result = check(args.output_root, args.anticipated_growth_bytes, args.large_run_reason, args.large_run_record)
    except AdmissionError as exc:
        result = {"verdict": "DENIED", "reason": str(exc), "scope": "local preflight snapshot"}
    print(json.dumps(result, sort_keys=True))
    return 0 if result["verdict"] == "ADMITTED" else 2


if __name__ == "__main__":
    sys.exit(main())
