import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_PROPERTY_CONFIG, validatePropertyConfig } from "../src/property-config.js";
import {
  buildStoredZip,
  crc32,
  createConfiguratorPackage,
  importConfiguratorProperty,
  normalizeToAuthoredV2,
} from "../src/configurator-package.js";

function glbDocument(document = { asset: { version: "2.0" }, scenes: [{}], scene: 0 }) {
  const source = new TextEncoder().encode(JSON.stringify(document));
  const paddedLength = Math.ceil(source.length / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + paddedLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20);
  bytes.set(source, 20);
  return bytes;
}

function readStoredEntries(zip) {
  const entries = new Map();
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let offset = 0;
  while (offset + 4 <= zip.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const compression = view.getUint16(offset + 8, true);
    const checksum = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    assert.equal(compression, 0);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = new TextDecoder().decode(zip.subarray(nameStart, nameStart + nameLength));
    const data = zip.slice(dataStart, dataStart + size);
    assert.equal(crc32(data), checksum);
    entries.set(name, data);
    offset = dataStart + size;
  }
  return entries;
}

test("CRC-32 matches the canonical ZIP fixture", () => {
  assert.equal(crc32("123456789"), 0xcbf43926);
});

test("stored ZIP output is deterministic, sorted, traversal-safe, and CRC-valid", () => {
  const first = buildStoredZip([
    { path: "property.json", data: "{}\n" },
    { path: "model.glb", data: new Uint8Array([1, 2, 3]) },
  ]);
  const second = buildStoredZip([
    { path: "model.glb", data: new Uint8Array([1, 2, 3]) },
    { path: "property.json", data: "{}\n" },
  ]);
  assert.deepEqual(first, second);
  assert.deepEqual([...readStoredEntries(first).keys()], ["model.glb", "property.json"]);
  assert.throws(() => buildStoredZip([{ path: "../private.glb", data: "x" }]), /safe ZIP path/);
  assert.throws(() => buildStoredZip([{ path: "a", data: "1" }, { path: "a", data: "2" }]), /Duplicate/);
});

test("JSON import normalizes a legacy property into strict authored v2", async () => {
  const authored = await importConfiguratorProperty(JSON.stringify(DEFAULT_PROPERTY_CONFIG));
  assert.equal(authored.schemaVersion, 2);
  assert.equal(authored.package.id, DEFAULT_PROPERTY_CONFIG.slug);
  assert.equal(authored.package.revision, "legacy-v1");
  assert.equal(authored.model.assetId, "model");
  assert.equal(authored.location.precision, "regional");
  assert.equal(validatePropertyConfig(authored).valid, true);
});

test("complete package exports strict rounded v2 JSON, model, safe manifest, and README", async () => {
  const config = normalizeToAuthoredV2(DEFAULT_PROPERTY_CONFIG);
  config.package = {
    id: "garden-study",
    label: "Garden Solar Study",
    revision: "2026.08.24-1",
    description: "A regional solar package.",
  };
  config.location.latitude = 40.12345;
  config.location.longitude = -105.67891;
  config.location.displayLabel = "Northern Virginia";

  const result = await createConfiguratorPackage({
    config,
    model: { name: "private-source.glb", data: glbDocument() },
    mode: "public-rounded",
    coordinateDecimals: 2,
    licenseAcknowledged: true,
  });
  const entries = readStoredEntries(result.zip);
  assert.deepEqual([...entries.keys()], ["README.md", "manifest.json", "model.glb", "property.json"]);
  const property = JSON.parse(new TextDecoder().decode(entries.get("property.json")));
  assert.equal(property.schemaVersion, 2);
  assert.equal(property.location.latitude, 40.12);
  assert.equal(property.location.longitude, -105.68);
  assert.equal(property.location.precision, "rounded");
  assert.equal(property.privacy.visibility, "public");
  assert.equal(property.assets[0].url, "model.glb");
  assert.equal(property.assets[0].size, glbDocument().byteLength);
  assert.match(property.assets[0].integrity, /^sha256-/);
  assert.equal(validatePropertyConfig(property).valid, true);

  const manifestText = new TextDecoder().decode(entries.get("manifest.json"));
  assert.doesNotMatch(manifestText, /40\.12|-105\.68|Northern Virginia|Garden Solar Study/);
  assert.doesNotMatch(manifestText, /latitude|longitude/i);
  assert.match(result.filename, /^garden-study-2026\.08\.24-1\.zip$/);
});

test("JSON and ZIP normalization preserve authored decision-zone geometry and thresholds", async () => {
  const config = normalizeToAuthoredV2(DEFAULT_PROPERTY_CONFIG);
  config.zones = [
    {
      id: "kitchen-garden",
      title: "Kitchen garden",
      purpose: "garden",
      surface: "raised-bed",
      elevation: 0.5,
      geometry: { type: "rectangle", minX: -3, maxX: 3, minZ: 4, maxZ: 8 },
      sunlightThresholds: {
        minimumDailyHours: 6,
        preferredTimeWindow: { start: "09:00", end: "16:00" },
      },
    },
    {
      id: "pv-roof",
      title: "PV roof",
      purpose: "pv",
      surface: "roof",
      elevation: 6,
      geometry: { type: "polygon", vertices: [[0, 0], [4, 0], [4, 2], [0, 2]] },
    },
  ];

  const imported = await importConfiguratorProperty(JSON.stringify(config));
  assert.deepEqual(imported.zones[0].geometry, config.zones[0].geometry);
  assert.deepEqual(imported.zones[0].position, [0, 0.5, 6]);
  assert.deepEqual(imported.zones[1].position, [2, 6, 1]);

  const result = await createConfiguratorPackage({
    config,
    model: { name: "model.glb", data: glbDocument() },
    mode: "local",
  });
  const property = JSON.parse(new TextDecoder().decode(readStoredEntries(result.zip).get("property.json")));
  assert.equal(validatePropertyConfig(property).valid, true);
  assert.deepEqual(property.zones, imported.zones);
  assert.equal(property.zones[0].sunlightThresholds.minimumDailyHours, 6);
  assert.equal(property.zones[1].geometry.type, "polygon");
});

test("public exact package is blocked without both acknowledgements", async () => {
  const config = normalizeToAuthoredV2(DEFAULT_PROPERTY_CONFIG);
  await assert.rejects(createConfiguratorPackage({
    config,
    model: { name: "model.glb", data: glbDocument() },
    mode: "public-exact",
    licenseAcknowledged: true,
  }), /exact coordinates will be downloadable/);
  await assert.rejects(createConfiguratorPackage({
    config,
    model: { name: "model.glb", data: glbDocument() },
    mode: "public-exact",
    exactLocationAcknowledged: true,
  }), /redistributed/);
});

test("complete package rejects a non-GLB or unreadable model", async () => {
  const config = normalizeToAuthoredV2(DEFAULT_PROPERTY_CONFIG);
  await assert.rejects(createConfiguratorPackage({
    config,
    model: { name: "model.obj", data: "not glb" },
  }), /must be a \.glb|readable GLB/);
  await assert.rejects(createConfiguratorPackage({
    config,
    model: { name: "model.glb", data: "not glb" },
  }), /readable GLB/);
});
