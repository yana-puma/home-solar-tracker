import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateDirectSunExposure,
  generateGroundSampleGrid,
  sunDirection,
} from '../src/exposure.js';

const EQUATOR_EQUINOX = {
  date: '2026-03-20',
  latitude: 0,
  longitude: 0,
  timeZone: 'UTC',
  northOffsetDegrees: 0,
  samplingMinutes: 60,
  points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }],
};

function closeTo(actual, expected, epsilon = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not close to ${expected}`);
}

test('sun directions follow viewer cardinal axes and model north offset', () => {
  const north = sunDirection({ altitude: 0, azimuth: 0 });
  const east = sunDirection({ altitude: 0, azimuth: 90 });
  const south = sunDirection({ altitude: 0, azimuth: 180 });
  const west = sunDirection({ altitude: 0, azimuth: 270 });
  const zenith = sunDirection({ altitude: 90, azimuth: 42 });
  const rotated = sunDirection({ altitude: 0, azimuth: 90, northOffsetDegrees: 90 });

  closeTo(north.x, 0); closeTo(north.z, -1);
  closeTo(east.x, -1); closeTo(east.z, 0);
  closeTo(south.x, 0); closeTo(south.z, 1);
  closeTo(west.x, 1); closeTo(west.z, 0);
  closeTo(zenith.x, 0); closeTo(zenith.y, 1); closeTo(zenith.z, 0);
  closeTo(rotated.x, 0); closeTo(rotated.z, -1);
});

test('generates cell-centered terrain samples in stable row-major order', () => {
  const points = generateGroundSampleGrid(
    { minX: 0, maxX: 4, minZ: -2, maxZ: 2 },
    (x, z) => x + z,
    { columns: 2, rows: 2 },
  );

  assert.deepEqual(points, [
    { x: 1, y: 0, z: -1 },
    { x: 3, y: 2, z: -1 },
    { x: 1, y: 2, z: 1 },
    { x: 3, y: 4, z: 1 },
  ]);
});

test('unobstructed points receive every above-horizon sample', async () => {
  const result = await calculateDirectSunExposure({
    ...EQUATOR_EQUINOX,
    isOccluded: () => false,
  });

  assert.ok(result.sampleCount >= 11 && result.sampleCount <= 13);
  assert.equal(result.exposures.length, 2);
  for (const exposure of result.exposures) {
    assert.equal(exposure.sunMinutes, result.sampleCount * 60);
    assert.equal(exposure.sunHours, result.sampleCount);
  }
  assert.equal(result.exposures[0].point, EQUATOR_EQUINOX.points[0]);
});

test('fully blocked and directionally blocked points report zero and partial exposure', async () => {
  const blocked = await calculateDirectSunExposure({
    ...EQUATOR_EQUINOX,
    points: [EQUATOR_EQUINOX.points[0]],
    isOccluded: () => true,
  });
  const afternoonOnly = await calculateDirectSunExposure({
    ...EQUATOR_EQUINOX,
    points: [EQUATOR_EQUINOX.points[0]],
    // In viewer coordinates morning/east has negative X; block that half.
    isOccluded: (_point, direction) => direction.x < 0,
  });

  assert.equal(blocked.exposures[0].sunMinutes, 0);
  assert.equal(blocked.exposures[0].sunHours, 0);
  assert.ok(afternoonOnly.exposures[0].sunMinutes > 0);
  assert.ok(afternoonOnly.exposures[0].sunMinutes < afternoonOnly.sampleCount * 60);
});

test('supports async occlusion callbacks', async () => {
  const result = await calculateDirectSunExposure({
    ...EQUATOR_EQUINOX,
    points: [EQUATOR_EQUINOX.points[0]],
    isOccluded: async () => false,
  });
  assert.ok(result.exposures[0].sunHours > 0);
});

test('rejects invalid grids and exposure inputs', async () => {
  assert.throws(
    () => generateGroundSampleGrid({ minX: 1, maxX: 0, minZ: 0, maxZ: 1 }, () => 0),
    /minimums/,
  );
  assert.throws(
    () => generateGroundSampleGrid({ minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, () => NaN),
    /non-finite/,
  );
  await assert.rejects(
    calculateDirectSunExposure({ ...EQUATOR_EQUINOX, samplingMinutes: 0, isOccluded: () => false }),
    /samplingMinutes/,
  );
  await assert.rejects(
    calculateDirectSunExposure({ ...EQUATOR_EQUINOX, points: [{ x: 0, y: NaN, z: 0 }], isOccluded: () => false }),
    /points\[0\]\.y/,
  );
  await assert.rejects(
    calculateDirectSunExposure({ ...EQUATOR_EQUINOX, isOccluded: () => 'no' }),
    /return a boolean/,
  );
});

test('honors an AbortSignal before and during calculation', async () => {
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(
    calculateDirectSunExposure({
      ...EQUATOR_EQUINOX,
      signal: alreadyAborted.signal,
      isOccluded: () => false,
    }),
    (error) => error.name === 'AbortError',
  );

  const duringRun = new AbortController();
  let calls = 0;
  await assert.rejects(
    calculateDirectSunExposure({
      ...EQUATOR_EQUINOX,
      signal: duringRun.signal,
      isOccluded: () => {
        calls += 1;
        duringRun.abort();
        return false;
      },
    }),
    (error) => error.name === 'AbortError',
  );
  assert.equal(calls, 1);
});
