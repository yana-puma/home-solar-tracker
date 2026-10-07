/**
 * Shared property configuration contract for the solar viewer and configurator.
 *
 * The validator is deliberately dependency-free so it can run in a browser,
 * in tests, or in a small static deployment without a build step.
 */

const SAFE_SLUG = /^[a-z0-9](?:[a-z0-9_-]{0,62})$/;
const SAFE_REVISION = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,63})$/;
const SAFE_REMOTE_PROTOCOLS = new Set(["http:", "https:"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INTEGRITY_PATTERN = /^(sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2}$/;
const ASSET_TYPES = new Set(["model", "thumbnail", "texture", "data"]);
const LOCATION_PRECISIONS = new Set(["exact", "rounded", "regional"]);
const VISIBILITY_VALUES = new Set(["private", "unlisted", "public"]);
const THEME_MODES = new Set(["auto", "light", "dark"]);
const SKY_STYLES = new Set(["gradient", "solid"]);
const MODEL_UNITS = new Set(["meters", "feet", "centimeters", "millimeters"]);
const EXPOSURE_METHODS = new Set(["estimated", "raycast"]);
export const ZONE_PURPOSES = Object.freeze(["general", "garden", "patio", "window", "pv"]);
export const ZONE_GEOMETRY_TYPES = Object.freeze(["point", "rectangle", "polygon"]);
const ZONE_PURPOSE_VALUES = new Set(ZONE_PURPOSES);
const ZONE_GEOMETRY_VALUES = new Set(ZONE_GEOMETRY_TYPES);
const FALLBACK_INTEGRITY = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const GEOMETRY_EPSILON = 1e-9;

const SOLAR_FEATURE_DEFAULTS = Object.freeze({
  sunPath: true,
  sunMap: true,
  compass: true,
  timelapse: true,
  annualStudy: false,
});

const UI_THEME_DEFAULTS = Object.freeze({
  mode: "auto",
  accentColor: "#f59e0b",
  skyStyle: "gradient",
});

export const DEFAULT_PROPERTY_CONFIG = Object.freeze({
  schemaVersion: 1,
  slug: "demo",
  title: "Fictional house and garden",
  description: "Invented primitive geometry; not a reconstruction of an actual house.",
  location: {
    latitude: 40.0,
    longitude: -80.0,
    timeZone: "America/New_York",
    displayLabel: "Fictional sample garden",
    showExactLocation: false,
  },
  model: {
    url: "./model.glb",
    units: "meters",
    scale: 1,
    northOffsetDegrees: 0,
    position: [0, 0, 0],
  },
  scene: {
    groundBounds: { minX: -25, minZ: -25, maxX: 25, maxZ: 25 },
    terrainProfile: [],
    cameraPresets: {
      overview: {
        label: "Overview",
        position: [38, 28, 38],
        target: [0, 0, 0],
      },
    },
  },
  zones: [],
  solar: {
    defaultDate: "today",
    samplingMinutes: 15,
    exposureMethod: "raycast",
  },
  privacy: {
    showAddress: false,
  },
});

/**
 * The stable shape new viewer modules should consume. Legacy callers may keep
 * using DEFAULT_PROPERTY_CONFIG and result.config for schemaVersion 1 files.
 */
export const DEFAULT_RUNTIME_CONFIG = Object.freeze({
  schemaVersion: 2,
  sourceSchemaVersion: 1,
  package: {
    id: DEFAULT_PROPERTY_CONFIG.slug,
    label: DEFAULT_PROPERTY_CONFIG.title,
    revision: "legacy-v1",
    description: DEFAULT_PROPERTY_CONFIG.description,
  },
  assets: [
    {
      id: "model",
      type: "model",
      url: DEFAULT_PROPERTY_CONFIG.model.url,
      size: null,
      integrity: null,
    },
  ],
  slug: DEFAULT_PROPERTY_CONFIG.slug,
  title: DEFAULT_PROPERTY_CONFIG.title,
  description: DEFAULT_PROPERTY_CONFIG.description,
  location: {
    ...DEFAULT_PROPERTY_CONFIG.location,
    precision: "regional",
  },
  model: {
    ...DEFAULT_PROPERTY_CONFIG.model,
    assetId: "model",
  },
  scene: DEFAULT_PROPERTY_CONFIG.scene,
  zones: DEFAULT_PROPERTY_CONFIG.zones,
  solar: {
    ...DEFAULT_PROPERTY_CONFIG.solar,
    features: SOLAR_FEATURE_DEFAULTS,
  },
  privacy: {
    ...DEFAULT_PROPERTY_CONFIG.privacy,
    visibility: "private",
    showExactLocation: false,
  },
  ui: { theme: UI_THEME_DEFAULTS },
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberOr(value, fallback) {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function booleanOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function vectorOr(value, fallback, path, errors) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => !Number.isFinite(Number(item)))) {
    errors.push(`${path} must be an array of three finite numbers.`);
    return [...fallback];
  }
  return value.map(Number);
}

function strictVectorOr(value, fallback, path, errors) {
  if (!Array.isArray(value) || value.length !== 3
    || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    errors.push(`${path} must be an array of three finite numbers.`);
    return [...fallback];
  }
  return [...value];
}

function validTimeZone(timeZone) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function normalizeBounds(value, fallback, errors, warnings) {
  let candidate = value;
  if (Array.isArray(value) && value.length === 4) {
    candidate = { minX: value[0], minZ: value[1], maxX: value[2], maxZ: value[3] };
    warnings.push("scene.groundBounds array syntax was converted to the schemaVersion 1 object form.");
  }
  if (!isRecord(candidate)) {
    errors.push("scene.groundBounds must contain minX, minZ, maxX, and maxZ.");
    return { ...fallback };
  }
  const bounds = {
    minX: numberOr(candidate.minX, fallback.minX),
    minZ: numberOr(candidate.minZ, fallback.minZ),
    maxX: numberOr(candidate.maxX, fallback.maxX),
    maxZ: numberOr(candidate.maxZ, fallback.maxZ),
  };
  if ([candidate.minX, candidate.minZ, candidate.maxX, candidate.maxZ].some((item) => !Number.isFinite(Number(item)))) {
    errors.push("scene.groundBounds values must be finite numbers.");
  }
  if (bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ) {
    errors.push("scene.groundBounds minimums must be smaller than their maximums.");
    return { ...fallback };
  }
  return bounds;
}

function isSafeAssetReference(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value, "https://config.invalid/");
    return SAFE_REMOTE_PROTOCOLS.has(parsed.protocol) || parsed.origin === "https://config.invalid" || parsed.protocol === "blob:";
  } catch {
    return false;
  }
}

function hasPathTraversal(value) {
  if (typeof value !== "string" || value.includes("\\") || value.includes("\uFFFD")
    || /[\u0000-\u001f\u007f]/.test(value)) return true;
  const withoutQuery = value.split(/[?#]/, 1)[0];
  let decoded = withoutQuery;
  let complete = false;
  for (let pass = 0; pass < 8; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        complete = true;
        break;
      }
      decoded = next;
    } catch {
      return true;
    }
  }
  if (!complete) return true;
  if (decoded.includes("\\")) return true;
  const path = decoded.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  return path.split("/").some((segment, index) => segment === ".." || (segment === "." && index > 0));
}

function isSafeV2AssetReference(value) {
  if (!isSafeAssetReference(value) || hasPathTraversal(value)) return false;
  try {
    const parsed = new URL(value, "https://config.invalid/");
    return parsed.protocol !== "blob:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function unknownFieldErrors(value, allowed, path, errors) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed in schemaVersion 2.`);
  }
}

function requiredRecord(value, path, errors) {
  if (isRecord(value)) return value;
  errors.push(`${path} must be an object.`);
  return {};
}

function strictString(value, fallback, path, errors, maximum = 120) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${path} must be a non-empty string.`);
    return fallback;
  }
  const result = value.trim();
  if (result.length > maximum) {
    errors.push(`${path} must be at most ${maximum} characters.`);
    return fallback;
  }
  return result;
}

function finiteNumber(value, fallback, path, errors) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${path} must be a finite number.`);
    return fallback;
  }
  return value;
}

function pointEquals(left, right) {
  return Math.abs(left[0] - right[0]) <= GEOMETRY_EPSILON
    && Math.abs(left[1] - right[1]) <= GEOMETRY_EPSILON;
}

function crossProduct(origin, left, right) {
  return (left[0] - origin[0]) * (right[1] - origin[1])
    - (left[1] - origin[1]) * (right[0] - origin[0]);
}

function pointOnSegment(point, start, end) {
  return Math.abs(crossProduct(start, end, point)) <= GEOMETRY_EPSILON
    && point[0] >= Math.min(start[0], end[0]) - GEOMETRY_EPSILON
    && point[0] <= Math.max(start[0], end[0]) + GEOMETRY_EPSILON
    && point[1] >= Math.min(start[1], end[1]) - GEOMETRY_EPSILON
    && point[1] <= Math.max(start[1], end[1]) + GEOMETRY_EPSILON;
}

function segmentsIntersect(a, b, c, d) {
  const abC = crossProduct(a, b, c);
  const abD = crossProduct(a, b, d);
  const cdA = crossProduct(c, d, a);
  const cdB = crossProduct(c, d, b);
  if (((abC > GEOMETRY_EPSILON && abD < -GEOMETRY_EPSILON)
      || (abC < -GEOMETRY_EPSILON && abD > GEOMETRY_EPSILON))
    && ((cdA > GEOMETRY_EPSILON && cdB < -GEOMETRY_EPSILON)
      || (cdA < -GEOMETRY_EPSILON && cdB > GEOMETRY_EPSILON))) return true;
  return (Math.abs(abC) <= GEOMETRY_EPSILON && pointOnSegment(c, a, b))
    || (Math.abs(abD) <= GEOMETRY_EPSILON && pointOnSegment(d, a, b))
    || (Math.abs(cdA) <= GEOMETRY_EPSILON && pointOnSegment(a, c, d))
    || (Math.abs(cdB) <= GEOMETRY_EPSILON && pointOnSegment(b, c, d));
}

function polygonAreaTwice(vertices) {
  return vertices.reduce((sum, point, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
}

function polygonCentroid(vertices) {
  const twiceArea = polygonAreaTwice(vertices);
  if (Math.abs(twiceArea) <= GEOMETRY_EPSILON) {
    const sum = vertices.reduce((value, point) => [value[0] + point[0], value[1] + point[1]], [0, 0]);
    return [sum[0] / vertices.length, sum[1] / vertices.length];
  }
  let x = 0;
  let z = 0;
  vertices.forEach((point, index) => {
    const next = vertices[(index + 1) % vertices.length];
    const factor = point[0] * next[1] - next[0] * point[1];
    x += (point[0] + next[0]) * factor;
    z += (point[1] + next[1]) * factor;
  });
  return [x / (3 * twiceArea), z / (3 * twiceArea)];
}

function validateSimplePolygon(vertices, path, errors) {
  if (vertices.length < 3) {
    errors.push(`${path} must contain at least three vertices.`);
    return;
  }
  for (let left = 0; left < vertices.length; left += 1) {
    for (let right = left + 1; right < vertices.length; right += 1) {
      if (pointEquals(vertices[left], vertices[right])) {
        errors.push(`${path} must not contain duplicate vertices.`);
        return;
      }
    }
  }
  if (Math.abs(polygonAreaTwice(vertices)) <= GEOMETRY_EPSILON) {
    errors.push(`${path} must enclose a non-zero area.`);
    return;
  }
  for (let first = 0; first < vertices.length; first += 1) {
    const firstNext = (first + 1) % vertices.length;
    for (let second = first + 1; second < vertices.length; second += 1) {
      const secondNext = (second + 1) % vertices.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsIntersect(vertices[first], vertices[firstNext], vertices[second], vertices[secondNext])) {
        errors.push(`${path} must describe a simple, non-self-intersecting polygon.`);
        return;
      }
    }
  }
}

function normalizeSunlightThresholds(value, path, errors) {
  if (value === undefined) return {};
  const thresholds = requiredRecord(value, path, errors);
  unknownFieldErrors(thresholds, new Set(["minimumDailyHours", "preferredTimeWindow"]), path, errors);
  const result = {};
  if (thresholds.minimumDailyHours !== undefined) {
    const hours = finiteNumber(thresholds.minimumDailyHours, 0, `${path}.minimumDailyHours`, errors);
    if (hours < 0 || hours > 24) {
      errors.push(`${path}.minimumDailyHours must be between 0 and 24.`);
    } else {
      result.minimumDailyHours = hours;
    }
  }
  if (thresholds.preferredTimeWindow !== undefined) {
    const windowPath = `${path}.preferredTimeWindow`;
    const window = requiredRecord(thresholds.preferredTimeWindow, windowPath, errors);
    unknownFieldErrors(window, new Set(["start", "end"]), windowPath, errors);
    const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    const start = typeof window.start === "string" ? window.start : "";
    const end = typeof window.end === "string" ? window.end : "";
    if (!timePattern.test(start)) errors.push(`${windowPath}.start must be a local 24-hour time in HH:MM format.`);
    if (!timePattern.test(end)) errors.push(`${windowPath}.end must be a local 24-hour time in HH:MM format.`);
    if (timePattern.test(start) && timePattern.test(end) && start >= end) {
      errors.push(`${windowPath}.start must be earlier than end.`);
    } else if (timePattern.test(start) && timePattern.test(end)) {
      result.preferredTimeWindow = { start, end };
    }
  }
  return result;
}

function normalizeV2Zone(zone, index, errors) {
  const path = `zones[${index}]`;
  unknownFieldErrors(
    zone,
    new Set(["id", "title", "purpose", "surface", "elevation", "position", "geometry", "sunlightThresholds"]),
    path,
    errors,
  );

  let authoredPosition;
  if (zone.position !== undefined) {
    authoredPosition = strictVectorOr(zone.position, [0, 0, 0], `${path}.position`, errors);
  }
  if (zone.position === undefined && zone.geometry === undefined) {
    errors.push(`${path} must define position or geometry.`);
  }

  const elevationFallback = authoredPosition?.[1] ?? 0;
  const elevation = zone.elevation === undefined
    ? elevationFallback
    : finiteNumber(zone.elevation, elevationFallback, `${path}.elevation`, errors);
  const authoredPurpose = zone.purpose === undefined ? "general" : zone.purpose;
  if (typeof authoredPurpose !== "string" || !ZONE_PURPOSE_VALUES.has(authoredPurpose)) {
    errors.push(`${path}.purpose must be general, garden, patio, window, or pv.`);
  }
  const purpose = ZONE_PURPOSE_VALUES.has(authoredPurpose) ? authoredPurpose : "general";
  const surface = zone.surface === undefined
    ? "ground"
    : strictString(zone.surface, "ground", `${path}.surface`, errors, 64);

  let geometry;
  let representative;
  if (zone.geometry === undefined) {
    const position = authoredPosition || [0, elevation, 0];
    geometry = { type: "point", x: position[0], z: position[2] };
    representative = [position[0], elevation, position[2]];
  } else {
    const geometryPath = `${path}.geometry`;
    const candidate = requiredRecord(zone.geometry, geometryPath, errors);
    const type = candidate.type;
    if (typeof type !== "string" || !ZONE_GEOMETRY_VALUES.has(type)) {
      errors.push(`${geometryPath}.type must be point, rectangle, or polygon.`);
    }
    if (type === "point") {
      unknownFieldErrors(candidate, new Set(["type", "x", "z"]), geometryPath, errors);
      const x = finiteNumber(candidate.x, 0, `${geometryPath}.x`, errors);
      const z = finiteNumber(candidate.z, 0, `${geometryPath}.z`, errors);
      geometry = { type: "point", x, z };
      representative = [x, elevation, z];
    } else if (type === "rectangle") {
      unknownFieldErrors(candidate, new Set(["type", "minX", "maxX", "minZ", "maxZ"]), geometryPath, errors);
      const minX = finiteNumber(candidate.minX, 0, `${geometryPath}.minX`, errors);
      const maxX = finiteNumber(candidate.maxX, 1, `${geometryPath}.maxX`, errors);
      const minZ = finiteNumber(candidate.minZ, 0, `${geometryPath}.minZ`, errors);
      const maxZ = finiteNumber(candidate.maxZ, 1, `${geometryPath}.maxZ`, errors);
      if (minX >= maxX || minZ >= maxZ) {
        errors.push(`${geometryPath} minimums must be smaller than maximums.`);
      }
      geometry = { type: "rectangle", minX, maxX, minZ, maxZ };
      representative = [(minX + maxX) / 2, elevation, (minZ + maxZ) / 2];
    } else if (type === "polygon") {
      unknownFieldErrors(candidate, new Set(["type", "vertices"]), geometryPath, errors);
      const vertices = [];
      if (!Array.isArray(candidate.vertices)) {
        errors.push(`${geometryPath}.vertices must be an array of model-local [x, z] pairs.`);
      } else {
        candidate.vertices.forEach((vertex, vertexIndex) => {
          const vertexPath = `${geometryPath}.vertices[${vertexIndex}]`;
          if (!Array.isArray(vertex) || vertex.length !== 2
            || vertex.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))) {
            errors.push(`${vertexPath} must be a pair of finite numbers.`);
          } else {
            vertices.push([...vertex]);
          }
        });
      }
      if (vertices.length > 3 && pointEquals(vertices[0], vertices.at(-1))) vertices.pop();
      validateSimplePolygon(vertices, `${geometryPath}.vertices`, errors);
      geometry = { type: "polygon", vertices };
      const center = vertices.length ? polygonCentroid(vertices) : [0, 0];
      representative = [center[0], elevation, center[1]];
    } else {
      geometry = { type: "point", x: 0, z: 0 };
      representative = [0, elevation, 0];
    }
  }

  if (authoredPosition && representative.some((coordinate, coordinateIndex) => (
    Math.abs(coordinate - authoredPosition[coordinateIndex]) > GEOMETRY_EPSILON
  ))) {
    errors.push(`${path}.position must match the geometry representative [x, elevation, z] point.`);
  }

  return {
    purpose,
    surface,
    elevation,
    position: representative,
    geometry,
    sunlightThresholds: normalizeSunlightThresholds(zone.sunlightThresholds, `${path}.sunlightThresholds`, errors),
  };
}

function runtimeZoneFromV1(zone) {
  const position = [...zone.position];
  return {
    ...clone(zone),
    purpose: ZONE_PURPOSE_VALUES.has(zone.purpose) ? zone.purpose : "general",
    surface: typeof zone.surface === "string" && zone.surface.trim() ? zone.surface.trim() : "ground",
    elevation: position[1],
    position,
    geometry: { type: "point", x: position[0], z: position[2] },
    sunlightThresholds: {},
  };
}

function runtimeDefaults() {
  return clone(DEFAULT_RUNTIME_CONFIG);
}

function buildRuntimeFromV1(config) {
  const precision = config.location.showExactLocation ? "exact" : "regional";
  const visibility = config.location.showExactLocation || config.privacy.showAddress ? "public" : "private";
  const asset = {
    id: "model",
    type: "model",
    url: config.model.url,
    size: null,
    integrity: null,
  };
  return {
    schemaVersion: 2,
    sourceSchemaVersion: 1,
    package: {
      id: config.slug,
      label: config.title,
      revision: "legacy-v1",
      description: config.description,
    },
    assets: [asset],
    // Compatibility aliases let the current viewer consume the normalized
    // contract before its own modules migrate to package.* and assets[].
    slug: config.slug,
    title: config.title,
    description: config.description,
    location: { ...config.location, precision },
    model: { ...config.model, assetId: asset.id },
    scene: clone(config.scene),
    zones: config.zones.map(runtimeZoneFromV1),
    solar: {
      ...config.solar,
      features: { ...SOLAR_FEATURE_DEFAULTS },
    },
    privacy: {
      ...config.privacy,
      visibility,
      showExactLocation: config.location.showExactLocation,
    },
    ui: { theme: { ...UI_THEME_DEFAULTS } },
  };
}

function normalizeSolarFeatures(value, errors) {
  if (value === undefined) return { ...SOLAR_FEATURE_DEFAULTS };
  const features = requiredRecord(value, "solar.features", errors);
  unknownFieldErrors(
    features,
    new Set(["sunPath", "sunMap", "compass", "timelapse", "annualStudy"]),
    "solar.features",
    errors,
  );
  const normalized = { ...SOLAR_FEATURE_DEFAULTS };
  for (const key of Object.keys(normalized)) {
    if (features[key] !== undefined && typeof features[key] !== "boolean") {
      errors.push(`solar.features.${key} must be a boolean.`);
    } else if (typeof features[key] === "boolean") {
      normalized[key] = features[key];
    }
  }
  return normalized;
}

function normalizeTheme(value, errors) {
  if (value === undefined) return { ...UI_THEME_DEFAULTS };
  const theme = requiredRecord(value, "ui.theme", errors);
  unknownFieldErrors(theme, new Set(["mode", "accentColor", "skyStyle"]), "ui.theme", errors);
  const authoredMode = theme.mode;
  const mode = authoredMode === undefined
    ? UI_THEME_DEFAULTS.mode
    : (typeof authoredMode === "string" ? authoredMode.toLowerCase() : UI_THEME_DEFAULTS.mode);
  const accentColor = stringOr(theme.accentColor, UI_THEME_DEFAULTS.accentColor);
  const authoredSkyStyle = theme.skyStyle;
  const skyStyle = authoredSkyStyle === undefined
    ? UI_THEME_DEFAULTS.skyStyle
    : (typeof authoredSkyStyle === "string" ? authoredSkyStyle.toLowerCase() : UI_THEME_DEFAULTS.skyStyle);
  if (authoredMode !== undefined && (typeof authoredMode !== "string" || !THEME_MODES.has(authoredMode))) {
    errors.push('ui.theme.mode must be "auto", "light", or "dark".');
  }
  if (theme.accentColor !== undefined
    && (typeof theme.accentColor !== "string" || !/^#[0-9a-f]{6}$/i.test(theme.accentColor))) {
    errors.push("ui.theme.accentColor must be a six-digit hexadecimal color.");
  }
  if (authoredSkyStyle !== undefined
    && (typeof authoredSkyStyle !== "string" || !SKY_STYLES.has(authoredSkyStyle))) {
    errors.push('ui.theme.skyStyle must be "gradient" or "solid".');
  }
  return {
    mode: THEME_MODES.has(mode) ? mode : UI_THEME_DEFAULTS.mode,
    accentColor: /^#[0-9a-f]{6}$/i.test(accentColor) ? accentColor : UI_THEME_DEFAULTS.accentColor,
    skyStyle: SKY_STYLES.has(skyStyle) ? skyStyle : UI_THEME_DEFAULTS.skyStyle,
  };
}

/**
 * Validate and normalize an unknown property configuration.
 *
 * Invalid fields are replaced with safe defaults, while `valid` remains false
 * and each replacement is described in `errors`.
 */
function validateV1PropertyConfig(input) {
  const errors = [];
  const warnings = [];
  const defaults = clone(DEFAULT_PROPERTY_CONFIG);

  if (!isRecord(input)) {
    return {
      valid: false,
      errors: ["Property configuration must be a JSON object."],
      warnings,
      config: defaults,
      runtimeConfig: runtimeDefaults(),
      sourceSchemaVersion: 1,
    };
  }

  const config = clone(input);
  if (input.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1.");
  }
  config.schemaVersion = 1;

  config.slug = stringOr(input.slug, defaults.slug).toLowerCase();
  if (!SAFE_SLUG.test(config.slug)) {
    errors.push("slug must use lowercase letters, numbers, hyphens, or underscores (maximum 63 characters).");
    config.slug = defaults.slug;
  }

  config.title = stringOr(input.title, defaults.title);
  if (typeof input.title !== "string" || !input.title.trim()) errors.push("title is required.");
  config.description = typeof input.description === "string" ? input.description.trim() : defaults.description;

  const inputLocation = isRecord(input.location) ? input.location : {};
  if (!isRecord(input.location)) errors.push("location is required.");
  const latitude = numberOr(inputLocation.latitude, defaults.location.latitude);
  const longitude = numberOr(inputLocation.longitude, defaults.location.longitude);
  if (latitude < -90 || latitude > 90 || !Number.isFinite(Number(inputLocation.latitude))) {
    errors.push("location.latitude must be between -90 and 90.");
  }
  if (longitude < -180 || longitude > 180 || !Number.isFinite(Number(inputLocation.longitude))) {
    errors.push("location.longitude must be between -180 and 180.");
  }
  const timeZone = stringOr(inputLocation.timeZone, defaults.location.timeZone);
  if (!validTimeZone(timeZone)) errors.push("location.timeZone must be a valid IANA timezone, such as America/New_York.");
  config.location = {
    ...inputLocation,
    latitude: latitude >= -90 && latitude <= 90 ? latitude : defaults.location.latitude,
    longitude: longitude >= -180 && longitude <= 180 ? longitude : defaults.location.longitude,
    timeZone: validTimeZone(timeZone) ? timeZone : defaults.location.timeZone,
    displayLabel: stringOr(inputLocation.displayLabel, defaults.location.displayLabel),
    showExactLocation: booleanOr(inputLocation.showExactLocation, false),
  };

  const inputModel = isRecord(input.model) ? input.model : {};
  if (!isRecord(input.model)) errors.push("model is required.");
  const modelUrl = stringOr(inputModel.url, defaults.model.url);
  if (!isSafeAssetReference(modelUrl)) errors.push("model.url must be a relative path, http(s) URL, or local preview blob URL.");
  const scale = numberOr(inputModel.scale, defaults.model.scale);
  if (!(scale > 0)) errors.push("model.scale must be greater than zero.");
  const units = stringOr(inputModel.units, defaults.model.units).toLowerCase();
  if (!["meters", "feet", "centimeters", "millimeters"].includes(units)) {
    errors.push(`model.units “${units}” must be meters, feet, centimeters, or millimeters.`);
  }
  config.model = {
    ...inputModel,
    url: isSafeAssetReference(modelUrl) ? modelUrl : defaults.model.url,
    units: ["meters", "feet", "centimeters", "millimeters"].includes(units) ? units : defaults.model.units,
    scale: scale > 0 ? scale : defaults.model.scale,
    northOffsetDegrees: numberOr(inputModel.northOffsetDegrees, defaults.model.northOffsetDegrees),
    position: vectorOr(inputModel.position ?? defaults.model.position, defaults.model.position, "model.position", errors),
  };

  const inputScene = isRecord(input.scene) ? input.scene : {};
  if (!isRecord(input.scene)) errors.push("scene is required.");
  const terrainProfile = [];
  if (!Array.isArray(inputScene.terrainProfile)) {
    errors.push("scene.terrainProfile must be an array of [z, elevation] pairs.");
  } else {
    inputScene.terrainProfile.forEach((pair, index) => {
      if (!Array.isArray(pair) || pair.length !== 2 || pair.some((value) => !Number.isFinite(Number(value)))) {
        errors.push(`scene.terrainProfile[${index}] must be a [z, elevation] pair.`);
      } else {
        terrainProfile.push(pair.map(Number));
      }
    });
  }

  const cameraPresets = {};
  if (!isRecord(inputScene.cameraPresets)) {
    errors.push("scene.cameraPresets must be an object.");
  } else {
    for (const [id, preset] of Object.entries(inputScene.cameraPresets)) {
      if (!SAFE_SLUG.test(id) || !isRecord(preset)) {
        errors.push(`scene.cameraPresets.${id} is not a valid preset.`);
        continue;
      }
      cameraPresets[id] = {
        ...preset,
        label: stringOr(preset.label, id),
        position: vectorOr(preset.position, defaults.scene.cameraPresets.overview.position, `scene.cameraPresets.${id}.position`, errors),
        target: vectorOr(preset.target, defaults.scene.cameraPresets.overview.target, `scene.cameraPresets.${id}.target`, errors),
      };
    }
  }
  if (Object.keys(cameraPresets).length === 0) {
    warnings.push("No valid camera presets were supplied; the default overview was added.");
    Object.assign(cameraPresets, defaults.scene.cameraPresets);
  }
  config.scene = {
    ...inputScene,
    groundBounds: normalizeBounds(inputScene.groundBounds, defaults.scene.groundBounds, errors, warnings),
    terrainProfile,
    cameraPresets,
  };

  config.zones = [];
  if (!Array.isArray(input.zones)) {
    errors.push("zones must be an array.");
  } else {
    const seenZoneIds = new Set();
    input.zones.forEach((zone, index) => {
      if (!isRecord(zone)) {
        errors.push(`zones[${index}] must be an object.`);
        return;
      }
      const id = stringOr(zone.id, `zone-${index + 1}`).toLowerCase();
      if (!SAFE_SLUG.test(id) || seenZoneIds.has(id)) {
        errors.push(`zones[${index}].id must be a unique slug.`);
        return;
      }
      seenZoneIds.add(id);
      config.zones.push({
        ...zone,
        id,
        title: stringOr(zone.title, id),
        position: vectorOr(zone.position, [0, 0, 0], `zones[${index}].position`, errors),
      });
    });
  }

  const inputSolar = isRecord(input.solar) ? input.solar : {};
  if (!isRecord(input.solar)) errors.push("solar is required.");
  const defaultDate = stringOr(inputSolar.defaultDate, defaults.solar.defaultDate);
  if (defaultDate !== "today" && !DATE_PATTERN.test(defaultDate)) {
    errors.push('solar.defaultDate must be "today" or an ISO date (YYYY-MM-DD).');
  }
  const samplingMinutes = numberOr(inputSolar.samplingMinutes, defaults.solar.samplingMinutes);
  if (!Number.isInteger(samplingMinutes) || samplingMinutes < 1 || samplingMinutes > 120) {
    errors.push("solar.samplingMinutes must be an integer between 1 and 120.");
  }
  const exposureMethod = stringOr(inputSolar.exposureMethod, defaults.solar.exposureMethod).toLowerCase();
  if (!["estimated", "raycast"].includes(exposureMethod)) {
    errors.push('solar.exposureMethod must be "estimated" or "raycast".');
  }
  config.solar = {
    ...inputSolar,
    defaultDate: defaultDate === "today" || DATE_PATTERN.test(defaultDate) ? defaultDate : defaults.solar.defaultDate,
    samplingMinutes: Number.isInteger(samplingMinutes) && samplingMinutes >= 1 && samplingMinutes <= 120
      ? samplingMinutes
      : defaults.solar.samplingMinutes,
    exposureMethod: ["estimated", "raycast"].includes(exposureMethod)
      ? exposureMethod
      : defaults.solar.exposureMethod,
  };

  const inputPrivacy = isRecord(input.privacy) ? input.privacy : {};
  if (!isRecord(input.privacy)) errors.push("privacy is required.");
  config.privacy = {
    ...inputPrivacy,
    showAddress: booleanOr(inputPrivacy.showAddress, false),
  };
  if (config.location.showExactLocation || config.privacy.showAddress) {
    warnings.push("This configuration is set to reveal precise property information. Review it before publishing.");
  }

  const runtimeConfig = buildRuntimeFromV1(config);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    config,
    runtimeConfig,
    sourceSchemaVersion: 1,
  };
}

function validateV2PropertyConfig(input) {
  const errors = [];
  const warnings = [];
  const defaults = runtimeDefaults();

  unknownFieldErrors(
    input,
    new Set(["$schema", "schemaVersion", "package", "location", "assets", "model", "scene", "zones", "solar", "privacy", "ui"]),
    "configuration",
    errors,
  );
  if (input.$schema !== undefined && typeof input.$schema !== "string") {
    errors.push("configuration.$schema must be a string.");
  }

  const inputPackage = requiredRecord(input.package, "package", errors);
  unknownFieldErrors(inputPackage, new Set(["id", "label", "revision", "description"]), "package", errors);
  const authoredPackageId = strictString(inputPackage.id, defaults.package.id, "package.id", errors);
  const packageId = authoredPackageId.toLowerCase();
  if (!SAFE_SLUG.test(authoredPackageId)) errors.push("package.id must be a lowercase slug of at most 63 characters.");
  const packageLabel = strictString(inputPackage.label, defaults.package.label, "package.label", errors);
  const revision = strictString(inputPackage.revision, defaults.package.revision, "package.revision", errors, 64);
  if (!SAFE_REVISION.test(revision)) {
    errors.push("package.revision must contain only letters, numbers, dots, underscores, or hyphens.");
  }
  let description = "";
  if (inputPackage.description !== undefined) {
    if (typeof inputPackage.description !== "string" || inputPackage.description.length > 500) {
      errors.push("package.description must be a string of at most 500 characters.");
    } else {
      description = inputPackage.description.trim();
    }
  }
  const packageInfo = {
    id: SAFE_SLUG.test(authoredPackageId) ? authoredPackageId : defaults.package.id,
    label: packageLabel,
    revision: SAFE_REVISION.test(revision) ? revision : defaults.package.revision,
    description,
  };

  const inputLocation = requiredRecord(input.location, "location", errors);
  unknownFieldErrors(
    inputLocation,
    new Set(["latitude", "longitude", "timeZone", "displayLabel", "precision"]),
    "location",
    errors,
  );
  const latitudeValid = typeof inputLocation.latitude === "number"
    && Number.isFinite(inputLocation.latitude)
    && inputLocation.latitude >= -90
    && inputLocation.latitude <= 90;
  const longitudeValid = typeof inputLocation.longitude === "number"
    && Number.isFinite(inputLocation.longitude)
    && inputLocation.longitude >= -180
    && inputLocation.longitude <= 180;
  if (!latitudeValid) errors.push("location.latitude must be a number between -90 and 90.");
  if (!longitudeValid) errors.push("location.longitude must be a number between -180 and 180.");
  const timeZone = strictString(inputLocation.timeZone, defaults.location.timeZone, "location.timeZone", errors);
  if (!validTimeZone(timeZone)) errors.push("location.timeZone must be a valid IANA timezone, such as America/New_York.");
  const displayLabel = strictString(
    inputLocation.displayLabel,
    defaults.location.displayLabel,
    "location.displayLabel",
    errors,
  );
  const authoredPrecision = inputLocation.precision;
  const precision = typeof authoredPrecision === "string" ? authoredPrecision.toLowerCase() : defaults.location.precision;
  if (typeof authoredPrecision !== "string" || !LOCATION_PRECISIONS.has(authoredPrecision)) {
    errors.push('location.precision must be "exact", "rounded", or "regional".');
  }
  const locationConfig = {
    latitude: latitudeValid ? inputLocation.latitude : defaults.location.latitude,
    longitude: longitudeValid ? inputLocation.longitude : defaults.location.longitude,
    timeZone: validTimeZone(timeZone) ? timeZone : defaults.location.timeZone,
    displayLabel,
    precision: LOCATION_PRECISIONS.has(precision) ? precision : defaults.location.precision,
    showExactLocation: false,
  };

  const assets = [];
  const assetIds = new Set();
  if (!Array.isArray(input.assets) || input.assets.length === 0) {
    errors.push("assets must be a non-empty array.");
  } else {
    input.assets.forEach((value, index) => {
      const path = `assets[${index}]`;
      const asset = requiredRecord(value, path, errors);
      unknownFieldErrors(asset, new Set(["id", "type", "url", "size", "integrity"]), path, errors);
      const authoredId = strictString(asset.id, `asset-${index + 1}`, `${path}.id`, errors);
      let id = authoredId.toLowerCase();
      if (!SAFE_SLUG.test(authoredId) || assetIds.has(authoredId)) {
        errors.push(`${path}.id must be a unique lowercase slug.`);
        id = `asset-${index + 1}`;
      }
      while (assetIds.has(id)) id = `${id}-${index + 1}`;
      assetIds.add(id);
      const authoredType = asset.type;
      const type = typeof authoredType === "string" ? authoredType.toLowerCase() : "data";
      if (typeof authoredType !== "string" || !ASSET_TYPES.has(authoredType)) {
        errors.push(`${path}.type is not a supported asset type.`);
      }
      const url = strictString(asset.url, "./invalid-asset", `${path}.url`, errors, 2048);
      if (!isSafeV2AssetReference(url)) {
        errors.push(`${path}.url must be a traversal-free relative path or http(s) URL.`);
      }
      const sizeValid = Number.isInteger(asset.size) && asset.size >= 0;
      if (!sizeValid) errors.push(`${path}.size must be a non-negative integer number of bytes.`);
      const integrity = strictString(asset.integrity, FALLBACK_INTEGRITY, `${path}.integrity`, errors, 256);
      if (!INTEGRITY_PATTERN.test(integrity)) {
        errors.push(`${path}.integrity must be an SRI sha256, sha384, or sha512 value.`);
      }
      assets.push({
        id,
        type: ASSET_TYPES.has(type) ? type : "data",
        url: isSafeV2AssetReference(url) ? url : "./invalid-asset",
        size: sizeValid ? asset.size : 0,
        integrity: INTEGRITY_PATTERN.test(integrity) ? integrity : FALLBACK_INTEGRITY,
      });
    });
  }
  if (assets.length === 0) assets.push(clone(defaults.assets[0]));

  const inputModel = requiredRecord(input.model, "model", errors);
  unknownFieldErrors(
    inputModel,
    new Set(["assetId", "units", "scale", "northOffsetDegrees", "position"]),
    "model",
    errors,
  );
  const authoredAssetId = strictString(inputModel.assetId, assets[0].id, "model.assetId", errors);
  const requestedAssetId = authoredAssetId.toLowerCase();
  if (!SAFE_SLUG.test(authoredAssetId)) errors.push("model.assetId must be a lowercase slug.");
  const selectedAsset = assets.find((asset) => asset.id === requestedAssetId);
  if (!selectedAsset) errors.push("model.assetId must reference an entry in assets.");
  if (selectedAsset && selectedAsset.type !== "model") errors.push("model.assetId must reference an asset whose type is model.");
  const modelAsset = selectedAsset?.type === "model"
    ? selectedAsset
    : assets.find((asset) => asset.type === "model") || assets[0];
  const authoredUnits = inputModel.units;
  const units = authoredUnits === undefined
    ? defaults.model.units
    : (typeof authoredUnits === "string" ? authoredUnits.toLowerCase() : defaults.model.units);
  if (authoredUnits !== undefined && (typeof authoredUnits !== "string" || !MODEL_UNITS.has(authoredUnits))) {
    errors.push("model.units must be meters, feet, centimeters, or millimeters.");
  }
  const scale = inputModel.scale === undefined ? defaults.model.scale : inputModel.scale;
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) {
    errors.push("model.scale must be a finite number greater than zero.");
  }
  const northOffsetDegrees = inputModel.northOffsetDegrees === undefined
    ? defaults.model.northOffsetDegrees
    : inputModel.northOffsetDegrees;
  if (typeof northOffsetDegrees !== "number" || !Number.isFinite(northOffsetDegrees)
    || northOffsetDegrees < -360 || northOffsetDegrees > 360) {
    errors.push("model.northOffsetDegrees must be between -360 and 360.");
  }
  const modelConfig = {
    assetId: modelAsset.id,
    url: modelAsset.url,
    units: MODEL_UNITS.has(units) ? units : defaults.model.units,
    scale: typeof scale === "number" && Number.isFinite(scale) && scale > 0 ? scale : defaults.model.scale,
    northOffsetDegrees: typeof northOffsetDegrees === "number" && Number.isFinite(northOffsetDegrees)
      && northOffsetDegrees >= -360 && northOffsetDegrees <= 360
      ? northOffsetDegrees
      : defaults.model.northOffsetDegrees,
    position: inputModel.position === undefined
      ? [...defaults.model.position]
      : strictVectorOr(inputModel.position, defaults.model.position, "model.position", errors),
  };

  const inputScene = requiredRecord(input.scene, "scene", errors);
  unknownFieldErrors(inputScene, new Set(["groundBounds", "terrainProfile", "cameraPresets"]), "scene", errors);
  const inputBounds = requiredRecord(inputScene.groundBounds, "scene.groundBounds", errors);
  unknownFieldErrors(inputBounds, new Set(["minX", "minZ", "maxX", "maxZ"]), "scene.groundBounds", errors);
  const boundsValues = ["minX", "minZ", "maxX", "maxZ"];
  const boundsAreNumbers = boundsValues.every((key) => typeof inputBounds[key] === "number" && Number.isFinite(inputBounds[key]));
  if (!boundsAreNumbers) errors.push("scene.groundBounds values must be finite numbers.");
  let groundBounds = boundsAreNumbers
    ? { minX: inputBounds.minX, minZ: inputBounds.minZ, maxX: inputBounds.maxX, maxZ: inputBounds.maxZ }
    : { ...defaults.scene.groundBounds };
  if (groundBounds.minX >= groundBounds.maxX || groundBounds.minZ >= groundBounds.maxZ) {
    errors.push("scene.groundBounds minimums must be smaller than their maximums.");
    groundBounds = { ...defaults.scene.groundBounds };
  }
  const terrainProfile = [];
  if (inputScene.terrainProfile !== undefined && !Array.isArray(inputScene.terrainProfile)) {
    errors.push("scene.terrainProfile must be an array of [z, elevation] pairs.");
  } else {
    (inputScene.terrainProfile || []).forEach((pair, index) => {
      if (!Array.isArray(pair) || pair.length !== 2 || pair.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
        errors.push(`scene.terrainProfile[${index}] must be a pair of finite numbers.`);
      } else {
        terrainProfile.push([...pair]);
      }
    });
  }
  const cameraPresets = {};
  if (inputScene.cameraPresets !== undefined && !isRecord(inputScene.cameraPresets)) {
    errors.push("scene.cameraPresets must be an object.");
  } else {
    for (const [id, value] of Object.entries(inputScene.cameraPresets || {})) {
      const path = `scene.cameraPresets.${id}`;
      const preset = requiredRecord(value, path, errors);
      if (!SAFE_SLUG.test(id)) errors.push(`${path} must use a lowercase slug as its key.`);
      unknownFieldErrors(preset, new Set(["label", "position", "target"]), path, errors);
      if (!SAFE_SLUG.test(id)) continue;
      cameraPresets[id] = {
        label: preset.label === undefined ? id : strictString(preset.label, id, `${path}.label`, errors),
        position: strictVectorOr(preset.position, defaults.scene.cameraPresets.overview.position, `${path}.position`, errors),
        target: strictVectorOr(preset.target, defaults.scene.cameraPresets.overview.target, `${path}.target`, errors),
      };
    }
  }
  if (Object.keys(cameraPresets).length === 0) {
    warnings.push("No camera presets were supplied; the default overview was added.");
    Object.assign(cameraPresets, clone(defaults.scene.cameraPresets));
  }

  const zones = [];
  const zoneIds = new Set();
  if (input.zones !== undefined && !Array.isArray(input.zones)) {
    errors.push("zones must be an array.");
  } else {
    (input.zones || []).forEach((value, index) => {
      const path = `zones[${index}]`;
      const zone = requiredRecord(value, path, errors);
      const authoredId = strictString(zone.id, `zone-${index + 1}`, `${path}.id`, errors);
      const id = authoredId.toLowerCase();
      if (!SAFE_SLUG.test(authoredId) || zoneIds.has(id)) {
        errors.push(`${path}.id must be a unique lowercase slug.`);
        return;
      }
      zoneIds.add(id);
      zones.push({
        id,
        title: strictString(zone.title, id, `${path}.title`, errors),
        ...normalizeV2Zone(zone, index, errors),
      });
    });
  }

  const inputSolar = input.solar === undefined ? {} : requiredRecord(input.solar, "solar", errors);
  unknownFieldErrors(inputSolar, new Set(["defaultDate", "samplingMinutes", "exposureMethod", "features"]), "solar", errors);
  const defaultDate = inputSolar.defaultDate === undefined ? defaults.solar.defaultDate : inputSolar.defaultDate;
  if (typeof defaultDate !== "string" || (defaultDate !== "today" && !DATE_PATTERN.test(defaultDate))) {
    errors.push('solar.defaultDate must be "today" or an ISO date (YYYY-MM-DD).');
  }
  const samplingMinutes = inputSolar.samplingMinutes === undefined
    ? defaults.solar.samplingMinutes
    : inputSolar.samplingMinutes;
  if (!Number.isInteger(samplingMinutes) || samplingMinutes < 1 || samplingMinutes > 120) {
    errors.push("solar.samplingMinutes must be an integer between 1 and 120.");
  }
  const authoredExposureMethod = inputSolar.exposureMethod;
  const exposureMethod = authoredExposureMethod === undefined
    ? defaults.solar.exposureMethod
    : (typeof authoredExposureMethod === "string" ? authoredExposureMethod.toLowerCase() : defaults.solar.exposureMethod);
  if (authoredExposureMethod !== undefined
    && (typeof authoredExposureMethod !== "string" || !EXPOSURE_METHODS.has(authoredExposureMethod))) {
    errors.push('solar.exposureMethod must be "estimated" or "raycast".');
  }
  const solarConfig = {
    defaultDate: typeof defaultDate === "string" && (defaultDate === "today" || DATE_PATTERN.test(defaultDate))
      ? defaultDate
      : defaults.solar.defaultDate,
    samplingMinutes: Number.isInteger(samplingMinutes) && samplingMinutes >= 1 && samplingMinutes <= 120
      ? samplingMinutes
      : defaults.solar.samplingMinutes,
    exposureMethod: EXPOSURE_METHODS.has(exposureMethod) ? exposureMethod : defaults.solar.exposureMethod,
    features: normalizeSolarFeatures(inputSolar.features, errors),
  };

  const inputPrivacy = input.privacy === undefined ? {} : requiredRecord(input.privacy, "privacy", errors);
  unknownFieldErrors(
    inputPrivacy,
    new Set(["visibility", "showExactLocation", "showAddress"]),
    "privacy",
    errors,
  );
  const authoredVisibility = inputPrivacy.visibility;
  const visibility = authoredVisibility === undefined
    ? defaults.privacy.visibility
    : (typeof authoredVisibility === "string" ? authoredVisibility.toLowerCase() : defaults.privacy.visibility);
  if (authoredVisibility !== undefined
    && (typeof authoredVisibility !== "string" || !VISIBILITY_VALUES.has(authoredVisibility))) {
    errors.push('privacy.visibility must be "private", "unlisted", or "public".');
  }
  for (const key of ["showExactLocation", "showAddress"]) {
    if (inputPrivacy[key] !== undefined && typeof inputPrivacy[key] !== "boolean") {
      errors.push(`privacy.${key} must be a boolean.`);
    }
  }
  const privacyConfig = {
    visibility: VISIBILITY_VALUES.has(visibility) ? visibility : defaults.privacy.visibility,
    showExactLocation: booleanOr(inputPrivacy.showExactLocation, false),
    showAddress: booleanOr(inputPrivacy.showAddress, false),
  };
  locationConfig.showExactLocation = privacyConfig.showExactLocation;
  if (privacyConfig.showExactLocation || privacyConfig.showAddress || locationConfig.precision === "exact") {
    warnings.push("This configuration can reveal precise property information. Review it before publishing.");
  }

  const inputUi = input.ui === undefined ? {} : requiredRecord(input.ui, "ui", errors);
  unknownFieldErrors(inputUi, new Set(["theme"]), "ui", errors);
  const uiConfig = { theme: normalizeTheme(inputUi.theme, errors) };

  const runtimeConfig = {
    schemaVersion: 2,
    sourceSchemaVersion: 2,
    package: packageInfo,
    assets,
    slug: packageInfo.id,
    title: packageInfo.label,
    description: packageInfo.description,
    location: locationConfig,
    model: modelConfig,
    scene: { groundBounds, terrainProfile, cameraPresets },
    zones,
    solar: solarConfig,
    privacy: privacyConfig,
    ui: uiConfig,
  };
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    config: runtimeConfig,
    runtimeConfig,
    sourceSchemaVersion: 2,
  };
}

/** Validate either supported authoring contract without changing v1 behavior. */
export function validatePropertyConfig(input) {
  if (isRecord(input) && input.schemaVersion === 2) return validateV2PropertyConfig(input);
  return validateV1PropertyConfig(input);
}

/**
 * Explicit adapter for callers ready to consume the normalized v2 runtime
 * shape while accepting an existing schemaVersion 1 package.
 */
export function adaptV1PropertyConfig(input) {
  const result = validateV1PropertyConfig(input);
  return { ...result, config: result.runtimeConfig };
}

function parseSearch(search) {
  if (search instanceof URLSearchParams) return search;
  const raw = typeof search === "string" ? search : "";
  return new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
}

function safeBaseUrl(baseUrl) {
  const fallback = typeof document !== "undefined" ? document.baseURI : import.meta.url;
  let base;
  try {
    base = new URL(baseUrl || fallback);
  } catch {
    throw new TypeError("baseUrl must be an absolute HTTP(S) URL.");
  }
  if (!SAFE_REMOTE_PROTOCOLS.has(base.protocol) || base.username || base.password) {
    throw new TypeError("baseUrl must be an HTTP(S) URL without embedded credentials.");
  }
  return base;
}

function normalizeAllowedConfigHosts(allowedHosts) {
  if (!Array.isArray(allowedHosts)) {
    throw new TypeError("allowedHosts must be an array of exact HTTPS host names.");
  }
  const result = new Set();
  for (const value of allowedHosts) {
    if (typeof value !== "string" || !/^[a-z0-9.-]+(?::\d+)?$/i.test(value) || value.includes("..")) {
      throw new TypeError(`Invalid allowed HTTPS host: ${String(value)}`);
    }
    result.add(value.toLowerCase());
  }
  return result;
}

function assertSafeConfigUrl(url, { base, allowedHosts }) {
  if (!SAFE_REMOTE_PROTOCOLS.has(url.protocol)) {
    throw new TypeError(`Unsupported configuration URL scheme: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new TypeError("Configuration URL must not contain embedded credentials.");
  }
  if (url.origin !== base.origin) {
    if (url.protocol !== "https:" || !allowedHosts.has(url.host.toLowerCase())) {
      throw new TypeError(`Cross-origin configuration host is not allowed: ${url.host}`);
    }
  }
  return url.href;
}

/** Resolve a property selector into a fetchable configuration URL. */
export function resolvePropertyConfigUrl(search = "", baseUrl, { allowedHosts = [] } = {}) {
  const params = parseSearch(search);
  const base = safeBaseUrl(baseUrl);
  const trustedHosts = normalizeAllowedConfigHosts(allowedHosts);
  const explicitConfig = params.get("config");
  if (explicitConfig) {
    if (hasPathTraversal(explicitConfig)) {
      throw new TypeError("Configuration URL must not contain path traversal.");
    }
    let resolved;
    try {
      resolved = new URL(explicitConfig, base);
    } catch {
      throw new TypeError("Configuration URL is malformed.");
    }
    return assertSafeConfigUrl(resolved, { base, allowedHosts: trustedHosts });
  }

  const property = (params.get("property") || DEFAULT_PROPERTY_CONFIG.slug).trim().toLowerCase();
  const segments = property.split("/");
  if (!segments.length || segments.some((segment) => !SAFE_SLUG.test(segment))) {
    throw new TypeError("property must be a relative slug made of letters, numbers, hyphens, or underscores.");
  }
  return assertSafeConfigUrl(new URL(`properties/${segments.join("/")}/property.json`, base), {
    base,
    allowedHosts: trustedHosts,
  });
}

/**
 * Fetch, validate, and normalize a selected property configuration.
 * Fetch or validation failures return the built-in privacy-safe demo.
 */
export async function loadPropertyConfig({ search, baseUrl, allowedHosts = [] } = {}) {
  const warnings = [];
  let url;
  try {
    url = resolvePropertyConfigUrl(
      search ?? (typeof location !== "undefined" ? location.search : ""),
      baseUrl,
      { allowedHosts },
    );
  } catch (error) {
    warnings.push(`${error.message} Using the built-in demo configuration.`);
    return {
      config: clone(DEFAULT_PROPERTY_CONFIG),
      runtimeConfig: runtimeDefaults(),
      sourceSchemaVersion: 1,
      url: null,
      warnings,
    };
  }

  try {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Configuration request failed (${response.status}).`);
    const raw = await response.json();
    const result = validatePropertyConfig(raw);
    warnings.push(...result.warnings);
    if (!result.valid) {
      warnings.push(`Configuration was invalid: ${result.errors.join(" ")} Using the built-in demo configuration.`);
      return {
        config: clone(DEFAULT_PROPERTY_CONFIG),
        runtimeConfig: runtimeDefaults(),
        sourceSchemaVersion: 1,
        url,
        warnings,
      };
    }

    const originalModelUrl = result.config.model.url;
    const absoluteModelUrl = new URL(originalModelUrl, url);
    if (!["http:", "https:", "blob:"].includes(absoluteModelUrl.protocol)) {
      throw new Error(`Unsupported model URL scheme: ${absoluteModelUrl.protocol}`);
    }
    result.config.model = {
      ...result.config.model,
      url: absoluteModelUrl.href,
      sourceUrl: originalModelUrl,
    };
    const runtimeConfig = clone(result.runtimeConfig);
    runtimeConfig.assets = runtimeConfig.assets.map((asset) => ({
      ...asset,
      sourceUrl: asset.url,
      url: new URL(asset.url, url).href,
    }));
    runtimeConfig.model = {
      ...runtimeConfig.model,
      url: absoluteModelUrl.href,
      sourceUrl: originalModelUrl,
    };
    if (result.sourceSchemaVersion === 2) {
      result.config.assets = runtimeConfig.assets;
    }
    return {
      config: result.config,
      runtimeConfig,
      sourceSchemaVersion: result.sourceSchemaVersion,
      url,
      warnings,
    };
  } catch (error) {
    warnings.push(`${error.message} Using the built-in demo configuration.`);
    return {
      config: clone(DEFAULT_PROPERTY_CONFIG),
      runtimeConfig: runtimeDefaults(),
      sourceSchemaVersion: 1,
      url,
      warnings,
    };
  }
}
