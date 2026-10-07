import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateZoneTimeWindows,
  compareSeasonalPresets,
  compareSolarDates,
  getMethodProvenance,
  getSeasonalPresetDates,
  sampleSolarDay,
  sampleSolarMonth,
  sampleSolarYear,
} from '../src/solar-analysis.js';

const DEMO = {
  latitude: 38.8,
  longitude: -77.2,
  timeZone: 'America/New_York',
};

const GOLDEN_TOLERANCE = {
  clockMinutes: 5,
  altitudeDegrees: 0.5,
};

function within(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} is not within ${tolerance} of ${expected}`,
  );
}

test('daily sampling is normalized and matches the documented Northern Virginia golden fixture', () => {
  const day = sampleSolarDay({
    ...DEMO,
    date: '2026-06-21',
    samplingMinutes: 60,
  });

  assert.equal(day.kind, 'day');
  assert.equal(day.date, '2026-06-21');
  assert.equal(day.dayOfYear, 172);
  assert.equal(day.samples.length, 24);
  assert.deepEqual(
    day.samples.map((sample) => sample.timeMinutes),
    Array.from({ length: 24 }, (_, index) => index * 60),
  );
  assert.ok(day.samples.every((sample) => sample.intervalMinutes === 60));
  assert.ok(day.samples.every((sample) => sample.azimuth >= 0 && sample.azimuth < 360));
  assert.ok(day.samples.every((sample) => sample.dayFraction >= 0 && sample.dayFraction < 1));

  within(day.summary.sunriseMinutes, 344, GOLDEN_TOLERANCE.clockMinutes, 'sunrise');
  within(day.summary.solarNoonMinutes, 791, GOLDEN_TOLERANCE.clockMinutes, 'solar noon');
  within(day.summary.sunsetMinutes, 1237, GOLDEN_TOLERANCE.clockMinutes, 'sunset');
  within(day.summary.daylightMinutes, 893, GOLDEN_TOLERANCE.clockMinutes, 'daylight');
  within(day.summary.solarNoonAltitude, 74.65, GOLDEN_TOLERANCE.altitudeDegrees, 'noon altitude');
  assert.equal(day.summary.utcOffsetHoursAtNoon, -4);
  assert.equal(day.summary.polarState, 'normal');
  assert.equal(day.provenance.claimLevel, 'calculated');
});

test('partial final intervals stay within one local calendar day', () => {
  const day = sampleSolarDay({ ...DEMO, date: '2026-08-15', samplingMinutes: 50 });
  const last = day.samples.at(-1);

  assert.equal(day.samples.length, 29);
  assert.equal(last.timeMinutes, 1400);
  assert.equal(last.intervalMinutes, 40);
});

test('monthly samples capture DST changes and fractional IANA offsets', () => {
  const march = sampleSolarMonth({
    ...DEMO,
    year: 2026,
    month: 3,
    samplingMinutes: 120,
  });
  const kathmandu = sampleSolarDay({
    date: '2026-03-20',
    latitude: 27.7172,
    longitude: 85.324,
    timeZone: 'Asia/Kathmandu',
    samplingMinutes: 120,
  });

  assert.equal(march.days.length, 31);
  assert.equal(march.days.find((day) => day.date === '2026-03-07').summary.utcOffsetHoursAtNoon, -5);
  assert.equal(march.days.find((day) => day.date === '2026-03-08').summary.utcOffsetHoursAtNoon, -4);
  assert.equal(kathmandu.summary.utcOffsetHoursAtNoon, 5.75);
  within(kathmandu.summary.sunriseMinutes, 369, GOLDEN_TOLERANCE.clockMinutes, 'Kathmandu sunrise');
  within(kathmandu.summary.sunsetMinutes, 1095, GOLDEN_TOLERANCE.clockMinutes, 'Kathmandu sunset');
});

test('annual samples include leap day and normalized month summaries', () => {
  const year = sampleSolarYear({
    year: 2024,
    latitude: 0,
    longitude: 0,
    timeZone: 'UTC',
    samplingMinutes: 120,
  });

  assert.equal(year.days.length, 366);
  assert.equal(year.days[59].date, '2024-02-29');
  assert.equal(year.months.length, 12);
  assert.equal(year.months[1].summary.dayCount, 29);
  assert.equal(year.summary.dayCount, 366);
  assert.equal(year.seasonalPresets.juneSolstice, '2024-06-21');
});

test('polar day and night retain a meaningful solar-noon summary', () => {
  const location = {
    latitude: 69.6492,
    longitude: 18.9553,
    timeZone: 'Europe/Oslo',
    samplingMinutes: 120,
  };
  const summer = sampleSolarDay({ ...location, date: '2026-06-21' });
  const winter = sampleSolarDay({ ...location, date: '2026-12-21' });

  assert.equal(summer.summary.polarState, 'polar-day');
  assert.equal(summer.summary.daylightMinutes, 1440);
  assert.equal(summer.summary.sunriseMinutes, null);
  assert.equal(summer.summary.sunsetMinutes, null);
  assert.ok(Number.isFinite(summer.summary.solarNoonMinutes));
  assert.ok(summer.summary.solarNoonAltitude > 40);

  assert.equal(winter.summary.polarState, 'polar-night');
  assert.equal(winter.summary.daylightMinutes, 0);
  assert.equal(winter.summary.sunriseMinutes, null);
  assert.equal(winter.summary.sunsetMinutes, null);
  assert.ok(Number.isFinite(winter.summary.solarNoonMinutes));
  assert.ok(winter.summary.solarNoonAltitude < 0);
});

test('date comparisons and representative seasonal presets are deterministic', () => {
  const presets = getSeasonalPresetDates(2026);
  const direct = compareSolarDates({
    ...DEMO,
    dateA: presets.juneSolstice,
    dateB: presets.decemberSolstice,
    samplingMinutes: 120,
  });
  const preset = compareSeasonalPresets({
    ...DEMO,
    year: 2026,
    presetA: 'juneSolstice',
    presetB: 'decemberSolstice',
    samplingMinutes: 120,
  });

  assert.deepEqual(preset.difference, direct.difference);
  assert.deepEqual(preset.dates, ['2026-06-21', '2026-12-21']);
  assert.ok(preset.difference.daylightMinutes < -300);
  assert.ok(preset.difference.solarNoonAltitude < -45);
  assert.match(preset.presetQualification, /not exact astronomical event timestamps/i);
});

test('zone exposure aggregates weighted sun and local-clock windows', () => {
  const result = aggregateZoneTimeWindows({
    series: [
      {
        date: '2026-06-21',
        timeMinutes: 480,
        intervalMinutes: 180,
        zones: { patio: true, bed: 0.5 },
      },
      {
        date: '2026-06-21',
        timeMinutes: 660,
        intervalMinutes: 180,
        zones: { patio: false, bed: { sunMinutes: 90 } },
      },
      {
        date: '2026-06-21',
        timeMinutes: 840,
        intervalMinutes: 180,
        zones: { patio: true, bed: { exposed: false } },
      },
    ],
  });

  const patio = result.days[0].zones.patio;
  assert.equal(patio.observedMinutes, 540);
  assert.equal(patio.sunMinutes, 360);
  assert.equal(patio.firstSunMinutes, 480);
  assert.equal(patio.lastSunMinutes, 1020);
  assert.equal(patio.longestContinuousSunMinutes, 180);
  assert.equal(patio.windows.morning.observedMinutes, 240);
  assert.equal(patio.windows.morning.sunMinutes, 180);
  assert.equal(patio.windows.afternoon.sunMinutes, 120);

  const bed = result.days[0].zones.bed;
  assert.equal(bed.sunMinutes, 180);
  assert.equal(bed.longestContinuousSunMinutes, 360);
  assert.equal(result.zones.patio.averageDailySunMinutes, 360);
  assert.equal(result.provenance.method, 'model-derived-direct-sun');
  assert.equal(result.provenance.claimLevel, 'modeled');
});

test('zone aggregation preserves missing observations and averages multiple dates', () => {
  const result = aggregateZoneTimeWindows({
    series: [
      { date: '2026-06-21', timeMinutes: 600, intervalMinutes: 60, zones: { patio: 1 } },
      { date: '2026-06-22', timeMinutes: 600, intervalMinutes: 60, zones: { patio: 0, garden: 0.5 } },
    ],
    windows: [{ id: 'workday', label: 'Workday', startMinutes: 540, endMinutes: 1020 }],
    minimumSunFraction: 0.75,
  });

  assert.equal(result.dates.length, 2);
  assert.equal(result.zones.patio.daysObserved, 2);
  assert.equal(result.zones.patio.sunMinutes, 60);
  assert.equal(result.zones.patio.averageDailySunMinutes, 30);
  assert.equal(result.zones.garden.daysObserved, 1);
  assert.equal(result.days[1].zones.garden.firstSunMinutes, null);
  assert.equal(result.days[1].zones.garden.sunMinutes, 30);
});

test('method labels prevent modeled and estimated claims from being conflated', () => {
  assert.equal(getMethodProvenance('geometric-solar').claimLevel, 'calculated');
  assert.equal(getMethodProvenance('model-derived-direct-sun').claimLevel, 'modeled');
  assert.equal(getMethodProvenance('seasonal-estimate').claimLevel, 'estimated');
  assert.match(getMethodProvenance('seasonal-estimate').limitations, /must not be presented as measured/i);
  assert.throws(() => getMethodProvenance('certified'), /method must be one of/i);
});

test('invalid solar analysis inputs fail rather than producing misleading samples', () => {
  assert.throws(
    () => sampleSolarDay({ ...DEMO, date: '2026-02-30' }),
    /valid calendar date/i,
  );
  assert.throws(
    () => sampleSolarDay({ ...DEMO, date: '2026-06-21', samplingMinutes: 121 }),
    /samplingMinutes/i,
  );
  assert.throws(
    () => sampleSolarDay({ ...DEMO, date: '2026-06-21', latitude: 91 }),
    /latitude/i,
  );
  assert.throws(
    () => sampleSolarDay({ ...DEMO, date: '2026-06-21', timeZone: 'Not\/A_Zone' }),
    /Invalid IANA time zone/i,
  );
  assert.throws(
    () => sampleSolarMonth({ ...DEMO, year: 2026, month: 13 }),
    /month must be an integer/i,
  );
  assert.throws(
    () => sampleSolarYear({ ...DEMO, year: 0 }),
    /year must be an integer/i,
  );
  assert.throws(
    () => compareSolarDates({ ...DEMO, dateA: '2026-06-21', dateB: '2026-06-21' }),
    /different dates/i,
  );
  assert.throws(
    () => compareSeasonalPresets({
      ...DEMO,
      year: 2026,
      presetA: 'summer',
      presetB: 'decemberSolstice',
    }),
    /must be one of/i,
  );
});

test('invalid or overlapping exposure series are rejected', () => {
  assert.throws(
    () => aggregateZoneTimeWindows({
      series: [{
        date: '2026-06-21',
        timeMinutes: 600,
        intervalMinutes: 60,
        zones: { patio: 1.1 },
      }],
    }),
    /between 0 and 1/i,
  );
  assert.throws(
    () => aggregateZoneTimeWindows({
      series: [
        { date: '2026-06-21', timeMinutes: 600, intervalMinutes: 90, zones: { patio: true } },
        { date: '2026-06-21', timeMinutes: 660, intervalMinutes: 60, zones: { patio: true } },
      ],
    }),
    /overlapping intervals/i,
  );
  assert.throws(
    () => aggregateZoneTimeWindows({
      series: [{
        date: '2026-06-21',
        timeMinutes: 1400,
        intervalMinutes: 60,
        zones: { patio: true },
      }],
    }),
    /must not extend beyond/i,
  );
  assert.throws(
    () => aggregateZoneTimeWindows({
      series: [{
        date: '2026-06-21',
        timeMinutes: 600,
        intervalMinutes: 60,
        zones: { patio: true },
      }],
      windows: [{ id: 'bad-window', startMinutes: 900, endMinutes: 600 }],
    }),
    /startMinutes must be less than endMinutes/i,
  );
});
