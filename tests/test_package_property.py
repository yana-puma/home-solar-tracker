import hashlib
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from package_property import create_property_package  # noqa: E402


def glb_document(document):
    payload = json.dumps(document, separators=(",", ":")).encode("utf-8")
    payload += b" " * ((-len(payload)) % 4)
    total_length = 12 + 8 + len(payload)
    return struct.pack("<III", 0x46546C67, 2, total_length) + struct.pack("<II", len(payload), 0x4E4F534A) + payload


class CreatePropertyPackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.model = self.root / "source.glb"
        self.model.write_bytes(b"dummy glb fixture")
        self.properties = self.root / "properties"

    def tearDown(self):
        self.temporary_directory.cleanup()

    def create(self, **overrides):
        values = {
            "slug": "garden-demo",
            "title": "Garden Solar Study",
            "model": self.model,
            "latitude": 38.8,
            "longitude": -77.2,
            "time_zone": "America/New_York",
            "display_label": "Northern Virginia",
            "output_root": self.properties,
        }
        values.update(overrides)
        return create_property_package(**values)

    def test_creates_portable_package_and_copies_model(self):
        package = self.create()

        self.assertEqual(package, self.properties / "garden-demo")
        self.assertEqual((package / "model.glb").read_bytes(), self.model.read_bytes())
        config = json.loads((package / "property.json").read_text(encoding="utf-8"))
        self.assertEqual(config["slug"], "garden-demo")
        self.assertEqual(config["model"]["url"], "model.glb")
        self.assertEqual(config["location"]["timeZone"], "America/New_York")
        manifest = json.loads((package / "package-manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["privacy"]["mode"], "local")
        self.assertNotIn("latitude", json.dumps(manifest).lower())
        self.assertNotIn("longitude", json.dumps(manifest).lower())

    def test_privacy_defaults_do_not_publish_an_address(self):
        package = create_property_package(
            slug="private-demo",
            title="Private Solar Study",
            model=self.model,
            latitude=0,
            longitude=0,
            time_zone="UTC",
            output_root=self.properties,
        )
        config = json.loads((package / "property.json").read_text(encoding="utf-8"))

        self.assertEqual(config["location"]["displayLabel"], "Private property")
        self.assertFalse(config["location"]["showExactLocation"])
        self.assertFalse(config["privacy"]["showAddress"])
        self.assertNotIn("streetAddress", config["location"])

    def test_refuses_to_overwrite_an_existing_package(self):
        package = self.create()
        original_config = (package / "property.json").read_bytes()

        with self.assertRaisesRegex(FileExistsError, "already exists"):
            self.create(title="Replacement")

        self.assertEqual((package / "property.json").read_bytes(), original_config)

    def test_validates_model_location_timezone_and_transform(self):
        with self.assertRaisesRegex(ValueError, "existing .glb"):
            self.create(model=self.root / "missing.glb")
        with self.assertRaisesRegex(ValueError, "latitude"):
            self.create(latitude=91)
        with self.assertRaisesRegex(ValueError, "valid IANA"):
            self.create(time_zone="Somewhere/Imaginary")
        with self.assertRaisesRegex(ValueError, "scale must be positive"):
            self.create(scale=0)
        with self.assertRaisesRegex(ValueError, "north_offset"):
            self.create(north_offset=361)

    def test_public_rounded_requires_license_acknowledgement_and_rounds_coordinates(self):
        self.model.write_bytes(glb_document({"asset": {"version": "2.0"}, "scenes": [{}], "scene": 0}))
        with self.assertRaisesRegex(ValueError, "redistributed"):
            self.create(privacy_mode="public-rounded")

        package = self.create(
            slug="rounded-study",
            privacy_mode="public-rounded",
            coordinate_decimals=2,
            acknowledge_license=True,
            latitude=40.12345,
            longitude=-105.67891,
        )
        config = json.loads((package / "property.json").read_text(encoding="utf-8"))
        manifest = json.loads((package / "package-manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(config["location"]["latitude"], 40.12)
        self.assertEqual(config["location"]["longitude"], -105.68)
        self.assertEqual(config["privacy"]["mode"], "public-rounded")
        self.assertEqual(manifest["privacy"]["coordinateHandling"], "rounded-2-decimals")
        manifest_text = json.dumps(manifest)
        self.assertNotIn("40.12", manifest_text)
        self.assertNotIn("-105.68", manifest_text)
        self.assertNotIn("Northern Virginia", manifest_text)

    def test_public_exact_requires_location_and_license_acknowledgements(self):
        self.model.write_bytes(glb_document({"asset": {"version": "2.0"}, "scenes": [{}], "scene": 0}))
        with self.assertRaisesRegex(ValueError, "exact coordinates"):
            self.create(privacy_mode="public-exact", acknowledge_license=True)
        with self.assertRaisesRegex(ValueError, "redistributed"):
            self.create(privacy_mode="public-exact", acknowledge_exact_location=True)

        package = self.create(
            slug="exact-study",
            privacy_mode="public-exact",
            acknowledge_license=True,
            acknowledge_exact_location=True,
        )
        manifest = json.loads((package / "package-manifest.json").read_text(encoding="utf-8"))
        self.assertTrue(manifest["privacy"]["exactLocationAcknowledged"])
        self.assertTrue(manifest["license"]["redistributionAcknowledged"])

    def test_public_preflight_blocks_address_labels_and_sensitive_glb_metadata(self):
        self.model.write_bytes(glb_document({
            "asset": {"version": "2.0", "extras": {"parcel": "1042-88"}},
            "nodes": [{"name": "123 Fictional Example Road"}],
            "images": [{"bufferView": 0, "mimeType": "image/jpeg"}],
        }))
        with self.assertRaisesRegex(ValueError, "street address"):
            self.create(
                privacy_mode="public-rounded",
                acknowledge_license=True,
                display_label="123 Fictional Example Road",
            )
        with self.assertRaisesRegex(ValueError, "GLB metadata"):
            self.create(
                slug="metadata-study",
                privacy_mode="public-rounded",
                acknowledge_license=True,
            )

    def test_allowlist_rejects_raw_source_assets(self):
        with self.assertRaisesRegex(ValueError, "raw source asset"):
            self.create(asset_allowlist=["survey.geojson"])

    def test_optional_sha256_manifest_hashes_public_assets(self):
        model_bytes = glb_document({"asset": {"version": "2.0"}, "scenes": [{}], "scene": 0})
        self.model.write_bytes(model_bytes)
        package = self.create(slug="hashed-study", include_sha256_manifest=True)
        manifest = json.loads((package / "package-manifest.json").read_text(encoding="utf-8"))
        assets = {entry["path"]: entry for entry in manifest["assets"]}
        self.assertEqual(assets["model.glb"]["sha256"], hashlib.sha256(model_bytes).hexdigest())
        expected_config_hash = hashlib.sha256((package / "property.json").read_bytes()).hexdigest()
        self.assertEqual(assets["property.json"]["sha256"], expected_config_hash)


if __name__ == "__main__":
    unittest.main()
