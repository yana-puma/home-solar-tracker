import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PROPERTY_CONFIG,
  loadPropertyConfig,
  resolvePropertyConfigUrl,
  validatePropertyConfig,
} from '../src/property-config.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('the built-in demo satisfies schema version 1 with private defaults', () => {
  const result = validatePropertyConfig(DEFAULT_PROPERTY_CONFIG);

  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.deepEqual(result.errors, []);
  assert.equal(result.config.schemaVersion, 1);
  assert.equal(result.config.slug, 'demo');
  assert.equal(result.config.location.showExactLocation, false);
  assert.equal(result.config.privacy.showAddress, false);
  assert.doesNotMatch(result.config.location.displayLabel, /\d+\s+\w+\s+(street|st|road|rd|avenue|ave)\b/i);
});

test('privacy flags default to false and explicit disclosure produces a warning', () => {
  const missingFlags = clone(DEFAULT_PROPERTY_CONFIG);
  delete missingFlags.location.showExactLocation;
  missingFlags.privacy = {};

  const privateResult = validatePropertyConfig(missingFlags);
  assert.equal(privateResult.valid, true, privateResult.errors.join('\n'));
  assert.equal(privateResult.config.location.showExactLocation, false);
  assert.equal(privateResult.config.privacy.showAddress, false);
  assert.equal(privateResult.warnings.some((warning) => /reveal precise/i.test(warning)), false);

  const publicResult = validatePropertyConfig({
    ...missingFlags,
    location: { ...missingFlags.location, showExactLocation: true },
  });
  assert.equal(publicResult.valid, true, publicResult.errors.join('\n'));
  assert.match(publicResult.warnings.join(' '), /reveal precise property information/i);
});

test('property selectors and explicit configs are same-origin by default', () => {
  const baseUrl = 'https://solar.example/app/';

  assert.equal(
    resolvePropertyConfigUrl('?property=garden-demo', baseUrl),
    'https://solar.example/app/properties/garden-demo/property.json',
  );
  assert.equal(
    resolvePropertyConfigUrl('?property=friends/alice', baseUrl),
    'https://solar.example/app/properties/friends/alice/property.json',
  );
  assert.equal(
    resolvePropertyConfigUrl('?config=./shared/property.json', baseUrl),
    'https://solar.example/app/shared/property.json',
  );
  assert.equal(
    resolvePropertyConfigUrl('?config=/shared/property.json', baseUrl),
    'https://solar.example/shared/property.json',
  );
  assert.equal(
    resolvePropertyConfigUrl('?config=https://solar.example/config/property.json', baseUrl),
    'https://solar.example/config/property.json',
  );

  for (const search of [
    '?property=../private',
    '?property=friends/%2e%2e/private',
    '?property=.',
    '?config=javascript:alert(1)',
    '?config=data:application/json,%7B%7D',
    '?config=file:///tmp/property.json',
    '?config=blob:https://solar.example/id',
    '?config=https://cdn.example/garden.json',
    '?config=https://user:secret@solar.example/property.json',
    '?config=../shared/property.json',
    '?config=https://solar.example/app/../private/property.json',
    '?config=https://solar.example/%252e%252e/private/property.json',
    '?config=https://solar.example/%25252525252e%25252525252e/private/property.json',
    '?config=https://solar.example/%255cprivate/property.json',
  ]) {
    assert.throws(
      () => resolvePropertyConfigUrl(search, baseUrl),
      /property must be a relative slug|Unsupported configuration URL scheme|Cross-origin configuration host|embedded credentials|path traversal/,
      search,
    );
  }
});

test('remote explicit configs require an exact caller-owned HTTPS host allowlist', () => {
  const baseUrl = 'https://solar.example/app/';
  const options = { allowedHosts: ['cdn.example', 'assets.example:8443'] };

  assert.equal(
    resolvePropertyConfigUrl('?config=https://cdn.example/garden.json', baseUrl, options),
    'https://cdn.example/garden.json',
  );
  assert.equal(
    resolvePropertyConfigUrl('?config=https://assets.example:8443/garden.json', baseUrl, options),
    'https://assets.example:8443/garden.json',
  );
  for (const search of [
    '?config=http://cdn.example/garden.json',
    '?config=https://sub.cdn.example/garden.json',
    '?config=https://assets.example/garden.json',
    '?config=https://cdn.example.evil.test/garden.json',
  ]) {
    assert.throws(
      () => resolvePropertyConfigUrl(search, baseUrl, options),
      /Cross-origin configuration host is not allowed/,
      search,
    );
  }
  assert.throws(
    () => resolvePropertyConfigUrl('?config=https://cdn.example/garden.json', baseUrl, { allowedHosts: ['https://cdn.example'] }),
    /Invalid allowed HTTPS host/,
  );
  assert.throws(
    () => resolvePropertyConfigUrl('?property=demo', baseUrl, { allowedHosts: 'cdn.example' }),
    /allowedHosts must be an array/,
  );
});

test('loadPropertyConfig forwards the explicit remote host allowlist without sending credentials', async () => {
  const originalFetch = globalThis.fetch;
  const property = clone(DEFAULT_PROPERTY_CONFIG);
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => property };
  };
  try {
    const result = await loadPropertyConfig({
      search: '?config=https://cdn.example/package/property.json',
      baseUrl: 'https://solar.example/viewer/',
      allowedHosts: ['cdn.example'],
    });
    assert.equal(request.url, 'https://cdn.example/package/property.json');
    assert.equal(request.options.credentials, 'same-origin');
    assert.equal(result.url, request.url);
    assert.equal(result.config.model.url, 'https://cdn.example/package/model.glb');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loaded configurations resolve the model relative to property.json and preserve its source path', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  const property = clone(DEFAULT_PROPERTY_CONFIG);
  property.slug = 'roof-study';
  property.model.url = '../models/roof.glb';

  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => property };
  };

  try {
    const result = await loadPropertyConfig({
      search: '?property=roof-study',
      baseUrl: 'https://solar.example/viewer/',
    });

    assert.equal(request.url, 'https://solar.example/viewer/properties/roof-study/property.json');
    assert.equal(request.options.credentials, 'same-origin');
    assert.equal(result.url, request.url);
    assert.equal(result.config.slug, 'roof-study');
    assert.equal(result.config.model.sourceUrl, '../models/roof.glb');
    assert.equal(result.config.model.url, 'https://solar.example/viewer/properties/models/roof.glb');
    assert.deepEqual(result.warnings, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetch and validation failures return the privacy-safe built-in demo', async () => {
  const originalFetch = globalThis.fetch;
  const invalid = { schemaVersion: 99, title: '' };

  try {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => invalid });
    const invalidResult = await loadPropertyConfig({
      search: '?property=broken',
      baseUrl: 'https://solar.example/',
    });
    assert.deepEqual(invalidResult.config, DEFAULT_PROPERTY_CONFIG);
    assert.equal(invalidResult.config.location.showExactLocation, false);
    assert.equal(invalidResult.config.privacy.showAddress, false);
    assert.match(invalidResult.warnings.join(' '), /invalid.*built-in demo/i);

    globalThis.fetch = async () => ({ ok: false, status: 404 });
    const missingResult = await loadPropertyConfig({
      search: '?property=missing',
      baseUrl: 'https://solar.example/',
    });
    assert.deepEqual(missingResult.config, DEFAULT_PROPERTY_CONFIG);
    assert.match(missingResult.warnings.join(' '), /failed \(404\).*built-in demo/i);

    let called = false;
    globalThis.fetch = async () => { called = true; throw new Error('should not fetch'); };
    const unsafeResult = await loadPropertyConfig({
      search: '?config=javascript:alert(1)',
      baseUrl: 'https://solar.example/',
    });
    assert.equal(called, false);
    assert.equal(unsafeResult.url, null);
    assert.deepEqual(unsafeResult.config, DEFAULT_PROPERTY_CONFIG);
    assert.match(unsafeResult.warnings.join(' '), /Unsupported configuration URL scheme.*built-in demo/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('bounds, terrain, cameras, and zones normalize numeric strings', () => {
  const property = clone(DEFAULT_PROPERTY_CONFIG);
  property.scene.groundBounds = ['-12.5', '-8', '16', '21.5'];
  property.scene.terrainProfile = [['-8', '0.25'], ['21.5', '1.75']];
  property.scene.cameraPresets = {
    entry: { label: 'Entry', position: ['4', '5', '6'], target: ['0', '1', '2'] },
  };
  property.zones = [
    { id: 'Kitchen-Garden', title: 'Kitchen garden', position: ['2.5', '0', '-3'] },
  ];

  const result = validatePropertyConfig(property);

  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.deepEqual(result.config.scene.groundBounds, { minX: -12.5, minZ: -8, maxX: 16, maxZ: 21.5 });
  assert.deepEqual(result.config.scene.terrainProfile, [[-8, 0.25], [21.5, 1.75]]);
  assert.deepEqual(result.config.scene.cameraPresets.entry, {
    label: 'Entry', position: [4, 5, 6], target: [0, 1, 2],
  });
  assert.deepEqual(result.config.zones, [
    { id: 'kitchen-garden', title: 'Kitchen garden', position: [2.5, 0, -3] },
  ]);
  assert.match(result.warnings.join(' '), /groundBounds array syntax was converted/i);
});

test('invalid scene collections report errors and normalize to safe usable values', () => {
  const property = clone(DEFAULT_PROPERTY_CONFIG);
  property.scene.groundBounds = { minX: 10, minZ: 2, maxX: -10, maxZ: 2 };
  property.scene.terrainProfile = [[0, 1], ['bad', 2]];
  property.scene.cameraPresets = {
    'Bad Preset': { label: 'Bad', position: [1, 2, 3], target: [0, 0, 0] },
    overview: { label: 'Overview', position: [1, 2], target: [0, 0, 0] },
  };
  property.zones = [
    { id: 'garden', title: 'Garden', position: [1, 0, 2] },
    { id: 'garden', title: 'Duplicate', position: [2, 0, 3] },
    { id: 'patio', title: 'Patio', position: [1, 'bad', 2] },
  ];

  const result = validatePropertyConfig(property);

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /minimums must be smaller/);
  assert.match(result.errors.join(' '), /terrainProfile\[1\]/);
  assert.match(result.errors.join(' '), /Bad Preset/);
  assert.match(result.errors.join(' '), /unique slug/);
  assert.deepEqual(result.config.scene.groundBounds, DEFAULT_PROPERTY_CONFIG.scene.groundBounds);
  assert.deepEqual(result.config.scene.terrainProfile, [[0, 1]]);
  assert.deepEqual(result.config.scene.cameraPresets.overview.position, DEFAULT_PROPERTY_CONFIG.scene.cameraPresets.overview.position);
  assert.deepEqual(result.config.zones.map((zone) => zone.id), ['garden', 'patio']);
  assert.deepEqual(result.config.zones[1].position, [0, 0, 0]);
});

test('invalid units and excessive exposure intervals are rejected and normalized', () => {
  const property = clone(DEFAULT_PROPERTY_CONFIG);
  property.model.units = 'yards';
  property.solar.samplingMinutes = 121;
  property.solar.exposureMethod = 'magic';

  const result = validatePropertyConfig(property);

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /model\.units/);
  assert.match(result.errors.join(' '), /between 1 and 120/);
  assert.match(result.errors.join(' '), /exposureMethod/);
  assert.equal(result.config.model.units, DEFAULT_PROPERTY_CONFIG.model.units);
  assert.equal(result.config.solar.samplingMinutes, DEFAULT_PROPERTY_CONFIG.solar.samplingMinutes);
  assert.equal(result.config.solar.exposureMethod, DEFAULT_PROPERTY_CONFIG.solar.exposureMethod);
});
