import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  adaptV1PropertyConfig,
  loadPropertyConfig,
  validatePropertyConfig,
} from '../src/property-config.js';

const fixtures = new URL('./fixtures/properties/', import.meta.url);

async function fixture(name) {
  return JSON.parse(await readFile(new URL(name, fixtures), 'utf8'));
}

test('the v2 JSON Schema is strict at every authored object boundary', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/property.schema.v2.json', import.meta.url), 'utf8'));

  assert.equal(schema.properties.schemaVersion.const, 2);
  assert.equal(schema.additionalProperties, false);
  for (const section of ['package', 'location', 'model', 'scene', 'solar', 'privacy', 'ui']) {
    assert.equal(schema.properties[section].additionalProperties, false, section);
  }
  for (const definition of [
    'groundBounds',
    'cameraPreset',
    'zone',
    'pointGeometry',
    'rectangleGeometry',
    'polygonGeometry',
    'sunlightThresholds',
    'timeWindow',
    'solarFeatures',
    'theme',
  ]) {
    assert.equal(schema.$defs[definition].additionalProperties, false, definition);
  }
  assert.deepEqual(schema.$defs.zone.properties.purpose.enum, ['general', 'garden', 'patio', 'window', 'pv']);
  assert.equal(schema.$defs.zoneGeometry.oneOf.length, 3);
  assert.equal(schema.properties.assets.items.additionalProperties, false);
});

test('a native v2 package validates and becomes the normalized runtime contract', async () => {
  const input = await fixture('valid-v2.json');
  const result = validatePropertyConfig(input);

  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.sourceSchemaVersion, 2);
  assert.equal(result.config, result.runtimeConfig);
  assert.equal(result.config.schemaVersion, 2);
  assert.deepEqual(result.config.package, input.package);
  assert.equal(result.config.slug, input.package.id);
  assert.equal(result.config.title, input.package.label);
  assert.equal(result.config.location.precision, 'regional');
  assert.equal(result.config.location.showExactLocation, false);
  assert.equal(result.config.model.assetId, 'house-model');
  assert.equal(result.config.model.url, './model.glb');
  assert.equal(result.config.assets[0].size, 428148);
  assert.match(result.config.assets[0].integrity, /^sha256-/);
  assert.equal(result.config.solar.features.annualStudy, true);
  assert.deepEqual(result.config.ui.theme, input.ui.theme);
  assert.deepEqual(result.config.scene.cameraPresets.overview.position, [38, 28, 38]);
  assert.deepEqual(result.config.zones[0].position, [2, 0, 8]);
  assert.deepEqual(result.config.zones[0].geometry, { type: 'point', x: 2, z: 8 });
  assert.equal(result.config.zones[0].purpose, 'general');
  assert.equal(result.config.zones[0].surface, 'ground');
});

test('schemaVersion 1 remains compatible and has an explicit v2 runtime adapter', async () => {
  const input = await fixture('valid-v1.json');
  const legacyResult = validatePropertyConfig(input);
  const adaptedResult = adaptV1PropertyConfig(input);

  assert.equal(legacyResult.valid, true, legacyResult.errors.join('\n'));
  assert.equal(legacyResult.config.schemaVersion, 1);
  assert.equal(legacyResult.runtimeConfig.schemaVersion, 2);
  assert.equal(legacyResult.runtimeConfig.sourceSchemaVersion, 1);
  assert.equal(legacyResult.runtimeConfig.package.id, input.slug);
  assert.equal(legacyResult.runtimeConfig.package.label, input.title);
  assert.equal(legacyResult.runtimeConfig.package.revision, 'legacy-v1');
  assert.equal(legacyResult.runtimeConfig.model.assetId, 'model');
  assert.equal(legacyResult.runtimeConfig.assets[0].url, input.model.url);
  assert.equal(legacyResult.runtimeConfig.location.precision, 'regional');
  assert.equal(legacyResult.runtimeConfig.solar.features.sunPath, true);
  assert.equal(adaptedResult.valid, true);
  assert.equal(adaptedResult.config.schemaVersion, 2);
  assert.deepEqual(adaptedResult.config, legacyResult.runtimeConfig);
});

test('v2 rejects unknown fields at top-level and nested boundaries', async () => {
  const result = validatePropertyConfig(await fixture('invalid-unknown-v2.json'));

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /configuration\.unexpected is not allowed/);
  assert.match(result.errors.join(' '), /package\.ownerEmail is not allowed/);
  assert.match(result.errors.join(' '), /assets\[0\]\.privatePath is not allowed/);
  assert.match(result.errors.join(' '), /scene\.groundBounds\.radius is not allowed/);
});

test('v2 does not silently coerce schema types or enum casing', async () => {
  const input = await fixture('valid-v2.json');
  input.package.id = 'Garden-Study';
  input.location.precision = 'Regional';
  input.model.units = 'Meters';
  input.model.position = ['0', 0, 0];
  input.solar.exposureMethod = 'Raycast';
  input.privacy.visibility = 'Unlisted';
  input.ui.theme.mode = 'Dark';

  const result = validatePropertyConfig(input);

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /package\.id.*lowercase slug/);
  assert.match(result.errors.join(' '), /location\.precision/);
  assert.match(result.errors.join(' '), /model\.units/);
  assert.match(result.errors.join(' '), /model\.position/);
  assert.match(result.errors.join(' '), /solar\.exposureMethod/);
  assert.match(result.errors.join(' '), /privacy\.visibility/);
  assert.match(result.errors.join(' '), /ui\.theme\.mode/);
});

test('v2 rejects unsafe schemes and encoded package traversal', async () => {
  const unsafe = validatePropertyConfig(await fixture('invalid-unsafe-url-v2.json'));
  const traversal = validatePropertyConfig(await fixture('invalid-traversal-v2.json'));

  assert.equal(unsafe.valid, false);
  assert.match(unsafe.errors.join(' '), /assets\[0\]\.url.*traversal-free relative path or http\(s\) URL/);
  assert.equal(traversal.valid, false);
  assert.match(traversal.errors.join(' '), /assets\[0\]\.url.*traversal-free relative path or http\(s\) URL/);

  const valid = await fixture('valid-v2.json');
  for (const url of [
    'data:model/gltf-binary,AA',
    'file:///tmp/model.glb',
    'blob:https://solar.example/id',
    '..\\private\\model.glb',
    '..%255cprivate%255cmodel.glb',
    '%252e%252e/private/model.glb',
    'https://user:secret@cdn.example/model.glb',
  ]) {
    const candidate = structuredClone(valid);
    candidate.assets[0].url = url;
    assert.equal(validatePropertyConfig(candidate).valid, false, url);
  }
});

test('v2 requires real IANA timezones and numeric in-range coordinates', async () => {
  const timezone = validatePropertyConfig(await fixture('invalid-timezone-v2.json'));
  const coordinates = validatePropertyConfig(await fixture('invalid-coordinates-v2.json'));

  assert.equal(timezone.valid, false);
  assert.match(timezone.errors.join(' '), /valid IANA timezone/);
  assert.equal(coordinates.valid, false);
  assert.match(coordinates.errors.join(' '), /latitude.*-90 and 90/);
  assert.match(coordinates.errors.join(' '), /longitude.*-180 and 180/);
});

test('a v2 document cannot silently downgrade by changing schemaVersion', async () => {
  const downgraded = validatePropertyConfig(await fixture('invalid-downgrade.json'));
  const future = await fixture('valid-v2.json');
  future.schemaVersion = 3;
  const unsupported = validatePropertyConfig(future);

  assert.equal(downgraded.valid, false);
  assert.equal(downgraded.sourceSchemaVersion, 1);
  assert.match(downgraded.errors.join(' '), /slug|title|model\.url/);
  assert.equal(unsupported.valid, false);
  assert.match(unsupported.errors.join(' '), /schemaVersion must be 1/);
});

test('loading v2 resolves model and manifest assets relative to the configuration', async () => {
  const originalFetch = globalThis.fetch;
  const input = await fixture('valid-v2.json');
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => input });

  try {
    const result = await loadPropertyConfig({
      search: '?property=garden-study',
      baseUrl: 'https://solar.example/viewer/',
    });

    assert.equal(result.sourceSchemaVersion, 2);
    assert.equal(result.config.model.sourceUrl, './model.glb');
    assert.equal(result.config.model.url, 'https://solar.example/viewer/properties/garden-study/model.glb');
    assert.equal(result.config.assets[0].sourceUrl, './model.glb');
    assert.equal(result.config.assets[0].url, 'https://solar.example/viewer/properties/garden-study/model.glb');
    assert.equal(result.config.assets[1].url, 'https://solar.example/viewer/properties/garden-study/preview.png');
    assert.deepEqual(result.runtimeConfig.assets, result.config.assets);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
