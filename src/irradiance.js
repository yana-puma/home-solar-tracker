/**
 * Dependency-free clear-sky irradiance and PV opportunity estimator.
 *
 * Inputs are already-calculated solar geometry samples. This module never
 * resolves civil time, coordinates, or time zones and therefore cannot shift
 * supplied local-calendar intervals.
 */

export const IRRADIANCE_MODEL_VERSION = 1;

export const IRRADIANCE_PROVENANCE = Object.freeze({
  method: 'haurwitz-isotropic-poa-planning',
  label: 'Clear-sky plane-of-array planning estimate',
  claimLevel: 'estimated',
  qualification: 'Planning estimate only. It is not measured production, a utility-grade forecast, a certified solar-access result, or a financial guarantee.',
  model: 'Haurwitz clear-sky GHI; declared direct/diffuse split; isotropic sky diffuse; ground-reflected component; cosine plane incidence.',
  limitations: 'Weather, aerosols, horizon detail, spectral response, temperature, inverter clipping, wiring, snow, soiling, degradation, mismatch, and obstructions absent from supplied sun fractions can materially change real output.',
});

const DEGREES_TO_RADIANS = Math.PI / 180;
const HAURWITZ_COEFFICIENT_W_M2 = 1098;
const HAURWITZ_OPTICAL_FACTOR = 0.059;
const DEFAULT_DIFFUSE_FRACTION = 0.15;
const DEFAULT_GROUND_ALBEDO = 0.2;
const DEFAULT_MODULE_EFFICIENCY = 0.2;
const DEFAULT_SYSTEM_LOSS = 0.14;
const DEFAULT_UNCERTAINTY = Object.freeze({ lowMultiplier: 0.7, highMultiplier: 1.1 });
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const EPSILON = 1e-12;

function record(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

function range(value, name, minimum, maximum, { maximumExclusive = false } = {}) {
  finite(value, name);
  if (value < minimum || (maximumExclusive ? value >= maximum : value > maximum)) {
    const comparator = maximumExclusive ? 'less than' : 'at most';
    throw new RangeError(`${name} must be at least ${minimum} and ${comparator} ${maximum}`);
  }
  return value;
}

function positive(value, name) {
  finite(value, name);
  if (!(value > 0)) throw new RangeError(`${name} must be greater than zero`);
  return value;
}

function fraction(value, name, { oneExclusive = false } = {}) {
  return range(value, name, 0, 1, { maximumExclusive: oneExclusive });
}

function parseDate(value, name = 'date') {
  if (typeof value !== 'string') throw new TypeError(`${name} must use YYYY-MM-DD format`);
  const match = ISO_DATE.exec(value);
  if (!match) throw new RangeError(`${name} must use YYYY-MM-DD format`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const days = daysInMonth(year, month);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > days) {
    throw new RangeError(`${name} must be a valid calendar date`);
  }
  return { value, year, month, day };
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  if (month < 1 || month > 12) return 0;
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function daysInYear(year) {
  return isLeapYear(year) ? 366 : 365;
}

function cloneProvenance() {
  return { ...IRRADIANCE_PROVENANCE };
}

function planeGeometry({ planeTiltDegrees, planeAzimuthDegrees }) {
  range(planeTiltDegrees, 'planeTiltDegrees', 0, 90);
  range(planeAzimuthDegrees, 'planeAzimuthDegrees', 0, 360, { maximumExclusive: true });
  return { planeTiltDegrees, planeAzimuthDegrees };
}

function irradianceAssumptions({
  diffuseFraction,
  groundAlbedo,
  systemLossFraction,
  moduleEfficiency,
  uncertainty,
  hasSunFraction,
  hasClimateDerate,
}) {
  return [
    `Clear-sky global horizontal irradiance uses Haurwitz coefficients ${HAURWITZ_COEFFICIENT_W_M2} W/m² and ${HAURWITZ_OPTICAL_FACTOR}.`,
    `Diffuse horizontal irradiance is fixed at ${(diffuseFraction * 100).toFixed(1)}% of clear-sky GHI; this is a transparent simplification, not a site atmosphere model.`,
    `Sky diffuse is isotropic and ground albedo is ${groundAlbedo}.`,
    'Each sample geometry is treated as constant across its declared interval; shorter intervals reduce this rectangular-integration approximation.',
    hasSunFraction
      ? 'Supplied model-derived sun fractions conservatively multiply the full plane-of-array opportunity, including diffuse and ground components.'
      : 'No model-derived shade factor was supplied; all clear-sky plane opportunity is treated as available.',
    hasClimateDerate
      ? 'User-declared monthly climate factors reduce clear-sky opportunity; they are not inferred weather data.'
      : 'No weather/climate reduction was supplied; results remain clear-sky opportunity rather than expected-weather production.',
    `Area-based energy uses declared module efficiency ${(moduleEfficiency * 100).toFixed(1)}%; rated-capacity energy uses 1 kW/m² reference irradiance.`,
    `Declared system losses are ${(systemLossFraction * 100).toFixed(1)}%.`,
    `The displayed range applies user/model multipliers ${uncertainty.lowMultiplier}–${uncertainty.highMultiplier} to the central estimate; it is not a statistical confidence interval.`,
  ];
}

function validateOpticalOptions({
  diffuseFraction = DEFAULT_DIFFUSE_FRACTION,
  groundAlbedo = DEFAULT_GROUND_ALBEDO,
} = {}) {
  fraction(diffuseFraction, 'diffuseFraction');
  fraction(groundAlbedo, 'groundAlbedo');
  return { diffuseFraction, groundAlbedo };
}

function validateUncertainty(value = DEFAULT_UNCERTAINTY) {
  record(value, 'uncertainty');
  positive(value.lowMultiplier, 'uncertainty.lowMultiplier');
  positive(value.highMultiplier, 'uncertainty.highMultiplier');
  if (value.lowMultiplier > 1 || value.highMultiplier < 1 || value.lowMultiplier > value.highMultiplier) {
    throw new RangeError('uncertainty multipliers must satisfy 0 < lowMultiplier <= 1 <= highMultiplier');
  }
  return { lowMultiplier: value.lowMultiplier, highMultiplier: value.highMultiplier };
}

function validateEnergyBasis({
  arrayAreaSquareMeters,
  systemRatingKw,
  moduleEfficiency = DEFAULT_MODULE_EFFICIENCY,
  systemLossFraction = DEFAULT_SYSTEM_LOSS,
} = {}) {
  if (arrayAreaSquareMeters !== undefined && systemRatingKw !== undefined) {
    throw new TypeError('supply arrayAreaSquareMeters or systemRatingKw, not both');
  }
  if (arrayAreaSquareMeters !== undefined) positive(arrayAreaSquareMeters, 'arrayAreaSquareMeters');
  if (systemRatingKw !== undefined) positive(systemRatingKw, 'systemRatingKw');
  fraction(moduleEfficiency, 'moduleEfficiency');
  if (moduleEfficiency === 0) throw new RangeError('moduleEfficiency must be greater than zero');
  fraction(systemLossFraction, 'systemLossFraction', { oneExclusive: true });
  return {
    arrayAreaSquareMeters: arrayAreaSquareMeters ?? null,
    systemRatingKw: systemRatingKw ?? null,
    moduleEfficiency,
    systemLossFraction,
    basis: arrayAreaSquareMeters !== undefined
      ? 'array-area-and-efficiency'
      : systemRatingKw !== undefined ? 'declared-dc-rating' : null,
  };
}

function normalizeClimateDerate(value) {
  if (value === undefined || value === null) return null;
  const result = Array(12).fill(1);
  if (Array.isArray(value)) {
    if (value.length !== 12) throw new TypeError('monthlyClimateDerate array must contain 12 factors');
    value.forEach((factor, index) => {
      result[index] = fraction(factor, `monthlyClimateDerate[${index}]`);
    });
    return result;
  }
  record(value, 'monthlyClimateDerate');
  for (const [key, factor] of Object.entries(value)) {
    const month = Number(key);
    if (!Number.isInteger(month) || month < 1 || month > 12 || String(month) !== key) {
      throw new RangeError('monthlyClimateDerate object keys must be canonical month numbers 1 through 12');
    }
    result[month - 1] = fraction(factor, `monthlyClimateDerate.${key}`);
  }
  return result;
}

function energyFromIrradiance(kWhPerSquareMeter, basis) {
  if (!basis.basis) return null;
  const beforeLosses = basis.basis === 'array-area-and-efficiency'
    ? kWhPerSquareMeter * basis.arrayAreaSquareMeters * basis.moduleEfficiency
    : kWhPerSquareMeter * basis.systemRatingKw;
  return beforeLosses * (1 - basis.systemLossFraction);
}

function energyRange(estimate, uncertainty) {
  if (estimate === null) return null;
  return {
    low: estimate * uncertainty.lowMultiplier,
    estimate,
    high: estimate * uncertainty.highMultiplier,
    lowMultiplier: uncertainty.lowMultiplier,
    highMultiplier: uncertainty.highMultiplier,
  };
}

/** Cosine of incidence on the front of a fixed plane. */
export function calculatePlaneIncidenceCosine({
  solarAltitudeDegrees,
  solarAzimuthDegrees,
  planeTiltDegrees,
  planeAzimuthDegrees,
} = {}) {
  range(solarAltitudeDegrees, 'solarAltitudeDegrees', -90, 90);
  range(solarAzimuthDegrees, 'solarAzimuthDegrees', 0, 360, { maximumExclusive: true });
  planeGeometry({ planeTiltDegrees, planeAzimuthDegrees });
  if (solarAltitudeDegrees <= 0) return 0;
  const altitude = solarAltitudeDegrees * DEGREES_TO_RADIANS;
  const tilt = planeTiltDegrees * DEGREES_TO_RADIANS;
  const azimuthDifference = (solarAzimuthDegrees - planeAzimuthDegrees) * DEGREES_TO_RADIANS;
  const cosine = Math.sin(altitude) * Math.cos(tilt)
    + Math.cos(altitude) * Math.sin(tilt) * Math.cos(azimuthDifference);
  return Math.max(0, Math.min(1, cosine));
}

/** Haurwitz clear-sky global horizontal irradiance in W/m². */
export function estimateClearSkyGhi(solarAltitudeDegrees) {
  range(solarAltitudeDegrees, 'solarAltitudeDegrees', -90, 90);
  if (solarAltitudeDegrees <= 0) return 0;
  const cosineZenith = Math.sin(solarAltitudeDegrees * DEGREES_TO_RADIANS);
  if (cosineZenith <= EPSILON) return 0;
  return HAURWITZ_COEFFICIENT_W_M2
    * cosineZenith
    * Math.exp(-HAURWITZ_OPTICAL_FACTOR / cosineZenith);
}

/** Estimate clear-sky irradiance components for one supplied solar sample. */
export function estimateClearSkyPlaneSample({
  altitude,
  azimuth,
  intervalMinutes,
  planeTiltDegrees,
  planeAzimuthDegrees,
  sunFraction = 1,
  climateDerate = 1,
  diffuseFraction = DEFAULT_DIFFUSE_FRACTION,
  groundAlbedo = DEFAULT_GROUND_ALBEDO,
} = {}) {
  range(altitude, 'altitude', -90, 90);
  range(azimuth, 'azimuth', 0, 360, { maximumExclusive: true });
  positive(intervalMinutes, 'intervalMinutes');
  planeGeometry({ planeTiltDegrees, planeAzimuthDegrees });
  fraction(sunFraction, 'sunFraction');
  fraction(climateDerate, 'climateDerate');
  validateOpticalOptions({ diffuseFraction, groundAlbedo });

  const cosineZenith = altitude > 0 ? Math.sin(altitude * DEGREES_TO_RADIANS) : 0;
  const incidenceCosine = calculatePlaneIncidenceCosine({
    solarAltitudeDegrees: altitude,
    solarAzimuthDegrees: azimuth,
    planeTiltDegrees,
    planeAzimuthDegrees,
  });
  const globalHorizontalWm2 = estimateClearSkyGhi(altitude);
  const diffuseHorizontalWm2 = globalHorizontalWm2 * diffuseFraction;
  const directNormalWm2 = cosineZenith > EPSILON
    ? Math.max(0, (globalHorizontalWm2 - diffuseHorizontalWm2) / cosineZenith)
    : 0;
  const tilt = planeTiltDegrees * DEGREES_TO_RADIANS;
  const directPlaneWm2 = directNormalWm2 * incidenceCosine;
  const skyDiffusePlaneWm2 = diffuseHorizontalWm2 * (1 + Math.cos(tilt)) / 2;
  const groundReflectedPlaneWm2 = globalHorizontalWm2 * groundAlbedo * (1 - Math.cos(tilt)) / 2;
  const planeClearSkyWm2 = directPlaneWm2 + skyDiffusePlaneWm2 + groundReflectedPlaneWm2;
  const planeAfterSunFractionWm2 = planeClearSkyWm2 * sunFraction;
  const planeClimateAdjustedWm2 = planeAfterSunFractionWm2 * climateDerate;
  const intervalHours = intervalMinutes / 60;

  return {
    altitude,
    azimuth,
    intervalMinutes,
    sunFraction,
    climateDerate,
    cosineZenith,
    incidenceCosine,
    irradianceWm2: {
      globalHorizontal: globalHorizontalWm2,
      directNormal: directNormalWm2,
      diffuseHorizontal: diffuseHorizontalWm2,
      planeDirect: directPlaneWm2,
      planeSkyDiffuse: skyDiffusePlaneWm2,
      planeGroundReflected: groundReflectedPlaneWm2,
      planeClearSky: planeClearSkyWm2,
      planeAfterSunFraction: planeAfterSunFractionWm2,
      planeClimateAdjusted: planeClimateAdjustedWm2,
    },
    opportunityKWhPerSquareMeter: {
      clearSky: planeClearSkyWm2 * intervalHours / 1000,
      afterSunFraction: planeAfterSunFractionWm2 * intervalHours / 1000,
      climateAdjusted: planeClimateAdjustedWm2 * intervalHours / 1000,
    },
  };
}

function normalizeSolarDay(solarDay) {
  record(solarDay, 'solarDay');
  const date = parseDate(solarDay.date, 'solarDay.date');
  if (!Array.isArray(solarDay.samples) || solarDay.samples.length === 0) {
    throw new TypeError('solarDay.samples must be a non-empty array');
  }
  let priorEnd = 0;
  const samples = solarDay.samples.map((sample, index) => {
    record(sample, `solarDay.samples[${index}]`);
    const timeMinutes = range(sample.timeMinutes, `solarDay.samples[${index}].timeMinutes`, 0, 1440, { maximumExclusive: true });
    const intervalMinutes = positive(sample.intervalMinutes, `solarDay.samples[${index}].intervalMinutes`);
    if (timeMinutes + intervalMinutes > 1440 + EPSILON) {
      throw new RangeError(`solarDay.samples[${index}] extends beyond its local calendar day`);
    }
    if (index > 0 && timeMinutes < priorEnd - EPSILON) {
      throw new RangeError('solarDay samples must be ordered and non-overlapping');
    }
    priorEnd = timeMinutes + intervalMinutes;
    const altitude = range(sample.altitude, `solarDay.samples[${index}].altitude`, -90, 90);
    const azimuth = range(sample.azimuth, `solarDay.samples[${index}].azimuth`, 0, 360, { maximumExclusive: true });
    if (sample.date !== undefined && sample.date !== solarDay.date) {
      throw new RangeError(`solarDay.samples[${index}].date must match solarDay.date`);
    }
    if (sample.isAboveHorizon !== undefined && typeof sample.isAboveHorizon !== 'boolean') {
      throw new TypeError(`solarDay.samples[${index}].isAboveHorizon must be boolean when supplied`);
    }
    if (sample.isAboveHorizon !== undefined && sample.isAboveHorizon !== (altitude > 0)) {
      throw new RangeError(`solarDay.samples[${index}].isAboveHorizon contradicts altitude`);
    }
    return { ...sample, timeMinutes, intervalMinutes, altitude, azimuth };
  });
  return { date, samples };
}

function resolveSunFraction(option, sample, index, sampleCount) {
  if (option === undefined) {
    return sample.sunFraction === undefined ? 1 : fraction(sample.sunFraction, `solarDay.samples[${index}].sunFraction`);
  }
  if (typeof option === 'number') return fraction(option, 'sunFraction');
  if (!Array.isArray(option) || option.length !== sampleCount) {
    throw new TypeError('sunFraction must be a factor or an array matching solarDay.samples');
  }
  return fraction(option[index], `sunFraction[${index}]`);
}

function aggregateSamples(samples) {
  return samples.reduce((totals, sample) => {
    for (const key of Object.keys(totals)) {
      totals[key] += sample.opportunityKWhPerSquareMeter[key];
    }
    return totals;
  }, { clearSky: 0, afterSunFraction: 0, climateAdjusted: 0 });
}

/** Integrate one supplied local-calendar solar day. */
export function estimateIrradianceDay({
  solarDay,
  planeTiltDegrees,
  planeAzimuthDegrees,
  sunFraction,
  arrayAreaSquareMeters,
  systemRatingKw,
  moduleEfficiency = DEFAULT_MODULE_EFFICIENCY,
  systemLossFraction = DEFAULT_SYSTEM_LOSS,
  monthlyClimateDerate,
  diffuseFraction = DEFAULT_DIFFUSE_FRACTION,
  groundAlbedo = DEFAULT_GROUND_ALBEDO,
  uncertainty = DEFAULT_UNCERTAINTY,
} = {}) {
  const day = normalizeSolarDay(solarDay);
  const plane = planeGeometry({ planeTiltDegrees, planeAzimuthDegrees });
  const optical = validateOpticalOptions({ diffuseFraction, groundAlbedo });
  const basis = validateEnergyBasis({ arrayAreaSquareMeters, systemRatingKw, moduleEfficiency, systemLossFraction });
  const normalizedUncertainty = validateUncertainty(uncertainty);
  const climate = normalizeClimateDerate(monthlyClimateDerate);
  if (Array.isArray(sunFraction) && sunFraction.length !== day.samples.length) {
    throw new TypeError('sunFraction must be a factor or an array matching solarDay.samples');
  }
  const climateFactor = climate?.[day.date.month - 1] ?? 1;
  const samples = day.samples.map((sample, index) => estimateClearSkyPlaneSample({
    altitude: sample.altitude,
    azimuth: sample.azimuth,
    intervalMinutes: sample.intervalMinutes,
    ...plane,
    ...optical,
    sunFraction: resolveSunFraction(sunFraction, sample, index, day.samples.length),
    climateDerate: climateFactor,
  }));
  const opportunityKWhPerSquareMeter = aggregateSamples(samples);
  const estimate = energyFromIrradiance(opportunityKWhPerSquareMeter.climateAdjusted, basis);
  return {
    kind: 'irradiance-day',
    modelVersion: IRRADIANCE_MODEL_VERSION,
    date: day.date.value,
    month: day.date.month,
    plane,
    optical,
    climateDerate: climateFactor,
    sampleCount: samples.length,
    representedMinutes: samples.reduce((total, sample) => total + sample.intervalMinutes, 0),
    opportunityKWhPerSquareMeter,
    energy: basis.basis ? {
      unit: 'kWh',
      basis,
      range: energyRange(estimate, normalizedUncertainty),
    } : null,
    samples,
    provenance: cloneProvenance(),
    assumptions: irradianceAssumptions({
      ...optical,
      ...basis,
      uncertainty: normalizedUncertainty,
      hasSunFraction: sunFraction !== undefined || day.samples.some((sample) => sample.sunFraction !== undefined),
      hasClimateDerate: climate !== null,
    }),
    uncertainty: normalizedUncertainty,
  };
}

function sumEnergyRanges(days) {
  if (!days[0]?.energy) return null;
  const range = { low: 0, estimate: 0, high: 0 };
  for (const day of days) {
    for (const key of Object.keys(range)) range[key] += day.energy.range[key];
  }
  return range;
}

function sameEnergyBasis(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Integrate supplied annual solar days without interpreting their clock zone. */
export function estimateIrradianceYear({ solarYear, ...options } = {}) {
  record(solarYear, 'solarYear');
  if (!Number.isInteger(solarYear.year) || solarYear.year < 1 || solarYear.year > 9999) {
    throw new RangeError('solarYear.year must be an integer between 1 and 9999');
  }
  if (!Array.isArray(solarYear.days) || solarYear.days.length === 0) {
    throw new TypeError('solarYear.days must be a non-empty array');
  }
  if (Array.isArray(options.sunFraction)) {
    throw new TypeError('annual sunFraction must be a scalar or supplied on individual samples');
  }
  const annualClimate = normalizeClimateDerate(options.monthlyClimateDerate);
  const dates = new Set();
  const days = solarYear.days.map((solarDay, index) => {
    const parsed = parseDate(solarDay?.date, `solarYear.days[${index}].date`);
    if (parsed.year !== solarYear.year) {
      throw new RangeError(`solarYear.days[${index}] is outside solarYear.year`);
    }
    if (dates.has(parsed.value)) throw new RangeError(`solarYear contains duplicate date ${parsed.value}`);
    dates.add(parsed.value);
    return estimateIrradianceDay({ solarDay, ...options });
  }).sort((left, right) => left.date.localeCompare(right.date));
  if (days.some((day) => !sameEnergyBasis(day.energy?.basis ?? null, days[0].energy?.basis ?? null))) {
    throw new TypeError('annual days must use one energy basis');
  }

  const monthly = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    calendarDays: daysInMonth(solarYear.year, index + 1),
    climateDerate: annualClimate?.[index] ?? 1,
    suppliedDays: 0,
    representedMinutes: 0,
    opportunityKWhPerSquareMeter: { clearSky: 0, afterSunFraction: 0, climateAdjusted: 0 },
    energy: days[0].energy ? { unit: 'kWh', range: { low: 0, estimate: 0, high: 0 } } : null,
  }));
  for (const day of days) {
    const month = monthly[day.month - 1];
    month.suppliedDays += 1;
    month.representedMinutes += day.representedMinutes;
    for (const key of Object.keys(month.opportunityKWhPerSquareMeter)) {
      month.opportunityKWhPerSquareMeter[key] += day.opportunityKWhPerSquareMeter[key];
    }
    if (month.energy) {
      for (const key of Object.keys(month.energy.range)) month.energy.range[key] += day.energy.range[key];
    }
  }
  const opportunityKWhPerSquareMeter = monthly.reduce((total, month) => {
    for (const key of Object.keys(total)) total[key] += month.opportunityKWhPerSquareMeter[key];
    return total;
  }, { clearSky: 0, afterSunFraction: 0, climateAdjusted: 0 });
  const expectedDayCount = daysInYear(solarYear.year);
  const suppliedDayCount = dates.size;
  const complete = suppliedDayCount === expectedDayCount
    && monthly.every((month) => month.suppliedDays === month.calendarDays);

  return {
    kind: 'irradiance-year',
    modelVersion: IRRADIANCE_MODEL_VERSION,
    year: solarYear.year,
    plane: days[0].plane,
    optical: days[0].optical,
    coverage: {
      suppliedDayCount,
      expectedDayCount,
      fraction: suppliedDayCount / expectedDayCount,
      complete,
      leapYear: isLeapYear(solarYear.year),
      qualification: complete
        ? `All ${expectedDayCount} local calendar days are represented.`
        : `Partial-year total: ${suppliedDayCount} of ${expectedDayCount} local calendar days are represented; missing days were not extrapolated.`,
    },
    representedMinutes: days.reduce((total, day) => total + day.representedMinutes, 0),
    opportunityKWhPerSquareMeter,
    energy: days[0].energy ? {
      unit: 'kWh',
      basis: days[0].energy.basis,
      range: {
        ...sumEnergyRanges(days),
        lowMultiplier: days[0].uncertainty.lowMultiplier,
        highMultiplier: days[0].uncertainty.highMultiplier,
      },
    } : null,
    months: monthly,
    days,
    provenance: cloneProvenance(),
    assumptions: [...days[0].assumptions],
    uncertainty: { ...days[0].uncertainty },
  };
}
