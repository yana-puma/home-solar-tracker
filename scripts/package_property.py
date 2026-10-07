#!/usr/bin/env python3
"""Create a privacy-safe property package from an existing GLB model."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import struct
from pathlib import Path, PurePosixPath
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


ROOT = Path(__file__).resolve().parent.parent


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not slug or len(slug) > 63:
        raise ValueError("slug must contain 1-63 lowercase letters, numbers, or hyphens")
    return slug


VALID_UNITS = {"meters", "feet", "centimeters", "millimeters"}
PRIVACY_MODES = {"local", "public-rounded", "public-exact"}
DEFAULT_ASSET_ALLOWLIST = {"model.glb", "property.json", "package-manifest.json"}
RAW_SOURCE_EXTENSIONS = {
    ".las", ".laz", ".geojson", ".jsonl", ".shp", ".shx", ".dbf", ".prj",
    ".gpkg", ".gdb", ".kml", ".kmz", ".dxf", ".dwg", ".e57", ".ply",
}
ADDRESS_PATTERN = re.compile(
    r"\b(?:p\.?\s*o\.?\s*box\s+\d+|\d{1,6}[a-z]?\s+"
    r"(?:[a-z0-9.'-]+\s+){0,5}"
    r"(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|court|ct|boulevard|blvd|"
    r"place|pl|terrace|ter|trail|trl|circle|cir|parkway|pkwy|highway|hwy|way))\b",
    re.IGNORECASE,
)
IDENTIFYING_NAME_PATTERN = re.compile(
    r"(?:^|[\s._-])(?:address|parcel|apn|owner|deed|survey|tax[-_ ]?map|"
    r"lot[-_ ]?\d+|\d{2,6}[-_ ][a-z]{2,})(?:$|[\s._-])",
    re.IGNORECASE,
)
SENSITIVE_METADATA_KEY = re.compile(
    r"address|street|parcel|apn|owner|latitude|longitude|gps|geolocation|easting|northing",
    re.IGNORECASE,
)


def _nonempty(value: str, name: str, maximum: int = 120) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    value = value.strip()
    if len(value) > maximum:
        raise ValueError(f"{name} must be at most {maximum} characters")
    return value


def _coordinate(value: float, name: str, minimum: float, maximum: float) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a number") from exc
    if not math.isfinite(result) or not minimum <= result <= maximum:
        raise ValueError(f"{name} must be between {minimum:g} and {maximum:g}")
    return result


def _validate_time_zone(time_zone: str) -> str:
    time_zone = _nonempty(time_zone, "time_zone")
    try:
        ZoneInfo(time_zone)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"time_zone must be a valid IANA time zone: {time_zone}") from exc
    return time_zone


def normalize_asset_path(value: str) -> str:
    """Return a safe portable package path or raise ``ValueError``."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError("asset paths must be non-empty strings")
    normalized = value.strip().replace("\\", "/")
    if "://" in normalized or normalized.startswith(("/", ".")):
        raise ValueError(f"unsafe asset path: {value}")
    path = PurePosixPath(normalized)
    if any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError(f"unsafe asset path: {value}")
    if any(not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", part) for part in path.parts):
        raise ValueError(f"unsafe asset path: {value}")
    return path.as_posix()


def looks_like_address(value: object) -> bool:
    return isinstance(value, str) and bool(ADDRESS_PATTERN.search(value))


def looks_identifying(value: object) -> bool:
    if not isinstance(value, str):
        return False
    readable = re.sub(r"[\\/_-]+", " ", value)
    return looks_like_address(readable) or bool(IDENTIFYING_NAME_PATTERN.search(value))


def _issue(severity: str, code: str, message: str) -> dict:
    return {"severity": severity, "code": code, "message": message}


def _public_severity(privacy_mode: str) -> str:
    return "warning" if privacy_mode == "local" else "error"


def _scan_glb_metadata(value: object, path: str, privacy_mode: str, issues: list[dict]) -> None:
    if isinstance(value, str):
        if looks_like_address(value):
            issues.append(_issue(_public_severity(privacy_mode), "glb_address_metadata", f"GLB metadata at {path} appears to contain a street address"))
        elif looks_identifying(value):
            issues.append(_issue(_public_severity(privacy_mode), "glb_identifying_metadata", f"GLB metadata at {path} may contain an identifying name"))
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _scan_glb_metadata(item, f"{path}[{index}]", privacy_mode, issues)
        return
    if not isinstance(value, dict):
        return
    for key, child in value.items():
        child_path = f"{path}.{key}" if path else str(key)
        if SENSITIVE_METADATA_KEY.search(str(key)):
            issues.append(_issue(_public_severity(privacy_mode), "glb_sensitive_metadata_key", f"GLB metadata contains the sensitive field {key!r}"))
        _scan_glb_metadata(child, child_path, privacy_mode, issues)


def inspect_glb_metadata(model_path: Path, privacy_mode: str) -> list[dict]:
    """Inspect GLB 2.0 JSON metadata without decoding geometry or textures."""
    data = model_path.read_bytes()
    severity = _public_severity(privacy_mode)
    if len(data) < 20:
        return [_issue(severity, "glb_unreadable", "GLB header is missing or too short to inspect")]
    magic, version, declared_length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67 or version != 2 or declared_length < 20 or declared_length > len(data):
        return [_issue(severity, "glb_unreadable", "model is not a readable GLB 2.0 file")]

    offset = 12
    document = None
    issues: list[dict] = []
    while offset + 8 <= declared_length:
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        chunk_start = offset + 8
        chunk_end = chunk_start + chunk_length
        if chunk_end > declared_length:
            issues.append(_issue(severity, "glb_unreadable", "a GLB chunk extends past the declared file length"))
            break
        if chunk_type == 0x4E4F534A and document is None:
            try:
                document = json.loads(data[chunk_start:chunk_end].decode("utf-8").rstrip("\x00 \t\r\n"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                issues.append(_issue(severity, "glb_unreadable", "GLB JSON metadata could not be parsed"))
        offset = chunk_end

    if document is None:
        issues.append(_issue(severity, "glb_unreadable", "GLB has no readable JSON metadata chunk"))
        return issues
    _scan_glb_metadata(document, "glb", privacy_mode, issues)
    images = document.get("images") if isinstance(document, dict) else None
    if isinstance(images, list) and images:
        issues.append(_issue("warning", "glb_images_present", f"GLB contains {len(images)} embedded or referenced image asset(s); review textures for photographs, labels, and metadata cues"))
    return issues


def preflight_property_package(
    *,
    config: dict,
    model_path: Path,
    privacy_mode: str,
    coordinate_decimals: int,
    acknowledge_exact_location: bool,
    acknowledge_license: bool,
    asset_allowlist: set[str],
) -> dict:
    """Return privacy errors and warnings for the exact package to be written."""
    issues: list[dict] = []
    if privacy_mode not in PRIVACY_MODES:
        issues.append(_issue("error", "privacy_mode_invalid", f"privacy_mode must be one of: {', '.join(sorted(PRIVACY_MODES))}"))
        privacy_mode = "local"
    is_public = privacy_mode != "local"
    if not isinstance(coordinate_decimals, int) or not 0 <= coordinate_decimals <= 5:
        issues.append(_issue("error", "coordinate_precision_invalid", "coordinate_decimals must be an integer from 0 through 5"))
    if is_public and not acknowledge_license:
        issues.append(_issue("error", "license_acknowledgement_required", "public export requires acknowledgement that every included asset may be redistributed"))
    if privacy_mode == "public-exact" and not acknowledge_exact_location:
        issues.append(_issue("error", "exact_location_acknowledgement_required", "public exact export requires acknowledgement that exact coordinates will be downloadable"))

    for field, value in (
        ("title", config.get("title")),
        ("description", config.get("description")),
        ("location.displayLabel", config.get("location", {}).get("displayLabel")),
    ):
        if looks_like_address(value):
            issues.append(_issue(_public_severity(privacy_mode), "address_like_label", f"{field} appears to contain a street address"))
    if looks_identifying(config.get("slug")):
        issues.append(_issue(_public_severity(privacy_mode), "identifying_slug", "property slug may reveal an address, parcel, owner, or survey identifier"))

    if is_public and (config.get("location", {}).get("showExactLocation") or config.get("privacy", {}).get("showAddress")):
        issues.append(_issue("error", "public_location_display_enabled", "public exports must keep exact-location and address display flags off"))

    normalized_allowlist: set[str] = set()
    for entry in asset_allowlist:
        try:
            normalized = normalize_asset_path(entry)
        except ValueError as exc:
            issues.append(_issue("error", "asset_allowlist_unsafe", str(exc)))
            continue
        if Path(normalized).suffix.lower() in RAW_SOURCE_EXTENSIONS:
            issues.append(_issue("error", "raw_source_allowlisted", f"raw source asset cannot be allowlisted: {normalized}"))
        normalized_allowlist.add(normalized)
    for required in ("model.glb", "property.json", "package-manifest.json"):
        if required not in normalized_allowlist:
            issues.append(_issue("error", "asset_not_allowlisted", f"required asset is not allowlisted: {required}"))

    if looks_identifying(model_path.name):
        issues.append(_issue("warning", "source_filename_sanitized", "the source model filename may be identifying; the package will rename it to model.glb"))
    issues.extend(inspect_glb_metadata(model_path, privacy_mode))

    errors = [issue for issue in issues if issue["severity"] == "error"]
    warnings = [issue for issue in issues if issue["severity"] == "warning"]
    return {
        "publishable": not errors,
        "privacyMode": privacy_mode,
        "errors": errors,
        "warnings": warnings,
        "assetAllowlist": sorted(normalized_allowlist),
    }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def build_safe_manifest(
    *,
    config: dict,
    package_dir: Path,
    preflight: dict,
    coordinate_decimals: int,
    acknowledge_exact_location: bool,
    acknowledge_license: bool,
    include_sha256: bool,
) -> dict:
    """Build a deterministic manifest that never repeats labels or coordinates."""
    mode = preflight["privacyMode"]
    coordinate_handling = "local-only"
    if mode == "public-rounded":
        coordinate_handling = f"rounded-{coordinate_decimals}-decimals"
    elif mode == "public-exact":
        coordinate_handling = "exact-public"
    assets = []
    for name in ("model.glb", "property.json"):
        path = package_dir / name
        entry = {"path": name, "bytes": path.stat().st_size}
        if include_sha256:
            entry["sha256"] = _sha256(path)
        assets.append(entry)
    return {
        "manifestVersion": 1,
        "property": {"slug": config["slug"], "schemaVersion": config["schemaVersion"]},
        "privacy": {
            "mode": mode,
            "coordinateHandling": coordinate_handling,
            "locationDisplayed": False,
            "exactLocationAcknowledged": bool(acknowledge_exact_location) if mode == "public-exact" else False,
        },
        "license": {"redistributionAcknowledged": bool(acknowledge_license)},
        "assetAllowlist": preflight["assetAllowlist"],
        "assets": assets,
        "preflightWarningCodes": sorted({warning["code"] for warning in preflight["warnings"]}),
    }


def build_config(
    *,
    slug: str,
    title: str,
    latitude: float,
    longitude: float,
    time_zone: str,
    display_label: str,
    units: str,
    scale: float,
    north_offset: float,
    model_name: str = "model.glb",
    privacy_mode: str = "local",
    coordinate_decimals: int = 2,
) -> dict:
    return {
        "$schema": "../../schemas/property.schema.json",
        "schemaVersion": 1,
        "slug": slug,
        "title": title,
        "description": "Configurable 3D property solar study.",
        "location": {
            "latitude": latitude,
            "longitude": longitude,
            "timeZone": time_zone,
            "displayLabel": display_label,
            "showExactLocation": False,
        },
        "model": {
            "url": model_name,
            "units": units,
            "scale": scale,
            "northOffsetDegrees": north_offset,
            "position": [0, 0, 0],
        },
        "scene": {
            "groundBounds": {"minX": -25, "maxX": 25, "minZ": -25, "maxZ": 25},
            "terrainProfile": [[-25, 0], [25, 0]],
            "cameraPresets": {},
        },
        "zones": [],
        "solar": {"defaultDate": "today", "samplingMinutes": 15, "exposureMethod": "estimated"},
        "privacy": {
            "showAddress": False,
            "mode": privacy_mode,
            **(
                {"coordinatePrecisionDecimals": coordinate_decimals}
                if privacy_mode == "public-rounded"
                else {}
            ),
        },
    }


def create_property_package(
    *,
    slug: str,
    title: str,
    model: str | Path,
    latitude: float,
    longitude: float,
    time_zone: str,
    display_label: str = "Private property",
    units: str = "meters",
    scale: float = 1.0,
    north_offset: float = 0.0,
    output_root: str | Path | None = None,
    privacy_mode: str = "local",
    coordinate_decimals: int = 2,
    acknowledge_exact_location: bool = False,
    acknowledge_license: bool = False,
    asset_allowlist: set[str] | list[str] | tuple[str, ...] | None = None,
    include_sha256_manifest: bool = False,
) -> Path:
    """Copy a GLB and write its privacy-safe viewer configuration.

    ``output_root`` is the directory that contains property folders. It defaults
    to this repository's ``properties/`` directory. Existing packages are never
    overwritten.
    """
    normalized_slug = slugify(slug)
    title = _nonempty(title, "title")
    display_label = _nonempty(display_label, "display_label")
    latitude = _coordinate(latitude, "latitude", -90, 90)
    longitude = _coordinate(longitude, "longitude", -180, 180)
    time_zone = _validate_time_zone(time_zone)

    model_path = Path(model).expanduser()
    if not model_path.is_file() or model_path.suffix.lower() != ".glb":
        raise ValueError("model must point to an existing .glb file")
    if units not in VALID_UNITS:
        raise ValueError(f"units must be one of: {', '.join(sorted(VALID_UNITS))}")
    scale = _coordinate(scale, "scale", 0, math.inf)
    if scale == 0:
        raise ValueError("scale must be positive")
    north_offset = _coordinate(north_offset, "north_offset", -360, 360)

    if privacy_mode not in PRIVACY_MODES:
        raise ValueError(f"privacy_mode must be one of: {', '.join(sorted(PRIVACY_MODES))}")
    if not isinstance(coordinate_decimals, int) or not 0 <= coordinate_decimals <= 5:
        raise ValueError("coordinate_decimals must be an integer from 0 through 5")
    if privacy_mode == "public-rounded":
        latitude = round(latitude, coordinate_decimals)
        longitude = round(longitude, coordinate_decimals)

    config = build_config(
        slug=normalized_slug,
        title=title,
        latitude=latitude,
        longitude=longitude,
        time_zone=time_zone,
        display_label=display_label,
        units=units,
        scale=scale,
        north_offset=north_offset,
        model_name="model.glb",
        privacy_mode=privacy_mode,
        coordinate_decimals=coordinate_decimals,
    )
    effective_allowlist = set(DEFAULT_ASSET_ALLOWLIST)
    if asset_allowlist is not None:
        effective_allowlist.update(asset_allowlist)
    preflight = preflight_property_package(
        config=config,
        model_path=model_path,
        privacy_mode=privacy_mode,
        coordinate_decimals=coordinate_decimals,
        acknowledge_exact_location=acknowledge_exact_location,
        acknowledge_license=acknowledge_license,
        asset_allowlist=effective_allowlist,
    )
    if preflight["errors"]:
        raise ValueError("privacy preflight failed: " + "; ".join(issue["message"] for issue in preflight["errors"]))

    properties_root = Path(output_root) if output_root is not None else ROOT / "properties"
    package_dir = properties_root / normalized_slug
    try:
        package_dir.mkdir(parents=True, exist_ok=False)
    except FileExistsError as exc:
        raise FileExistsError(f"property package already exists: {package_dir}") from exc

    model_name = "model.glb"
    try:
        shutil.copy2(model_path, package_dir / model_name)
        (package_dir / "property.json").write_text(
            json.dumps(config, indent=2) + "\n",
            encoding="utf-8",
        )
        manifest = build_safe_manifest(
            config=config,
            package_dir=package_dir,
            preflight=preflight,
            coordinate_decimals=coordinate_decimals,
            acknowledge_exact_location=acknowledge_exact_location,
            acknowledge_license=acknowledge_license,
            include_sha256=include_sha256_manifest,
        )
        (package_dir / "package-manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n",
            encoding="utf-8",
        )
    except Exception:
        # A failed copy/write must not reserve the slug with a partial package.
        shutil.rmtree(package_dir)
        raise

    return package_dir


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slug", required=True, type=slugify)
    parser.add_argument("--title", required=True)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--latitude", required=True, type=float)
    parser.add_argument("--longitude", required=True, type=float)
    parser.add_argument("--time-zone", required=True)
    parser.add_argument("--display-label", default="Private property")
    parser.add_argument("--units", choices=["meters", "feet", "centimeters", "millimeters"], default="meters")
    parser.add_argument("--scale", type=float, default=1.0)
    parser.add_argument("--north-offset", type=float, default=0.0)
    parser.add_argument(
        "--privacy-mode",
        choices=sorted(PRIVACY_MODES),
        default="local",
        help="local keeps exact coordinates private; public-rounded rounds them; public-exact requires explicit acknowledgement",
    )
    parser.add_argument("--coordinate-decimals", type=int, default=2, help="coordinate precision for public-rounded mode (0-5)")
    parser.add_argument("--acknowledge-exact-location", action="store_true", help="confirm that public-exact coordinates will be downloadable")
    parser.add_argument("--acknowledge-license", action="store_true", help="confirm redistribution rights for every packaged asset")
    parser.add_argument("--asset-allow", action="append", default=[], help="add a safe relative path to the export allowlist")
    parser.add_argument("--sha256-manifest", action="store_true", help="include SHA-256 digests for property.json and model.glb")
    args = parser.parse_args()

    try:
        package_dir = create_property_package(
            slug=args.slug,
            title=args.title,
            model=args.model,
            latitude=args.latitude,
            longitude=args.longitude,
            time_zone=args.time_zone,
            display_label=args.display_label,
            units=args.units,
            scale=args.scale,
            north_offset=args.north_offset,
            privacy_mode=args.privacy_mode,
            coordinate_decimals=args.coordinate_decimals,
            acknowledge_exact_location=args.acknowledge_exact_location,
            acknowledge_license=args.acknowledge_license,
            asset_allowlist=args.asset_allow,
            include_sha256_manifest=args.sha256_manifest,
        )
    except (ValueError, FileExistsError) as exc:
        parser.error(str(exc))

    print(f"Created {package_dir}")
    print(f"Open /?property={package_dir.name}")


if __name__ == "__main__":
    main()
