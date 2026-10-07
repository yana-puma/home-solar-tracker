#!/usr/bin/env python3
"""Inspect the static deployment tree and produce an asset-safety report.

The scanner intentionally has no third-party dependencies so it can run in CI
before a Vercel deployment.  It approximates .vercelignore matching; supported
patterns cover ordinary names, directory prefixes, ``*``/``?``/``**`` globs,
and negation.
"""

from __future__ import annotations

import argparse
import base64
import fnmatch
import hashlib
import json
import mimetypes
import os
import re
import struct
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any, Iterable
from urllib.parse import unquote, urlparse


RAW_OR_SENSITIVE_SUFFIXES = {
    ".3ds", ".7z", ".asc", ".blend", ".csv", ".dae", ".dbf", ".dwg",
    ".dxf", ".e57", ".fbx", ".gdb", ".geojson", ".gltf", ".gpkg",
    ".gz", ".kml", ".kmz", ".las", ".laz", ".mtl", ".obj", ".p12",
    ".pcd", ".pem", ".pfx", ".ply", ".prj", ".pts", ".rar", ".shp",
    ".shx", ".stl", ".tar", ".tif", ".tiff", ".xyz", ".zip",
}
SECRET_NAMES = {
    ".env", ".env.local", ".npmrc", ".pypirc", "credentials.json",
    "id_dsa", "id_ed25519", "id_rsa", "service-account.json",
}
SAFE_NAME = re.compile(r"^[A-Za-z0-9._@+-]+$")
SRI = re.compile(r"^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$")
GLB_JSON_CHUNK = 0x4E4F534A
GLB_BIN_CHUNK = 0x004E4942
IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/ktx2"}
DEFAULT_MAX_BYTES = 50 * 1024 * 1024
DEFAULT_DUPLICATE_BLOCKER_BYTES = 5 * 1024 * 1024
DEFAULT_APPROVED_PUBLIC_GLBS = frozenset({"properties/demo/model.glb"})


@dataclass
class Finding:
    severity: str
    code: str
    message: str
    path: str | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "severity": self.severity,
            "code": self.code,
            "message": self.message,
        }
        if self.path is not None:
            result["path"] = self.path
        if self.details:
            result["details"] = self.details
        return result


class IgnoreRules:
    """Small, deterministic subset of gitignore semantics used by Vercel."""

    def __init__(self, lines: Iterable[str] = ()) -> None:
        self.rules: list[tuple[bool, str, bool]] = []
        for raw in lines:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            negated = line.startswith("!")
            if negated:
                line = line[1:]
            directory = line.endswith("/")
            line = line.strip("/")
            if line:
                self.rules.append((negated, line, directory))

    @classmethod
    def from_root(cls, root: Path) -> "IgnoreRules":
        path = root / ".vercelignore"
        if not path.is_file():
            return cls()
        return cls(path.read_text(encoding="utf-8").splitlines())

    @staticmethod
    def _matches(path: str, pattern: str, directory: bool, is_dir: bool) -> bool:
        candidates = [pattern]
        if pattern.startswith("**/"):
            candidates.append(pattern[3:])
        if directory:
            return any(path == value or path.startswith(value + "/") for value in candidates)
        if "/" not in pattern:
            return any(fnmatch.fnmatchcase(part, pattern) for part in path.split("/"))
        return any(fnmatch.fnmatchcase(path, value) for value in candidates)

    def ignores(self, path: str, *, is_dir: bool = False) -> bool:
        if path == ".git" or path.startswith(".git/") or path == ".vercel" or path.startswith(".vercel/"):
            return True
        ignored = False
        for negated, pattern, directory in self.rules:
            if self._matches(path, pattern, directory, is_dir):
                ignored = not negated
        return ignored


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_relative_url(value: str) -> tuple[str | None, str | None]:
    """Return a decoded normalized relative path or an error code."""
    parsed = urlparse(value)
    if parsed.scheme or parsed.netloc:
        return None, "remote"
    if parsed.query or parsed.fragment:
        return None, "query_or_fragment"
    decoded = unquote(parsed.path).replace("\\", "/")
    pure = PurePosixPath(decoded)
    if not decoded or decoded.startswith("/") or any(part in {"", ".", ".."} for part in pure.parts):
        return None, "unsafe_relative_path"
    return pure.as_posix(), None


def inspect_glb(path: Path, relative_path: str) -> tuple[dict[str, Any], list[Finding]]:
    """Validate a GLB 2 container and estimate its rendered triangle count."""
    findings: list[Finding] = []
    size = path.stat().st_size
    result: dict[str, Any] = {
        "path": relative_path,
        "bytes": size,
        "mimeType": "model/gltf-binary",
        "version": None,
        "trianglesApproximate": None,
        "meshPrimitives": 0,
    }
    try:
        with path.open("rb") as stream:
            header = stream.read(12)
            if len(header) != 12:
                raise ValueError("file is shorter than the 12-byte GLB header")
            magic, version, declared_length = struct.unpack("<4sII", header)
            result["version"] = version
            if magic != b"glTF":
                raise ValueError("header magic is not glTF")
            if version != 2:
                raise ValueError(f"GLB version {version} is unsupported; expected 2")
            if declared_length != size:
                raise ValueError(f"header length {declared_length} does not match file size {size}")

            chunks: list[tuple[int, bytes]] = []
            offset = 12
            while offset < size:
                chunk_header = stream.read(8)
                if len(chunk_header) != 8:
                    raise ValueError("truncated chunk header")
                chunk_length, chunk_type = struct.unpack("<II", chunk_header)
                chunk = stream.read(chunk_length)
                if len(chunk) != chunk_length:
                    raise ValueError("truncated chunk payload")
                offset += 8 + chunk_length
                chunks.append((chunk_type, chunk))
            if offset != size or not chunks or chunks[0][0] != GLB_JSON_CHUNK:
                raise ValueError("first GLB chunk must be JSON and chunks must fill the file")
            document = json.loads(chunks[0][1].decode("utf-8").rstrip("\x00 \t\r\n"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError, struct.error) as exc:
        findings.append(Finding("blocker", "invalid_glb", str(exc), relative_path))
        return result, findings

    if not str(document.get("asset", {}).get("version", "")).startswith("2"):
        findings.append(Finding("blocker", "invalid_gltf_asset_version", "GLB JSON asset.version must be 2.x.", relative_path))

    accessors = document.get("accessors", [])
    triangles = 0
    counted = 0
    primitives = 0
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            primitives += 1
            accessor_index = primitive.get("indices")
            if accessor_index is None:
                accessor_index = primitive.get("attributes", {}).get("POSITION")
            try:
                vertex_count = int(accessors[accessor_index]["count"])
            except (IndexError, KeyError, TypeError, ValueError):
                continue
            mode = primitive.get("mode", 4)
            if mode == 4:
                triangles += vertex_count // 3
                counted += 1
            elif mode in (5, 6):
                triangles += max(0, vertex_count - 2)
                counted += 1
    result["meshPrimitives"] = primitives
    result["trianglesApproximate"] = triangles if counted else None

    for index, image in enumerate(document.get("images", [])):
        mime = image.get("mimeType")
        uri = image.get("uri", "")
        if mime and mime not in IMAGE_MIME_TYPES:
            findings.append(Finding("blocker", "unsafe_glb_image_mime", f"Embedded image {index} has unsupported MIME type {mime!r}.", relative_path))
        if isinstance(uri, str) and uri.startswith("data:"):
            data_mime = uri[5:].split(";", 1)[0]
            if data_mime not in IMAGE_MIME_TYPES:
                findings.append(Finding("blocker", "unsafe_glb_data_uri", f"Image {index} has unsupported data URI MIME type {data_mime!r}.", relative_path))
        elif uri:
            _, error = _safe_relative_url(str(uri))
            if error:
                findings.append(Finding("blocker", "unsafe_glb_external_uri", f"Image {index} uses a non-package URI.", relative_path))
    return result, findings


class AssetScanner:
    def __init__(
        self,
        root: str | Path,
        *,
        max_bytes: int = DEFAULT_MAX_BYTES,
        duplicate_blocker_bytes: int = DEFAULT_DUPLICATE_BLOCKER_BYTES,
        approved_public_glbs: Iterable[str] = DEFAULT_APPROVED_PUBLIC_GLBS,
    ) -> None:
        self.root = Path(root).resolve()
        self.max_bytes = max_bytes
        self.duplicate_blocker_bytes = duplicate_blocker_bytes
        self.approved_public_glbs = frozenset(PurePosixPath(value).as_posix() for value in approved_public_glbs)
        self.ignore = IgnoreRules.from_root(self.root)
        self.findings: list[Finding] = []
        self.files: list[dict[str, Any]] = []
        self.glbs: list[dict[str, Any]] = []
        self.configs: list[dict[str, Any]] = []
        self.duplicates: list[dict[str, Any]] = []
        self._paths: dict[str, Path] = {}
        self._hashes: dict[str, list[dict[str, Any]]] = {}

    def finding(self, severity: str, code: str, message: str, path: str | None = None, **details: Any) -> None:
        self.findings.append(Finding(severity, code, message, path, details))

    def _walk(self) -> None:
        if not self.root.is_dir():
            self.finding("blocker", "invalid_root", "Deployment root is not a directory.", str(self.root))
            return
        for current, directories, filenames in os.walk(self.root, topdown=True, followlinks=False):
            current_path = Path(current)
            kept: list[str] = []
            for name in sorted(directories):
                path = current_path / name
                relative = path.relative_to(self.root).as_posix()
                if self.ignore.ignores(relative, is_dir=True):
                    continue
                if path.is_symlink():
                    self.finding("blocker", "symlink", "Deployable symlinks are not allowed.", relative)
                    continue
                kept.append(name)
            directories[:] = kept
            for name in sorted(filenames):
                path = current_path / name
                relative = path.relative_to(self.root).as_posix()
                if self.ignore.ignores(relative):
                    continue
                if path.is_symlink():
                    self.finding("blocker", "symlink", "Deployable symlinks are not allowed.", relative)
                    continue
                if not path.is_file():
                    self.finding("blocker", "unsupported_file", "Deployable entry is not a regular file.", relative)
                    continue
                self._inspect_file(path, relative)

    def _inspect_file(self, path: Path, relative: str) -> None:
        size = path.stat().st_size
        suffix = path.suffix.lower()
        digest = _sha256(path)
        mime = "model/gltf-binary" if suffix == ".glb" else (mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        entry = {"path": relative, "bytes": size, "sha256": digest, "mimeType": mime}
        self.files.append(entry)
        self._paths[relative] = path
        self._hashes.setdefault(digest, []).append(entry)

        lowered = path.name.lower()
        if lowered in SECRET_NAMES or lowered.startswith(".env") or suffix in {".key", ".p12", ".pem", ".pfx"}:
            self.finding("blocker", "secret_file", "Credential or environment file is deployable.", relative)
        elif suffix in RAW_OR_SENSITIVE_SUFFIXES:
            self.finding("blocker", "raw_source_asset", "Raw survey, GIS, CAD, or sensitive source format is deployable.", relative)
        if any(not SAFE_NAME.fullmatch(part) for part in PurePosixPath(relative).parts):
            self.finding("blocker", "unsafe_name", "Deployable path contains whitespace or unsafe characters.", relative)
        if size > self.max_bytes:
            self.finding("blocker", "oversized_file", f"File exceeds the {self.max_bytes}-byte release limit.", relative, bytes=size, limit=self.max_bytes)
        if suffix == ".glb":
            glb, findings = inspect_glb(path, relative)
            self.glbs.append(glb)
            self.findings.extend(findings)
            if relative in self.approved_public_glbs:
                self.finding("info", "approved_public_glb", "GLB matches the explicitly approved public release scope.", relative)
            else:
                self.finding(
                    "blocker",
                    "unapproved_public_glb",
                    "Deployable GLB is not in the explicitly approved public release scope.",
                    relative,
                )

    def _inspect_duplicates(self) -> None:
        for digest, entries in sorted(self._hashes.items()):
            if len(entries) < 2:
                continue
            paths = sorted(entry["path"] for entry in entries)
            size = entries[0]["bytes"]
            wasted = size * (len(entries) - 1)
            duplicate = {"sha256": digest, "bytesEach": size, "wastedBytes": wasted, "paths": paths}
            self.duplicates.append(duplicate)
            severity = "blocker" if wasted >= self.duplicate_blocker_bytes else "warning"
            self.finding(severity, "duplicate_assets", f"{len(paths)} deployable files are byte-identical.", paths[0], paths=paths, wastedBytes=wasted)

    def _resolve_asset(self, config_relative: str, url: Any, *, label: str) -> tuple[str | None, Path | None]:
        if not isinstance(url, str):
            self.finding("blocker", "invalid_asset_url", f"{label} must be a string.", config_relative)
            return None, None
        parsed = urlparse(url)
        if parsed.scheme == "http":
            self.finding("blocker", "insecure_remote_asset", f"{label} uses insecure HTTP.", config_relative, url=url)
            return None, None
        if parsed.scheme == "https":
            self.finding("warning", "remote_asset_unverified", f"{label} is remote; bytes and integrity cannot be verified locally.", config_relative, url=url)
            return None, None
        relative_url, error = _safe_relative_url(url)
        if error:
            self.finding("blocker", "unsafe_asset_url", f"{label} is not a traversal-free package-relative URL.", config_relative, url=url)
            return None, None
        base = PurePosixPath(config_relative).parent
        parts: list[str] = []
        for part in (base / relative_url).parts:
            if part == "..":
                if not parts:
                    self.finding("blocker", "asset_outside_root", f"{label} resolves outside the deployment root.", config_relative, url=url)
                    return None, None
                parts.pop()
            elif part not in {"", "."}:
                parts.append(part)
        resolved_relative = PurePosixPath(*parts).as_posix()
        candidate = self.root / resolved_relative
        if resolved_relative not in self._paths or not candidate.is_file():
            self.finding("blocker", "missing_asset", f"{label} does not resolve to a deployable file.", config_relative, url=url, resolvedPath=resolved_relative)
            return resolved_relative, None
        return resolved_relative, candidate

    def _check_sri(self, config_relative: str, asset: dict[str, Any], path: Path | None, resolved: str | None) -> None:
        integrity = asset.get("integrity")
        match = SRI.fullmatch(integrity) if isinstance(integrity, str) else None
        if not match:
            self.finding("blocker", "invalid_asset_integrity", "Asset integrity must be a valid SRI sha256, sha384, or sha512 value.", config_relative, assetId=asset.get("id"))
            return
        size = asset.get("size")
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            self.finding("blocker", "invalid_asset_size", "Asset size must be a non-negative integer.", config_relative, assetId=asset.get("id"))
        if path is None:
            return
        algorithm, encoded = match.groups()
        digest = hashlib.new(algorithm, path.read_bytes()).digest()
        try:
            authored = base64.b64decode(encoded, validate=True)
        except ValueError:
            authored = b""
        if digest != authored:
            self.finding("blocker", "asset_integrity_mismatch", "Asset SRI digest does not match the deployed file.", config_relative, assetId=asset.get("id"), resolvedPath=resolved)
        if isinstance(size, int) and not isinstance(size, bool) and size >= 0 and size != path.stat().st_size:
            self.finding("blocker", "asset_size_mismatch", "Authored asset size does not match the deployed file.", config_relative, assetId=asset.get("id"), authored=size, actual=path.stat().st_size)

    def _inspect_property_config(self, relative: str, document: dict[str, Any]) -> None:
        version = document.get("schemaVersion")
        record: dict[str, Any] = {"path": relative, "schemaVersion": version, "assets": []}
        if version == 1:
            model = document.get("model")
            if not isinstance(model, dict):
                self.finding("blocker", "missing_model", "Property config has no model object.", relative)
            else:
                resolved, path = self._resolve_asset(relative, model.get("url"), label="model.url")
                if resolved:
                    record["assets"].append(resolved)
                if path is not None and path.suffix.lower() != ".glb":
                    self.finding("blocker", "invalid_model_type", "Property model must resolve to a .glb file.", relative)
        elif version == 2:
            assets = document.get("assets")
            if not isinstance(assets, list) or not assets:
                self.finding("blocker", "missing_assets", "V2 property config must include a non-empty assets array.", relative)
            else:
                seen_ids: set[str] = set()
                by_id: dict[str, dict[str, Any]] = {}
                for index, value in enumerate(assets):
                    if not isinstance(value, dict):
                        self.finding("blocker", "invalid_asset_entry", f"assets[{index}] must be an object.", relative)
                        continue
                    asset_id = value.get("id")
                    if not isinstance(asset_id, str) or not asset_id or asset_id in seen_ids:
                        self.finding("blocker", "invalid_asset_id", f"assets[{index}] has a missing or duplicate id.", relative)
                    else:
                        seen_ids.add(asset_id)
                        by_id[asset_id] = value
                    resolved, path = self._resolve_asset(relative, value.get("url"), label=f"assets[{index}].url")
                    if resolved:
                        record["assets"].append(resolved)
                    self._check_sri(relative, value, path, resolved)
                model_id = document.get("model", {}).get("assetId") if isinstance(document.get("model"), dict) else None
                model_asset = by_id.get(model_id)
                if not model_asset or model_asset.get("type") != "model":
                    self.finding("blocker", "invalid_model_asset", "model.assetId must reference a model asset.", relative)
                elif isinstance(model_asset.get("url"), str):
                    resolved, path = self._resolve_asset(relative, model_asset["url"], label="model asset URL")
                    if path is not None and path.suffix.lower() != ".glb":
                        self.finding("blocker", "invalid_model_type", "Model asset must resolve to a .glb file.", relative)
        else:
            self.finding("blocker", "unsupported_config_version", "Property config schemaVersion must be 1 or 2.", relative)
        self.configs.append(record)

    def _inspect_manifest(self, relative: str, document: dict[str, Any]) -> None:
        assets = document.get("assets")
        if not isinstance(assets, list):
            self.finding("blocker", "invalid_manifest", "Package manifest assets must be an array.", relative)
            return
        allowlist = document.get("assetAllowlist")
        if allowlist is not None:
            if not isinstance(allowlist, list) or not all(isinstance(value, str) for value in allowlist) or len(set(allowlist)) != len(allowlist):
                self.finding("blocker", "invalid_manifest_allowlist", "Manifest allowlist must contain unique paths.", relative)
                return
            declared = [asset.get("path") for asset in assets if isinstance(asset, dict)]
            expected = set(allowlist) - {"manifest.json", "package-manifest.json"}
            if len(declared) != len(set(str(value) for value in declared)) or set(str(value) for value in declared) != expected:
                self.finding("blocker", "manifest_allowlist_mismatch", "Every allowlisted asset except the manifest itself must have one manifest entry.", relative)
        for index, asset in enumerate(assets):
            if not isinstance(asset, dict):
                self.finding("blocker", "invalid_manifest_asset", f"Manifest assets[{index}] must be an object.", relative)
                continue
            resolved, path = self._resolve_asset(relative, asset.get("path"), label=f"manifest assets[{index}].path")
            if path is None:
                continue
            size = asset.get("bytes")
            if allowlist is not None and (not isinstance(size, int) or isinstance(size, bool) or not isinstance(asset.get("sha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", asset.get("sha256", ""))):
                self.finding("blocker", "invalid_manifest_integrity", "Manifest assets require byte sizes and SHA-256 hashes.", relative)
            if size is not None and size != path.stat().st_size:
                self.finding("blocker", "manifest_size_mismatch", "Manifest byte count does not match the deployed file.", relative, resolvedPath=resolved)
            digest = asset.get("sha256")
            if digest is not None and digest != _sha256(path):
                self.finding("blocker", "manifest_hash_mismatch", "Manifest SHA-256 does not match the deployed file.", relative, resolvedPath=resolved)

    def _inspect_registry(self, relative: str, document: dict[str, Any]) -> None:
        entries = document.get("properties")
        if not isinstance(entries, list):
            self.finding("blocker", "invalid_registry", "Property registry must contain a properties array.", relative)
            return
        slugs: set[str] = set()
        revisions: set[tuple[str, str]] = set()
        for index, entry in enumerate(entries):
            if not isinstance(entry, dict):
                self.finding("blocker", "invalid_registry_entry", f"Registry properties[{index}] must be an object.", relative)
                continue
            slug = entry.get("slug")
            revision = entry.get("revision", "legacy-v1")
            if not isinstance(slug, str) or not slug or not isinstance(revision, str) or not revision or (slug, revision) in revisions:
                self.finding("blocker", "invalid_registry_slug", f"Registry properties[{index}] has a missing identity or duplicate slug/revision.", relative)
            else:
                slugs.add(slug)
                revisions.add((slug, revision))
            self._resolve_asset(relative, entry.get("configUrl"), label=f"properties[{index}].configUrl")
            if entry.get("modelUrl") is not None:
                resolved, path = self._resolve_asset(relative, entry.get("modelUrl"), label=f"properties[{index}].modelUrl")
                if path is not None and path.suffix.lower() != ".glb":
                    self.finding("blocker", "invalid_registry_model", "Registry modelUrl must resolve to a .glb file.", relative, resolvedPath=resolved)
        default = document.get("defaultProperty")
        if default is not None and default not in slugs:
            self.finding("blocker", "invalid_registry_default", "defaultProperty does not reference a registry slug.", relative)

    def _inspect_json_contracts(self) -> None:
        for relative in sorted(self._paths):
            if not relative.endswith(".json"):
                continue
            if not (relative.endswith("/property.json") or relative.endswith(("/manifest.json", "/package-manifest.json")) or relative == "properties/index.json"):
                continue
            try:
                document = json.loads(self._paths[relative].read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                self.finding("blocker", "invalid_json", f"JSON file cannot be parsed: {exc}", relative)
                continue
            if not isinstance(document, dict):
                self.finding("blocker", "invalid_json_contract", "Asset contract JSON must be an object.", relative)
            elif relative.endswith("/property.json"):
                self._inspect_property_config(relative, document)
            elif relative.endswith(("/manifest.json", "/package-manifest.json")):
                self._inspect_manifest(relative, document)
            else:
                self._inspect_registry(relative, document)

    def scan(self) -> dict[str, Any]:
        self._walk()
        self._inspect_duplicates()
        self._inspect_json_contracts()
        severity_order = {"blocker": 0, "warning": 1, "info": 2}
        findings = sorted(self.findings, key=lambda item: (severity_order.get(item.severity, 9), item.path or "", item.code))
        blockers = sum(item.severity == "blocker" for item in findings)
        warnings = sum(item.severity == "warning" for item in findings)
        return {
            "schemaVersion": 1,
            "root": str(self.root),
            "ok": blockers == 0,
            "summary": {
                "files": len(self.files),
                "bytes": sum(entry["bytes"] for entry in self.files),
                "blockers": blockers,
                "warnings": warnings,
                "glbs": len(self.glbs),
                "propertyConfigs": len(self.configs),
                "duplicateGroups": len(self.duplicates),
            },
            "findings": [item.as_dict() for item in findings],
            "glbs": sorted(self.glbs, key=lambda item: item["path"]),
            "configs": sorted(self.configs, key=lambda item: item["path"]),
            "duplicates": self.duplicates,
            "files": sorted(self.files, key=lambda item: item["path"]),
        }


def scan_deployable_tree(root: str | Path, **kwargs: Any) -> dict[str, Any]:
    return AssetScanner(root, **kwargs).scan()


def render_human_report(report: dict[str, Any]) -> str:
    summary = report["summary"]
    status = "PASS" if report["ok"] else "BLOCKED"
    lines = [
        f"Static asset release report: {status}",
        f"Root: {report['root']}",
        f"Files: {summary['files']} ({summary['bytes']} bytes); GLBs: {summary['glbs']}; property configs: {summary['propertyConfigs']}",
        f"Findings: {summary['blockers']} blocker(s), {summary['warnings']} warning(s)",
    ]
    for finding in report["findings"]:
        location = f" {finding['path']}:" if finding.get("path") else ""
        lines.append(f"[{finding['severity'].upper()}] {finding['code']}:{location} {finding['message']}")
    if report["glbs"]:
        lines.append("GLB inventory:")
        for glb in report["glbs"]:
            triangles = glb["trianglesApproximate"]
            triangle_text = "unknown" if triangles is None else f"~{triangles}"
            lines.append(f"- {glb['path']}: {glb['bytes']} bytes, {triangle_text} triangles ({glb['mimeType']})")
    return "\n".join(lines) + "\n"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Report deployable asset safety and integrity.")
    parser.add_argument("root", nargs="?", default=".", help="static deployment root (default: current directory)")
    parser.add_argument("--format", choices=("human", "json"), default="human")
    parser.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES)
    parser.add_argument("--duplicate-blocker-bytes", type=int, default=DEFAULT_DUPLICATE_BLOCKER_BYTES)
    parser.add_argument("--allow-public-glb", action="append", default=[], help="add a deploy-root-relative GLB path to the approved public scope")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    approved = set(DEFAULT_APPROVED_PUBLIC_GLBS)
    approved.update(args.allow_public_glb)
    report = scan_deployable_tree(
        args.root,
        max_bytes=args.max_bytes,
        duplicate_blocker_bytes=args.duplicate_blocker_bytes,
        approved_public_glbs=approved,
    )
    if args.format == "json":
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(render_human_report(report), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
