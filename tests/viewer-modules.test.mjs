import test from 'node:test';
import assert from 'node:assert/strict';

import { appBaseFromDocument } from '../src/viewer/bootstrap.js';
import { prefersReducedMotion, viewerStateAnnouncement } from '../src/viewer/accessibility.js';
import { modelTriangleSoup } from '../src/viewer/exposure-controller.js';
import { cameraPreset, publicPropertyLabel, resolveModelUrl } from '../src/viewer/property-scene.js';
import { DEFAULT_MARKER_RADIUS, sunMarkerPosition } from '../src/viewer/sun-markers.js';
import { mergeViewerShareState } from '../src/viewer/ui-state.js';

test('both static entry documents resolve the same application base', () => {
  assert.equal(appBaseFromDocument('https://example.test/index.html').href, 'https://example.test/');
  assert.equal(appBaseFromDocument('https://example.test/viewer/index.html').href, 'https://example.test/');
  assert.equal(appBaseFromDocument('https://example.test/viewer/').href, 'https://example.test/');
});

test('sun markers use the doubled radius and north-oriented coordinates', () => {
  assert.equal(DEFAULT_MARKER_RADIUS, 26);
  const eastHorizon = sunMarkerPosition({ altitude: 0, azimuth: 90 });
  assert.ok(Math.abs(eastHorizon.x + 26) < 1e-10);
  assert.ok(Math.abs(eastHorizon.z) < 1e-10);
  assert.equal(eastHorizon.y, 2.5);
  const noon = sunMarkerPosition({ altitude: 90, azimuth: 180 });
  assert.ok(noon.y > eastHorizon.y);
});

test('property scene helpers retain privacy-safe labels and config-relative models', () => {
  const privateProperty = {
    title: 'Private house title',
    location: { displayLabel: 'Northern Virginia', precision: 'regional' },
    scene: { cameraPresets: { iso: { label: 'Orbit', position: [1, 2, 3] } } },
  };
  assert.equal(publicPropertyLabel(privateProperty), 'Northern Virginia');
  assert.equal(
    resolveModelUrl({ model: { url: 'model.glb' } }, { configUrl: 'https://example.test/properties/demo/property.json' }),
    'https://example.test/properties/demo/model.glb',
  );
  assert.deepEqual(
    cameraPreset(privateProperty, 'iso', { target: [0, 0, 0] }),
    { target: [0, 0, 0], label: 'Orbit', position: [1, 2, 3] },
  );
});

test('triangle soup applies mesh world transforms without Three.js globals', () => {
  const mesh = {
    isMesh: true,
    visible: true,
    geometry: {
      attributes: {
        position: {
          itemSize: 3,
          count: 3,
          getX: (index) => [0, 1, 0][index],
          getY: (index) => [0, 0, 1][index],
          getZ: () => 0,
        },
      },
      index: null,
    },
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1] },
  };
  const root = {
    updateMatrixWorld() {},
    traverse(callback) { callback(mesh); },
  };
  assert.deepEqual([...modelTriangleSoup(root)], [5, 6, 7, 6, 6, 7, 5, 7, 7]);
});

test('runtime values override parsed state while comparison dates survive', () => {
  assert.deepEqual(
    mergeViewerShareState(
      { property: 'demo', compareDates: ['2026-12-21'], view: 'street' },
      { property: 'demo', revision: '2', view: 'iso' },
    ),
    { property: 'demo', revision: '2', compareDates: ['2026-12-21'], view: 'iso' },
  );
});

test('accessibility announcements describe state without relying on color', () => {
  const state = {
    date: '2026-12-21',
    view: 'rear',
    markers: 'off',
    compass: 'on',
    map: 'calculated',
    selectedZone: 'patio',
    playbackSpeed: 4,
    playing: false,
  };
  assert.equal(viewerStateAnnouncement(state, 'date'), 'Study date changed to 2026-12-21.');
  assert.equal(viewerStateAnnouncement(state, 'markers'), 'Hourly sun markers hidden.');
  assert.equal(viewerStateAnnouncement(state, 'map'), 'Sun map calculated mode shown.');
  assert.equal(viewerStateAnnouncement(state, 'zone'), 'Selected zone patio.');
});

test('reduced-motion detection is safe with and without matchMedia', () => {
  assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(prefersReducedMotion({}), false);
});
