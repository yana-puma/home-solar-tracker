import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStudyReport,
  studyReportFilename,
  studyReportToCsv,
  studyReportToJson,
} from '../src/study-report.js';

function fixture() {
  return createStudyReport({
    property: {
      schemaVersion: 2,
      slug: 'home-demo',
      title: 'Garden Study',
      package: { id: 'home-demo', revision: '2026-08' },
      location: {
        latitude: 38.8,
        longitude: -77.2,
        displayLabel: 'Northern Virginia',
        timeZone: 'America/New_York',
        precision: 'rounded',
      },
    },
    state: {
      date: '2026-06-21',
      localTimeMinutes: 780,
      view: 'garden',
      selectedZone: 'patio',
      map: 'calculated',
      compareDates: ['2026-12-21'],
    },
    daylight: {
      date: '2026-06-21',
      summary: {
        sunrise: '5:43 AM',
        solarNoon: '1:11 PM',
        sunset: '8:38 PM',
        daylightHours: 14.92,
        solarNoonAltitude: 74.6,
        polarState: 'normal',
      },
    },
    zoneAnalysis: {
      zones: {
        patio: { zoneId: 'patio', daysObserved: 1, sunMinutes: 360, averageDailySunMinutes: 360, sunFraction: 0.5 },
      },
    },
    generatedAt: '2026-08-24T12:00:00Z',
  });
}

test('reports are reproducible and omit exact coordinates and asset URLs', () => {
  const report = fixture();
  assert.equal(report.reportVersion, 1);
  assert.equal(report.property.revision, '2026-08');
  assert.equal(report.zones[0].averageDailySunHours, 6);
  const json = studyReportToJson(report);
  assert.doesNotMatch(json, /38\.8|-77\.2|model\.glb/);
  assert.match(json, /Planning estimate only/);
});

test('CSV contains property, daylight, qualification, and zone summaries', () => {
  const csv = studyReportToCsv(fixture());
  assert.match(csv, /property,id,home-demo/);
  assert.match(csv, /daylight,sunrise,5:43 AM/);
  assert.match(csv, /patio,1,6,6,0\.5/);
  assert.match(csv, /Planning estimate only/);
});

test('CSV neutralizes authored spreadsheet formulas without changing numbers', () => {
  const report = fixture();
  report.property.title = '=HYPERLINK("https://example.test","open")';
  report.property.displayLabel = '  +SUM(1,2)';
  report.zones[0].zoneId = '@IMPORT';
  const csv = studyReportToCsv(report);
  assert.match(csv, /property,title,"'=HYPERLINK/);
  assert.match(csv, /property,displayLabel,"'  \+SUM/);
  assert.match(csv, /'@IMPORT,1,6,6,0\.5/);
  assert.match(csv, /daylightHours,14\.92/);
});

test('filenames are stable and filesystem-safe', () => {
  const report = fixture();
  report.property.id = 'My House / Main';
  assert.equal(studyReportFilename(report, 'CSV'), 'My-House-Main-solar-study-2026-06-21.csv');
});

test('invalid required inputs fail without producing misleading reports', () => {
  assert.throws(() => createStudyReport(), /property must be an object/);
  assert.throws(() => createStudyReport({ property: {}, state: {}, generatedAt: 'nope' }), /generatedAt/);
});
