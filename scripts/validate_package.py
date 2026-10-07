#!/usr/bin/env python3
"""Release gate for the Atlee static deployment package."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from pathlib import PurePosixPath
from typing import Iterable

from asset_report import (
    DEFAULT_APPROVED_PUBLIC_GLBS,
    DEFAULT_DUPLICATE_BLOCKER_BYTES,
    DEFAULT_MAX_BYTES,
    render_human_report,
    scan_deployable_tree,
)


TEXT_SUFFIXES = frozenset({".css", ".html", ".js", ".json", ".md", ".mjs", ".svg", ".txt"})
DIRECT_COORDINATE_PAIR = re.compile(
    r"(?<![\d.])([-+]?\d{1,3}\.(\d{4,}))\s*[,/]\s*([-+]?\d{1,3}\.(\d{4,}))(?![\d.])"
)
LABELED_COORDINATE = re.compile(
    r"\b(latitude|longitude|lat|lon|lng)\b[\"']?\s*(?::|=)?\s*([-+]?\d{1,3}\.(\d{4,}))",
    re.IGNORECASE,
)
DEMO_LOCATION_FIELD = re.compile(
    r'("(latitude|longitude)"\s*:\s*)[-+]?\d{1,3}\.\d{4,}',
    re.IGNORECASE,
)


def _safe_deployable_path(value: str) -> str:
    if not isinstance(value, str) or not value.strip() or "\\" in value:
        raise ValueError("precise-coordinate text allowlist entries must be non-empty deployment-relative paths")
    text = value.strip()
    path = PurePosixPath(text)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError(f"unsafe precise-coordinate text allowlist path: {value}")
    return path.as_posix()


def _coordinate_pair_lines(text: str) -> list[int]:
    """Return lines containing likely precise lat/lon pairs without retaining values."""
    lines: set[int] = set()
    for match in DIRECT_COORDINATE_PAIR.finditer(text):
        first = float(match.group(1))
        second = float(match.group(3))
        latitude_longitude = abs(first) <= 90 and abs(second) <= 180
        longitude_latitude = abs(first) <= 180 and abs(second) <= 90
        if not (latitude_longitude or longitude_latitude):
            continue
        # Avoid common normalized vectors, CSS values, and zero-origin fixtures.
        if abs(first) <= 1 and abs(second) <= 1:
            continue
        lines.add(text.count("\n", 0, match.start()) + 1)

    labeled: dict[str, list[tuple[int, int]]] = {"latitude": [], "longitude": []}
    for match in LABELED_COORDINATE.finditer(text):
        label = match.group(1).lower()
        kind = "latitude" if label in {"latitude", "lat"} else "longitude"
        value = float(match.group(2))
        if (kind == "latitude" and abs(value) > 90) or (kind == "longitude" and abs(value) > 180):
            continue
        labeled[kind].append((match.start(), text.count("\n", 0, match.start()) + 1))
    # Labels may be split across a compact CLI or JSON example. Require proximity
    # so unrelated constants elsewhere in a large source file are not paired.
    for latitude_offset, latitude_line in labeled["latitude"]:
        for longitude_offset, longitude_line in labeled["longitude"]:
            if abs(latitude_offset - longitude_offset) <= 512:
                lines.update({latitude_line, longitude_line})
    return sorted(lines)


def _append_precise_coordinate_findings(
    report: dict,
    root: str | Path,
    *,
    allowed_paths: Iterable[str] = (),
) -> dict:
    deploy_root = Path(root).resolve()
    deployable = {entry["path"] for entry in report.get("files", [])}
    explicit = {_safe_deployable_path(value) for value in allowed_paths}
    findings = list(report.get("findings", []))
    detected: dict[str, list[int]] = {}
    approved_demo_location_lines: list[int] = []

    for relative in sorted(deployable):
        path = deploy_root / relative
        if path.suffix.lower() not in TEXT_SUFFIXES or path.stat().st_size > 2 * 1024 * 1024:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        if relative == "properties/demo/property.json":
            demo_fields: dict[str, list[int]] = {"latitude": [], "longitude": []}
            for match in DEMO_LOCATION_FIELD.finditer(text):
                demo_fields[match.group(2).lower()].append(text.count("\n", 0, match.start()) + 1)
            if demo_fields["latitude"] and demo_fields["longitude"]:
                approved_demo_location_lines = sorted(set(demo_fields["latitude"] + demo_fields["longitude"]))
                # The approved demo exception covers only its canonical JSON
                # location fields, not arbitrary pairs elsewhere in the file.
                text = DEMO_LOCATION_FIELD.sub(r"\g<1>0.0", text)
        lines = _coordinate_pair_lines(text)
        if lines:
            detected[relative] = lines

    for relative in sorted(explicit):
        if relative not in deployable:
            findings.append({
                "severity": "blocker",
                "code": "invalid_precise_coordinate_text_allowlist",
                "message": "Explicit precise-coordinate text allowlist entry is not a deployable file.",
                "path": relative,
            })
        elif Path(relative).suffix.lower() not in TEXT_SUFFIXES:
            findings.append({
                "severity": "blocker",
                "code": "invalid_precise_coordinate_text_allowlist",
                "message": "Explicit precise-coordinate text allowlist entry is not a supported text file.",
                "path": relative,
            })
        elif relative not in detected:
            findings.append({
                "severity": "blocker",
                "code": "unused_precise_coordinate_text_allowlist",
                "message": "Explicit precise-coordinate text allowlist entry contains no detected precise coordinate pair.",
                "path": relative,
            })

    for relative, lines in sorted(detected.items()):
        if relative in explicit:
            findings.append({
                "severity": "info",
                "code": "approved_precise_coordinate_text",
                "message": "Precise coordinate text matches an explicitly approved deployment path.",
                "path": relative,
                "details": {"lineCount": len(lines), "lineNumbers": lines},
            })
        else:
            findings.append({
                "severity": "blocker",
                "code": "precise_coordinate_text",
                "message": "Deployable text appears to contain a latitude/longitude pair with excessive precision.",
                "path": relative,
                "details": {"lineCount": len(lines), "lineNumbers": lines},
            })
    if approved_demo_location_lines:
        findings.append({
            "severity": "info",
            "code": "approved_precise_coordinate_text",
            "message": "Precise coordinate text is limited to the separately approved demo location fields.",
            "path": "properties/demo/property.json",
            "details": {
                "lineCount": len(approved_demo_location_lines),
                "lineNumbers": approved_demo_location_lines,
            },
        })

    order = {"blocker": 0, "warning": 1, "info": 2}
    findings.sort(key=lambda item: (order.get(item.get("severity"), 9), item.get("path", ""), item.get("code", "")))
    blockers = sum(item.get("severity") == "blocker" for item in findings)
    warnings = sum(item.get("severity") == "warning" for item in findings)
    report["findings"] = findings
    report["summary"]["blockers"] = blockers
    report["summary"]["warnings"] = warnings
    report["ok"] = blockers == 0
    return report


def scan_release_package(
    root: str | Path,
    *,
    allowed_precise_coordinate_text: Iterable[str] = (),
    **scan_options,
) -> dict:
    """Run the asset scanner plus deployable-text privacy checks."""
    report = scan_deployable_tree(root, **scan_options)
    return _append_precise_coordinate_findings(
        report,
        root,
        allowed_paths=allowed_precise_coordinate_text,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate a static property-solar deployment and fail on release blockers.")
    parser.add_argument("root", nargs="?", default=".", help="static deployment root (default: current directory)")
    parser.add_argument("--format", choices=("human", "json"), default="human", help="report output format")
    parser.add_argument("--json", action="store_true", help="shorthand for --format json")
    parser.add_argument("--output", type=Path, help="write the report to this file instead of stdout")
    parser.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES, help="maximum bytes permitted for one deployable file")
    parser.add_argument(
        "--duplicate-blocker-bytes",
        type=int,
        default=DEFAULT_DUPLICATE_BLOCKER_BYTES,
        help="duplicate wasted bytes at which a duplicate group blocks release",
    )
    parser.add_argument(
        "--allow-public-glb",
        action="append",
        default=[],
        help="add a deploy-root-relative GLB path to the explicit public release scope",
    )
    parser.add_argument(
        "--allow-precise-coordinate-text",
        action="append",
        default=[],
        help="explicitly approve one deployment-relative text file containing a detected precise coordinate pair",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    approved = set(DEFAULT_APPROVED_PUBLIC_GLBS)
    approved.update(args.allow_public_glb)
    try:
        report = scan_release_package(
            args.root,
            max_bytes=args.max_bytes,
            duplicate_blocker_bytes=args.duplicate_blocker_bytes,
            approved_public_glbs=approved,
            allowed_precise_coordinate_text=args.allow_precise_coordinate_text,
        )
    except ValueError as exc:
        parser.error(str(exc))
    output_format = "json" if args.json else args.format
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n" if output_format == "json" else render_human_report(report)
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
