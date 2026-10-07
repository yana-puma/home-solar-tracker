/**
 * Validation and selection for the static property registry.
 *
 * This module is deliberately browser-independent. Callers provide registry
 * data and its source URL, then decide whether to update browser history.
 */

const SAFE_SLUG = /^[a-z0-9](?:[a-z0-9_-]{0,62})$/;
const SAFE_REVISION = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,63})$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const PRIVACY_TIERS = new Set(["private", "unlisted", "public"]);
const ENTRY_FIELDS = new Set([
  "slug",
  "title",
  "displayLabel",
  "revision",
  "configUrl",
  "modelUrl",
  "privacyTier",
  "updatedAt",
]);
const REGISTRY_FIELDS = new Set(["schemaVersion", "defaultProperty", "properties"]);
const DEFAULT_REGISTRY_URL = "https://property-solar.local/properties/index.json";

export const DEFAULT_REGISTRY_ENTRY = Object.freeze({
  slug: "demo",
  title: "Property Solar Study",
  displayLabel: "Configured property",
  revision: "built-in",
  configUrl: "./demo/property.json",
  modelUrl: "./demo/model.glb",
  privacyTier: "private",
  updatedAt: "1970-01-01T00:00:00Z",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonemptyString(value, maximum = 120) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximum;
}

function validTimestamp(value) {
  if (typeof value !== "string" || !RFC3339.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12
    && day >= 1 && day <= daysInMonth
    && hour <= 23
    && minute <= 59
    && second <= 59;
}

function unknownFields(value, allowed, path, errors) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed.`);
  }
}

function hasPathTraversal(value) {
  if (typeof value !== "string" || value.includes("\\")) return true;
  let decoded = value.split(/[?#]/, 1)[0];
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return true;
    }
  }
  if (decoded.includes("\\")) return true;
  const path = decoded.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  return path.split("/").some((segment, index) => segment === ".." || (segment === "." && index > 0));
}

function normalizeAllowedHosts(allowedHosts) {
  if (!Array.isArray(allowedHosts)) throw new TypeError("allowedHosts must be an array of HTTPS host names.");
  const result = new Set();
  for (const value of allowedHosts) {
    if (typeof value !== "string" || !/^[a-z0-9.-]+(?::\d+)?$/i.test(value) || value.includes("..")) {
      throw new TypeError(`Invalid allowed HTTPS host: ${String(value)}`);
    }
    result.add(value.toLowerCase());
  }
  return result;
}

function safeRegistryBase(registryUrl) {
  let base;
  try {
    base = new URL(registryUrl || DEFAULT_REGISTRY_URL);
  } catch {
    throw new TypeError("registryUrl must be an absolute HTTP(S) URL.");
  }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) {
    throw new TypeError("registryUrl must be an HTTP(S) URL without embedded credentials.");
  }
  return base;
}

/**
 * Resolve one authored registry URL against its registry source.
 * Same-origin URLs are accepted. Cross-origin URLs require HTTPS and an exact
 * host match in allowedHosts. Raw and repeatedly encoded traversal is rejected.
 */
export function resolveTrustedRegistryUrl(value, {
  registryUrl = DEFAULT_REGISTRY_URL,
  allowedHosts = [],
} = {}) {
  if (!isNonemptyString(value, 2048)) {
    throw new TypeError("Registry URL must be a non-empty string of at most 2048 characters.");
  }
  const authored = value.trim();
  if (hasPathTraversal(authored)) throw new TypeError("Registry URL must not contain path traversal.");
  const base = safeRegistryBase(registryUrl);
  const hosts = normalizeAllowedHosts(allowedHosts);
  let resolved;
  try {
    resolved = new URL(authored, base);
  } catch {
    throw new TypeError("Registry URL is malformed.");
  }
  if (resolved.username || resolved.password) {
    throw new TypeError("Registry URL must not contain embedded credentials.");
  }
  if (!["http:", "https:"].includes(resolved.protocol)) {
    throw new TypeError(`Registry URL scheme is not allowed: ${resolved.protocol}`);
  }
  if (resolved.origin !== base.origin) {
    if (resolved.protocol !== "https:" || !hosts.has(resolved.host.toLowerCase())) {
      throw new TypeError(`Cross-origin registry host is not allowed: ${resolved.host}`);
    }
  }
  return resolved.href;
}

function validateEntry(value, index, options, errors) {
  const path = `properties[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return null;
  }
  const initialErrorCount = errors.length;
  unknownFields(value, ENTRY_FIELDS, path, errors);
  let entryValid = errors.length === initialErrorCount;
  const fail = (message) => {
    entryValid = false;
    errors.push(`${path}.${message}`);
  };

  if (typeof value.slug !== "string" || !SAFE_SLUG.test(value.slug)) {
    fail("slug must be a lowercase slug of at most 63 characters.");
  }
  if (!isNonemptyString(value.title)) fail("title must be a non-empty string of at most 120 characters.");
  if (!isNonemptyString(value.displayLabel)) {
    fail("displayLabel must be a non-empty string of at most 120 characters.");
  }
  if (typeof value.revision !== "string" || !SAFE_REVISION.test(value.revision)) {
    fail("revision must contain only letters, numbers, dots, underscores, or hyphens.");
  }
  if (!PRIVACY_TIERS.has(value.privacyTier)) {
    fail('privacyTier must be "private", "unlisted", or "public".');
  }
  if (!validTimestamp(value.updatedAt)) {
    fail("updatedAt must be an RFC 3339 timestamp.");
  }

  let configUrl;
  let modelUrl;
  try {
    configUrl = resolveTrustedRegistryUrl(value.configUrl, options);
    if (!new URL(configUrl).pathname.endsWith(".json")) throw new TypeError("configUrl must identify a JSON file.");
  } catch (error) {
    fail(`configUrl ${error.message}`);
  }
  try {
    modelUrl = resolveTrustedRegistryUrl(value.modelUrl, options);
    if (!new URL(modelUrl).pathname.endsWith(".glb")) throw new TypeError("modelUrl must identify a GLB file.");
  } catch (error) {
    fail(`modelUrl ${error.message}`);
  }
  if (!entryValid) return null;
  return {
    slug: value.slug,
    title: value.title.trim(),
    displayLabel: value.displayLabel.trim(),
    revision: value.revision,
    configUrl,
    modelUrl,
    sourceConfigUrl: value.configUrl.trim(),
    sourceModelUrl: value.modelUrl.trim(),
    privacyTier: value.privacyTier,
    updatedAt: new Date(value.updatedAt).toISOString(),
  };
}

/** Validate and normalize a static registry document. Invalid entries are omitted. */
export function validatePropertyRegistry(input, {
  registryUrl = DEFAULT_REGISTRY_URL,
  allowedHosts = [],
} = {}) {
  const errors = [];
  const warnings = [];
  const options = { registryUrl: safeRegistryBase(registryUrl).href, allowedHosts };
  // Validate the allowlist even when every registry entry is same-origin.
  normalizeAllowedHosts(allowedHosts);
  if (!isRecord(input)) {
    return {
      valid: false,
      errors: ["Property registry must be an object."],
      warnings,
      registry: { schemaVersion: 1, defaultProperty: "demo", properties: [] },
    };
  }
  unknownFields(input, REGISTRY_FIELDS, "registry", errors);
  if (input.schemaVersion !== 1) errors.push("registry.schemaVersion must be 1.");
  const defaultProperty = typeof input.defaultProperty === "string" && SAFE_SLUG.test(input.defaultProperty)
    ? input.defaultProperty
    : "demo";
  if (defaultProperty !== input.defaultProperty) {
    errors.push("registry.defaultProperty must be a lowercase slug of at most 63 characters.");
  }
  const properties = [];
  const versions = new Set();
  if (!Array.isArray(input.properties)) {
    errors.push("registry.properties must be an array.");
  } else {
    input.properties.forEach((value, index) => {
      const before = errors.length;
      const entry = validateEntry(value, index, options, errors);
      if (!entry) {
        if (errors.length > before) warnings.push(`properties[${index}] was omitted.`);
        return;
      }
      const key = `${entry.slug}\u0000${entry.revision}`;
      if (versions.has(key)) {
        errors.push(`properties[${index}] duplicates ${entry.slug}@${entry.revision}.`);
        return;
      }
      versions.add(key);
      properties.push(entry);
    });
  }
  if (!properties.some((entry) => entry.slug === defaultProperty)) {
    warnings.push(`No valid ${defaultProperty} entry exists; selection will use the built-in demo fallback.`);
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    registry: { schemaVersion: 1, defaultProperty, properties },
  };
}

function latestEntry(entries) {
  return [...entries].sort((left, right) => {
    const timeDifference = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    return timeDifference || right.revision.localeCompare(left.revision);
  })[0] || null;
}

function builtInFallback(registryUrl) {
  return {
    ...DEFAULT_REGISTRY_ENTRY,
    configUrl: resolveTrustedRegistryUrl(DEFAULT_REGISTRY_ENTRY.configUrl, { registryUrl }),
    modelUrl: resolveTrustedRegistryUrl(DEFAULT_REGISTRY_ENTRY.modelUrl, { registryUrl }),
    sourceConfigUrl: DEFAULT_REGISTRY_ENTRY.configUrl,
    sourceModelUrl: DEFAULT_REGISTRY_ENTRY.modelUrl,
  };
}

/**
 * Select a requested property revision. Missing or malformed selectors use the
 * registry default, then the built-in same-site demo if the registry has no
 * usable default entry.
 */
export function resolvePropertyEntry(input, {
  property = "demo",
  revision = null,
  registryUrl = DEFAULT_REGISTRY_URL,
  allowedHosts = [],
  fallbackSlug,
} = {}) {
  const validation = validatePropertyRegistry(input, { registryUrl, allowedHosts });
  const warnings = [...validation.warnings];
  if (validation.errors.length) warnings.push(...validation.errors.map((error) => `Registry: ${error}`));
  const requestedProperty = typeof property === "string" && SAFE_SLUG.test(property) ? property : null;
  const requestedRevision = revision === null || revision === undefined || revision === ""
    ? null
    : (typeof revision === "string" && SAFE_REVISION.test(revision) ? revision : null);
  if (!requestedProperty) warnings.push("Requested property was malformed; using the safe fallback.");
  if (revision !== null && revision !== undefined && revision !== "" && !requestedRevision) {
    warnings.push("Requested revision was malformed; using the safe fallback.");
  }
  const entries = validation.registry.properties;
  let entry = null;
  if (requestedProperty && (revision === null || revision === undefined || revision === "" || requestedRevision)) {
    const candidates = entries.filter((candidate) => candidate.slug === requestedProperty);
    entry = requestedRevision
      ? candidates.find((candidate) => candidate.revision === requestedRevision) || null
      : latestEntry(candidates);
  }
  let fallback = false;
  if (!entry) {
    fallback = true;
    if (requestedProperty) {
      warnings.push(`Property revision ${requestedProperty}@${requestedRevision || "latest"} was not found; using the safe fallback.`);
    }
    const safeFallbackSlug = typeof fallbackSlug === "string" && SAFE_SLUG.test(fallbackSlug)
      ? fallbackSlug
      : validation.registry.defaultProperty;
    entry = latestEntry(entries.filter((candidate) => candidate.slug === safeFallbackSlug));
  }
  if (!entry) entry = builtInFallback(safeRegistryBase(registryUrl).href);
  return {
    entry,
    fallback,
    requested: { property: requestedProperty, revision: requestedRevision },
    warnings,
    registry: validation.registry,
  };
}

/** Fetch and validate a registry while retaining safe fallback behavior. */
export async function loadPropertyRegistry({
  url = DEFAULT_REGISTRY_URL,
  allowedHosts = [],
  fetchImpl = globalThis.fetch,
} = {}) {
  const registryUrl = safeRegistryBase(url).href;
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function.");
  try {
    const response = await fetchImpl(registryUrl, { credentials: "same-origin" });
    if (!response?.ok) throw new Error(`Registry request failed (${response?.status ?? "unknown"}).`);
    const result = validatePropertyRegistry(await response.json(), { registryUrl, allowedHosts });
    return { ...result, url: registryUrl };
  } catch (error) {
    return {
      valid: false,
      errors: [error.message],
      warnings: ["Using the built-in demo registry."],
      registry: { schemaVersion: 1, defaultProperty: "demo", properties: [builtInFallback(registryUrl)] },
      url: registryUrl,
    };
  }
}
