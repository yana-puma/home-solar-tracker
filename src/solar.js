/**
 * Dependency-free solar calculations based on NOAA's fractional-year equations.
 *
 * Angles returned by this module are degrees. Azimuth is clockwise from true
 * north (east = 90, south = 180). Dates are interpreted as local calendar
 * dates in the caller-provided IANA time zone; Date objects use their UTC
 * calendar fields so results do not depend on the browser's own time zone.
 */

const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;
const MINUTES_PER_DAY = 1440;

function assertFiniteNumber(value, name, minimum = -Infinity, maximum = Infinity) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be a finite number between ${minimum} and ${maximum}`);
  }
}

function makeUtcDate(year, month, day) {
  const result = new Date(0);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCFullYear(year, month - 1, day);
  return result;
}

function parseCalendarDate(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new RangeError('date must be valid');
    return {
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
    };
  }

  if (typeof value !== 'string') {
    throw new TypeError('date must be a Date or an ISO calendar date (YYYY-MM-DD)');
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError('date must use YYYY-MM-DD format');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = makeUtcDate(year, month, day);
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() + 1 !== month
    || candidate.getUTCDate() !== day
  ) {
    throw new RangeError('date must be a valid calendar date');
  }
  return { year, month, day };
}

function validateTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') {
    throw new TypeError('timeZone must be a non-empty IANA time zone name');
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
  } catch {
    throw new RangeError(`Invalid IANA time zone: ${timeZone}`);
  }
}

function offsetAtInstant(date, timeZone) {
  validateTimeZone(timeZone);
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new RangeError('date must be valid');
  }

  // longOffset is direct and preserves half-hour and quarter-hour offsets.
  const dateTimeOptions = {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  };
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      ...dateTimeOptions,
      timeZoneName: 'longOffset',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', dateTimeOptions);
  }
  const parts = formatter.formatToParts(date);
  const zoneName = parts.find((part) => part.type === 'timeZoneName')?.value;
  const match = /^GMT(?:([+-])(\d{1,2})(?::?(\d{2}))?)?$/.exec(zoneName ?? '');
  if (match) {
    if (!match[1]) return 0;
    const sign = match[1] === '-' ? -1 : 1;
    return sign * (Number(match[2]) + Number(match[3] ?? 0) / 60);
  }

  // Fallback for engines that do not implement `longOffset`.
  const values = Object.fromEntries(
    parts
      .filter((part) => ['year', 'month', 'day', 'hour', 'minute', 'second'].includes(part.type))
      .map((part) => [part.type, Number(part.value)]),
  );
  const representedAsUtc = makeUtcDate(values.year, values.month, values.day);
  representedAsUtc.setUTCHours(values.hour, values.minute, values.second, date.getUTCMilliseconds());
  return Math.round((representedAsUtc.getTime() - date.getTime()) / 60000) / 60;
}

function instantForLocalTime(calendarDate, timeMinutes, timeZone) {
  const wholeMinutes = Math.floor(timeMinutes);
  const seconds = (timeMinutes - wholeMinutes) * 60;
  const localAsUtc = makeUtcDate(calendarDate.year, calendarDate.month, calendarDate.day);
  localAsUtc.setUTCMinutes(wholeMinutes, seconds, 0);

  // Iterate because the first UTC guess can lie on the other side of a DST
  // boundary. Two passes converge for normal IANA transitions.
  let offset = offsetAtInstant(localAsUtc, timeZone);
  let instant = new Date(localAsUtc.getTime() - offset * 3600000);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const correctedOffset = offsetAtInstant(instant, timeZone);
    if (correctedOffset === offset) break;
    offset = correctedOffset;
    instant = new Date(localAsUtc.getTime() - offset * 3600000);
  }
  return instant;
}

/** Return the UTC offset in hours at an instant or at noon on an ISO date. */
export function getTimeZoneOffsetHours(date, timeZone) {
  validateTimeZone(timeZone);
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const calendarDate = parseCalendarDate(date);
    const instant = instantForLocalTime(calendarDate, 12 * 60, timeZone);
    return offsetAtInstant(instant, timeZone);
  }

  const instant = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(instant.getTime())) throw new RangeError('date must be valid');
  return offsetAtInstant(instant, timeZone);
}

export function dayOfYearFromDate(date) {
  const { year, month, day } = parseCalendarDate(date);
  const current = makeUtcDate(year, month, day);
  const start = makeUtcDate(year, 1, 1);
  return Math.floor((current.getTime() - start.getTime()) / 86400000) + 1;
}

export function dateFromDayOfYear(day, year) {
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new RangeError('year must be an integer between 1 and 9999');
  }
  const daysInYear = dayOfYearFromDate(`${String(year).padStart(4, '0')}-12-31`);
  if (!Number.isInteger(day) || day < 1 || day > daysInYear) {
    throw new RangeError(`day must be an integer between 1 and ${daysInYear}`);
  }
  const result = makeUtcDate(year, 1, 1);
  result.setUTCDate(day);
  return `${String(result.getUTCFullYear()).padStart(4, '0')}-${String(result.getUTCMonth() + 1).padStart(2, '0')}-${String(result.getUTCDate()).padStart(2, '0')}`;
}

function daysInCalendarYear(year) {
  return dayOfYearFromDate(`${String(year).padStart(4, '0')}-12-31`);
}

function solarTerms(calendarDate, timeMinutes) {
  const dayOfYear = dayOfYearFromDate(
    `${String(calendarDate.year).padStart(4, '0')}-${String(calendarDate.month).padStart(2, '0')}-${String(calendarDate.day).padStart(2, '0')}`,
  );
  const hours = timeMinutes / 60;
  const gamma = (2 * Math.PI / daysInCalendarYear(calendarDate.year))
    * (dayOfYear - 1 + (hours - 12) / 24);

  const equationOfTime = 229.18 * (
    0.000075
    + 0.001868 * Math.cos(gamma)
    - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma)
    - 0.040849 * Math.sin(2 * gamma)
  );
  const declination = 0.006918
    - 0.399912 * Math.cos(gamma)
    + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma)
    + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma)
    + 0.00148 * Math.sin(3 * gamma);

  return { equationOfTime, declination };
}

function validateSolarInputs({ date, timeMinutes, latitude, longitude, timeZone }, needsTime) {
  const calendarDate = parseCalendarDate(date);
  assertFiniteNumber(latitude, 'latitude', -90, 90);
  assertFiniteNumber(longitude, 'longitude', -180, 180);
  validateTimeZone(timeZone);
  if (needsTime) {
    assertFiniteNumber(timeMinutes, 'timeMinutes', 0, MINUTES_PER_DAY);
    if (timeMinutes === MINUTES_PER_DAY) {
      throw new RangeError('timeMinutes must be less than 1440');
    }
  }
  return calendarDate;
}

export function calculateSolarPosition({ date, timeMinutes, latitude, longitude, timeZone }) {
  const calendarDate = validateSolarInputs(
    { date, timeMinutes, latitude, longitude, timeZone },
    true,
  );
  const instant = instantForLocalTime(calendarDate, timeMinutes, timeZone);
  const utcOffsetHours = offsetAtInstant(instant, timeZone);
  const { equationOfTime, declination } = solarTerms(calendarDate, timeMinutes);

  const trueSolarMinutes = (
    timeMinutes + equationOfTime + 4 * longitude - 60 * utcOffsetHours
  ) % MINUTES_PER_DAY;
  let hourAngleDegrees = trueSolarMinutes / 4 - 180;
  if (hourAngleDegrees < -180) hourAngleDegrees += 360;

  const latitudeRadians = latitude * DEGREES_TO_RADIANS;
  const hourAngleRadians = hourAngleDegrees * DEGREES_TO_RADIANS;
  const cosineZenith = Math.max(-1, Math.min(1,
    Math.sin(latitudeRadians) * Math.sin(declination)
    + Math.cos(latitudeRadians) * Math.cos(declination) * Math.cos(hourAngleRadians),
  ));
  const zenith = Math.acos(cosineZenith);
  const altitude = 90 - zenith * RADIANS_TO_DEGREES;

  let azimuth = (
    Math.atan2(
      Math.sin(hourAngleRadians),
      Math.cos(hourAngleRadians) * Math.sin(latitudeRadians)
        - Math.tan(declination) * Math.cos(latitudeRadians),
    ) * RADIANS_TO_DEGREES + 180
  ) % 360;
  if (azimuth < 0) azimuth += 360;

  return { altitude, azimuth };
}

function formatDuration(totalMinutes) {
  const rounded = Math.max(0, Math.round(totalMinutes));
  return `${Math.floor(rounded / 60)}h ${rounded % 60}m`;
}

export function formatTime12h(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) throw new TypeError('totalMinutes must be finite');
  const normalized = ((Math.round(totalMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour24 = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${hour24 >= 12 ? 'PM' : 'AM'}`;
}

export function calculateDaylightStats({ date, latitude, longitude, timeZone }) {
  const calendarDate = validateSolarInputs({ date, latitude, longitude, timeZone }, false);
  const noonInstant = instantForLocalTime(calendarDate, 12 * 60, timeZone);
  const utcOffsetHours = offsetAtInstant(noonInstant, timeZone);
  const { equationOfTime, declination } = solarTerms(calendarDate, 12 * 60);
  const latitudeRadians = latitude * DEGREES_TO_RADIANS;

  // 90.833 degrees includes standard atmospheric refraction and the apparent
  // radius of the solar disc, matching NOAA's sunrise/sunset convention.
  const sunriseZenith = 90.833 * DEGREES_TO_RADIANS;
  const cosineHourAngle = (
    Math.cos(sunriseZenith) / (Math.cos(latitudeRadians) * Math.cos(declination))
    - Math.tan(latitudeRadians) * Math.tan(declination)
  );

  if (cosineHourAngle > 1) {
    return {
      sunrise: null,
      sunset: null,
      sunriseMinutes: null,
      sunsetMinutes: null,
      daylightMinutes: 0,
      daylightText: '0h 0m',
    };
  }
  if (cosineHourAngle < -1) {
    return {
      sunrise: null,
      sunset: null,
      sunriseMinutes: null,
      sunsetMinutes: null,
      daylightMinutes: MINUTES_PER_DAY,
      daylightText: '24h 0m',
    };
  }

  const hourAngleDegrees = Math.acos(cosineHourAngle) * RADIANS_TO_DEGREES;
  const solarNoonMinutes = 720 - 4 * longitude - equationOfTime + 60 * utcOffsetHours;
  const sunriseMinutes = Math.round(solarNoonMinutes - 4 * hourAngleDegrees);
  const sunsetMinutes = Math.round(solarNoonMinutes + 4 * hourAngleDegrees);
  const daylightMinutes = sunsetMinutes - sunriseMinutes;

  return {
    sunrise: formatTime12h(sunriseMinutes),
    sunset: formatTime12h(sunsetMinutes),
    sunriseMinutes,
    sunsetMinutes,
    daylightMinutes,
    daylightText: formatDuration(daylightMinutes),
  };
}
