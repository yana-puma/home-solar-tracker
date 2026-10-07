import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculatePvPlanningEstimate,
  createPvEstimateRunner,
  normalizePvInputs,
  pvRangeText,
} from '../src/viewer/pv-planning.js';
import {
  createViewerDiagnostics,
  diagnosticsDownloadPayload,
  diagnosticsFilename,
} from '../src/viewer/diagnostics-controller.js';
import {
  aggregateZoneExposure,
  pointInZoneGeometry,
  zoneRepresentativePoint,
} from '../src/viewer/zone-analysis.js';
import {
  createViewerStudyReport,
  viewerStudyReportToCsv,
} from '../src/viewer/viewer-report.js';

const solarYear = {
  year: 2026,
  days: [{
    date: '2026-06-21',
    samples: [
      { timeMinutes: 720, intervalMinutes: 60, altitude: 70, azimuth: 180, isAboveHorizon: true },
      { timeMinutes: 780, intervalMinutes: 60, altitude: 62, azimuth: 200, isAboveHorizon: true },
    ],
  }],
};

test('PV planning supports rating and area bases with explicit estimate qualification', () => {
  const rated = calculatePvPlanningEstimate({
    solarYear,
    inputs: { basis: 'rating', systemRatingKw: 5, planeTiltDegrees: 30, planeAzimuthDegrees: 180, systemLossPercent: 14 },
    shade: { sunFraction: 0.75, source: 'model-derived-selected-day-extrapolation', label: 'Coarse modeled factor.', limitations: 'One-day extrapolation.' },
  });
  const area = calculatePvPlanningEstimate({
    solarYear,
    inputs: { basis: 'area', arrayAreaSquareMeters: 25, moduleEfficiencyPercent: 20, planeTiltDegrees: 30, planeAzimuthDegrees: 180, systemLossPercent: 14 },
  });

  assert.ok(rated.energy.range.estimate > 0);
  assert.ok(area.energy.range.estimate > 0);
  assert.equal(rated.source, 'model-derived-selected-day-extrapolation');
  assert.match(rated.qualification, /not measured production/i);
  assert.match(area.sourceLabel, /no model-derived shade factor/i);
  assert.match(pvRangeText(rated.energy.range).central, /kWh\/year/);
  assert.throws(() => normalizePvInputs({ basis: 'rating', systemRatingKw: 0 }), /System rating/);
  assert.throws(() => normalizePvInputs({ basis: 'area', arrayAreaSquareMeters: 5, moduleEfficiencyPercent: 101 }), /efficiency/);
});

test('PV planning discards stale results and invalidates active work', async () => {
  const pending = [];
  const runner = createPvEstimateRunner({
    calculate: ({ requestId }) => new Promise((resolve) => pending.push({ requestId, resolve })),
  });
  const first = runner.run({ requestId: 'old' });
  const second = runner.run({ requestId: 'new' });
  pending.find((item) => item.requestId === 'old').resolve({ id: 'old' });
  await assert.rejects(first, (error) => error.name === 'AbortError');
  pending.find((item) => item.requestId === 'new').resolve({ id: 'new' });
  assert.deepEqual(await second, { id: 'new' });
  assert.equal(runner.active, false);

  const third = runner.run({ requestId: 'changed' });
  runner.invalidate();
  pending.find((item) => item.requestId === 'changed').resolve({ id: 'changed' });
  await assert.rejects(third, (error) => error.name === 'AbortError');
});

test('diagnostic downloads are explicit, local, redacted, and privacy-safe by filename', () => {
  let tick = 0;
  const diagnostics = createViewerDiagnostics({
    clock: () => Date.UTC(2026, 7, 24) + tick++,
    idFactory: (kind, sequence) => `${kind}-${sequence}`,
  });
  const timing = diagnostics.startTiming('model', { latitude: 40.0, modelMetadata: 'private mesh author' });
  diagnostics.endTiming(timing, { status: 'loaded' });
  const payload = diagnosticsDownloadPayload(diagnostics, new Date('2026-08-24T12:00:00Z'));

  assert.equal(payload.filename, 'atlee-viewer-diagnostics-2026-08-24.json');
  assert.equal(diagnosticsFilename(new Date('invalid')), 'atlee-viewer-diagnostics-local.json');
  assert.doesNotMatch(payload.text, /38\.802|private mesh author/);
  assert.match(payload.text, /redacted-coordinate/);
  assert.match(payload.text, /"eventCount": 2/);
  assert.equal(diagnostics.hasTransport, false);
});

test('decision zones aggregate rectangle and polygon grid points and qualify representative fallback', () => {
  const rectangle = { id: 'roof', geometry: { type: 'rectangle', minX: 0, maxX: 4, minZ: 0, maxZ: 2 } };
  const polygon = { id: 'garden', geometry: { type: 'polygon', vertices: [[5, 0], [9, 0], [9, 4], [5, 4]] } };
  const point = { id: 'window', geometry: { type: 'point', x: 20, z: 20 } };
  const exposure = {
    exposures: [
      { point: { x: 1, z: 1 }, sunMinutes: 360 },
      { point: { x: 3, z: 1 }, sunMinutes: 480 },
      { point: { x: 6, z: 1 }, sunMinutes: 240 },
      { point: { x: 8, z: 3 }, sunMinutes: 300 },
    ],
  };
  const analysis = aggregateZoneExposure({ zones: [rectangle, polygon, point], exposure, daylightMinutes: 720 });

  assert.deepEqual(zoneRepresentativePoint(rectangle), { x: 2, z: 1 });
  assert.equal(pointInZoneGeometry({ x: 6, z: 2 }, polygon.geometry), true);
  assert.equal(analysis.zones.roof.method, 'area-grid-mean');
  assert.equal(analysis.zones.roof.gridPointCount, 2);
  assert.equal(analysis.zones.roof.sunMinutes, 420);
  assert.equal(analysis.zones.garden.sunMinutes, 270);
  assert.equal(analysis.zones.window.method, 'representative-nearest-grid-point');
  assert.match(analysis.zones.window.qualification, /not an area average/i);
});

test('viewer reports use registry revision and retain zone aggregation provenance in JSON and CSV', () => {
  const zoneAnalysis = {
    zones: {
      roof: {
        zoneId: 'roof', daysObserved: 1, sunMinutes: 420, averageDailySunMinutes: 420, sunFraction: 0.6,
        geometryType: 'rectangle', method: 'area-grid-mean', gridPointCount: 2,
        representative: { x: 2, z: 1 }, qualification: 'Mean of modeled grid points.',
      },
    },
    provenance: { method: 'viewer-decision-zone-grid-aggregation', claimLevel: 'model-derived' },
  };
  const report = createViewerStudyReport({
    property: { title: 'Demo', location: { displayLabel: 'Private region', timeZone: 'America/New_York' } },
    registryEntry: { slug: 'demo', revision: '2026.08.24-1' },
    state: { date: '2026-06-21' },
    zoneAnalysis,
    generatedAt: '2026-08-24T12:00:00Z',
  });

  assert.equal(report.property.revision, '2026.08.24-1');
  assert.equal(report.zones[0].method, 'area-grid-mean');
  assert.equal(report.zoneAnalysisProvenance.claimLevel, 'model-derived');
  const csv = viewerStudyReportToCsv(report);
  assert.match(csv, /decision-zone details/);
  assert.match(csv, /roof,rectangle,area-grid-mean,2/);
  report.zones[0].qualification = '=HYPERLINK("https://example.test","unsafe")';
  assert.match(viewerStudyReportToCsv(report), /"'=HYPERLINK/);
});
