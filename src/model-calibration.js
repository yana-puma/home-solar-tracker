/**
 * Pure, Three.js-independent model calibration and QA helpers.
 *
 * Viewer coordinates are Y-up, -Z model north, -X model east. Bearings are
 * clockwise from north. A positive north offset means model north is clockwise
 * from true north, matching exposure.sunDirection().
 */

export const MODEL_CALIBRATION_VERSION = 1;

export const LENGTH_UNITS = Object.freeze({
  meters: 1,
  feet: 0.3048,
  centimeters: 0.01,
  millimeters: 0.001,
});

const SEVERITY_ORDER = Object.freeze({ error: 0, warning: 1, info: 2 });
const EPSILON = 1e-9;
const DEFAULT_SCALE_WARNING_TOLERANCE = 0.02;
const DEFAULT_SCALE_ERROR_TOLERANCE = 0.1;
const DEFAULT_TRIANGLE_WARNING = 500_000;
const DEFAULT_TRIANGLE_ERROR = 2_000_000;

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

function positive(value, name) {
  finite(value, name);
  if (!(value > 0)) throw new RangeError(`${name} must be greater than zero`);
  return value;
}

function nonNegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
  return value;
}

function unitFactor(units, name = 'units') {
  if (typeof units !== 'string' || !(units in LENGTH_UNITS)) {
    throw new RangeError(`${name} must be one of: ${Object.keys(LENGTH_UNITS).join(', ')}`);
  }
  return LENGTH_UNITS[units];
}

function point3(value, name) {
  if (Array.isArray(value)) {
    if (value.length !== 3) throw new TypeError(`${name} must contain exactly three coordinates`);
    value.forEach((coordinate, index) => finite(coordinate, `${name}[${index}]`));
    return { x: value[0], y: value[1], z: value[2] };
  }
  record(value, name);
  finite(value.x, `${name}.x`);
  finite(value.y, `${name}.y`);
  finite(value.z, `${name}.z`);
  return { x: value.x, y: value.y, z: value.z };
}

function horizontalPoint(value, name) {
  if (Array.isArray(value)) {
    if (value.length !== 2 && value.length !== 3) {
      throw new TypeError(`${name} must contain x/z or x/y/z coordinates`);
    }
    if (value.length === 2) {
      finite(value[0], `${name}[0]`);
      finite(value[1], `${name}[1]`);
      return { x: value[0], z: value[1] };
    }
    return point3(value, name);
  }
  record(value, name);
  finite(value.x, `${name}.x`);
  finite(value.z, `${name}.z`);
  if (value.y !== undefined) finite(value.y, `${name}.y`);
  return { x: value.x, z: value.z, ...(value.y === undefined ? {} : { y: value.y }) };
}

function normalizeBearing(value) {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function normalizeSignedAngle(value) {
  const normalized = normalizeBearing(value + 180) - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function round(value, digits = 12) {
  const rounded = Number(value.toFixed(digits));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function finding(severity, code, message, remediation, details = {}) {
  return { severity, code, message, remediation, details };
}

function summarizeFindings(findings) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const item of findings) counts[item.severity] += 1;
  return {
    status: counts.error ? 'fail' : counts.warning ? 'review' : 'pass',
    counts,
  };
}

function sortFindings(findings) {
  return [...findings].sort((left, right) => (
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    || left.code.localeCompare(right.code)
    || JSON.stringify(left.details).localeCompare(JSON.stringify(right.details))
  ));
}

function withSummary(value, findings) {
  const ordered = sortFindings(findings);
  return { ...value, ...summarizeFindings(ordered), findings: ordered };
}

function bounds2(value, name = 'groundBounds') {
  record(value, name);
  const result = {};
  for (const key of ['minX', 'maxX', 'minZ', 'maxZ']) {
    result[key] = finite(value[key], `${name}.${key}`);
  }
  if (!(result.minX < result.maxX) || !(result.minZ < result.maxZ)) {
    throw new RangeError(`${name} minimums must be less than maximums`);
  }
  return result;
}

function bounds3(value, name = 'bounds') {
  record(value, name);
  const min = point3(value.min, `${name}.min`);
  const max = point3(value.max, `${name}.max`);
  for (const axis of ['x', 'y', 'z']) {
    if (!(min[axis] < max[axis])) {
      throw new RangeError(`${name}.min.${axis} must be less than ${name}.max.${axis}`);
    }
  }
  return { min, max };
}

function optionalAssetHash(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^(sha256-[A-Za-z0-9+/]+={0,2}|[a-fA-F0-9]{64})$/.test(value)) {
    throw new TypeError('assetHash must be a SHA-256 SRI value or 64-character hexadecimal digest');
  }
  return value;
}

/** Convert a length among the model contract's supported unit systems. */
export function convertLength(value, fromUnits, toUnits) {
  finite(value, 'value');
  const meters = value * unitFactor(fromUnits, 'fromUnits');
  return meters / unitFactor(toUnits, 'toUnits');
}

/**
 * Solve north offset from a known directed line.
 *
 * `trueBearingDegrees` describes the bearing from `from` to `to`. Reversing
 * either the bearing or the points changes the solution by 180 degrees.
 */
export function calculateNorthOffset({
  from,
  to,
  trueBearingDegrees,
  minimumHorizontalSeparation = 1e-6,
} = {}) {
  const start = horizontalPoint(from, 'from');
  const end = horizontalPoint(to, 'to');
  finite(trueBearingDegrees, 'trueBearingDegrees');
  if (trueBearingDegrees < 0 || trueBearingDegrees >= 360) {
    throw new RangeError('trueBearingDegrees must be at least 0 and less than 360');
  }
  positive(minimumHorizontalSeparation, 'minimumHorizontalSeparation');

  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const distanceModelUnits = Math.hypot(dx, dz);
  if (distanceModelUnits < minimumHorizontalSeparation) {
    throw new RangeError('reference points must have distinct horizontal positions');
  }

  // In model coordinates east is -X and north is -Z.
  const localBearingDegrees = normalizeBearing(Math.atan2(-dx, -dz) * 180 / Math.PI);
  const northOffsetDegrees = normalizeSignedAngle(trueBearingDegrees - localBearingDegrees);
  return {
    from: start,
    to: end,
    northOffsetDegrees: round(northOffsetDegrees),
    localBearingDegrees: round(localBearingDegrees),
    trueBearingDegrees,
    distanceModelUnits: round(distanceModelUnits),
    convention: 'Y-up; -Z model north; -X model east; bearings clockwise from north',
  };
}

/** Solve a viewer scale multiplier from one model/real dimension pair. */
export function calculateScaleFromDimension({
  modelLength,
  realLength,
  modelUnits = 'meters',
  realUnits = 'meters',
} = {}) {
  positive(modelLength, 'modelLength');
  positive(realLength, 'realLength');
  const realMeters = realLength * unitFactor(realUnits, 'realUnits');
  const declaredUnitScale = unitFactor(modelUnits, 'modelUnits');
  const recommendedScale = realMeters / modelLength;
  return {
    recommendedScale,
    realMeters,
    declaredUnitScale,
    scaleCorrectionFactor: recommendedScale / declaredUnitScale,
  };
}

function validateTolerance(warningTolerance, errorTolerance) {
  finite(warningTolerance, 'warningTolerance');
  finite(errorTolerance, 'errorTolerance');
  if (warningTolerance < 0 || errorTolerance <= warningTolerance || errorTolerance >= 1) {
    throw new RangeError('tolerances must satisfy 0 <= warningTolerance < errorTolerance < 1');
  }
}

/** Assess configured model units/scale against one or more measured dimensions. */
export function assessModelScale({
  modelUnits,
  configuredScale,
  dimensions,
  defaultRealUnits = 'meters',
  warningTolerance = DEFAULT_SCALE_WARNING_TOLERANCE,
  errorTolerance = DEFAULT_SCALE_ERROR_TOLERANCE,
} = {}) {
  const modelFactor = unitFactor(modelUnits, 'modelUnits');
  positive(configuredScale, 'configuredScale');
  unitFactor(defaultRealUnits, 'defaultRealUnits');
  validateTolerance(warningTolerance, errorTolerance);
  if (!Array.isArray(dimensions) || dimensions.length === 0) {
    throw new TypeError('dimensions must be a non-empty array');
  }

  const findings = [];
  const evidence = dimensions.map((dimension, index) => {
    record(dimension, `dimensions[${index}]`);
    const id = dimension.id === undefined ? `dimension-${index + 1}` : dimension.id;
    if (typeof id !== 'string' || !id.trim()) {
      throw new TypeError(`dimensions[${index}].id must be a non-empty string when supplied`);
    }
    const modelLength = positive(dimension.modelLength, `dimensions[${index}].modelLength`);
    const realLength = positive(dimension.realLength, `dimensions[${index}].realLength`);
    const realUnits = dimension.realUnits ?? defaultRealUnits;
    const realMeters = realLength * unitFactor(realUnits, `dimensions[${index}].realUnits`);
    // The current viewer applies model.scale directly to decoded coordinates;
    // model.units tells us which direct multiplier would normally be expected.
    const predictedMeters = modelLength * configuredScale;
    const recommendedScale = realMeters / modelLength;
    const signedErrorRatio = (predictedMeters - realMeters) / realMeters;
    const absoluteErrorRatio = Math.abs(signedErrorRatio);
    const details = {
      id: id.trim(),
      predictedMeters: round(predictedMeters),
      realMeters: round(realMeters),
      signedErrorPercent: round(signedErrorRatio * 100, 8),
      recommendedScale: round(recommendedScale),
    };
    if (absoluteErrorRatio >= errorTolerance) {
      findings.push(finding(
        'error',
        'dimension_scale_mismatch',
        `${id.trim()} differs from its real dimension by ${round(absoluteErrorRatio * 100, 4)}%.`,
        'Confirm both unit declarations and remeasure the reference; then apply the recommended scale only after resolving inconsistent evidence.',
        details,
      ));
    } else if (absoluteErrorRatio >= warningTolerance) {
      findings.push(finding(
        'warning',
        'dimension_scale_drift',
        `${id.trim()} differs from its real dimension by ${round(absoluteErrorRatio * 100, 4)}%.`,
        'Review measurement endpoints and consider updating model.scale.',
        details,
      ));
    } else {
      findings.push(finding(
        'info',
        'dimension_scale_within_tolerance',
        `${id.trim()} is within the configured scale tolerance.`,
        'Retain the measurement as calibration provenance.',
        details,
      ));
    }
    return {
      id: id.trim(),
      modelLength,
      realLength,
      realUnits,
      realMeters: round(realMeters),
      predictedMeters: round(predictedMeters),
      signedErrorRatio,
      recommendedScale,
    };
  });

  const recommendations = evidence.map((item) => item.recommendedScale).sort((a, b) => a - b);
  const middle = Math.floor(recommendations.length / 2);
  const recommendedScale = recommendations.length % 2
    ? recommendations[middle]
    : (recommendations[middle - 1] + recommendations[middle]) / 2;
  const maximumRecommendationDeviation = Math.max(
    ...recommendations.map((value) => Math.abs(value - recommendedScale) / recommendedScale),
  );
  if (evidence.length > 1 && maximumRecommendationDeviation >= errorTolerance) {
    findings.push(finding(
      'error',
      'inconsistent_reference_dimensions',
      'Reference dimensions imply materially different scale multipliers.',
      'Check that dimensions use the same model revision, axes, measurement endpoints, and real-world units.',
      { maximumDeviationPercent: round(maximumRecommendationDeviation * 100, 8) },
    ));
  } else if (evidence.length > 1 && maximumRecommendationDeviation >= warningTolerance) {
    findings.push(finding(
      'warning',
      'reference_dimension_spread',
      'Reference dimensions have a noticeable spread in implied scale.',
      'Add a longer independently measured reference dimension before finalizing scale.',
      { maximumDeviationPercent: round(maximumRecommendationDeviation * 100, 8) },
    ));
  }

  return withSummary({
    modelUnits,
    configuredScale,
    declaredUnitScale: modelFactor,
    effectiveMetersPerModelUnit: configuredScale,
    scaleCorrectionFactor: configuredScale / modelFactor,
    recommendedScale: round(recommendedScale),
    dimensions: evidence,
    tolerances: { warning: warningTolerance, error: errorTolerance },
  }, findings);
}

/** Assess supplied bounding-box and mesh complexity statistics. */
export function assessModelGeometry({
  bounds,
  units = 'meters',
  scale = 1,
  triangleCount,
  vertexCount,
  meshCount,
  triangleWarning = DEFAULT_TRIANGLE_WARNING,
  triangleError = DEFAULT_TRIANGLE_ERROR,
} = {}) {
  const factor = unitFactor(units);
  positive(scale, 'scale');
  nonNegativeInteger(triangleWarning, 'triangleWarning');
  nonNegativeInteger(triangleError, 'triangleError');
  if (!(triangleWarning < triangleError)) {
    throw new RangeError('triangleWarning must be less than triangleError');
  }
  const normalizedBounds = bounds === undefined ? null : bounds3(bounds, 'bounds');
  const findings = [];
  let extentsModelUnits = null;
  let extentsMeters = null;
  if (normalizedBounds) {
    extentsModelUnits = {
      x: normalizedBounds.max.x - normalizedBounds.min.x,
      y: normalizedBounds.max.y - normalizedBounds.min.y,
      z: normalizedBounds.max.z - normalizedBounds.min.z,
    };
    extentsMeters = Object.fromEntries(
      Object.entries(extentsModelUnits).map(([axis, value]) => [axis, value * scale]),
    );
    const largest = Math.max(...Object.values(extentsMeters));
    const smallest = Math.min(...Object.values(extentsMeters));
    if (largest > 1_000) {
      findings.push(finding('warning', 'model_extent_unusually_large', 'Model extent exceeds one kilometer.', 'Confirm units and scale before using the model for shadow decisions.', { largestExtentMeters: round(largest) }));
    } else if (largest < 0.1) {
      findings.push(finding('warning', 'model_extent_unusually_small', 'All model extents are below 10 centimeters.', 'Confirm units and scale before using the model for shadow decisions.', { largestExtentMeters: round(largest) }));
    }
    if (largest / smallest > 1_000) {
      findings.push(finding('warning', 'model_extent_extreme_aspect', 'Model bounding box has an extreme aspect ratio.', 'Inspect for stray geometry or an incorrect export axis.', { aspectRatio: round(largest / smallest) }));
    }
  } else {
    findings.push(finding('warning', 'model_bounds_missing', 'No model bounding box was supplied.', 'Calculate the local-space bounding box after loading the GLB and rerun calibration.', {}));
  }

  const normalizedStats = {};
  for (const [key, value] of Object.entries({ triangleCount, vertexCount, meshCount })) {
    if (value !== undefined) normalizedStats[key] = nonNegativeInteger(value, key);
  }
  if (triangleCount === undefined) {
    findings.push(finding('warning', 'triangle_count_missing', 'No triangle count was supplied.', 'Record decoded render-triangle statistics for performance QA.', {}));
  } else if (triangleCount === 0) {
    findings.push(finding('error', 'model_has_no_triangles', 'Model reports zero triangles.', 'Verify the GLB mesh export and decoded primitive statistics.', {}));
  } else if (triangleCount >= triangleError) {
    findings.push(finding('error', 'triangle_budget_exceeded', 'Model exceeds the error triangle budget.', 'Create a decimated viewer asset while preserving a separately archived source model.', { triangleCount, triangleError }));
  } else if (triangleCount >= triangleWarning) {
    findings.push(finding('warning', 'triangle_budget_high', 'Model exceeds the warning triangle budget.', 'Profile mobile rendering and consider a decimated viewer asset.', { triangleCount, triangleWarning }));
  } else {
    findings.push(finding('info', 'triangle_budget_ok', 'Model is below the configured triangle warning budget.', 'Retain the triangle count with the calibration record.', { triangleCount, triangleWarning }));
  }
  if (meshCount === 0 || vertexCount === 0) {
    findings.push(finding('error', 'empty_model_statistic', 'A supplied model statistic reports an empty model.', 'Verify decoded mesh statistics before release.', { meshCount, vertexCount }));
  }

  return withSummary({
    bounds: normalizedBounds,
    units,
    scale,
    declaredUnitScale: factor,
    extentsModelUnits,
    extentsMeters,
    stats: normalizedStats,
    budgets: { triangleWarning, triangleError },
  }, findings);
}

function normalizeTerrainProfile(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError('terrainProfile must be an array');
  return value.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 2) {
      throw new TypeError(`terrainProfile[${index}] must be [z, elevation]`);
    }
    return [finite(point[0], `terrainProfile[${index}][0]`), finite(point[1], `terrainProfile[${index}][1]`)];
  });
}

function terrainElevationAt(profile, z) {
  if (profile.length === 0) return 0;
  if (z <= profile[0][0]) return profile[0][1];
  if (z >= profile.at(-1)[0]) return profile.at(-1)[1];
  for (let index = 1; index < profile.length; index += 1) {
    if (z <= profile[index][0]) {
      const [z0, y0] = profile[index - 1];
      const [z1, y1] = profile[index];
      return y0 + (y1 - y0) * ((z - z0) / (z1 - z0));
    }
  }
  return 0;
}

/** Validate placement, ground coverage, model containment, and camera presets. */
export function validateSceneCalibration({
  origin,
  groundBounds,
  terrainProfile = [],
  cameraPresets = {},
  modelBounds,
  modelScale = 1,
  groundContactWarning = 0.25,
  groundContactError = 1,
  cameraEnvelopeFactor = 2,
} = {}) {
  const normalizedOrigin = point3(origin, 'origin');
  const normalizedGround = bounds2(groundBounds);
  const profile = normalizeTerrainProfile(terrainProfile);
  record(cameraPresets, 'cameraPresets');
  positive(modelScale, 'modelScale');
  finite(groundContactWarning, 'groundContactWarning');
  finite(groundContactError, 'groundContactError');
  if (groundContactWarning < 0 || groundContactError <= groundContactWarning) {
    throw new RangeError('ground contact thresholds must satisfy 0 <= warning < error');
  }
  positive(cameraEnvelopeFactor, 'cameraEnvelopeFactor');
  const normalizedModelBounds = modelBounds === undefined ? null : bounds3(modelBounds, 'modelBounds');
  const findings = [];

  if (normalizedOrigin.x < normalizedGround.minX || normalizedOrigin.x > normalizedGround.maxX
    || normalizedOrigin.z < normalizedGround.minZ || normalizedOrigin.z > normalizedGround.maxZ) {
    findings.push(finding('error', 'origin_outside_ground_bounds', 'Model origin is outside the configured ground bounds.', 'Move model.position inside groundBounds or correct the bounds.', { origin: normalizedOrigin }));
  } else {
    findings.push(finding('info', 'origin_within_ground_bounds', 'Model origin lies within the ground bounds.', 'Retain the origin with the calibration record.', { origin: normalizedOrigin }));
  }

  for (let index = 1; index < profile.length; index += 1) {
    if (!(profile[index - 1][0] < profile[index][0])) {
      throw new RangeError('terrainProfile z coordinates must be strictly increasing');
    }
  }
  if (profile.length === 0) {
    findings.push(finding('info', 'flat_ground_assumed', 'No terrain profile was supplied; elevation zero is assumed.', 'Add a terrain profile when slope materially affects shadows.', {}));
  } else if (profile[0][0] > normalizedGround.minZ || profile.at(-1)[0] < normalizedGround.maxZ) {
    findings.push(finding('error', 'terrain_coverage_incomplete', 'Terrain profile does not span the full ground-bounds Z range.', 'Extend terrainProfile through groundBounds.minZ and groundBounds.maxZ.', { profileMinZ: profile[0][0], profileMaxZ: profile.at(-1)[0] }));
  } else {
    findings.push(finding('info', 'terrain_coverage_complete', 'Terrain profile spans the configured ground bounds.', 'Retain the sampled profile with its source provenance.', {}));
  }

  let worldModelBounds = null;
  if (normalizedModelBounds) {
    worldModelBounds = {
      min: {
        x: normalizedOrigin.x + normalizedModelBounds.min.x * modelScale,
        y: normalizedOrigin.y + normalizedModelBounds.min.y * modelScale,
        z: normalizedOrigin.z + normalizedModelBounds.min.z * modelScale,
      },
      max: {
        x: normalizedOrigin.x + normalizedModelBounds.max.x * modelScale,
        y: normalizedOrigin.y + normalizedModelBounds.max.y * modelScale,
        z: normalizedOrigin.z + normalizedModelBounds.max.z * modelScale,
      },
    };
    if (worldModelBounds.min.x < normalizedGround.minX || worldModelBounds.max.x > normalizedGround.maxX
      || worldModelBounds.min.z < normalizedGround.minZ || worldModelBounds.max.z > normalizedGround.maxZ) {
      findings.push(finding('error', 'model_footprint_outside_ground_bounds', 'Transformed model footprint extends outside ground bounds.', 'Expand ground bounds or correct model position/scale.', { worldModelBounds }));
    } else {
      findings.push(finding('info', 'model_footprint_contained', 'Transformed model footprint is contained by ground bounds.', 'Retain these bounds with the model revision.', {}));
    }
    const groundY = terrainElevationAt(profile, normalizedOrigin.z);
    const groundGap = worldModelBounds.min.y - groundY;
    if (Math.abs(groundGap) >= groundContactError) {
      findings.push(finding('error', 'model_ground_contact_error', 'Model base is materially separated from the terrain at its origin.', 'Correct model.position.y, local origin, model scale, or terrain elevation.', { groundGap: round(groundGap), groundY: round(groundY) }));
    } else if (Math.abs(groundGap) >= groundContactWarning) {
      findings.push(finding('warning', 'model_ground_contact_drift', 'Model base has a noticeable terrain gap at its origin.', 'Inspect ground contact and adjust vertical placement if needed.', { groundGap: round(groundGap), groundY: round(groundY) }));
    } else {
      findings.push(finding('info', 'model_ground_contact_ok', 'Model base is near the terrain elevation at its origin.', 'Check several footprint points when terrain is sloped.', { groundGap: round(groundGap), groundY: round(groundY) }));
    }
  } else {
    findings.push(finding('warning', 'scene_model_bounds_missing', 'Scene containment cannot check the model footprint without local bounds.', 'Supply decoded local model bounds.', {}));
  }

  const width = normalizedGround.maxX - normalizedGround.minX;
  const depth = normalizedGround.maxZ - normalizedGround.minZ;
  const diagonal = Math.hypot(width, depth);
  const verticalMin = Math.min(0, worldModelBounds?.min.y ?? 0) - diagonal * cameraEnvelopeFactor;
  const verticalMax = Math.max(0, worldModelBounds?.max.y ?? 0) + diagonal * cameraEnvelopeFactor;
  const cameras = [];
  for (const key of Object.keys(cameraPresets).sort()) {
    const camera = record(cameraPresets[key], `cameraPresets.${key}`);
    const position = point3(camera.position, `cameraPresets.${key}.position`);
    const target = point3(camera.target, `cameraPresets.${key}.target`);
    const distance = Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z);
    if (distance < EPSILON) {
      findings.push(finding('error', 'camera_position_equals_target', `Camera ${key} has the same position and target.`, 'Move the camera or target to define a view direction.', { camera: key }));
    }
    const targetContained = target.x >= normalizedGround.minX && target.x <= normalizedGround.maxX
      && target.z >= normalizedGround.minZ && target.z <= normalizedGround.maxZ
      && target.y >= verticalMin && target.y <= verticalMax;
    if (!targetContained) {
      findings.push(finding('error', 'camera_target_outside_scene', `Camera ${key} targets outside the calibrated scene envelope.`, 'Move the target inside the ground/model envelope.', { camera: key, target }));
    }
    const positionContained = position.x >= normalizedGround.minX - width * cameraEnvelopeFactor
      && position.x <= normalizedGround.maxX + width * cameraEnvelopeFactor
      && position.z >= normalizedGround.minZ - depth * cameraEnvelopeFactor
      && position.z <= normalizedGround.maxZ + depth * cameraEnvelopeFactor
      && position.y >= verticalMin && position.y <= verticalMax;
    if (!positionContained) {
      findings.push(finding('warning', 'camera_position_outside_envelope', `Camera ${key} is unusually far outside the scene envelope.`, 'Confirm the preset is intentional and that near/far clipping remains usable.', { camera: key, position }));
    }
    if (distance >= EPSILON && targetContained && positionContained) {
      findings.push(finding('info', 'camera_contained', `Camera ${key} is contained by the QA envelope.`, 'Retain this preset with the calibration record.', { camera: key }));
    }
    cameras.push({ id: key, position, target, distance: round(distance), targetContained, positionContained });
  }
  if (cameras.length === 0) {
    findings.push(finding('warning', 'camera_presets_missing', 'No camera presets were supplied for containment checks.', 'Add at least one overview preset with a target inside ground bounds.', {}));
  }

  return withSummary({
    origin: normalizedOrigin,
    groundBounds: normalizedGround,
    terrainProfile: profile,
    modelBounds: normalizedModelBounds,
    modelScale,
    worldModelBounds,
    cameras,
  }, findings);
}

/** Guidance for using a solar-noon shadow only as an orientation cross-check. */
export function solarNoonAlignmentGuidance({ northOffsetDegrees } = {}) {
  finite(northOffsetDegrees, 'northOffsetDegrees');
  return {
    method: 'solar-noon-shadow-field-check',
    northOffsetDegrees,
    claimLevel: 'approximate field check',
    steps: [
      'Use the property date, IANA time zone, and coordinates to calculate local solar noon.',
      'At that time, mark the shadow axis of a verified vertical object on level ground.',
      'Use the calculated solar azimuth or a surveyed/map reference to resolve the shadow axis 180-degree ambiguity.',
      'Compare the observed axis with the configured model north offset and record conditions and uncertainty.',
    ],
    qualification: 'A solar-noon shadow can reveal gross orientation errors, but it is not an automatic survey. Clock error, an unlevel reference, terrain, horizon obstruction, atmospheric effects, coordinate uncertainty, and the 180-degree axis ambiguity can all affect the check.',
  };
}

function canonicalize(value, path = 'calibration') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return finite(value, path);
  if (Array.isArray(value)) return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${path} must contain only JSON-compatible plain objects, arrays, strings, booleans, finite numbers, and null`);
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) throw new TypeError(`${path}.${key} must not be undefined`);
    result[key] = canonicalize(value[key], `${path}.${key}`);
  }
  return result;
}

/** Create stable UTF-8 input suitable for a shareable SHA-256 revision. */
export function createCalibrationRevisionInput(calibration) {
  record(calibration, 'calibration');
  const payload = canonicalize({
    calibrationVersion: MODEL_CALIBRATION_VERSION,
    calibration,
  });
  return {
    algorithm: 'SHA-256',
    encoding: 'UTF-8',
    value: JSON.stringify(payload),
  };
}

/** Hash canonical revision input with browser/Node Web Crypto. */
export async function hashCalibrationRevision(revisionInput, cryptoRef = globalThis.crypto) {
  record(revisionInput, 'revisionInput');
  if (revisionInput.algorithm !== 'SHA-256' || revisionInput.encoding !== 'UTF-8' || typeof revisionInput.value !== 'string') {
    throw new TypeError('revisionInput must be produced by createCalibrationRevisionInput');
  }
  if (!cryptoRef?.subtle?.digest) throw new Error('Web Crypto SHA-256 is unavailable');
  const digest = new Uint8Array(await cryptoRef.subtle.digest('SHA-256', new TextEncoder().encode(revisionInput.value)));
  const hex = [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
  return {
    algorithm: 'SHA-256',
    digestHex: hex,
    revision: `cal-v${MODEL_CALIBRATION_VERSION}-${hex.slice(0, 16)}`,
  };
}

/** Run all supplied calibration checks and aggregate a shareable result. */
export function createCalibrationAssessment({
  northReference,
  scaleEvidence,
  scene,
  model,
  assetHash,
} = {}) {
  if (northReference === undefined && scaleEvidence === undefined && scene === undefined && model === undefined) {
    throw new TypeError('at least one calibration input must be supplied');
  }
  const north = northReference === undefined ? null : calculateNorthOffset(northReference);
  const scale = scaleEvidence === undefined ? null : assessModelScale(scaleEvidence);
  const geometry = model === undefined ? null : assessModelGeometry(model);
  const sceneInput = scene === undefined ? null : {
    ...record(scene, 'scene'),
    ...(scene.modelBounds === undefined && geometry?.bounds ? { modelBounds: geometry.bounds } : {}),
    ...(scene.modelScale === undefined && (scale || geometry)
      ? { modelScale: scale?.configuredScale ?? geometry.scale }
      : {}),
  };
  const sceneAssessment = sceneInput ? validateSceneCalibration(sceneInput) : null;
  const findings = sortFindings([
    ...(scale?.findings ?? []),
    ...(geometry?.findings ?? []),
    ...(sceneAssessment?.findings ?? []),
  ]);
  const calibration = {
    north: north ? {
      from: north.from,
      to: north.to,
      northOffsetDegrees: north.northOffsetDegrees,
      localBearingDegrees: north.localBearingDegrees,
      trueBearingDegrees: north.trueBearingDegrees,
      distanceModelUnits: north.distanceModelUnits,
    } : null,
    scale: scale ? {
      modelUnits: scale.modelUnits,
      configuredScale: scale.configuredScale,
      recommendedScale: scale.recommendedScale,
      dimensions: scale.dimensions.map((item) => ({
        id: item.id,
        modelLength: item.modelLength,
        realLength: item.realLength,
        realUnits: item.realUnits,
      })),
    } : null,
    scene: sceneAssessment ? {
      origin: sceneAssessment.origin,
      groundBounds: sceneAssessment.groundBounds,
      terrainProfile: sceneAssessment.terrainProfile,
      modelBounds: sceneAssessment.modelBounds,
      modelScale: sceneAssessment.modelScale,
      cameras: sceneAssessment.cameras.map(({ id, position, target }) => ({ id, position, target })),
    } : null,
    model: geometry ? {
      assetHash: optionalAssetHash(assetHash),
      bounds: geometry.bounds,
      units: geometry.units,
      scale: geometry.scale,
      stats: geometry.stats,
    } : null,
  };
  const revisionInput = createCalibrationRevisionInput(calibration);
  return {
    calibrationVersion: MODEL_CALIBRATION_VERSION,
    ...summarizeFindings(findings),
    north,
    scale,
    geometry,
    scene: sceneAssessment,
    findings,
    solarNoonGuidance: north ? solarNoonAlignmentGuidance({ northOffsetDegrees: north.northOffsetDegrees }) : null,
    calibration,
    revisionInput,
  };
}
