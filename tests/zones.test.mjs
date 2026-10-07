import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  adaptV1PropertyConfig,
  validatePropertyConfig,
  ZONE_GEOMETRY_TYPES,
  ZONE_PURPOSES,
} from '../src/property-config.js';

const fixtureUrl = new URL('./fixtures/properties/valid-v2.json', import.meta.url);

async function baseV2() {
  const config = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  config.zones = [];
  return config;
}

test('zone geometry and purpose enums expose the normalized viewer contract', () => {
  assert.deepEqual(ZONE_GEOMETRY_TYPES, ['point', 'rectangle', 'polygon']);
  assert.deepEqual(ZONE_PURPOSES, ['general', 'garden', 'patio', 'window', 'pv']);
});

test('configurator exposes an accessible numeric decision-zone editor', async () => {
  const html = await readFile(new URL('../configure/index.html', import.meta.url), 'utf8');

  assert.match(html, /<fieldset aria-describedby="zone-guidance"><legend>Decision zones<\/legend>/);
  assert.match(html, /id="add-zone" type="button">Add decision zone/);
  assert.match(html, /id="zone-list"[^>]*role="list"[^>]*aria-live="polite"/);
  assert.match(html, /X runs east\/west.*Z runs north\/south.*elevation is viewer Y/);
  assert.match(html, /Vertex \$\{vertexIndex\+1\} X/);
  assert.match(html, /Minimum daily sun hours/);
  assert.match(html, /calculateNorthOffset, validateSceneCalibration.*model-calibration\.js/);
  assert.match(html, /id="apply-north-reference"[^>]*>Calculate and apply north offset/);
  assert.match(html, /id="calibration-qa-label"/);
});

test('v1 point zones retain legacy config and gain additive runtime geometry', async () => {
  const legacy = {
    schemaVersion: 1,
    slug: 'legacy-zones',
    title: 'Legacy zones',
    location: {
      latitude: 38.9,
      longitude: -77,
      timeZone: 'America/New_York',
      displayLabel: 'Mid-Atlantic example',
      showExactLocation: false,
    },
    model: { url: './model.glb', units: 'meters', scale: 1, northOffsetDegrees: 0, position: [0, 0, 0] },
    scene: {
      groundBounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
      terrainProfile: [],
      cameraPresets: { overview: { position: [10, 10, 10], target: [0, 0, 0] } },
    },
    zones: [{ id: 'bench', title: 'Bench', position: ['2', '1.5', '-4'] }],
    solar: { defaultDate: 'today', samplingMinutes: 15, exposureMethod: 'estimated' },
    privacy: { showAddress: false },
  };
  const result = validatePropertyConfig(legacy);
  const adapted = adaptV1PropertyConfig(legacy);

  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.deepEqual(result.config.zones[0], { id: 'bench', title: 'Bench', position: [2, 1.5, -4] });
  assert.deepEqual(result.runtimeConfig.zones[0], {
    id: 'bench',
    title: 'Bench',
    purpose: 'general',
    surface: 'ground',
    elevation: 1.5,
    position: [2, 1.5, -4],
    geometry: { type: 'point', x: 2, z: -4 },
    sunlightThresholds: {},
  });
  assert.deepEqual(adapted.config.zones, result.runtimeConfig.zones);
});

test('legacy v2 position zones normalize into a stable point shape', async () => {
  const config = await baseV2();
  config.zones = [{ id: 'patio-seat', title: 'Patio seat', position: [2, 0.25, 8] }];
  const result = validatePropertyConfig(config);

  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.deepEqual(result.config.zones[0], {
    id: 'patio-seat',
    title: 'Patio seat',
    purpose: 'general',
    surface: 'ground',
    elevation: 0.25,
    position: [2, 0.25, 8],
    geometry: { type: 'point', x: 2, z: 8 },
    sunlightThresholds: {},
  });
});

test('point, rectangle, and polygon zones normalize with stable representatives and thresholds', async () => {
  const config = await baseV2();
  config.zones = [
    {
      id: 'south-window',
      title: 'South window',
      purpose: 'window',
      surface: 'facade',
      elevation: 2.4,
      geometry: { type: 'point', x: 3, z: -1 },
      sunlightThresholds: {
        minimumDailyHours: 3.5,
        preferredTimeWindow: { start: '09:00', end: '14:30' },
      },
    },
    {
      id: 'garden-bed',
      title: 'Garden bed',
      purpose: 'garden',
      surface: 'raised-bed',
      elevation: 0.6,
      geometry: { type: 'rectangle', minX: -4, maxX: 2, minZ: 5, maxZ: 9 },
      sunlightThresholds: { minimumDailyHours: 6 },
    },
    {
      id: 'roof-array',
      title: 'Roof array',
      purpose: 'pv',
      surface: 'roof',
      elevation: 7,
      geometry: { type: 'polygon', vertices: [[0, 0], [4, 0], [4, 2], [0, 2]] },
    },
  ];
  const result = validatePropertyConfig(config);

  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.deepEqual(result.config.zones[0].position, [3, 2.4, -1]);
  assert.deepEqual(result.config.zones[0].sunlightThresholds, {
    minimumDailyHours: 3.5,
    preferredTimeWindow: { start: '09:00', end: '14:30' },
  });
  assert.deepEqual(result.config.zones[1].geometry, {
    type: 'rectangle', minX: -4, maxX: 2, minZ: 5, maxZ: 9,
  });
  assert.deepEqual(result.config.zones[1].position, [-1, 0.6, 7]);
  assert.deepEqual(result.config.zones[2].position, [2, 7, 1]);
  assert.deepEqual(result.config.zones[2].sunlightThresholds, {});
});

test('a repeated closing polygon vertex is removed in the runtime shape', async () => {
  const config = await baseV2();
  config.zones = [{
    id: 'closed-shape',
    title: 'Closed shape',
    geometry: { type: 'polygon', vertices: [[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]] },
  }];
  const result = validatePropertyConfig(config);

  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.config.zones[0].geometry.vertices.length, 4);
  assert.deepEqual(result.config.zones[0].position, [2, 0, 1]);
});

test('zone validation rejects invalid bounds, self-intersection, duplicate IDs, and non-finite values', async () => {
  const config = await baseV2();
  config.zones = [
    { id: 'duplicate', title: 'First', geometry: { type: 'point', x: Number.NaN, z: 0 } },
    { id: 'duplicate', title: 'Second', geometry: { type: 'rectangle', minX: 2, maxX: 2, minZ: 0, maxZ: 1 } },
    {
      id: 'bow-tie',
      title: 'Bow tie',
      geometry: { type: 'polygon', vertices: [[0, 0], [2, 2], [0, 2], [2, 0]] },
    },
  ];
  const result = validatePropertyConfig(config);
  const errors = result.errors.join(' ');

  assert.equal(result.valid, false);
  assert.match(errors, /zones\[0\]\.geometry\.x must be a finite number/);
  assert.match(errors, /zones\[1\]\.id must be a unique lowercase slug/);
  assert.match(errors, /non-self-intersecting|non-zero area/);

  const rectangle = await baseV2();
  rectangle.zones = [{
    id: 'bad-bounds', title: 'Bad bounds', geometry: { type: 'rectangle', minX: 4, maxX: 1, minZ: 0, maxZ: 2 },
  }];
  const rectangleResult = validatePropertyConfig(rectangle);
  assert.equal(rectangleResult.valid, false);
  assert.match(rectangleResult.errors.join(' '), /minimums must be smaller than maximums/);
});

test('zone nested objects retain schema-v2 unknown-field strictness', async () => {
  const config = await baseV2();
  config.zones = [{
    id: 'strict-zone',
    title: 'Strict zone',
    owner: 'private',
    geometry: { type: 'rectangle', minX: 0, maxX: 2, minZ: 0, maxZ: 2, radius: 4 },
    sunlightThresholds: {
      minimumDailyHours: 25,
      confidence: 0.9,
      preferredTimeWindow: { start: '15:00', end: '09:00', timezone: 'UTC' },
    },
  }];
  const result = validatePropertyConfig(config);
  const errors = result.errors.join(' ');

  assert.equal(result.valid, false);
  assert.match(errors, /zones\[0\]\.owner is not allowed/);
  assert.match(errors, /zones\[0\]\.geometry\.radius is not allowed/);
  assert.match(errors, /sunlightThresholds\.confidence is not allowed/);
  assert.match(errors, /preferredTimeWindow\.timezone is not allowed/);
  assert.match(errors, /minimumDailyHours must be between 0 and 24/);
  assert.match(errors, /start must be earlier than end/);
});

test('an authored representative position must agree with its geometry', async () => {
  const config = await baseV2();
  config.zones = [{
    id: 'mismatch',
    title: 'Mismatch',
    elevation: 1,
    position: [99, 1, 99],
    geometry: { type: 'rectangle', minX: 0, maxX: 4, minZ: 0, maxZ: 2 },
  }];
  const result = validatePropertyConfig(config);

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /position must match the geometry representative/);
  assert.deepEqual(result.config.zones[0].position, [2, 1, 1]);
});
