import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IRRADIANCE_MODEL_VERSION,
  IRRADIANCE_PROVENANCE,
  calculatePlaneIncidenceCosine,
  estimateClearSkyGhi,
  estimateClearSkyPlaneSample,
  estimateIrradianceDay,
  estimateIrradianceYear,
} from '../src/irradiance.js';
import { sampleSolarDay } from '../src/solar-analysis.js';

function close(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

function solarDay(date, samples) {
  return { kind: 'day', date, samples };
}

function sample({ timeMinutes = 720, intervalMinutes = 60, altitude = 30, azimuth = 180, ...extra } = {}) {
  return { timeMinutes, intervalMinutes, altitude, azimuth, ...extra };
}

function calendarYear(year) {
  const lengths = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const days = [];
  for (let month = 1; month <= 12; month += 1) {
    for (let day = 1; day <= lengths[month - 1]; day += 1) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      days.push(solarDay(date, [sample()]));
    }
  }
  return { kind: 'year', year, days };
}

test('Haurwitz GHI and plane incidence have deterministic reference values', () => {
  close(estimateClearSkyGhi(30), 487.89413288542494, 1e-9);
  close(calculatePlaneIncidenceCosine({
    solarAltitudeDegrees: 30,
    solarAzimuthDegrees: 180,
    planeTiltDegrees: 60,
    planeAzimuthDegrees: 180,
  }), 1);
  assert.equal(calculatePlaneIncidenceCosine({
    solarAltitudeDegrees: -5,
    solarAzimuthDegrees: 180,
    planeTiltDegrees: 30,
    planeAzimuthDegrees: 180,
  }), 0);
  assert.equal(estimateClearSkyGhi(0), 0);
});

test('an appropriately tilted plane exceeds horizontal opportunity for a low southern sun', () => {
  const horizontal = estimateClearSkyPlaneSample({
    altitude: 30,
    azimuth: 180,
    intervalMinutes: 60,
    planeTiltDegrees: 0,
    planeAzimuthDegrees: 180,
  });
  const tilted = estimateClearSkyPlaneSample({
    altitude: 30,
    azimuth: 180,
    intervalMinutes: 60,
    planeTiltDegrees: 60,
    planeAzimuthDegrees: 180,
  });
  close(horizontal.irradianceWm2.planeClearSky, horizontal.irradianceWm2.globalHorizontal);
  assert.ok(tilted.irradianceWm2.planeClearSky > horizontal.irradianceWm2.planeClearSky);
  assert.equal(tilted.incidenceCosine, 1);
});

test('night and polar-night samples contribute zero without special clock logic', () => {
  const night = estimateClearSkyPlaneSample({
    altitude: -12,
    azimuth: 0,
    intervalMinutes: 120,
    planeTiltDegrees: 30,
    planeAzimuthDegrees: 180,
  });
  assert.deepEqual(night.opportunityKWhPerSquareMeter, {
    clearSky: 0,
    afterSunFraction: 0,
    climateAdjusted: 0,
  });

  const polarNight = estimateIrradianceDay({
    solarDay: solarDay('2026-12-21', [sample({ altitude: -10, azimuth: 0, intervalMinutes: 1440, timeMinutes: 0 })]),
    planeTiltDegrees: 45,
    planeAzimuthDegrees: 180,
    systemRatingKw: 5,
  });
  assert.equal(polarNight.energy.range.estimate, 0);

  const polarDayGeometry = sampleSolarDay({
    date: '2026-06-21',
    latitude: 69.6492,
    longitude: 18.9553,
    timeZone: 'Europe/Oslo',
    samplingMinutes: 120,
  });
  const polarDay = estimateIrradianceDay({
    solarDay: polarDayGeometry,
    planeTiltDegrees: 30,
    planeAzimuthDegrees: 180,
  });
  assert.equal(polarDay.representedMinutes, 1440);
  assert.ok(polarDay.opportunityKWhPerSquareMeter.clearSky > 0);
});

test('full supplied shade produces zero opportunity and zero estimated energy', () => {
  const result = estimateIrradianceDay({
    solarDay: solarDay('2026-06-21', [sample()]),
    planeTiltDegrees: 30,
    planeAzimuthDegrees: 180,
    sunFraction: 0,
    systemRatingKw: 5,
  });
  assert.ok(result.opportunityKWhPerSquareMeter.clearSky > 0);
  assert.equal(result.opportunityKWhPerSquareMeter.afterSunFraction, 0);
  assert.equal(result.opportunityKWhPerSquareMeter.climateAdjusted, 0);
  assert.deepEqual(result.energy.range, {
    low: 0,
    estimate: 0,
    high: 0,
    lowMultiplier: 0.7,
    highMultiplier: 1.1,
  });
});

test('system losses reduce energy monotonically and do not change plane opportunity', () => {
  const input = {
    solarDay: solarDay('2026-06-21', [sample({ altitude: 50 })]),
    planeTiltDegrees: 40,
    planeAzimuthDegrees: 180,
    systemRatingKw: 5,
  };
  const lossless = estimateIrradianceDay({ ...input, systemLossFraction: 0 });
  const ordinary = estimateIrradianceDay({ ...input, systemLossFraction: 0.14 });
  const highLoss = estimateIrradianceDay({ ...input, systemLossFraction: 0.3 });
  assert.ok(lossless.energy.range.estimate > ordinary.energy.range.estimate);
  assert.ok(ordinary.energy.range.estimate > highLoss.energy.range.estimate);
  assert.equal(lossless.opportunityKWhPerSquareMeter.climateAdjusted, highLoss.opportunityKWhPerSquareMeter.climateAdjusted);
  close(highLoss.energy.range.estimate / lossless.energy.range.estimate, 0.7);
});

test('area-efficiency and equivalent declared DC rating agree at reference irradiance', () => {
  const common = {
    solarDay: solarDay('2026-06-21', [sample({ altitude: 50 })]),
    planeTiltDegrees: 40,
    planeAzimuthDegrees: 180,
    systemLossFraction: 0.14,
  };
  const area = estimateIrradianceDay({
    ...common,
    arrayAreaSquareMeters: 25,
    moduleEfficiency: 0.2,
  });
  const rating = estimateIrradianceDay({ ...common, systemRatingKw: 5 });
  close(area.energy.range.estimate, rating.energy.range.estimate);
  assert.equal(area.energy.basis.basis, 'array-area-and-efficiency');
  assert.equal(rating.energy.basis.basis, 'declared-dc-rating');
});

test('monthly climate factors remain user-declared and apply after model sun fraction', () => {
  const common = {
    solarDay: solarDay('2026-06-21', [sample({ sunFraction: 0.5 })]),
    planeTiltDegrees: 30,
    planeAzimuthDegrees: 180,
    systemRatingKw: 4,
  };
  const clear = estimateIrradianceDay(common);
  const climate = estimateIrradianceDay({ ...common, monthlyClimateDerate: { 6: 0.4 } });
  close(clear.opportunityKWhPerSquareMeter.afterSunFraction, clear.opportunityKWhPerSquareMeter.clearSky * 0.5);
  close(climate.opportunityKWhPerSquareMeter.climateAdjusted, climate.opportunityKWhPerSquareMeter.afterSunFraction * 0.4);
  close(climate.energy.range.estimate / clear.energy.range.estimate, 0.4);
  assert.match(climate.assumptions.join(' '), /User-declared monthly climate factors/);
});

test('existing normalized solar-day samples integrate without timezone reinterpretation', () => {
  const day = sampleSolarDay({
    date: '2026-03-08',
    latitude: 40.0,
    longitude: -105.0,
    timeZone: 'America/New_York',
    samplingMinutes: 60,
  });
  const first = estimateIrradianceDay({
    solarDay: day,
    planeTiltDegrees: 30,
    planeAzimuthDegrees: 180,
  });
  const second = estimateIrradianceDay({
    solarDay: { ...day, location: { ...day.location, timeZone: 'Asia/Kathmandu' } },
    planeTiltDegrees: 30,
    planeAzimuthDegrees: 180,
  });
  assert.ok(first.opportunityKWhPerSquareMeter.clearSky > 0);
  assert.deepEqual(first.opportunityKWhPerSquareMeter, second.opportunityKWhPerSquareMeter);
  assert.equal(first.representedMinutes, 1440);
});

test('complete leap-year inputs retain February 29 and calendar-day weights', () => {
  const result = estimateIrradianceYear({
    solarYear: calendarYear(2024),
    planeTiltDegrees: 30,
    planeAzimuthDegrees: 180,
    monthlyClimateDerate: { 2: 0.8 },
  });
  assert.equal(result.coverage.leapYear, true);
  assert.equal(result.coverage.expectedDayCount, 366);
  assert.equal(result.coverage.suppliedDayCount, 366);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.months[1].calendarDays, 29);
  assert.equal(result.months[1].suppliedDays, 29);
  assert.equal(result.months[0].climateDerate, 1);
  assert.equal(result.months[1].climateDerate, 0.8);
  assert.equal(result.days[59].date, '2024-02-29');
  close(
    result.months[1].opportunityKWhPerSquareMeter.clearSky
      / result.months[0].opportunityKWhPerSquareMeter.clearSky,
    29 / 31,
  );
  close(
    result.months[1].opportunityKWhPerSquareMeter.climateAdjusted
      / result.months[0].opportunityKWhPerSquareMeter.climateAdjusted,
    (29 / 31) * 0.8,
  );
});

test('partial annual input is not silently extrapolated', () => {
  const result = estimateIrradianceYear({
    solarYear: { year: 2026, days: [solarDay('2026-06-21', [sample()])] },
    planeTiltDegrees: 30,
    planeAzimuthDegrees: 180,
    systemRatingKw: 5,
  });
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.suppliedDayCount, 1);
  assert.equal(result.coverage.expectedDayCount, 365);
  assert.match(result.coverage.qualification, /missing days were not extrapolated/i);
  assert.equal(result.energy.range.estimate, result.days[0].energy.range.estimate);
});

test('uncertainty and provenance explicitly limit the claim', () => {
  const result = estimateIrradianceDay({
    solarDay: solarDay('2026-06-21', [sample()]),
    planeTiltDegrees: 30,
    planeAzimuthDegrees: 180,
    systemRatingKw: 5,
    uncertainty: { lowMultiplier: 0.6, highMultiplier: 1.05 },
  });
  assert.equal(result.modelVersion, IRRADIANCE_MODEL_VERSION);
  assert.equal(result.provenance.claimLevel, 'estimated');
  assert.notEqual(result.provenance, IRRADIANCE_PROVENANCE);
  assert.match(IRRADIANCE_PROVENANCE.qualification, /not measured production/i);
  assert.match(IRRADIANCE_PROVENANCE.qualification, /utility-grade/i);
  assert.match(IRRADIANCE_PROVENANCE.qualification, /certified/i);
  close(result.energy.range.low, result.energy.range.estimate * 0.6);
  close(result.energy.range.high, result.energy.range.estimate * 1.05);
  assert.match(result.assumptions.at(-1), /not a statistical confidence interval/i);
});

test('invalid geometry, factors, intervals, and energy bases fail strictly', () => {
  assert.throws(() => estimateClearSkyPlaneSample({ altitude: 30, azimuth: 180, intervalMinutes: 60, planeTiltDegrees: 91, planeAzimuthDegrees: 180 }), /planeTiltDegrees/);
  assert.throws(() => estimateClearSkyPlaneSample({ altitude: 30, azimuth: 360, intervalMinutes: 60, planeTiltDegrees: 30, planeAzimuthDegrees: 180 }), /azimuth/);
  assert.throws(() => estimateClearSkyPlaneSample({ altitude: 30, azimuth: 180, intervalMinutes: 0, planeTiltDegrees: 30, planeAzimuthDegrees: 180 }), /greater than zero/);
  assert.throws(() => estimateIrradianceDay({
    solarDay: solarDay('2026-06-21', [sample({ timeMinutes: 1400, intervalMinutes: 60 })]),
    planeTiltDegrees: 30,
    planeAzimuthDegrees: 180,
  }), /beyond/);
  assert.throws(() => estimateIrradianceDay({
    solarDay: solarDay('2026-06-21', [sample({ timeMinutes: 600, intervalMinutes: 120 }), sample({ timeMinutes: 700 })]),
    planeTiltDegrees: 30,
    planeAzimuthDegrees: 180,
  }), /non-overlapping/);
  assert.throws(() => estimateIrradianceDay({
    solarDay: solarDay('2026-06-21', [sample()]),
    planeTiltDegrees: 30,
    planeAzimuthDegrees: 180,
    sunFraction: [],
  }), /array matching/);
  assert.throws(() => estimateIrradianceDay({
    solarDay: solarDay('2026-06-21', [sample()]),
    planeTiltDegrees: 30,
    planeAzimuthDegrees: 180,
    arrayAreaSquareMeters: 20,
    systemRatingKw: 4,
  }), /not both/);
  assert.throws(() => estimateIrradianceDay({
    solarDay: solarDay('2026-06-21', [sample()]),
    planeTiltDegrees: 30,
    planeAzimuthDegrees: 180,
    systemLossFraction: 1,
  }), /less than 1/);
  assert.throws(() => estimateIrradianceDay({
    solarDay: solarDay('2026-06-21', [sample()]),
    planeTiltDegrees: 30,
    planeAzimuthDegrees: 180,
    monthlyClimateDerate: { 13: 0.5 },
  }), /month numbers/);
  assert.throws(() => estimateIrradianceDay({
    solarDay: solarDay('2026-06-21', [sample({ altitude: 30, isAboveHorizon: false })]),
    planeTiltDegrees: 30,
    planeAzimuthDegrees: 180,
  }), /contradicts altitude/);
});

test('annual validation rejects duplicates, wrong years, and ambiguous sun arrays', () => {
  const one = solarDay('2026-01-01', [sample()]);
  const common = { planeTiltDegrees: 30, planeAzimuthDegrees: 180 };
  assert.throws(() => estimateIrradianceYear({ solarYear: { year: 2026, days: [one, one] }, ...common }), /duplicate/);
  assert.throws(() => estimateIrradianceYear({ solarYear: { year: 2025, days: [one] }, ...common }), /outside/);
  assert.throws(() => estimateIrradianceYear({ solarYear: { year: 2026, days: [one] }, ...common, sunFraction: [1] }), /annual sunFraction/);
});
