import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateDaylightStats,
  calculateSolarPosition,
  dateFromDayOfYear,
  dayOfYearFromDate,
  formatTime12h,
  getTimeZoneOffsetHours,
} from '../src/solar.js';

const DEMO = {
  latitude: 38.8,
  longitude: -77.2,
  timeZone: 'America/New_York',
};

test('resolves New York standard and daylight-saving offsets', () => {
  assert.equal(getTimeZoneOffsetHours('2026-01-15', 'America/New_York'), -5);
  assert.equal(getTimeZoneOffsetHours('2026-07-15', 'America/New_York'), -4);
});

test('preserves fractional IANA offsets', () => {
  assert.equal(getTimeZoneOffsetHours('2026-07-15', 'Asia/Kathmandu'), 5.75);
  assert.equal(getTimeZoneOffsetHours('2026-07-15', 'Australia/Adelaide'), 9.5);
});

test('converts ISO dates and leap-year ordinal days', () => {
  assert.equal(dayOfYearFromDate('2024-02-29'), 60);
  assert.equal(dayOfYearFromDate('2026-12-31'), 365);
  assert.equal(dateFromDayOfYear(60, 2024), '2024-02-29');
  assert.equal(dateFromDayOfYear(365, 2026), '2026-12-31');
});

test('summer sun is higher and daylight is longer at the demo property', () => {
  const summerSun = calculateSolarPosition({ ...DEMO, date: '2026-06-21', timeMinutes: 13 * 60 });
  const winterSun = calculateSolarPosition({ ...DEMO, date: '2026-12-21', timeMinutes: 12 * 60 });
  const summerDay = calculateDaylightStats({ ...DEMO, date: '2026-06-21' });
  const winterDay = calculateDaylightStats({ ...DEMO, date: '2026-12-21' });

  assert.ok(summerSun.altitude > 70 && summerSun.altitude < 80, `summer altitude ${summerSun.altitude}`);
  assert.ok(winterSun.altitude > 25 && winterSun.altitude < 35, `winter altitude ${winterSun.altitude}`);
  assert.ok(summerSun.altitude > winterSun.altitude);
  assert.ok(summerDay.daylightMinutes > 14 * 60);
  assert.ok(winterDay.daylightMinutes < 10 * 60);
});

test('daylight results have plausible local ordering and east-to-west sun travel', () => {
  const stats = calculateDaylightStats({ ...DEMO, date: '2026-08-15' });
  const morning = calculateSolarPosition({ ...DEMO, date: '2026-08-15', timeMinutes: 9 * 60 });
  const noon = calculateSolarPosition({ ...DEMO, date: '2026-08-15', timeMinutes: 13 * 60 });
  const evening = calculateSolarPosition({ ...DEMO, date: '2026-08-15', timeMinutes: 18 * 60 });

  assert.ok(stats.sunriseMinutes > 5 * 60 && stats.sunriseMinutes < 7 * 60);
  assert.ok(stats.sunsetMinutes > 19 * 60 && stats.sunsetMinutes < 21 * 60);
  assert.ok(stats.sunriseMinutes < 13 * 60 && 13 * 60 < stats.sunsetMinutes);
  assert.ok(morning.azimuth > 70 && morning.azimuth < 130, `morning azimuth ${morning.azimuth}`);
  assert.ok(noon.altitude > morning.altitude && noon.altitude > evening.altitude);
  assert.ok(evening.azimuth > 240 && evening.azimuth < 310, `evening azimuth ${evening.azimuth}`);
});

test('formats clock times around midnight and noon', () => {
  assert.equal(formatTime12h(0), '12:00 AM');
  assert.equal(formatTime12h(12 * 60), '12:00 PM');
  assert.equal(formatTime12h(13 * 60 + 7), '1:07 PM');
  assert.equal(formatTime12h(24 * 60), '12:00 AM');
});

test('rejects invalid inputs instead of returning misleading numbers', () => {
  assert.throws(() => dayOfYearFromDate('2026-02-30'), /valid calendar date/);
  assert.throws(() => dateFromDayOfYear(366, 2026), /between 1 and 365/);
  assert.throws(
    () => calculateSolarPosition({ ...DEMO, date: '2026-06-21', timeMinutes: -1 }),
    /timeMinutes/,
  );
  assert.throws(
    () => calculateSolarPosition({ ...DEMO, date: '2026-06-21', timeMinutes: 1440 }),
    /less than 1440/,
  );
  assert.throws(
    () => calculateSolarPosition({ ...DEMO, date: '2026-06-21', timeMinutes: 720, latitude: 91 }),
    /latitude/,
  );
  assert.throws(() => getTimeZoneOffsetHours('2026-01-01', 'Not/A_Zone'), /Invalid IANA/);
  assert.throws(() => formatTime12h(Number.NaN), /finite/);
});
