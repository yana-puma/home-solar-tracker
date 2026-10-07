import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

import {
  MODEL_CALIBRATION_VERSION,
  assessModelGeometry,
  assessModelScale,
  calculateNorthOffset,
  calculateScaleFromDimension,
  convertLength,
  createCalibrationAssessment,
  createCalibrationRevisionInput,
  hashCalibrationRevision,
  solarNoonAlignmentGuidance,
  validateSceneCalibration,
} from '../src/model-calibration.js';

function codes(result, severity = null) {
  return new Set(result.findings
    .filter((item) => severity === null || item.severity === severity)
    .map((item) => item.code));
}

const MODEL_BOUNDS = Object.freeze({ min: [-5, 0, -6], max: [5, 8, 6] });

test('north offset uses the viewer -Z north and -X east convention', () => {
  const northLine = calculateNorthOffset({
    from: [0, 0, 0],
    to: [0, 0, -10],
    trueBearingDegrees: 28,
  });
  assert.equal(northLine.localBearingDegrees, 0);
  assert.equal(northLine.northOffsetDegrees, 28);
  assert.equal(northLine.distanceModelUnits, 10);

  const eastLine = calculateNorthOffset({
    from: { x: 2, z: 3 },
    to: { x: -8, z: 3 },
    trueBearingDegrees: 100,
  });
  assert.equal(eastLine.localBearingDegrees, 90);
  assert.equal(eastLine.northOffsetDegrees, 10);
});

test('north offset wraps deterministically and rejects degenerate evidence', () => {
  const result = calculateNorthOffset({ from: [0, 0], to: [10, 0], trueBearingDegrees: 350 });
  assert.equal(result.localBearingDegrees, 270);
  assert.equal(result.northOffsetDegrees, 80);
  assert.throws(
    () => calculateNorthOffset({ from: [1, 2], to: [1, 2], trueBearingDegrees: 0 }),
    /distinct horizontal positions/,
  );
  assert.throws(
    () => calculateNorthOffset({ from: [0, 0], to: [0, -1], trueBearingDegrees: 360 }),
    /less than 360/,
  );
  assert.throws(
    () => calculateNorthOffset({ from: [0, 0, 0], to: [0, Number.NaN, -1], trueBearingDegrees: 0 }),
    /finite/,
  );
});

test('length conversion and one-dimension scale solve are unit-aware', () => {
  assert.equal(convertLength(10, 'feet', 'meters'), 3.048);
  assert.equal(convertLength(250, 'centimeters', 'meters'), 2.5);
  const result = calculateScaleFromDimension({
    modelLength: 10,
    realLength: 3.048,
    modelUnits: 'feet',
    realUnits: 'meters',
  });
  assert.equal(result.recommendedScale, 0.3048);
  assert.equal(result.declaredUnitScale, 0.3048);
  assert.equal(result.scaleCorrectionFactor, 1);
  assert.throws(() => convertLength(1, 'yards', 'meters'), /one of/);
  assert.throws(() => calculateScaleFromDimension({ modelLength: 0, realLength: 1 }), /greater than zero/);
});

test('scale assessment recommends a robust median and labels tolerances', () => {
  const result = assessModelScale({
    modelUnits: 'meters',
    configuredScale: 1.01,
    dimensions: [
      { id: 'wall', modelLength: 10, realLength: 10, realUnits: 'meters' },
      { id: 'door', modelLength: 2, realLength: 2, realUnits: 'meters' },
    ],
  });
  assert.equal(result.status, 'pass');
  assert.equal(result.recommendedScale, 1);
  assert.equal(result.effectiveMetersPerModelUnit, 1.01);
  assert.deepEqual(codes(result), new Set(['dimension_scale_within_tolerance']));

  const drift = assessModelScale({
    modelUnits: 'meters',
    configuredScale: 1.05,
    dimensions: [{ id: 'wall', modelLength: 10, realLength: 10 }],
  });
  assert.equal(drift.status, 'review');
  assert.ok(codes(drift, 'warning').has('dimension_scale_drift'));

  const feet = assessModelScale({
    modelUnits: 'feet',
    configuredScale: 0.3048,
    dimensions: [{ id: 'wall', modelLength: 10, realLength: 3.048, realUnits: 'meters' }],
  });
  assert.equal(feet.status, 'pass');
  assert.equal(feet.recommendedScale, 0.3048);
  assert.equal(feet.scaleCorrectionFactor, 1);
});

test('scale assessment identifies mismatches and inconsistent evidence', () => {
  const result = assessModelScale({
    modelUnits: 'meters',
    configuredScale: 1,
    dimensions: [
      { id: 'wall', modelLength: 10, realLength: 10 },
      { id: 'roof', modelLength: 10, realLength: 14 },
    ],
  });
  assert.equal(result.status, 'fail');
  assert.ok(codes(result, 'error').has('dimension_scale_mismatch'));
  assert.ok(codes(result, 'error').has('inconsistent_reference_dimensions'));
  assert.throws(() => assessModelScale({ modelUnits: 'meters', configuredScale: 1, dimensions: [] }), /non-empty/);
  assert.throws(
    () => assessModelScale({ modelUnits: 'meters', configuredScale: 1, dimensions: [{ modelLength: '10', realLength: 10 }] }),
    /finite number/,
  );
});

test('model geometry reports physical bounds and triangle budgets', () => {
  const result = assessModelGeometry({
    bounds: MODEL_BOUNDS,
    units: 'meters',
    scale: 1,
    triangleCount: 21_148,
    vertexCount: 12_000,
    meshCount: 1,
  });
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.extentsMeters, { x: 10, y: 8, z: 12 });
  assert.ok(codes(result, 'info').has('triangle_budget_ok'));

  const feet = assessModelGeometry({
    bounds: MODEL_BOUNDS,
    units: 'feet',
    scale: 0.3048,
    triangleCount: 100,
  });
  assert.equal(feet.extentsMeters.x, 3.048);
  assert.equal(feet.declaredUnitScale, 0.3048);

  const heavy = assessModelGeometry({ bounds: MODEL_BOUNDS, triangleCount: 2_000_000 });
  assert.equal(heavy.status, 'fail');
  assert.ok(codes(heavy, 'error').has('triangle_budget_exceeded'));
});

test('missing geometry evidence is reviewable while malformed bounds fail strictly', () => {
  const result = assessModelGeometry({});
  assert.equal(result.status, 'review');
  assert.ok(codes(result, 'warning').has('model_bounds_missing'));
  assert.ok(codes(result, 'warning').has('triangle_count_missing'));
  assert.throws(
    () => assessModelGeometry({ bounds: { min: [0, 0, 0], max: [1, 0, 1] }, triangleCount: 1 }),
    /min\.y must be less/,
  );
  assert.throws(() => assessModelGeometry({ triangleCount: 1.5 }), /non-negative integer/);
});

test('scene QA accepts contained origin, terrain, model footprint, and cameras', () => {
  const result = validateSceneCalibration({
    origin: [0, 0, 0],
    groundBounds: { minX: -25, maxX: 25, minZ: -25, maxZ: 55 },
    terrainProfile: [[-25, 0], [55, 0]],
    modelBounds: MODEL_BOUNDS,
    modelScale: 1,
    cameraPresets: {
      overview: { position: [-28, 18, -16], target: [0, 2, 5] },
      top: { position: [0, 95, 15], target: [0, 0, 15] },
    },
  });
  assert.equal(result.status, 'pass');
  assert.ok(codes(result, 'info').has('origin_within_ground_bounds'));
  assert.ok(codes(result, 'info').has('terrain_coverage_complete'));
  assert.ok(codes(result, 'info').has('model_footprint_contained'));
  assert.equal(result.cameras.every((camera) => camera.positionContained && camera.targetContained), true);
});

test('scene QA reports incomplete terrain, misplaced geometry, and invalid cameras', () => {
  const result = validateSceneCalibration({
    origin: [30, 2, 0],
    groundBounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    terrainProfile: [[-5, 0], [5, 0]],
    modelBounds: MODEL_BOUNDS,
    cameraPresets: {
      bad: { position: [1000, 1000, 1000], target: [100, 0, 100] },
      degenerate: { position: [0, 0, 0], target: [0, 0, 0] },
    },
  });
  assert.equal(result.status, 'fail');
  const errors = codes(result, 'error');
  assert.ok(errors.has('origin_outside_ground_bounds'));
  assert.ok(errors.has('terrain_coverage_incomplete'));
  assert.ok(errors.has('model_footprint_outside_ground_bounds'));
  assert.ok(errors.has('model_ground_contact_error'));
  assert.ok(errors.has('camera_target_outside_scene'));
  assert.ok(errors.has('camera_position_equals_target'));
  assert.ok(codes(result, 'warning').has('camera_position_outside_envelope'));
  assert.throws(
    () => validateSceneCalibration({ origin: [0, 0, 0], groundBounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }, terrainProfile: [[0, 0], [0, 1]] }),
    /strictly increasing/,
  );
});

test('flat-ground and missing optional scene evidence remain explicit', () => {
  const result = validateSceneCalibration({
    origin: [0, 0, 0],
    groundBounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
  });
  assert.equal(result.status, 'review');
  assert.ok(codes(result, 'info').has('flat_ground_assumed'));
  assert.ok(codes(result, 'warning').has('scene_model_bounds_missing'));
  assert.ok(codes(result, 'warning').has('camera_presets_missing'));
});

test('calibration revision input is canonical and hashes reproducibly', async () => {
  const left = createCalibrationRevisionInput({ scale: 1, north: { offset: 12, method: 'bearing' } });
  const right = createCalibrationRevisionInput({ north: { method: 'bearing', offset: 12 }, scale: 1 });
  assert.deepEqual(left, right);
  assert.match(left.value, /^\{"calibration":/);
  const first = await hashCalibrationRevision(left, webcrypto);
  const second = await hashCalibrationRevision(right, webcrypto);
  assert.deepEqual(first, second);
  assert.match(first.digestHex, /^[a-f0-9]{64}$/);
  assert.match(first.revision, /^cal-v1-[a-f0-9]{16}$/);
  assert.throws(() => createCalibrationRevisionInput({ invalid: Number.NaN }), /finite/);
  await assert.rejects(() => hashCalibrationRevision({ algorithm: 'MD5', encoding: 'UTF-8', value: 'x' }, webcrypto), /produced by/);
});

test('composite assessment aggregates QA and emits shareable calibration state', async () => {
  const result = createCalibrationAssessment({
    northReference: { from: [0, 0, 0], to: [0, 0, -10], trueBearingDegrees: 12 },
    scaleEvidence: {
      modelUnits: 'meters',
      configuredScale: 1,
      dimensions: [{ id: 'wall', modelLength: 10, realLength: 10 }],
    },
    model: {
      bounds: MODEL_BOUNDS,
      units: 'meters',
      scale: 1,
      triangleCount: 21_148,
      vertexCount: 12_000,
      meshCount: 1,
    },
    scene: {
      origin: [0, 0, 0],
      groundBounds: { minX: -25, maxX: 25, minZ: -25, maxZ: 55 },
      terrainProfile: [[-25, 0], [55, 0]],
      cameraPresets: { overview: { position: [-28, 18, -16], target: [0, 2, 5] } },
    },
    assetHash: '0'.repeat(64),
  });
  assert.equal(result.calibrationVersion, MODEL_CALIBRATION_VERSION);
  assert.equal(result.status, 'pass');
  assert.equal(result.calibration.north.northOffsetDegrees, 12);
  assert.equal(result.calibration.model.assetHash, '0'.repeat(64));
  assert.match(result.solarNoonGuidance.qualification, /not an automatic survey/i);
  assert.match(result.solarNoonGuidance.qualification, /180-degree/);
  const hash = await hashCalibrationRevision(result.revisionInput, webcrypto);
  assert.match(hash.revision, /^cal-v1-/);
});

test('solar-noon guidance is qualified and strict inputs reject misleading QA', () => {
  const guidance = solarNoonAlignmentGuidance({ northOffsetDegrees: -15 });
  assert.equal(guidance.claimLevel, 'approximate field check');
  assert.match(guidance.qualification, /not an automatic survey/i);
  assert.throws(() => solarNoonAlignmentGuidance({ northOffsetDegrees: '15' }), /finite number/);
  assert.throws(() => createCalibrationAssessment({}), /at least one/);
  assert.throws(
    () => createCalibrationAssessment({ model: { triangleCount: 1 }, assetHash: 'not-a-hash' }),
    /assetHash/,
  );
});
