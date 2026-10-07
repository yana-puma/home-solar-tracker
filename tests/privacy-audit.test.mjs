import assert from "node:assert/strict";
import test from "node:test";

import {
  auditPropertyPackage,
  inspectGlbMetadata,
  PRIVACY_MODES,
} from "../src/privacy-audit.js";
import {
  importPropertyJson,
  preparePropertyConfigForExport,
  preparePropertyExport,
} from "../src/property-io.js";

function baseConfig(overrides = {}) {
  const config = {
    schemaVersion: 1,
    slug: "garden-study",
    title: "Garden Solar Study",
    description: "A regional sunlight planning model.",
    location: {
      latitude: 40.12345,
      longitude: -105.67891,
      timeZone: "America/New_York",
      displayLabel: "Northern Virginia",
      showExactLocation: false,
    },
    model: { url: "model.glb", units: "meters", scale: 1, northOffsetDegrees: 0, position: [0, 0, 0] },
    scene: { groundBounds: { minX: -25, maxX: 25, minZ: -25, maxZ: 25 }, terrainProfile: [], cameraPresets: {} },
    zones: [],
    solar: { defaultDate: "today", samplingMinutes: 15, exposureMethod: "estimated" },
    privacy: { showAddress: false },
  };
  return {
    ...config,
    ...overrides,
    location: { ...config.location, ...(overrides.location || {}) },
    model: { ...config.model, ...(overrides.model || {}) },
    privacy: { ...config.privacy, ...(overrides.privacy || {}) },
  };
}

function glbDocument(document) {
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

const cleanGlb = () => glbDocument({ asset: { version: "2.0", generator: "Atlee package test" }, scenes: [{}], scene: 0 });

test("public exact export requires separate license and location acknowledgements", () => {
  const blocked = auditPropertyPackage({
    config: baseConfig(),
    assets: [{ path: "model.glb", data: cleanGlb() }],
    mode: PRIVACY_MODES.PUBLIC_EXACT,
    assetAllowlist: ["model.glb", "property.json", "package-manifest.json"],
  });
  assert.equal(blocked.publishable, false);
  assert.deepEqual(
    blocked.errors.map((item) => item.code).filter((code) => code.includes("acknowledgement")).sort(),
    ["exact_location_acknowledgement_required", "license_acknowledgement_required"],
  );

  const allowed = auditPropertyPackage({
    config: baseConfig(),
    assets: [{ path: "model.glb", data: cleanGlb() }],
    mode: PRIVACY_MODES.PUBLIC_EXACT,
    exactLocationAcknowledged: true,
    licenseAcknowledged: true,
    assetAllowlist: ["model.glb", "property.json", "package-manifest.json"],
  });
  assert.equal(allowed.publishable, true);
});

test("public rounded mode rejects address labels and unrounded coordinates", () => {
  const result = auditPropertyPackage({
    config: baseConfig({ location: { displayLabel: "123 Fictional Example Road" } }),
    mode: PRIVACY_MODES.PUBLIC_ROUNDED,
    coordinateDecimals: 2,
    licenseAcknowledged: true,
    assetAllowlist: ["model.glb", "property.json", "package-manifest.json"],
  });
  assert.equal(result.publishable, false);
  assert.ok(result.errors.some((item) => item.code === "address_like_label"));
  assert.equal(result.errors.filter((item) => item.code === "coordinates_not_rounded").length, 2);
});

test("preflight detects remote, traversal, raw-source, and non-allowlisted assets", () => {
  const result = auditPropertyPackage({
    config: baseConfig({ model: { url: "https://example.com/private/model.glb" } }),
    assets: [
      { path: "survey.geojson" },
      { path: "parcel-1042/model.glb", data: cleanGlb() },
      { path: "../outside.glb" },
    ],
    mode: PRIVACY_MODES.PUBLIC_ROUNDED,
    coordinateDecimals: 2,
    licenseAcknowledged: true,
    assetAllowlist: ["model.glb", "property.json", "package-manifest.json", "survey.geojson"],
  });
  const codes = new Set(result.errors.map((item) => item.code));
  assert.ok(codes.has("remote_asset"));
  assert.ok(codes.has("raw_source_allowlisted"));
  assert.ok(codes.has("raw_source_asset"));
  assert.ok(codes.has("asset_not_allowlisted"));
  assert.ok(codes.has("asset_path_unsafe"));
});

test("GLB inspection reports sensitive metadata and image cues", () => {
  const findings = inspectGlbMetadata(glbDocument({
    asset: { version: "2.0", extras: { parcel: "1042-88" } },
    nodes: [{ name: "123 Fictional Example Road" }],
    images: [{ name: "front-door-photo", bufferView: 0, mimeType: "image/jpeg" }],
  }), { mode: PRIVACY_MODES.PUBLIC_EXACT });
  const codes = new Set(findings.map((item) => item.code));
  assert.ok(codes.has("glb_sensitive_metadata_key"));
  assert.ok(codes.has("glb_address_metadata"));
  assert.ok(codes.has("glb_images_present"));
  assert.ok(findings.some((item) => item.severity === "error"));
});

test("property export rounds coordinates and creates a coordinate-free SHA-256 manifest", async () => {
  const model = cleanGlb();
  const result = await preparePropertyExport({
    config: baseConfig(),
    assets: [{ path: "model.glb", data: model, mediaType: "model/gltf-binary" }],
    mode: PRIVACY_MODES.PUBLIC_ROUNDED,
    coordinateDecimals: 2,
    licenseAcknowledged: true,
    includeSha256: true,
  });
  assert.equal(result.config.location.latitude, 40.12);
  assert.equal(result.config.location.longitude, -105.68);
  assert.equal(result.config.location.showExactLocation, false);
  assert.equal(result.config.privacy.showAddress, false);
  assert.equal(result.manifest.privacy.coordinateHandling, "rounded-2-decimals");
  assert.match(result.manifest.assets.find((asset) => asset.path === "model.glb").sha256, /^[a-f0-9]{64}$/);

  const manifestText = JSON.stringify(result.manifest);
  assert.doesNotMatch(manifestText, /40\.12|-105\.68|Northern Virginia|Garden Solar Study/);
  assert.doesNotMatch(manifestText, /latitude|longitude/i);
});

test("local preparation keeps coordinate precision but still hides address UI flags", () => {
  const prepared = preparePropertyConfigForExport(baseConfig({
    location: { showExactLocation: true },
    privacy: { showAddress: true },
  }), { mode: PRIVACY_MODES.LOCAL });
  assert.equal(prepared.location.latitude, 40.12345);
  assert.equal(prepared.location.showExactLocation, false);
  assert.equal(prepared.privacy.showAddress, false);
  assert.equal(prepared.privacy.mode, "local");
});

test("property import accepts local JSON but rejects unsafe keys and oversized input", async () => {
  const imported = await importPropertyJson(JSON.stringify(baseConfig()));
  assert.equal(imported.slug, "garden-study");
  assert.notEqual(imported, baseConfig());

  await assert.rejects(
    importPropertyJson('{"schemaVersion":1,"__proto__":{"polluted":true}}'),
    /Unsafe reserved key/,
  );
  await assert.rejects(importPropertyJson("{}", { maxBytes: 1 }), /size limit/);
});
