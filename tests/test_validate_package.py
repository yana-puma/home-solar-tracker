from __future__ import annotations

import base64
import hashlib
import json
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = REPO_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from asset_report import IgnoreRules, render_human_report, scan_deployable_tree  # noqa: E402
from validate_package import scan_release_package  # noqa: E402


def glb_document(*, triangle_vertices: int = 6) -> bytes:
    document = {
        "asset": {"version": "2.0"},
        "accessors": [{"count": triangle_vertices, "type": "VEC3", "componentType": 5126}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "mode": 4}]}],
        "scenes": [{"nodes": []}],
        "scene": 0,
    }
    payload = json.dumps(document, separators=(",", ":")).encode("utf-8")
    payload += b" " * ((4 - len(payload) % 4) % 4)
    chunk = struct.pack("<II", len(payload), 0x4E4F534A) + payload
    return struct.pack("<4sII", b"glTF", 2, 12 + len(chunk)) + chunk


def sri(data: bytes, algorithm: str = "sha256") -> str:
    digest = hashlib.new(algorithm, data).digest()
    return f"{algorithm}-{base64.b64encode(digest).decode('ascii')}"


class PackageValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write(self, relative: str, data: str | bytes) -> Path:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(data, bytes):
            path.write_bytes(data)
        else:
            path.write_text(data, encoding="utf-8")
        return path

    def valid_v1_tree(self) -> bytes:
        model = glb_document()
        self.write("index.html", "<!doctype html><title>Viewer</title>")
        self.write("properties/demo/model.glb", model)
        self.write("properties/demo/property.json", json.dumps({"schemaVersion": 1, "model": {"url": "model.glb"}}))
        self.write(
            "properties/index.json",
            json.dumps({
                "schemaVersion": 1,
                "defaultProperty": "demo",
                "properties": [{
                    "slug": "demo",
                    "configUrl": "./demo/property.json",
                    "modelUrl": "./demo/model.glb",
                }],
            }),
        )
        return model

    @staticmethod
    def codes(report: dict, severity: str | None = None) -> set[str]:
        return {
            finding["code"]
            for finding in report["findings"]
            if severity is None or finding["severity"] == severity
        }

    def test_valid_v1_tree_reports_glb_inventory_and_passes(self) -> None:
        self.valid_v1_tree()
        report = scan_deployable_tree(self.root)
        self.assertTrue(report["ok"], report["findings"])
        self.assertEqual(report["summary"]["glbs"], 1)
        self.assertEqual(report["glbs"][0]["trianglesApproximate"], 2)
        self.assertEqual(report["glbs"][0]["mimeType"], "model/gltf-binary")
        self.assertIn("Static asset release report: PASS", render_human_report(report))

    def test_release_scan_blocks_precise_coordinate_pairs_in_deployable_text(self) -> None:
        self.valid_v1_tree()
        self.write(
            "share-example.html",
            "<p>latitude: 38.897676</p>\n<p>longitude: -77.036530</p>\n",
        )
        report = scan_release_package(self.root)

        self.assertFalse(report["ok"])
        finding = next(item for item in report["findings"] if item["code"] == "precise_coordinate_text")
        self.assertEqual(finding["path"], "share-example.html")
        self.assertEqual(finding["details"]["lineNumbers"], [1, 2])
        self.assertNotIn("38.897676", json.dumps(finding))
        self.assertEqual(report["summary"]["blockers"], 1)

    def test_release_scan_detects_unlabeled_pairs_in_either_coordinate_order(self) -> None:
        self.valid_v1_tree()
        self.write("lat-lon.txt", "study center 38.897676, -77.036530\n")
        self.write("lon-lat.txt", "map point -77.036530 / 38.897676\n")
        report = scan_release_package(self.root)

        blocked_paths = {
            item["path"] for item in report["findings"]
            if item["code"] == "precise_coordinate_text"
        }
        self.assertEqual(blocked_paths, {"lat-lon.txt", "lon-lat.txt"})

    def test_coordinate_scan_ignores_coarse_values_normalized_vectors_and_excluded_fixtures(self) -> None:
        self.valid_v1_tree()
        self.write("coarse.md", "Fictional location: 40.0, -105.0\ntransform 0.1234, 0.5678\n")
        self.write(".vercelignore", "fixtures/\n")
        self.write("fixtures/private-location.txt", "38.897676, -77.036530\n")

        report = scan_release_package(self.root)
        self.assertTrue(report["ok"], report["findings"])
        self.assertNotIn("precise_coordinate_text", self.codes(report))

    def test_precise_coordinate_text_allowlist_is_exact_auditable_and_used(self) -> None:
        self.valid_v1_tree()
        self.write("approved-fixture.txt", "38.897676, -77.036530\n")

        report = scan_release_package(
            self.root,
            allowed_precise_coordinate_text=["approved-fixture.txt"],
        )
        self.assertTrue(report["ok"], report["findings"])
        approved = next(item for item in report["findings"] if item["code"] == "approved_precise_coordinate_text")
        self.assertEqual(approved["path"], "approved-fixture.txt")
        self.assertNotIn("38.897676", json.dumps(approved))

        unused = scan_release_package(
            self.root,
            allowed_precise_coordinate_text=["index.html"],
        )
        self.assertIn("unused_precise_coordinate_text_allowlist", self.codes(unused, "blocker"))
        with self.assertRaisesRegex(ValueError, "unsafe precise-coordinate"):
            scan_release_package(self.root, allowed_precise_coordinate_text=["../outside.txt"])

    def test_approved_demo_config_scope_remains_available(self) -> None:
        self.valid_v1_tree()
        config = self.root / "properties/demo/property.json"
        config.write_text(json.dumps({
            "schemaVersion": 1,
            "location": {"latitude": 38.897676, "longitude": -77.036530},
            "model": {"url": "model.glb"},
        }), encoding="utf-8")

        report = scan_release_package(self.root)
        self.assertTrue(report["ok"], report["findings"])
        approved = next(item for item in report["findings"] if item["code"] == "approved_precise_coordinate_text")
        self.assertEqual(approved["path"], "properties/demo/property.json")

        document = json.loads(config.read_text(encoding="utf-8"))
        document["description"] = "Unapproved copied point 39.123456, -76.654321"
        config.write_text(json.dumps(document), encoding="utf-8")
        blocked = scan_release_package(self.root)
        self.assertIn("precise_coordinate_text", self.codes(blocked, "blocker"))

    def test_vercelignore_excludes_raw_sources_but_unignored_raw_blocks(self) -> None:
        self.valid_v1_tree()
        self.write(".vercelignore", "private/\n")
        self.write("private/survey.las", b"private")
        self.write("public/parcel.geojson", "{}")
        report = scan_deployable_tree(self.root)
        self.assertFalse(report["ok"])
        paths = {finding.get("path") for finding in report["findings"] if finding["code"] == "raw_source_asset"}
        self.assertEqual(paths, {"public/parcel.geojson"})

    def test_symlinks_secrets_unsafe_names_and_oversize_are_blockers(self) -> None:
        self.valid_v1_tree()
        self.write(".env.local", "TOKEN=do-not-deploy")
        self.write("unsafe name.txt", "unsafe")
        self.write("large.bin", b"12345")
        try:
            (self.root / "linked-model.glb").symlink_to(self.root / "properties/demo/model.glb")
        except OSError:
            pass
        report = scan_deployable_tree(self.root, max_bytes=4)
        codes = self.codes(report, "blocker")
        self.assertIn("secret_file", codes)
        self.assertIn("unsafe_name", codes)
        self.assertIn("oversized_file", codes)
        if (self.root / "linked-model.glb").is_symlink():
            self.assertIn("symlink", codes)

    def test_duplicate_assets_warn_or_block_at_configured_waste_threshold(self) -> None:
        self.valid_v1_tree()
        self.write("copy-a.bin", b"same")
        self.write("copy-b.bin", b"same")
        warning_report = scan_deployable_tree(self.root, duplicate_blocker_bytes=5)
        self.assertIn("duplicate_assets", self.codes(warning_report, "warning"))
        blocking_report = scan_deployable_tree(self.root, duplicate_blocker_bytes=4)
        self.assertIn("duplicate_assets", self.codes(blocking_report, "blocker"))

    def test_malformed_glb_is_a_blocker(self) -> None:
        self.valid_v1_tree()
        self.write("properties/demo/model.glb", b"not a glb")
        report = scan_deployable_tree(self.root)
        self.assertIn("invalid_glb", self.codes(report, "blocker"))

    def test_glb_rejects_unsupported_embedded_image_mime(self) -> None:
        document = {"asset": {"version": "2.0"}, "images": [{"bufferView": 0, "mimeType": "image/svg+xml"}]}
        payload = json.dumps(document, separators=(",", ":")).encode("utf-8")
        payload += b" " * ((4 - len(payload) % 4) % 4)
        chunk = struct.pack("<II", len(payload), 0x4E4F534A) + payload
        model = struct.pack("<4sII", b"glTF", 2, 12 + len(chunk)) + chunk
        self.write("properties/demo/model.glb", model)
        self.write("properties/demo/property.json", json.dumps({"schemaVersion": 1, "model": {"url": "model.glb"}}))
        report = scan_deployable_tree(self.root)
        self.assertIn("unsafe_glb_image_mime", self.codes(report, "blocker"))

    def test_v2_asset_size_and_integrity_are_verified(self) -> None:
        model = glb_document(triangle_vertices=9)
        self.write("index.html", "ok")
        self.write("properties/garden/model.glb", model)
        config = {
            "schemaVersion": 2,
            "assets": [{
                "id": "model",
                "type": "model",
                "url": "model.glb",
                "size": len(model),
                "integrity": sri(model),
            }],
            "model": {"assetId": "model"},
        }
        path = self.write("properties/garden/property.json", json.dumps(config))
        report = scan_deployable_tree(self.root, approved_public_glbs={"properties/garden/model.glb"})
        self.assertTrue(report["ok"], report["findings"])

        config["assets"][0]["size"] += 1
        config["assets"][0]["integrity"] = sri(b"different")
        path.write_text(json.dumps(config), encoding="utf-8")
        failed = scan_deployable_tree(self.root, approved_public_glbs={"properties/garden/model.glb"})
        self.assertIn("asset_size_mismatch", self.codes(failed, "blocker"))
        self.assertIn("asset_integrity_mismatch", self.codes(failed, "blocker"))

    def test_unapproved_public_model_blocks_until_added_to_scope(self) -> None:
        model = glb_document()
        self.write("properties/friend/model.glb", model)
        self.write("properties/friend/property.json", json.dumps({"schemaVersion": 1, "model": {"url": "model.glb"}}))
        blocked = scan_deployable_tree(self.root)
        self.assertIn("unapproved_public_glb", self.codes(blocked, "blocker"))
        approved = scan_deployable_tree(self.root, approved_public_glbs={"properties/friend/model.glb"})
        self.assertTrue(approved["ok"], approved["findings"])

    def test_traversal_missing_insecure_and_registry_references_block(self) -> None:
        self.valid_v1_tree()
        property_path = self.root / "properties/demo/property.json"
        property_path.write_text(json.dumps({"schemaVersion": 1, "model": {"url": "../missing.glb"}}), encoding="utf-8")
        registry_path = self.root / "properties/index.json"
        registry_path.write_text(json.dumps({
            "defaultProperty": "missing",
            "properties": [{"slug": "demo", "configUrl": "http://example.test/property.json"}],
        }), encoding="utf-8")
        report = scan_deployable_tree(self.root)
        codes = self.codes(report, "blocker")
        self.assertTrue({"unsafe_asset_url", "insecure_remote_asset", "invalid_registry_default"}.issubset(codes))

    def test_package_manifest_hash_and_size_are_verified(self) -> None:
        model = self.valid_v1_tree()
        manifest = {
            "manifestVersion": 1,
            "assets": [{"path": "model.glb", "bytes": len(model), "sha256": hashlib.sha256(model).hexdigest()}],
        }
        path = self.write("properties/demo/package-manifest.json", json.dumps(manifest))
        self.assertTrue(scan_deployable_tree(self.root)["ok"])
        manifest["assets"][0]["sha256"] = "0" * 64
        path.write_text(json.dumps(manifest), encoding="utf-8")
        self.assertIn("manifest_hash_mismatch", self.codes(scan_deployable_tree(self.root), "blocker"))

    def test_builder_manifest_name_and_allowlist_are_enforced(self) -> None:
        model = self.valid_v1_tree()
        manifest = {"manifestVersion": 1, "assetAllowlist": ["model.glb", "manifest.json"],
                    "assets": [{"path": "model.glb", "bytes": len(model), "sha256": hashlib.sha256(model).hexdigest()}]}
        path = self.write("properties/demo/manifest.json", json.dumps(manifest))
        self.assertTrue(scan_deployable_tree(self.root)["ok"])
        manifest["assets"][0]["sha256"] = "0" * 64
        path.write_text(json.dumps(manifest), encoding="utf-8")
        self.assertIn("manifest_hash_mismatch", self.codes(scan_deployable_tree(self.root), "blocker"))
        manifest["assetAllowlist"].append("README.md")
        path.write_text(json.dumps(manifest), encoding="utf-8")
        self.assertIn("manifest_allowlist_mismatch", self.codes(scan_deployable_tree(self.root), "blocker"))

    def test_validator_json_is_machine_readable_and_exit_code_gates_release(self) -> None:
        self.valid_v1_tree()
        command = [sys.executable, str(SCRIPTS / "validate_package.py"), str(self.root), "--json"]
        passed = subprocess.run(command, check=False, capture_output=True, text=True)
        self.assertEqual(passed.returncode, 0, passed.stderr)
        self.assertTrue(json.loads(passed.stdout)["ok"])

        self.write("survey.las", b"raw")
        blocked = subprocess.run(command, check=False, capture_output=True, text=True)
        self.assertEqual(blocked.returncode, 1)
        self.assertFalse(json.loads(blocked.stdout)["ok"])

    def test_checked_in_vercel_policy_has_safe_headers_and_asset_scope(self) -> None:
        config = json.loads((REPO_ROOT / "vercel.json").read_text(encoding="utf-8"))
        headers = [header for rule in config["headers"] for header in rule["headers"]]
        self.assertFalse(any(header["key"].lower() == "access-control-allow-origin" for header in headers))
        csp = next(header["value"] for header in headers if header["key"] == "Content-Security-Policy")
        self.assertIn("https://unpkg.com", csp)
        self.assertIn("frame-ancestors 'none'", csp)
        immutable = [rule for rule in config["headers"] if any("immutable" in header["value"] for header in rule["headers"])]
        self.assertTrue(any("revisions" in rule["source"] for rule in immutable))
        self.assertTrue(any(":hash" in rule["source"] for rule in immutable))
        aliases = {"/", "/properties/index.json", "/properties/:property/property.json", "/properties/:property/model.glb"}
        for rule in config["headers"]:
            if rule["source"] in aliases:
                self.assertTrue(any("must-revalidate" in header["value"] for header in rule["headers"]))

        rules = IgnoreRules.from_root(REPO_ROOT)
        self.assertTrue(rules.ignores("viewer/private-house-model.glb"))
        self.assertTrue(rules.ignores("data/raw/survey.las"))
        self.assertFalse(rules.ignores("properties/demo/model.glb"))


if __name__ == "__main__":
    unittest.main()
