import {
  calculateDaylightStats,
  calculateSolarPosition,
  dateFromDayOfYear,
  dayOfYearFromDate,
  formatTime12h,
  getTimeZoneOffsetHours,
} from './solar.js';

const MINUTES_PER_DAY = 1440;
const MAX_SAMPLING_MINUTES = 120;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const DEFAULT_TIME_WINDOWS = Object.freeze([
  Object.freeze({ id: 'whole-day', label: 'Whole day', startMinutes: 0, endMinutes: 1440 }),
  Object.freeze({ id: 'morning', label: 'Morning', startMinutes: 0, endMinutes: 720 }),
  Object.freeze({ id: 'midday', label: 'Midday', startMinutes: 720, endMinutes: 900 }),
  Object.freeze({ id: 'afternoon', label: 'Afternoon', startMinutes: 900, endMinutes: 1080 }),
  Object.freeze({ id: 'evening', label: 'Evening', startMinutes: 1080, endMinutes: 1440 }),
]);

export const METHOD_PROVENANCE = Object.freeze({
  'geometric-solar': Object.freeze({
    method: 'geometric-solar',
    label: 'Calculated solar geometry',
    claimLevel: 'calculated',
    description: 'Sun position and daylight are calculated from date, coordinates, and IANA time zone.',
    limitations: 'Does not include clouds, vegetation, buildings, terrain beyond the model, or measured site conditions.',
  }),
  'model-derived-direct-sun': Object.freeze({
    method: 'model-derived-direct-sun',
    label: 'Model-derived direct sun',
    claimLevel: 'modeled',
    description: 'Direct-sun opportunity is aggregated from time samples tested against configured model geometry.',
    limitations: 'Accuracy depends on model completeness, scale, north alignment, terrain, sampling interval, and spatial resolution.',
  }),
  'seasonal-estimate': Object.freeze({
    method: 'seasonal-estimate',
    label: 'Seasonal estimate',
    claimLevel: 'estimated',
    description: 'Seasonal exposure is an approximate planning indicator rather than a model-derived or measured result.',
    limitations: 'Must not be presented as measured exposure, professional solar access, or an energy-production guarantee.',
  }),
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertRecord(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function assertFinite(value, name, minimum = -Infinity, maximum = Infinity) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be a finite number between ${minimum} and ${maximum}`);
  }
}

function validateYear(year) {
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new RangeError('year must be an integer between 1 and 9999');
  }
  return year;
}

function validateMonth(month) {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError('month must be an integer between 1 and 12');
  }
  return month;
}

function validateSamplingMinutes(samplingMinutes) {
  if (
    !Number.isInteger(samplingMinutes)
    || samplingMinutes < 1
    || samplingMinutes > MAX_SAMPLING_MINUTES
  ) {
    throw new RangeError(`samplingMinutes must be an integer between 1 and ${MAX_SAMPLING_MINUTES}`);
  }
  return samplingMinutes;
}

function validateLocation({ latitude, longitude, timeZone }) {
  assertFinite(latitude, 'latitude', -90, 90);
  assertFinite(longitude, 'longitude', -180, 180);
  if (typeof timeZone !== 'string' || !timeZone.trim()) {
    throw new TypeError('timeZone must be a non-empty IANA time zone name');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
  } catch {
    throw new RangeError(`Invalid IANA time zone: ${timeZone}`);
  }
  return { latitude, longitude, timeZone };
}

function validateDate(date) {
  if (typeof date !== 'string' || !ISO_DATE.test(date)) {
    throw new RangeError('date must use YYYY-MM-DD format');
  }
  dayOfYearFromDate(date);
  return date;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isoDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeClockMinutes(minutes) {
  return ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

function polarState(daylightMinutes) {
  if (daylightMinutes === 0) return 'polar-night';
  if (daylightMinutes === MINUTES_PER_DAY) return 'polar-day';
  return 'normal';
}

export function getMethodProvenance(method) {
  if (typeof method !== 'string' || !(method in METHOD_PROVENANCE)) {
    throw new RangeError(`method must be one of: ${Object.keys(METHOD_PROVENANCE).join(', ')}`);
  }
  return clone(METHOD_PROVENANCE[method]);
}

/**
 * Representative local calendar dates for the four seasonal solar events.
 * These are comparison presets, not predictions of the exact astronomical
 * event instant, which can move by a calendar day depending on year and zone.
 */
export function getSeasonalPresetDates(year) {
  validateYear(year);
  return {
    marchEquinox: `${String(year).padStart(4, '0')}-03-20`,
    juneSolstice: `${String(year).padStart(4, '0')}-06-21`,
    septemberEquinox: `${String(year).padStart(4, '0')}-09-22`,
    decemberSolstice: `${String(year).padStart(4, '0')}-12-21`,
    provenance: {
      label: 'Representative seasonal dates',
      qualification: 'Calendar presets for comparison; not exact astronomical event timestamps.',
    },
  };
}

function findSolarNoonMinutes({ date, latitude, longitude, timeZone, samples, samplingMinutes }) {
  let best = samples[0];
  for (const sample of samples) {
    if (sample.altitude > best.altitude) best = sample;
  }

  const start = Math.max(0, Math.floor(best.timeMinutes - samplingMinutes));
  const end = Math.min(MINUTES_PER_DAY - 1, Math.ceil(best.timeMinutes + samplingMinutes));
  let bestMinute = best.timeMinutes;
  let bestAltitude = best.altitude;
  for (let timeMinutes = start; timeMinutes <= end; timeMinutes += 1) {
    const position = calculateSolarPosition({ date, timeMinutes, latitude, longitude, timeZone });
    if (position.altitude > bestAltitude) {
      bestMinute = timeMinutes;
      bestAltitude = position.altitude;
    }
  }
  return Math.round(bestMinute);
}

function buildDaySummary({ date, latitude, longitude, timeZone, samples, samplingMinutes }) {
  const daylight = calculateDaylightStats({ date, latitude, longitude, timeZone });
  const state = polarState(daylight.daylightMinutes);
  let solarNoonMinutes;

  if (daylight.sunriseMinutes !== null && daylight.sunsetMinutes !== null) {
    solarNoonMinutes = Math.round((daylight.sunriseMinutes + daylight.sunsetMinutes) / 2);
  } else {
    solarNoonMinutes = findSolarNoonMinutes({
      date,
      latitude,
      longitude,
      timeZone,
      samples,
      samplingMinutes,
    });
  }
  solarNoonMinutes = normalizeClockMinutes(solarNoonMinutes);
  const noonPosition = calculateSolarPosition({
    date,
    timeMinutes: solarNoonMinutes,
    latitude,
    longitude,
    timeZone,
  });

  const sunriseMinutes = daylight.sunriseMinutes === null
    ? null
    : normalizeClockMinutes(daylight.sunriseMinutes);
  const sunsetMinutes = daylight.sunsetMinutes === null
    ? null
    : normalizeClockMinutes(daylight.sunsetMinutes);

  return {
    sunriseMinutes,
    sunrise: sunriseMinutes === null ? null : formatTime12h(sunriseMinutes),
    solarNoonMinutes,
    solarNoon: formatTime12h(solarNoonMinutes),
    solarNoonAltitude: noonPosition.altitude,
    solarNoonAzimuth: noonPosition.azimuth,
    sunsetMinutes,
    sunset: sunsetMinutes === null ? null : formatTime12h(sunsetMinutes),
    daylightMinutes: daylight.daylightMinutes,
    daylightHours: daylight.daylightMinutes / 60,
    daylightText: daylight.daylightText,
    polarState: state,
    utcOffsetHoursAtNoon: getTimeZoneOffsetHours(date, timeZone),
  };
}

/** Return normalized solar samples and daylight summary for one local date. */
export function sampleSolarDay({
  date,
  latitude,
  longitude,
  timeZone,
  samplingMinutes = 30,
}) {
  validateDate(date);
  validateLocation({ latitude, longitude, timeZone });
  validateSamplingMinutes(samplingMinutes);

  const samples = [];
  for (let timeMinutes = 0; timeMinutes < MINUTES_PER_DAY; timeMinutes += samplingMinutes) {
    const position = calculateSolarPosition({ date, timeMinutes, latitude, longitude, timeZone });
    samples.push({
      date,
      timeMinutes,
      time: formatTime12h(timeMinutes),
      intervalMinutes: Math.min(samplingMinutes, MINUTES_PER_DAY - timeMinutes),
      dayFraction: timeMinutes / MINUTES_PER_DAY,
      altitude: position.altitude,
      azimuth: position.azimuth,
      isAboveHorizon: position.altitude > 0,
    });
  }

  const [year, month, day] = date.split('-').map(Number);
  return {
    kind: 'day',
    date,
    year,
    month,
    day,
    dayOfYear: dayOfYearFromDate(date),
    samplingMinutes,
    location: { latitude, longitude, timeZone },
    summary: buildDaySummary({
      date,
      latitude,
      longitude,
      timeZone,
      samples,
      samplingMinutes,
    }),
    samples,
    provenance: getMethodProvenance('geometric-solar'),
  };
}

function summarizeDays(days) {
  if (!Array.isArray(days) || days.length === 0) {
    throw new TypeError('days must be a non-empty array');
  }
  let shortest = days[0];
  let longest = days[0];
  let totalDaylightMinutes = 0;
  let polarDayCount = 0;
  let polarNightCount = 0;

  for (const day of days) {
    totalDaylightMinutes += day.summary.daylightMinutes;
    if (day.summary.daylightMinutes < shortest.summary.daylightMinutes) shortest = day;
    if (day.summary.daylightMinutes > longest.summary.daylightMinutes) longest = day;
    if (day.summary.polarState === 'polar-day') polarDayCount += 1;
    if (day.summary.polarState === 'polar-night') polarNightCount += 1;
  }

  return {
    dayCount: days.length,
    averageDaylightMinutes: totalDaylightMinutes / days.length,
    shortestDay: {
      date: shortest.date,
      daylightMinutes: shortest.summary.daylightMinutes,
    },
    longestDay: {
      date: longest.date,
      daylightMinutes: longest.summary.daylightMinutes,
    },
    polarDayCount,
    polarNightCount,
  };
}

/** Return one normalized daily sample for every date in a calendar month. */
export function sampleSolarMonth({
  year,
  month,
  latitude,
  longitude,
  timeZone,
  samplingMinutes = 60,
}) {
  validateYear(year);
  validateMonth(month);
  validateLocation({ latitude, longitude, timeZone });
  validateSamplingMinutes(samplingMinutes);

  const days = [];
  for (let day = 1; day <= daysInMonth(year, month); day += 1) {
    days.push(sampleSolarDay({
      date: isoDate(year, month, day),
      latitude,
      longitude,
      timeZone,
      samplingMinutes,
    }));
  }

  return {
    kind: 'month',
    year,
    month,
    samplingMinutes,
    location: { latitude, longitude, timeZone },
    days,
    summary: summarizeDays(days),
    provenance: getMethodProvenance('geometric-solar'),
  };
}

/** Return one normalized daily sample for every date in a calendar year. */
export function sampleSolarYear({
  year,
  latitude,
  longitude,
  timeZone,
  samplingMinutes = 60,
}) {
  validateYear(year);
  validateLocation({ latitude, longitude, timeZone });
  validateSamplingMinutes(samplingMinutes);

  const dayCount = isLeapYear(year) ? 366 : 365;
  const days = [];
  for (let ordinal = 1; ordinal <= dayCount; ordinal += 1) {
    days.push(sampleSolarDay({
      date: dateFromDayOfYear(ordinal, year),
      latitude,
      longitude,
      timeZone,
      samplingMinutes,
    }));
  }

  const months = [];
  for (let month = 1; month <= 12; month += 1) {
    const monthDays = days.filter((day) => day.month === month);
    months.push({ month, summary: summarizeDays(monthDays) });
  }

  return {
    kind: 'year',
    year,
    samplingMinutes,
    location: { latitude, longitude, timeZone },
    days,
    months,
    summary: summarizeDays(days),
    seasonalPresets: getSeasonalPresetDates(year),
    provenance: getMethodProvenance('geometric-solar'),
  };
}

/** Compare exactly two local calendar dates using identical sampling inputs. */
export function compareSolarDates({
  dateA,
  dateB,
  latitude,
  longitude,
  timeZone,
  samplingMinutes = 30,
}) {
  validateDate(dateA);
  validateDate(dateB);
  if (dateA === dateB) throw new RangeError('dateA and dateB must be different dates');

  const first = sampleSolarDay({ date: dateA, latitude, longitude, timeZone, samplingMinutes });
  const second = sampleSolarDay({ date: dateB, latitude, longitude, timeZone, samplingMinutes });
  return {
    kind: 'date-comparison',
    dates: [dateA, dateB],
    first,
    second,
    difference: {
      daylightMinutes: second.summary.daylightMinutes - first.summary.daylightMinutes,
      solarNoonMinutes: second.summary.solarNoonMinutes - first.summary.solarNoonMinutes,
      solarNoonAltitude: second.summary.solarNoonAltitude - first.summary.solarNoonAltitude,
      sunriseMinutes: first.summary.sunriseMinutes === null || second.summary.sunriseMinutes === null
        ? null
        : second.summary.sunriseMinutes - first.summary.sunriseMinutes,
      sunsetMinutes: first.summary.sunsetMinutes === null || second.summary.sunsetMinutes === null
        ? null
        : second.summary.sunsetMinutes - first.summary.sunsetMinutes,
    },
    provenance: getMethodProvenance('geometric-solar'),
  };
}

/** Compare two representative equinox/solstice presets. */
export function compareSeasonalPresets({
  year,
  presetA,
  presetB,
  latitude,
  longitude,
  timeZone,
  samplingMinutes = 30,
}) {
  const presets = getSeasonalPresetDates(year);
  const available = ['marchEquinox', 'juneSolstice', 'septemberEquinox', 'decemberSolstice'];
  if (!available.includes(presetA) || !available.includes(presetB)) {
    throw new RangeError(`presetA and presetB must be one of: ${available.join(', ')}`);
  }
  if (presetA === presetB) throw new RangeError('presetA and presetB must be different presets');
  return {
    presetA,
    presetB,
    presetQualification: presets.provenance.qualification,
    ...compareSolarDates({
      dateA: presets[presetA],
      dateB: presets[presetB],
      latitude,
      longitude,
      timeZone,
      samplingMinutes,
    }),
  };
}

function validateTimeWindows(windows) {
  if (!Array.isArray(windows) || windows.length === 0) {
    throw new TypeError('windows must be a non-empty array');
  }
  const seen = new Set();
  return windows.map((window, index) => {
    assertRecord(window, `windows[${index}]`);
    if (typeof window.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(window.id)) {
      throw new TypeError(`windows[${index}].id must be a lowercase slug`);
    }
    if (seen.has(window.id)) throw new RangeError(`windows[${index}].id must be unique`);
    seen.add(window.id);
    assertFinite(window.startMinutes, `windows[${index}].startMinutes`, 0, MINUTES_PER_DAY);
    assertFinite(window.endMinutes, `windows[${index}].endMinutes`, 0, MINUTES_PER_DAY);
    if (window.startMinutes >= window.endMinutes) {
      throw new RangeError(`windows[${index}] startMinutes must be less than endMinutes`);
    }
    return {
      id: window.id,
      label: typeof window.label === 'string' && window.label.trim() ? window.label.trim() : window.id,
      startMinutes: window.startMinutes,
      endMinutes: window.endMinutes,
    };
  });
}

function normalizedSunFraction(value, intervalMinutes, path) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') {
    assertFinite(value, path, 0, 1);
    return value;
  }
  assertRecord(value, path);
  if ('sunFraction' in value) {
    assertFinite(value.sunFraction, `${path}.sunFraction`, 0, 1);
    return value.sunFraction;
  }
  if ('exposed' in value) {
    if (typeof value.exposed !== 'boolean') throw new TypeError(`${path}.exposed must be boolean`);
    return value.exposed ? 1 : 0;
  }
  if ('sunMinutes' in value) {
    assertFinite(value.sunMinutes, `${path}.sunMinutes`, 0, intervalMinutes);
    return value.sunMinutes / intervalMinutes;
  }
  throw new TypeError(`${path} must be a boolean, a 0-1 fraction, or contain sunFraction, exposed, or sunMinutes`);
}

function normalizedExposureSeries(series) {
  if (!Array.isArray(series) || series.length === 0) {
    throw new TypeError('series must be a non-empty array');
  }
  const normalized = series.map((sample, index) => {
    assertRecord(sample, `series[${index}]`);
    validateDate(sample.date);
    assertFinite(sample.timeMinutes, `series[${index}].timeMinutes`, 0, MINUTES_PER_DAY - 1);
    assertFinite(sample.intervalMinutes, `series[${index}].intervalMinutes`, Number.EPSILON, MINUTES_PER_DAY);
    if (sample.timeMinutes + sample.intervalMinutes > MINUTES_PER_DAY) {
      throw new RangeError(`series[${index}] must not extend beyond the local calendar day`);
    }
    assertRecord(sample.zones, `series[${index}].zones`);
    const entries = Object.entries(sample.zones);
    if (entries.length === 0) throw new TypeError(`series[${index}].zones must not be empty`);
    const zones = {};
    for (const [zoneId, value] of entries) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(zoneId)) {
        throw new TypeError(`series[${index}].zones contains an invalid zone id: ${zoneId}`);
      }
      zones[zoneId] = normalizedSunFraction(
        value,
        sample.intervalMinutes,
        `series[${index}].zones.${zoneId}`,
      );
    }
    return {
      date: sample.date,
      timeMinutes: sample.timeMinutes,
      intervalMinutes: sample.intervalMinutes,
      zones,
    };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.timeMinutes - b.timeMinutes);

  const byDate = new Map();
  for (const sample of normalized) {
    const previous = byDate.get(sample.date);
    if (previous && sample.timeMinutes < previous.timeMinutes + previous.intervalMinutes) {
      throw new RangeError(`series contains overlapping intervals on ${sample.date}`);
    }
    byDate.set(sample.date, sample);
  }
  return normalized;
}

function overlapMinutes(startA, endA, startB, endB) {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function emptyZoneAggregate(zoneId, windows) {
  return {
    zoneId,
    observedMinutes: 0,
    sunMinutes: 0,
    sunFraction: null,
    firstSunMinutes: null,
    lastSunMinutes: null,
    longestContinuousSunMinutes: 0,
    windows: Object.fromEntries(windows.map((window) => [window.id, {
      id: window.id,
      label: window.label,
      startMinutes: window.startMinutes,
      endMinutes: window.endMinutes,
      observedMinutes: 0,
      sunMinutes: 0,
      sunFraction: null,
    }])),
    _activeStart: null,
    _activeEnd: null,
  };
}

function finishContinuousWindow(zone) {
  if (zone._activeStart !== null) {
    zone.longestContinuousSunMinutes = Math.max(
      zone.longestContinuousSunMinutes,
      zone._activeEnd - zone._activeStart,
    );
    zone._activeStart = null;
    zone._activeEnd = null;
  }
}

function finalizeZone(zone) {
  finishContinuousWindow(zone);
  zone.sunFraction = zone.observedMinutes > 0 ? zone.sunMinutes / zone.observedMinutes : null;
  for (const window of Object.values(zone.windows)) {
    window.sunFraction = window.observedMinutes > 0 ? window.sunMinutes / window.observedMinutes : null;
  }
  delete zone._activeStart;
  delete zone._activeEnd;
  return zone;
}

/**
 * Aggregate local-clock exposure snapshots into per-zone daily time windows.
 * Zone values may be booleans, 0-1 spatial exposure fractions, or objects with
 * `sunFraction`, `exposed`, or `sunMinutes`.
 */
export function aggregateZoneTimeWindows({
  series,
  windows = DEFAULT_TIME_WINDOWS,
  method = 'model-derived-direct-sun',
  minimumSunFraction = 0.5,
}) {
  const normalized = normalizedExposureSeries(series);
  const normalizedWindows = validateTimeWindows(windows);
  const provenance = getMethodProvenance(method);
  assertFinite(minimumSunFraction, 'minimumSunFraction', 0, 1);

  const dayMap = new Map();
  for (const sample of normalized) {
    if (!dayMap.has(sample.date)) dayMap.set(sample.date, new Map());
    const zonesForDay = dayMap.get(sample.date);
    const sampleEnd = sample.timeMinutes + sample.intervalMinutes;

    for (const [zoneId, fraction] of Object.entries(sample.zones)) {
      if (!zonesForDay.has(zoneId)) {
        zonesForDay.set(zoneId, emptyZoneAggregate(zoneId, normalizedWindows));
      }
      const zone = zonesForDay.get(zoneId);
      zone.observedMinutes += sample.intervalMinutes;
      zone.sunMinutes += sample.intervalMinutes * fraction;

      if (fraction >= minimumSunFraction) {
        if (zone.firstSunMinutes === null) zone.firstSunMinutes = sample.timeMinutes;
        zone.lastSunMinutes = sampleEnd;
        if (zone._activeStart === null || sample.timeMinutes > zone._activeEnd) {
          finishContinuousWindow(zone);
          zone._activeStart = sample.timeMinutes;
          zone._activeEnd = sampleEnd;
        } else {
          zone._activeEnd = Math.max(zone._activeEnd, sampleEnd);
        }
      } else {
        finishContinuousWindow(zone);
      }

      for (const window of normalizedWindows) {
        const overlap = overlapMinutes(
          sample.timeMinutes,
          sampleEnd,
          window.startMinutes,
          window.endMinutes,
        );
        if (overlap > 0) {
          zone.windows[window.id].observedMinutes += overlap;
          zone.windows[window.id].sunMinutes += overlap * fraction;
        }
      }
    }
  }

  const days = [];
  const overall = new Map();
  for (const [date, zonesForDay] of [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const zones = {};
    for (const [zoneId, aggregate] of [...zonesForDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const zone = finalizeZone(aggregate);
      zones[zoneId] = zone;
      if (!overall.has(zoneId)) {
        overall.set(zoneId, {
          zoneId,
          daysObserved: 0,
          observedMinutes: 0,
          sunMinutes: 0,
          averageDailySunMinutes: 0,
          windows: Object.fromEntries(normalizedWindows.map((window) => [window.id, {
            id: window.id,
            label: window.label,
            observedMinutes: 0,
            sunMinutes: 0,
            sunFraction: null,
          }])),
        });
      }
      const total = overall.get(zoneId);
      total.daysObserved += 1;
      total.observedMinutes += zone.observedMinutes;
      total.sunMinutes += zone.sunMinutes;
      for (const [windowId, window] of Object.entries(zone.windows)) {
        total.windows[windowId].observedMinutes += window.observedMinutes;
        total.windows[windowId].sunMinutes += window.sunMinutes;
      }
    }
    days.push({ date, zones });
  }

  const zones = {};
  for (const [zoneId, total] of [...overall.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    total.averageDailySunMinutes = total.sunMinutes / total.daysObserved;
    total.sunFraction = total.observedMinutes > 0 ? total.sunMinutes / total.observedMinutes : null;
    for (const window of Object.values(total.windows)) {
      window.sunFraction = window.observedMinutes > 0 ? window.sunMinutes / window.observedMinutes : null;
    }
    zones[zoneId] = total;
  }

  return {
    kind: 'zone-time-window-aggregation',
    dates: days.map((day) => day.date),
    minimumSunFraction,
    windows: normalizedWindows,
    days,
    zones,
    provenance,
    qualification: 'Aggregates supplied local-clock samples; it does not add weather, unmodeled obstructions, or measurement certainty.',
  };
}
