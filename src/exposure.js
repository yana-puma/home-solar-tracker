import { calculateSolarPosition, dayOfYearFromDate } from './solar.js';

const MINUTES_PER_DAY = 1440;
const DEGREES_TO_RADIANS = Math.PI / 180;
const YIELD_AFTER_RAYS = 256;

export const EXPOSURE_JOB_VERSION = 1;

export const EXPOSURE_TIERS = Object.freeze({
  quick: Object.freeze({
    tier: 'quick',
    columns: 12,
    rows: 16,
    samplingMinutes: 60,
    batchSolarSamples: 2,
  }),
  standard: Object.freeze({
    tier: 'standard',
    columns: 20,
    rows: 28,
    samplingMinutes: 30,
    batchSolarSamples: 2,
  }),
  high: Object.freeze({
    tier: 'high',
    columns: 32,
    rows: 44,
    samplingMinutes: 15,
    batchSolarSamples: 1,
  }),
});

function assertFinite(value, name, minimum = -Infinity, maximum = Infinity) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be a finite number between ${minimum} and ${maximum}`);
  }
}

function validatePoint(point, index) {
  if (!point || typeof point !== 'object') {
    throw new TypeError(`points[${index}] must be an object with x, y, and z coordinates`);
  }
  for (const coordinate of ['x', 'y', 'z']) {
    if (!Number.isFinite(point[coordinate])) {
      throw new TypeError(`points[${index}].${coordinate} must be finite`);
    }
  }
}

export function createExposureAbortError(message = 'Exposure calculation aborted') {
  if (typeof DOMException === 'function') {
    return new DOMException(message, 'AbortError');
  }
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function abortError() {
  return createExposureAbortError();
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function yieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Convert a solar position into a normalized model-space ray direction.
 *
 * Viewer coordinates are Y-up, -Z north, -X east, +Z south, and +X west.
 * The vector points from a ground sample toward the Sun. A positive north
 * offset rotates model north clockwise from true north, so it is subtracted
 * from true solar azimuth when producing a model-local direction.
 */
export function sunDirection({ altitude, azimuth, northOffsetDegrees = 0 }) {
  assertFinite(altitude, 'altitude', -90, 90);
  assertFinite(azimuth, 'azimuth');
  assertFinite(northOffsetDegrees, 'northOffsetDegrees');

  const altitudeRadians = altitude * DEGREES_TO_RADIANS;
  const modelAzimuthRadians = (azimuth - northOffsetDegrees) * DEGREES_TO_RADIANS;
  const horizontal = Math.cos(altitudeRadians);
  return {
    x: -horizontal * Math.sin(modelAzimuthRadians),
    y: Math.sin(altitudeRadians),
    z: -horizontal * Math.cos(modelAzimuthRadians),
  };
}

/** Create evenly spaced, cell-centered ground samples in an X/Z rectangle. */
export function generateGroundSampleGrid(
  bounds,
  terrainElevation,
  { columns = 20, rows = 20 } = {},
) {
  if (!bounds || typeof bounds !== 'object') {
    throw new TypeError('bounds must contain minX, maxX, minZ, and maxZ');
  }
  for (const key of ['minX', 'maxX', 'minZ', 'maxZ']) {
    if (!Number.isFinite(bounds[key])) throw new TypeError(`bounds.${key} must be finite`);
  }
  if (!(bounds.minX < bounds.maxX) || !(bounds.minZ < bounds.maxZ)) {
    throw new RangeError('bounds minimums must be less than maximums');
  }
  if (typeof terrainElevation !== 'function') {
    throw new TypeError('terrainElevation must be a function');
  }
  if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) {
    throw new RangeError('columns and rows must be positive integers');
  }

  const cellWidth = (bounds.maxX - bounds.minX) / columns;
  const cellDepth = (bounds.maxZ - bounds.minZ) / rows;
  const points = [];
  for (let row = 0; row < rows; row += 1) {
    const z = bounds.minZ + (row + 0.5) * cellDepth;
    for (let column = 0; column < columns; column += 1) {
      const x = bounds.minX + (column + 0.5) * cellWidth;
      const y = terrainElevation(x, z);
      if (!Number.isFinite(y)) {
        throw new TypeError(`terrainElevation returned a non-finite value at (${x}, ${z})`);
      }
      points.push({ x, y, z });
    }
  }
  return points;
}

/**
 * Approximate direct-sun exposure by sampling one local calendar day.
 *
 * `isOccluded(point, direction)` may return a boolean or Promise<boolean>.
 * The return value is `{ sampleCount, samplingMinutes, exposures }`, where
 * every exposure is `{ point, sunMinutes, sunHours }` and retains the original
 * point reference.
 */
export async function calculateDirectSunExposure({
  date,
  latitude,
  longitude,
  timeZone,
  northOffsetDegrees = 0,
  samplingMinutes = 15,
  points,
  isOccluded,
  signal,
}) {
  assertFinite(latitude, 'latitude', -90, 90);
  assertFinite(longitude, 'longitude', -180, 180);
  assertFinite(northOffsetDegrees, 'northOffsetDegrees');
  if (!Number.isInteger(samplingMinutes) || samplingMinutes < 1 || samplingMinutes > 120) {
    throw new RangeError('samplingMinutes must be an integer between 1 and 120');
  }
  if (!Array.isArray(points) || points.length === 0) {
    throw new TypeError('points must be a non-empty array');
  }
  points.forEach(validatePoint);
  if (typeof isOccluded !== 'function') {
    throw new TypeError('isOccluded must be a function');
  }
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean')) {
    throw new TypeError('signal must be an AbortSignal');
  }

  throwIfAborted(signal);
  const exposures = points.map((point) => ({ point, sunMinutes: 0, sunHours: 0 }));
  let sampleCount = 0;
  let raysSinceYield = 0;

  for (let timeMinutes = 0; timeMinutes < MINUTES_PER_DAY; timeMinutes += samplingMinutes) {
    throwIfAborted(signal);
    const solarPosition = calculateSolarPosition({
      date,
      timeMinutes,
      latitude,
      longitude,
      timeZone,
    });
    if (solarPosition.altitude <= 0) continue;

    sampleCount += 1;
    const direction = sunDirection({
      ...solarPosition,
      northOffsetDegrees,
    });
    const intervalMinutes = Math.min(samplingMinutes, MINUTES_PER_DAY - timeMinutes);

    for (let index = 0; index < points.length; index += 1) {
      throwIfAborted(signal);
      const blocked = await isOccluded(points[index], direction);
      if (typeof blocked !== 'boolean') {
        throw new TypeError('isOccluded must return a boolean or Promise<boolean>');
      }
      if (!blocked) exposures[index].sunMinutes += intervalMinutes;

      raysSinceYield += 1;
      if (raysSinceYield >= YIELD_AFTER_RAYS) {
        raysSinceYield = 0;
        await yieldToEventLoop();
        throwIfAborted(signal);
      }
    }
  }

  for (const exposure of exposures) {
    exposure.sunHours = exposure.sunMinutes / 60;
  }
  return { sampleCount, samplingMinutes, exposures };
}

function assertRecord(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function normalizeTier(tier = 'standard') {
  if (typeof tier !== 'string' || !(tier in EXPOSURE_TIERS)) {
    throw new RangeError(`tier must be one of: ${Object.keys(EXPOSURE_TIERS).join(', ')}`);
  }
  return tier;
}

function validateNonEmptyString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function validateTimeZone(timeZone) {
  const normalized = validateNonEmptyString(timeZone, 'timeZone');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date(0));
  } catch {
    throw new RangeError(`Invalid IANA time zone: ${normalized}`);
  }
  return normalized;
}

function normalizeBounds(bounds) {
  assertRecord(bounds, 'grid.bounds');
  const normalized = {};
  for (const key of ['minX', 'maxX', 'minZ', 'maxZ']) {
    if (!Number.isFinite(bounds[key])) throw new TypeError(`grid.bounds.${key} must be finite`);
    normalized[key] = bounds[key];
  }
  if (!(normalized.minX < normalized.maxX) || !(normalized.minZ < normalized.maxZ)) {
    throw new RangeError('grid.bounds minimums must be less than maximums');
  }
  return normalized;
}

function normalizeFiniteArray(value, name, expectedLength) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    throw new TypeError(`${name} must be an array or typed array`);
  }
  if (expectedLength !== undefined && value.length !== expectedLength) {
    throw new RangeError(`${name} must contain exactly ${expectedLength} values`);
  }
  const normalized = new Float64Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    if (!Number.isFinite(value[index])) throw new TypeError(`${name}[${index}] must be finite`);
    normalized[index] = value[index];
  }
  return normalized;
}

function normalizeGrid(grid, tierDefaults) {
  assertRecord(grid, 'grid');
  const bounds = normalizeBounds(grid.bounds);
  const columns = grid.columns ?? tierDefaults.columns;
  const rows = grid.rows ?? tierDefaults.rows;
  if (!Number.isInteger(columns) || columns < 1 || columns > 512) {
    throw new RangeError('grid.columns must be an integer between 1 and 512');
  }
  if (!Number.isInteger(rows) || rows < 1 || rows > 512) {
    throw new RangeError('grid.rows must be an integer between 1 and 512');
  }
  const pointCount = columns * rows;
  const baseElevation = grid.baseElevation ?? 0;
  assertFinite(baseElevation, 'grid.baseElevation');
  const elevations = grid.elevations == null
    ? null
    : normalizeFiniteArray(grid.elevations, 'grid.elevations', pointCount);
  return { bounds, columns, rows, pointCount, baseElevation, elevations };
}

function normalizeOcclusion(occlusion) {
  assertRecord(occlusion, 'occlusion');
  const type = occlusion.type;
  if (!['none', 'triangle-soup', 'visibility-matrix'].includes(type)) {
    throw new RangeError('occlusion.type must be none, triangle-soup, or visibility-matrix');
  }
  if (type === 'none') return { type };

  if (type === 'triangle-soup') {
    const triangles = normalizeFiniteArray(occlusion.triangles, 'occlusion.triangles');
    if (triangles.length === 0 || triangles.length % 9 !== 0) {
      throw new RangeError('occlusion.triangles must contain xyz coordinates for complete triangles');
    }
    const originOffset = occlusion.originOffset ?? 0.03;
    const maxDistance = occlusion.maxDistance ?? 1000;
    assertFinite(originOffset, 'occlusion.originOffset', 0);
    assertFinite(maxDistance, 'occlusion.maxDistance', Number.EPSILON);
    return { type, triangles, originOffset, maxDistance };
  }

  const blocked = occlusion.blocked;
  if (!Array.isArray(blocked) && !ArrayBuffer.isView(blocked)) {
    throw new TypeError('occlusion.blocked must be an array or typed array');
  }
  const normalizedBlocked = new Uint8Array(blocked.length);
  for (let index = 0; index < blocked.length; index += 1) {
    const value = blocked[index];
    if (value !== 0 && value !== 1 && value !== false && value !== true) {
      throw new RangeError(`occlusion.blocked[${index}] must be boolean, 0, or 1`);
    }
    normalizedBlocked[index] = value ? 1 : 0;
  }
  return { type, blocked: normalizedBlocked };
}

/**
 * Validate and normalize a worker-compatible exposure job.
 *
 * The returned object contains only structured-clone-compatible values.
 */
export function normalizeExposureJob(job) {
  assertRecord(job, 'job');
  const jobVersion = job.jobVersion ?? EXPOSURE_JOB_VERSION;
  if (jobVersion !== EXPOSURE_JOB_VERSION) {
    throw new RangeError(`jobVersion must be ${EXPOSURE_JOB_VERSION}`);
  }
  const tier = normalizeTier(job.tier);
  const tierDefaults = EXPOSURE_TIERS[tier];
  const propertyRevision = validateNonEmptyString(job.propertyRevision, 'propertyRevision');
  const modelHash = validateNonEmptyString(job.modelHash, 'modelHash');
  if (typeof job.date !== 'string') throw new TypeError('date must use YYYY-MM-DD format');
  dayOfYearFromDate(job.date);
  assertFinite(job.latitude, 'latitude', -90, 90);
  assertFinite(job.longitude, 'longitude', -180, 180);
  const timeZone = validateTimeZone(job.timeZone);
  const northOffsetDegrees = job.northOffsetDegrees ?? 0;
  assertFinite(northOffsetDegrees, 'northOffsetDegrees');
  const samplingMinutes = job.samplingMinutes ?? tierDefaults.samplingMinutes;
  if (!Number.isInteger(samplingMinutes) || samplingMinutes < 1 || samplingMinutes > 120) {
    throw new RangeError('samplingMinutes must be an integer between 1 and 120');
  }
  const batchSolarSamples = job.batchSolarSamples ?? tierDefaults.batchSolarSamples;
  if (!Number.isInteger(batchSolarSamples) || batchSolarSamples < 1 || batchSolarSamples > 48) {
    throw new RangeError('batchSolarSamples must be an integer between 1 and 48');
  }
  const grid = normalizeGrid(job.grid, tierDefaults);
  const occlusion = normalizeOcclusion(job.occlusion ?? { type: 'none' });

  const normalized = {
    jobVersion,
    tier,
    propertyRevision,
    modelHash,
    date: job.date,
    latitude: job.latitude,
    longitude: job.longitude,
    timeZone,
    northOffsetDegrees,
    samplingMinutes,
    batchSolarSamples,
    grid,
    occlusion,
  };
  return normalized;
}

function hashNumericArray(values) {
  if (!values) return 'none';
  let hash = 0x811c9dc5;
  for (let index = 0; index < values.length; index += 1) {
    const text = Number(values[index]).toString();
    for (let charIndex = 0; charIndex < text.length; charIndex += 1) {
      hash ^= text.charCodeAt(charIndex);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 124;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${values.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Create a deterministic cache key for every input that can change exposure. */
export function createExposureCacheKey(job) {
  const normalized = normalizeExposureJob(job);
  const payload = {
    jobVersion: normalized.jobVersion,
    propertyRevision: normalized.propertyRevision,
    modelHash: normalized.modelHash,
    date: normalized.date,
    latitude: normalized.latitude,
    longitude: normalized.longitude,
    timeZone: normalized.timeZone,
    northOffsetDegrees: normalized.northOffsetDegrees,
    tier: normalized.tier,
    samplingMinutes: normalized.samplingMinutes,
    grid: {
      bounds: normalized.grid.bounds,
      columns: normalized.grid.columns,
      rows: normalized.grid.rows,
      baseElevation: normalized.grid.baseElevation,
      elevations: hashNumericArray(normalized.grid.elevations),
    },
    occlusion: {
      type: normalized.occlusion.type,
      geometry: normalized.occlusion.type === 'triangle-soup'
        ? hashNumericArray(normalized.occlusion.triangles)
        : normalized.occlusion.type === 'visibility-matrix'
          ? hashNumericArray(normalized.occlusion.blocked)
          : 'none',
      originOffset: normalized.occlusion.originOffset ?? null,
      maxDistance: normalized.occlusion.maxDistance ?? null,
    },
  };
  return `exposure:${EXPOSURE_JOB_VERSION}:${JSON.stringify(payload)}`;
}

function pointsFromNormalizedGrid(grid) {
  const { bounds, columns, rows, elevations, baseElevation } = grid;
  const cellWidth = (bounds.maxX - bounds.minX) / columns;
  const cellDepth = (bounds.maxZ - bounds.minZ) / rows;
  const points = [];
  for (let row = 0; row < rows; row += 1) {
    const z = bounds.minZ + (row + 0.5) * cellDepth;
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      points.push({
        x: bounds.minX + (column + 0.5) * cellWidth,
        y: elevations ? elevations[index] : baseElevation,
        z,
      });
    }
  }
  return points;
}

function rayIntersectsTriangleSoup(point, direction, occlusion) {
  const triangles = occlusion.triangles;
  const ox = point.x + direction.x * occlusion.originOffset;
  const oy = point.y + direction.y * occlusion.originOffset;
  const oz = point.z + direction.z * occlusion.originOffset;
  const epsilon = 1e-9;

  for (let index = 0; index < triangles.length; index += 9) {
    const ax = triangles[index];
    const ay = triangles[index + 1];
    const az = triangles[index + 2];
    const edge1x = triangles[index + 3] - ax;
    const edge1y = triangles[index + 4] - ay;
    const edge1z = triangles[index + 5] - az;
    const edge2x = triangles[index + 6] - ax;
    const edge2y = triangles[index + 7] - ay;
    const edge2z = triangles[index + 8] - az;

    const hx = direction.y * edge2z - direction.z * edge2y;
    const hy = direction.z * edge2x - direction.x * edge2z;
    const hz = direction.x * edge2y - direction.y * edge2x;
    const determinant = edge1x * hx + edge1y * hy + edge1z * hz;
    if (Math.abs(determinant) < epsilon) continue;
    const inverse = 1 / determinant;
    const sx = ox - ax;
    const sy = oy - ay;
    const sz = oz - az;
    const u = inverse * (sx * hx + sy * hy + sz * hz);
    if (u < 0 || u > 1) continue;

    const qx = sy * edge1z - sz * edge1y;
    const qy = sz * edge1x - sx * edge1z;
    const qz = sx * edge1y - sy * edge1x;
    const v = inverse * (direction.x * qx + direction.y * qy + direction.z * qz);
    if (v < 0 || u + v > 1) continue;

    const distance = inverse * (edge2x * qx + edge2y * qy + edge2z * qz);
    if (distance > epsilon && distance <= occlusion.maxDistance) return true;
  }
  return false;
}

function serializeProgress(exposures, completedSolarSamples, totalSolarSamples, completedRays, totalRays) {
  return {
    completedSolarSamples,
    totalSolarSamples,
    completedRays,
    totalRays,
    progress: totalRays === 0 ? 1 : completedRays / totalRays,
    sunMinutes: exposures.map((exposure) => exposure.sunMinutes),
  };
}

/**
 * Produce the stable point and above-horizon ray ordering used by serializable
 * jobs. Callers with a scene-specific raycaster can use this plan to build a
 * visibility-matrix without duplicating the scheduler's ordering rules.
 */
export function createExposureRayPlan(job) {
  const normalized = normalizeExposureJob(job);
  const points = pointsFromNormalizedGrid(normalized.grid);
  const solarSamples = [];
  for (let timeMinutes = 0; timeMinutes < MINUTES_PER_DAY; timeMinutes += normalized.samplingMinutes) {
    const position = calculateSolarPosition({
      date: normalized.date,
      timeMinutes,
      latitude: normalized.latitude,
      longitude: normalized.longitude,
      timeZone: normalized.timeZone,
    });
    if (position.altitude <= 0) continue;
    solarSamples.push({
      timeMinutes,
      intervalMinutes: Math.min(normalized.samplingMinutes, MINUTES_PER_DAY - timeMinutes),
      altitude: position.altitude,
      azimuth: position.azimuth,
      direction: sunDirection({ ...position, northOffsetDegrees: normalized.northOffsetDegrees }),
    });
  }
  return {
    points,
    solarSamples,
    pointCount: points.length,
    solarSampleCount: solarSamples.length,
    rayCount: points.length * solarSamples.length,
  };
}

/**
 * Calculate a structured-clone-compatible exposure job.
 *
 * This supports unobstructed studies, a world-space two-sided triangle soup,
 * or a caller-precomputed visibility matrix. It is shared by the Web Worker
 * and the synchronous scheduler fallback.
 */
export async function calculateSerializableExposure(job, { signal, onProgress } = {}) {
  const normalized = normalizeExposureJob(job);
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean')) {
    throw new TypeError('signal must be an AbortSignal');
  }
  if (onProgress !== undefined && typeof onProgress !== 'function') {
    throw new TypeError('onProgress must be a function');
  }
  throwIfAborted(signal);

  const plan = createExposureRayPlan(normalized);
  const { points, solarSamples, rayCount: totalRays } = plan;

  if (
    normalized.occlusion.type === 'visibility-matrix'
    && normalized.occlusion.blocked.length !== totalRays
  ) {
    throw new RangeError(`occlusion.blocked must contain exactly ${totalRays} values for this job`);
  }

  const exposures = points.map((point) => ({ point, sunMinutes: 0, sunHours: 0 }));
  let completedRays = 0;

  if (totalRays === 0 && onProgress) {
    await onProgress(serializeProgress(exposures, 0, 0, 0, 0));
    await yieldToEventLoop();
    throwIfAborted(signal);
  }

  for (let solarIndex = 0; solarIndex < solarSamples.length; solarIndex += 1) {
    throwIfAborted(signal);
    const solarSample = solarSamples[solarIndex];
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      let blocked = false;
      if (normalized.occlusion.type === 'triangle-soup') {
        blocked = rayIntersectsTriangleSoup(
          points[pointIndex],
          solarSample.direction,
          normalized.occlusion,
        );
      } else if (normalized.occlusion.type === 'visibility-matrix') {
        blocked = normalized.occlusion.blocked[solarIndex * points.length + pointIndex] === 1;
      }
      if (!blocked) exposures[pointIndex].sunMinutes += solarSample.intervalMinutes;
      completedRays += 1;
      if (completedRays % YIELD_AFTER_RAYS === 0) throwIfAborted(signal);
    }

    const completedSolarSamples = solarIndex + 1;
    const shouldUpdate = (
      completedSolarSamples % normalized.batchSolarSamples === 0
      || completedSolarSamples === solarSamples.length
    );
    if (shouldUpdate) {
      if (onProgress) {
        await onProgress(serializeProgress(
          exposures,
          completedSolarSamples,
          solarSamples.length,
          completedRays,
          totalRays,
        ));
      }
      await yieldToEventLoop();
      throwIfAborted(signal);
    }
  }

  for (const exposure of exposures) exposure.sunHours = exposure.sunMinutes / 60;
  return {
    jobVersion: normalized.jobVersion,
    tier: normalized.tier,
    date: normalized.date,
    samplingMinutes: normalized.samplingMinutes,
    sampleCount: solarSamples.length,
    rayCount: totalRays,
    grid: {
      bounds: normalized.grid.bounds,
      columns: normalized.grid.columns,
      rows: normalized.grid.rows,
      pointCount: normalized.grid.pointCount,
    },
    exposures,
    provenance: {
      method: normalized.occlusion.type === 'none'
        ? 'geometric-unobstructed'
        : 'model-derived-direct-sun',
      label: normalized.occlusion.type === 'none'
        ? 'Unobstructed geometric direct sun'
        : 'Model-derived direct sun',
      qualification: normalized.occlusion.type === 'none'
        ? 'Does not include any site obstruction model.'
        : 'Depends on serialized geometry or visibility data, model completeness, alignment, and sampling resolution.',
      occlusionContract: normalized.occlusion.type,
    },
  };
}
