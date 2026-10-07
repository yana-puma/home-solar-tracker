/**
 * Privacy-preserving, local-only diagnostics for the property solar viewer.
 *
 * Recording never performs I/O. Diagnostics can leave memory only through an
 * explicit user-initiated export or an explicitly supplied transport.
 */

export const DIAGNOSTIC_STAGES = Object.freeze([
  'config',
  'model',
  'first-render',
  'exposure',
]);

export const ERROR_CATEGORIES = Object.freeze([
  'config',
  'model',
  'render',
  'exposure',
  'validation',
  'storage',
  'network',
  'unknown',
]);

export const REDACTED = '[redacted]';

const REDACTED_ADDRESS = '[redacted-address]';
const REDACTED_COORDINATE = '[redacted-coordinate]';
const REDACTED_PATH = '[redacted-path]';
const REDACTED_QUERY = '[redacted-query-value]';
const REDACTED_URL = '[redacted-url]';
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 100;
const MAX_STRING_LENGTH = 2000;

const SENSITIVE_KEY_PART = new Set([
  'address', 'latitude', 'longitude', 'lat', 'lon', 'lng', 'coordinate',
  'coordinates', 'gps', 'position',
]);
const SENSITIVE_KEY_COMPOUND = new Set(['streetaddress', 'geolocation', 'gpsposition']);
const SECRET_KEY_COMPOUND = /(?:authorization|apikey|accesstoken|authtoken|bearer|cookie|credential|password|secret|signature|signedurl|token|xamz|xgoog)/;
const MODEL_METADATA_COMPOUND = /(?:metadata|modelmetadata|extras|userdata|generator|copyright|creator|author|embeddedimages?|modelname|meshname|nodename|materialname)/;
const ADDRESS_PATTERN = /\b\d{1,6}[\s-]+(?:[A-Za-z0-9.'-]+[\s-]+){0,5}(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Court|Ct|Boulevard|Blvd|Way|Place|Pl|Terrace|Trail|Parkway|Pkwy|Highway|Hwy)\b(?:[.,]?\s*(?:Apt|Apartment|Unit|Suite|#)\s*[A-Za-z0-9-]+)?/gi;
const ADDRESS_DETECTION_PATTERN = new RegExp(ADDRESS_PATTERN.source, 'i');
const LABELED_COORDINATE_PATTERN = /\b(latitude|longitude|lat|lon|lng)\s*[:=]\s*[-+]?\d{1,3}(?:\.\d+)?/gi;
const COORDINATE_PAIR_PATTERN = /(?<![\d.])[-+]?\d{1,2}\.\d{3,}\s*[,/]\s*[-+]?\d{1,3}\.\d{3,}(?![\d.])/g;
const FILE_URL_PATTERN = /file:\/\/[^\s"'<>),]+/gi;
const HTTP_URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:\\(?:[^\s\\/:*?"<>|]+\\)*[^\s\\/:*?"<>|]*/g;
const UNIX_PATH_PATTERN = /(^|[\s("'=])\/(?:Users|home|var|private|tmp|Volumes|mnt|opt|usr|etc)\/[^\s"'<>),]*/g;
const QUERY_VALUE_PATTERN = /([?&][A-Za-z0-9_.~%-]+=)[^&#\s"'<>]+/g;
let fallbackIdSequence = 0;

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function normalizeStage(stage) {
  const aliases = {
    'config-load': 'config',
    configuration: 'config',
    'model-load': 'model',
    render: 'first-render',
    firstRender: 'first-render',
    'exposure-calculation': 'exposure',
  };
  const normalized = aliases[stage] || stage;
  if (!DIAGNOSTIC_STAGES.includes(normalized)) {
    throw new RangeError(`stage must be one of: ${DIAGNOSTIC_STAGES.join(', ')}`);
  }
  return normalized;
}

function nowMilliseconds(clock) {
  const value = clock();
  const milliseconds = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(milliseconds)) throw new TypeError('clock must return a Date or finite milliseconds');
  return milliseconds;
}

function timestampFor(milliseconds) {
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return '1970-01-01T00:00:00.000Z';
  }
}

function defaultClock() {
  return Date.now();
}

function defaultIdFactory(kind, sequence, milliseconds) {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `${kind}-${randomId}`;
  fallbackIdSequence += 1;
  return `${kind}-${Math.trunc(milliseconds).toString(36)}-${sequence.toString(36)}-${fallbackIdSequence.toString(36)}`;
}

function normalizedKeyParts(key) {
  if (typeof key !== 'string' || !key) return [];
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function keyClassification(key) {
  const parts = normalizedKeyParts(key);
  const compound = parts.join('');
  return {
    sensitive: parts.some((part) => SENSITIVE_KEY_PART.has(part))
      || SENSITIVE_KEY_COMPOUND.has(compound),
    secret: SECRET_KEY_COMPOUND.test(compound),
    modelMetadata: MODEL_METADATA_COMPOUND.test(compound),
    filesystemPath: parts.at(-1) === 'path',
  };
}

function isCoordinateNumberPair(value) {
  return Array.isArray(value)
    && value.length === 2
    && value.every((item) => typeof item === 'number' && Number.isFinite(item))
    && value[0] >= -90
    && value[0] <= 90
    && value[1] >= -180
    && value[1] <= 180;
}

function safeQueryKey(value) {
  const decoded = (() => {
    try {
      return decodeURIComponent(value.replaceAll('+', ' '));
    } catch {
      return '';
    }
  })();
  if (!/^[A-Za-z0-9_.~-]{1,64}$/.test(decoded)) return 'parameter';
  const classification = keyClassification(decoded);
  return classification.secret || classification.sensitive
    || classification.modelMetadata || classification.filesystemPath
    ? 'redacted-parameter'
    : decoded;
}

function redactUrl(urlText) {
  if (/^file:/i.test(urlText)) return REDACTED_PATH;
  try {
    const parsed = new URL(urlText);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return REDACTED;
    const path = parsed.pathname && parsed.pathname !== '/' ? `/${REDACTED_PATH}` : '';
    const query = [...parsed.searchParams.keys()]
      .map((key) => `${safeQueryKey(key)}=${REDACTED_QUERY}`)
      .join('&');
    return `${parsed.origin}${path}${query ? `?${query}` : ''}`;
  } catch {
    // Malformed HTTP(S) text is not useful enough to justify retaining any of
    // it; in particular, partial parsing must never preserve URL userinfo.
    return REDACTED_URL;
  }
}

function redactString(value) {
  let result = value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}[truncated]`
    : value;
  result = result.replace(FILE_URL_PATTERN, REDACTED_PATH);
  result = result.replace(HTTP_URL_PATTERN, (url) => redactUrl(url));
  result = result.replace(QUERY_VALUE_PATTERN, `$1${REDACTED_QUERY}`);
  result = result.replace(WINDOWS_PATH_PATTERN, REDACTED_PATH);
  result = result.replace(UNIX_PATH_PATTERN, (_match, prefix) => `${prefix}${REDACTED_PATH}`);
  if (ADDRESS_DETECTION_PATTERN.test(result)) return REDACTED_ADDRESS;
  result = result.replace(ADDRESS_PATTERN, REDACTED_ADDRESS);
  result = result.replace(LABELED_COORDINATE_PATTERN, (_match, label) => `${label}=${REDACTED_COORDINATE}`);
  result = result.replace(COORDINATE_PAIR_PATTERN, REDACTED_COORDINATE);
  return result;
}

function redactValue(value, seen, depth, key = '') {
  const classification = keyClassification(key);
  if (classification.secret) return REDACTED;
  if (classification.modelMetadata) return REDACTED;
  if (classification.filesystemPath) return REDACTED_PATH;
  if (classification.sensitive) return REDACTED_COORDINATE;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return '[undefined]';
  if (typeof value === 'function') return '[function]';
  if (typeof value === 'symbol') return value.toString();
  if (!isObject(value)) return redactString(String(value));
  if (depth >= MAX_DEPTH) return '[max-depth]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '[invalid-date]' : value.toISOString();
  if (value instanceof Error) {
    const redactedError = {
      name: redactString(value.name || 'Error'),
      message: redactString(value.message || ''),
    };
    if (typeof value.code === 'string' || typeof value.code === 'number') {
      redactedError.code = redactString(String(value.code));
    }
    if (typeof value.stack === 'string') redactedError.stack = redactString(value.stack);
    return redactedError;
  }
  if (typeof URL !== 'undefined' && value instanceof URL) return redactUrl(value.toString());
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
    return `[binary ${value.byteLength} bytes]`;
  }
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
    return `[binary ${value.byteLength} bytes]`;
  }
  if (isCoordinateNumberPair(value)) return REDACTED_COORDINATE;
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS)
      .map((item) => redactValue(item, seen, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`[${value.length - MAX_ARRAY_ITEMS} more items]`);
    return items;
  }

  const result = {};
  const keys = Object.keys(value).sort().slice(0, MAX_OBJECT_KEYS);
  for (const property of keys) {
    let propertyValue;
    try {
      propertyValue = value[property];
    } catch {
      propertyValue = '[unreadable]';
    }
    result[property] = redactValue(propertyValue, seen, depth + 1, property);
  }
  const omitted = Object.keys(value).length - keys.length;
  if (omitted > 0) result['[truncated-keys]'] = omitted;
  return result;
}

/** Return a serializable copy with sensitive property information removed. */
export function redactDiagnostics(value) {
  return redactValue(value, new WeakSet(), 0);
}

/** Infer a stable, coarse error category without exposing error details. */
export function categorizeDiagnosticError(error, context = {}) {
  const explicit = context.category;
  if (explicit !== undefined) {
    if (!ERROR_CATEGORIES.includes(explicit)) {
      throw new RangeError(`category must be one of: ${ERROR_CATEGORIES.join(', ')}`);
    }
    return explicit;
  }
  const haystack = [
    context.stage,
    context.component,
    error?.name,
    error?.code,
    error?.message,
  ].filter(Boolean).join(' ').toLowerCase();
  if (/exposure|raycast|occlusion|solar analysis/.test(haystack)) return 'exposure';
  if (/gltf|glb|model|mesh|draco|texture/.test(haystack)) return 'model';
  if (/render|webgl|canvas|shader|gpu/.test(haystack)) return 'render';
  if (/config|property\.json|schema/.test(haystack)) return 'config';
  if (/validation|invalid|rangeerror|typeerror/.test(haystack)) return 'validation';
  if (/storage|quota|indexeddb|localstorage/.test(haystack)) return 'storage';
  if (/network|fetch|http|cors|timeout|offline/.test(haystack)) return 'network';
  return 'unknown';
}

function validateTransport(transport) {
  if (transport === null || transport === undefined) return null;
  if (typeof transport === 'function') return { send: transport };
  if (typeof transport.send === 'function') return transport;
  throw new TypeError('transport must be a function or provide a send(payload) method');
}

function cloneEvent(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Bounded in-memory diagnostics recorder.
 *
 * There are deliberately no fetch, beacon, persistence, or automatic export
 * paths. Supplying a transport only enables `transmit`; it does not schedule or
 * automatically invoke that transport.
 */
export class LocalDiagnostics {
  constructor({
    maxEvents = 200,
    clock = defaultClock,
    idFactory = defaultIdFactory,
    transport = null,
    appVersion = null,
  } = {}) {
    if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 10_000) {
      throw new RangeError('maxEvents must be an integer between 1 and 10000');
    }
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    if (typeof idFactory !== 'function') throw new TypeError('idFactory must be a function');
    this.maxEvents = maxEvents;
    this._clock = clock;
    this._idFactory = idFactory;
    this._transport = validateTransport(transport);
    this._events = [];
    this._activeTimings = new Map();
    this._idSequence = 0;
    this._eventSequence = 0;
    const createdAt = nowMilliseconds(this._clock);
    this.sessionId = String(this._idFactory('session', 0, createdAt));
    this.createdAt = timestampFor(createdAt);
    this.appVersion = appVersion === null ? null : redactString(String(appVersion));
  }

  get size() {
    return this._events.length;
  }

  get hasTransport() {
    return this._transport !== null;
  }

  _nextId(kind, milliseconds) {
    this._idSequence += 1;
    return String(this._idFactory(kind, this._idSequence, milliseconds));
  }

  _append(event, milliseconds = nowMilliseconds(this._clock)) {
    this._eventSequence += 1;
    const safeEvent = redactDiagnostics({
      sequence: this._eventSequence,
      timestamp: timestampFor(milliseconds),
      ...event,
    });
    this._events.push(safeEvent);
    while (this._events.length > this.maxEvents) this._events.shift();
    return cloneEvent(safeEvent);
  }

  /** Record a named mark for config, model, first render, or exposure. */
  mark(stage, details = {}) {
    const normalizedStage = normalizeStage(stage);
    const milliseconds = nowMilliseconds(this._clock);
    const correlationId = this._nextId('mark', milliseconds);
    return this._append({
      type: 'performance',
      stage: normalizedStage,
      state: 'mark',
      correlationId,
      details,
    }, milliseconds);
  }

  /** Begin a measured config, model, first-render, or exposure interval. */
  startTiming(stage, details = {}) {
    const normalizedStage = normalizeStage(stage);
    const milliseconds = nowMilliseconds(this._clock);
    const correlationId = this._nextId('timing', milliseconds);
    this._activeTimings.set(correlationId, { stage: normalizedStage, milliseconds });
    this._append({
      type: 'performance',
      stage: normalizedStage,
      state: 'start',
      correlationId,
      details,
    }, milliseconds);
    return Object.freeze({ correlationId, stage: normalizedStage });
  }

  /** Complete an interval returned by `startTiming`. */
  endTiming(timing, details = {}) {
    const correlationId = typeof timing === 'string' ? timing : timing?.correlationId;
    if (typeof correlationId !== 'string' || !this._activeTimings.has(correlationId)) {
      throw new RangeError('timing must identify an active timing');
    }
    const active = this._activeTimings.get(correlationId);
    this._activeTimings.delete(correlationId);
    const milliseconds = nowMilliseconds(this._clock);
    return this._append({
      type: 'performance',
      stage: active.stage,
      state: 'complete',
      correlationId,
      durationMs: Math.max(0, milliseconds - active.milliseconds),
      details,
    }, milliseconds);
  }

  /** Record a categorized, redacted error and return its correlation id. */
  recordError(error, context = {}) {
    const normalizedError = error instanceof Error ? error : new Error(String(error ?? 'Unknown error'));
    const milliseconds = nowMilliseconds(this._clock);
    const correlationId = context.correlationId === undefined
      ? this._nextId('error', milliseconds)
      : String(context.correlationId);
    const category = categorizeDiagnosticError(normalizedError, context);
    const { category: _category, correlationId: _correlationId, ...details } = context;
    return this._append({
      type: 'error',
      category,
      correlationId,
      error: normalizedError,
      details,
    }, milliseconds);
  }

  /** Return a detached snapshot. Reading a snapshot performs no export or I/O. */
  getEvents() {
    return cloneEvent(this._events);
  }

  clear() {
    this._events.length = 0;
    this._activeTimings.clear();
  }

  _snapshot() {
    return redactDiagnostics({
      format: 'atlee-local-diagnostics',
      formatVersion: 1,
      sessionId: this.sessionId,
      createdAt: this.createdAt,
      appVersion: this.appVersion,
      eventCount: this._events.length,
      events: this._events,
    });
  }

  /**
   * Serialize diagnostics only after a user-selected export action.
   * Callers should pass `{ userInitiated: true }` from their click handler.
   */
  exportJson({ userInitiated = false, pretty = true } = {}) {
    if (userInitiated !== true) {
      throw new Error('Diagnostics export requires an explicit user action');
    }
    return JSON.stringify(this._snapshot(), null, pretty ? 2 : 0);
  }

  /**
   * Send a redacted snapshot through an explicitly supplied transport.
   * This method is never called automatically and is user-action gated.
   */
  async transmit({ userInitiated = false } = {}) {
    if (userInitiated !== true) {
      throw new Error('Diagnostics transport requires an explicit user action');
    }
    if (!this._transport) {
      throw new Error('Diagnostics transport is disabled');
    }
    return this._transport.send(this._snapshot());
  }
}

export function createLocalDiagnostics(options) {
  return new LocalDiagnostics(options);
}
