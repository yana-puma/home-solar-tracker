/** Pure share-state parsing and URL serialization for the solar viewer. */

const SAFE_SLUG = /^[a-z0-9](?:[a-z0-9_-]{0,62})$/;
const SAFE_REVISION = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,63})$/;
const SAFE_PRESERVED_KEY = /^[a-z][a-z0-9_-]{0,31}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ON_OFF = new Set(["on", "off"]);
const MAP_MODES = new Set(["off", "estimated", "calculated"]);
const RESERVED_KEYS = new Set([
  "property",
  "v",
  "date",
  "time",
  "view",
  "zone",
  "markers",
  "compass",
  "map",
  "tier",
  "speed",
  "compare",
]);

export const SHARE_QUERY_ORDER = Object.freeze([
  "property",
  "v",
  "date",
  "time",
  "view",
  "zone",
  "markers",
  "compass",
  "map",
  "tier",
  "speed",
  "compare",
]);

export const DEFAULT_SHARE_STATE = Object.freeze({
  property: "demo",
  revision: null,
  date: null,
  localTimeMinutes: 720,
  view: null,
  selectedZone: null,
  markers: "on",
  compass: "on",
  map: "off",
  exposureTier: "standard",
  playbackSpeed: 1,
  compareDates: Object.freeze([]),
});

function cloneDefaults(defaults = DEFAULT_SHARE_STATE) {
  return {
    property: defaults.property,
    revision: defaults.revision ?? null,
    date: defaults.date ?? null,
    localTimeMinutes: defaults.localTimeMinutes,
    view: defaults.view ?? null,
    selectedZone: defaults.selectedZone ?? null,
    markers: defaults.markers,
    compass: defaults.compass,
    map: defaults.map,
    exposureTier: defaults.exposureTier ?? "standard",
    playbackSpeed: defaults.playbackSpeed,
    compareDates: [...(defaults.compareDates || [])],
  };
}

function validCalendarDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day));
  return instant.getUTCFullYear() === year
    && instant.getUTCMonth() === month - 1
    && instant.getUTCDate() === day;
}

function parseLocalTime(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 && value <= 1439 ? value : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^\d{1,4}$/.test(trimmed)) {
    const minutes = Number(trimmed);
    return minutes >= 0 && minutes <= 1439 ? minutes : null;
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? hours * 60 + minutes : null;
}

function normalizeSpeed(value) {
  const speed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 16) return null;
  return Number(speed.toFixed(3));
}

function normalizeCompareDates(value, warnings) {
  const values = Array.isArray(value)
    ? value
    : (typeof value === "string" && value.trim() ? value.split(",") : []);
  const dates = [];
  for (const candidate of values) {
    if (!validCalendarDate(candidate)) {
      warnings.push(`Ignored malformed comparison date: ${String(candidate)}`);
      continue;
    }
    if (!dates.includes(candidate)) dates.push(candidate);
  }
  if (dates.length > 4) warnings.push("Only the first four comparison dates are retained.");
  return dates.slice(0, 4).sort();
}

function normalizePreserveKeys(values) {
  if (!Array.isArray(values)) throw new TypeError("preserveParams must be an array.");
  const keys = new Set();
  for (const value of values) {
    if (typeof value !== "string" || !SAFE_PRESERVED_KEY.test(value) || RESERVED_KEYS.has(value)) {
      throw new TypeError(`Cannot preserve query parameter: ${String(value)}`);
    }
    keys.add(value);
  }
  return [...keys].sort();
}

function safePreservedValue(value) {
  return typeof value === "string" && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Normalize an application state object without reading browser globals. */
export function normalizeShareState(input = {}, { defaults = DEFAULT_SHARE_STATE } = {}) {
  const warnings = [];
  const state = cloneDefaults(defaults);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { state, warnings: ["Share state was not an object; defaults were used."] };
  }

  if (input.property !== undefined) {
    if (typeof input.property === "string" && SAFE_SLUG.test(input.property)) state.property = input.property;
    else warnings.push("Malformed property selector was replaced with the default.");
  }
  if (input.revision !== undefined && input.revision !== null && input.revision !== "") {
    if (typeof input.revision === "string" && SAFE_REVISION.test(input.revision)) state.revision = input.revision;
    else warnings.push("Malformed property revision was removed.");
  } else if (input.revision === null || input.revision === "") {
    state.revision = null;
  }
  if (input.date !== undefined && input.date !== null && input.date !== "") {
    if (validCalendarDate(input.date)) state.date = input.date;
    else warnings.push("Malformed study date was removed.");
  } else if (input.date === null || input.date === "") {
    state.date = null;
  }
  if (input.localTimeMinutes !== undefined) {
    const time = parseLocalTime(input.localTimeMinutes);
    if (time === null) warnings.push("Malformed local time was replaced with the default.");
    else state.localTimeMinutes = time;
  }
  for (const [field, label] of [["view", "view"], ["selectedZone", "selected zone"]]) {
    if (input[field] === undefined) continue;
    if (input[field] === null || input[field] === "") state[field] = null;
    else if (typeof input[field] === "string" && SAFE_SLUG.test(input[field])) state[field] = input[field];
    else warnings.push(`Malformed ${label} was removed.`);
  }
  for (const field of ["markers", "compass"]) {
    if (input[field] === undefined) continue;
    if (ON_OFF.has(input[field])) state[field] = input[field];
    else warnings.push(`Malformed ${field} mode was replaced with the default.`);
  }
  if (input.map !== undefined) {
    if (MAP_MODES.has(input.map)) state.map = input.map;
    else warnings.push("Malformed map mode was replaced with the default.");
  }
  if (input.exposureTier !== undefined) {
    if (["quick", "standard", "high"].includes(input.exposureTier)) state.exposureTier = input.exposureTier;
    else warnings.push("Malformed exposure tier was replaced with the default.");
  }
  if (input.playbackSpeed !== undefined) {
    const speed = normalizeSpeed(input.playbackSpeed);
    if (speed === null) warnings.push("Malformed playback speed was replaced with the default.");
    else state.playbackSpeed = speed;
  }
  if (input.compareDates !== undefined) state.compareDates = normalizeCompareDates(input.compareDates, warnings);
  return { state, warnings };
}

function searchParamsFrom(value) {
  if (value instanceof URLSearchParams) return new URLSearchParams(value);
  if (value instanceof URL) return new URLSearchParams(value.search);
  const raw = typeof value === "string" ? value : "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return new URL(raw).searchParams;
  return new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
}

function lastValue(params, key, warnings) {
  const values = params.getAll(key);
  if (values.length > 1) warnings.push(`Duplicate ${key} parameters were normalized; the last value won.`);
  return values.length ? values[values.length - 1] : undefined;
}

/** Parse a query string or URL into normalized share state. */
export function parseShareState(value = "", {
  defaults = DEFAULT_SHARE_STATE,
  preserveParams = [],
} = {}) {
  const warnings = [];
  let params;
  try {
    params = searchParamsFrom(value);
  } catch {
    return {
      state: cloneDefaults(defaults),
      warnings: ["Malformed share URL was replaced with defaults."],
      preservedParams: {},
    };
  }
  const raw = {
    property: lastValue(params, "property", warnings),
    revision: lastValue(params, "v", warnings),
    date: lastValue(params, "date", warnings),
    localTimeMinutes: lastValue(params, "time", warnings),
    view: lastValue(params, "view", warnings),
    selectedZone: lastValue(params, "zone", warnings),
    markers: lastValue(params, "markers", warnings),
    compass: lastValue(params, "compass", warnings),
    map: lastValue(params, "map", warnings),
    exposureTier: lastValue(params, "tier", warnings),
    playbackSpeed: lastValue(params, "speed", warnings),
    compareDates: lastValue(params, "compare", warnings),
  };
  for (const [key, item] of Object.entries(raw)) {
    if (item === undefined) delete raw[key];
  }
  const normalized = normalizeShareState(raw, { defaults });
  warnings.push(...normalized.warnings);

  const preservedParams = {};
  const allowedKeys = normalizePreserveKeys(preserveParams);
  for (const key of allowedKeys) {
    const candidate = lastValue(params, key, warnings);
    if (candidate === undefined) continue;
    if (safePreservedValue(candidate)) preservedParams[key] = candidate;
    else warnings.push(`Unsafe preserved parameter ${key} was ignored.`);
  }
  for (const key of params.keys()) {
    if (!RESERVED_KEYS.has(key) && !allowedKeys.includes(key)) {
      warnings.push(`Unrelated query parameter ${key} was ignored.`);
    }
  }
  return { state: normalized.state, warnings, preservedParams };
}

function appendIf(params, key, value, condition) {
  if (condition) params.append(key, String(value));
}

/** Serialize normalized state into a canonical query string. */
export function serializeShareState(input = {}, {
  defaults = DEFAULT_SHARE_STATE,
  preserveParams = [],
  preservedParams = {},
} = {}) {
  const { state } = normalizeShareState(input, { defaults });
  const baseline = cloneDefaults(defaults);
  const params = new URLSearchParams();
  params.append("property", state.property);
  appendIf(params, "v", state.revision, state.revision !== null);
  appendIf(params, "date", state.date, state.date !== null);
  appendIf(params, "time", state.localTimeMinutes, state.localTimeMinutes !== baseline.localTimeMinutes);
  appendIf(params, "view", state.view, state.view !== null);
  appendIf(params, "zone", state.selectedZone, state.selectedZone !== null);
  appendIf(params, "markers", state.markers, state.markers !== baseline.markers);
  appendIf(params, "compass", state.compass, state.compass !== baseline.compass);
  appendIf(params, "map", state.map, state.map !== baseline.map);
  appendIf(params, "tier", state.exposureTier, state.exposureTier !== baseline.exposureTier);
  appendIf(params, "speed", state.playbackSpeed, state.playbackSpeed !== baseline.playbackSpeed);
  appendIf(params, "compare", state.compareDates.join(","), state.compareDates.length > 0);

  for (const key of normalizePreserveKeys(preserveParams)) {
    const value = preservedParams instanceof URLSearchParams
      ? preservedParams.get(key)
      : preservedParams?.[key];
    if (safePreservedValue(value)) params.append(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Build a share URL without mutating location or browser history. */
export function buildShareUrl(baseUrl, state, options = {}) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new TypeError("baseUrl must be an absolute HTTP(S) URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new TypeError("baseUrl must be an HTTP(S) URL without embedded credentials.");
  }
  url.search = serializeShareState(state, options);
  return url.href;
}

/** Parse and rebuild an existing URL in canonical order. */
export function canonicalizeShareUrl(url, options = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError("url must be an absolute HTTP(S) URL.");
  }
  const result = parseShareState(parsed, options);
  const canonicalUrl = buildShareUrl(parsed.href, result.state, {
    ...options,
    preservedParams: result.preservedParams,
  });
  return { ...result, url: canonicalUrl };
}
