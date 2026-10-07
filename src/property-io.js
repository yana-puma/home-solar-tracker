import { auditPropertyPackage, normalizeAssetPath, PRIVACY_MODES } from "./privacy-audit.js";

export const DEFAULT_EXPORT_ASSET_ALLOWLIST = Object.freeze([
  "model.glb",
  "property.json",
  "package-manifest.json",
]);

const RESERVED_IMPORT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const DEFAULT_MAX_PROPERTY_JSON_BYTES = 1024 * 1024;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeAssets(assets) {
  if (!Array.isArray(assets)) throw new TypeError("assets must be an array");
  const seen = new Set();
  return assets.map((asset, index) => {
    const path = normalizeAssetPath(asset?.path);
    if (!path) throw new TypeError(`assets[${index}].path must be a safe relative package path`);
    if (seen.has(path)) throw new TypeError(`Duplicate export asset path: ${path}`);
    seen.add(path);
    return { ...asset, path };
  });
}

function asBytes(data) {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError("Asset data must be a string, ArrayBuffer, or typed array");
}

function assertSafeJsonTree(value, path = "property", depth = 0) {
  if (depth > 40) throw new TypeError("Property JSON is nested too deeply");
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeJsonTree(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (RESERVED_IMPORT_KEYS.has(key)) throw new TypeError(`Unsafe reserved key in property JSON: ${path}.${key}`);
    assertSafeJsonTree(child, `${path}.${key}`, depth + 1);
  }
}

/** Parse local property JSON with size, shape, and prototype-pollution guards. */
export async function importPropertyJson(source, { maxBytes = DEFAULT_MAX_PROPERTY_JSON_BYTES } = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new RangeError("maxBytes must be a positive integer");
  let text;
  if (typeof source === "string") {
    if (new TextEncoder().encode(source).byteLength > maxBytes) throw new RangeError("Property JSON exceeds the import size limit");
    text = source;
  } else if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    const bytes = asBytes(source);
    if (bytes.byteLength > maxBytes) throw new RangeError("Property JSON exceeds the import size limit");
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } else if (source && typeof source.text === "function") {
    if (Number.isFinite(source.size) && source.size > maxBytes) throw new RangeError("Property JSON exceeds the import size limit");
    text = await source.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new RangeError("Property JSON exceeds the import size limit");
  } else {
    throw new TypeError("Property import must be JSON text, bytes, or a File/Blob-like object");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new SyntaxError(`Property JSON could not be parsed: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Property JSON must contain one object");
  }
  assertSafeJsonTree(parsed);
  return clone(parsed);
}

async function sha256(data) {
  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 requires the Web Crypto API");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", asBytes(data));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function coordinateHandling(mode, coordinateDecimals) {
  if (mode === PRIVACY_MODES.PUBLIC_ROUNDED) return `rounded-${coordinateDecimals}-decimals`;
  if (mode === PRIVACY_MODES.PUBLIC_EXACT) return "exact-public";
  return "local-only";
}

/** Clone a configuration and apply the selected privacy mode safely. */
export function preparePropertyConfigForExport(config, {
  mode = PRIVACY_MODES.LOCAL,
  coordinateDecimals = 2,
} = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError("config must be an object");
  }
  if (!Object.values(PRIVACY_MODES).includes(mode)) {
    throw new RangeError(`Unsupported privacy mode: ${mode}`);
  }
  if (!Number.isInteger(coordinateDecimals) || coordinateDecimals < 0 || coordinateDecimals > 5) {
    throw new RangeError("coordinateDecimals must be an integer from 0 through 5");
  }
  const prepared = clone(config);
  prepared.location = { ...(prepared.location || {}), showExactLocation: false };
  prepared.privacy = {
    ...(prepared.privacy || {}),
    showAddress: false,
    mode,
  };
  delete prepared.privacy.coordinatePrecisionDecimals;
  if (mode === PRIVACY_MODES.PUBLIC_ROUNDED) {
    const factor = 10 ** coordinateDecimals;
    for (const field of ["latitude", "longitude"]) {
      const value = prepared.location[field];
      if (!Number.isFinite(value)) throw new TypeError(`location.${field} must be finite`);
      prepared.location[field] = Math.round(value * factor) / factor;
    }
    prepared.privacy.coordinatePrecisionDecimals = coordinateDecimals;
  }
  return prepared;
}

/**
 * Build a manifest that is safe to publish beside a property package.
 *
 * It deliberately omits coordinates, labels, source paths, and GLB metadata.
 */
export async function buildSafeExportManifest({
  config,
  assets,
  audit,
  includeSha256 = false,
  exactLocationAcknowledged = false,
  licenseAcknowledged = false,
  coordinateDecimals = 2,
} = {}) {
  if (!audit?.publishable) throw new Error("Cannot build a manifest for a package that failed privacy preflight");
  const normalizedAssets = normalizeAssets(assets);
  const assetEntries = [];
  for (const asset of normalizedAssets) {
    const entry = { path: asset.path };
    if (asset.data !== undefined) {
      entry.bytes = asBytes(asset.data).byteLength;
      if (includeSha256) entry.sha256 = await sha256(asset.data);
    } else if (includeSha256) {
      throw new TypeError(`Asset data is required to hash ${asset.path}`);
    }
    assetEntries.push(entry);
  }

  return {
    manifestVersion: 1,
    property: {
      slug: String(config.slug || "property"),
      schemaVersion: Number(config.schemaVersion || 1),
    },
    privacy: {
      mode: audit.mode,
      coordinateHandling: coordinateHandling(audit.mode, coordinateDecimals),
      locationDisplayed: false,
      exactLocationAcknowledged: audit.mode === PRIVACY_MODES.PUBLIC_EXACT
        ? Boolean(exactLocationAcknowledged)
        : false,
    },
    license: {
      redistributionAcknowledged: Boolean(licenseAcknowledged),
    },
    assetAllowlist: [...audit.assetAllowlist],
    assets: assetEntries.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

/** Prepare property.json, run preflight, and create a safe package manifest. */
export async function preparePropertyExport({
  config,
  assets = [],
  mode = PRIVACY_MODES.LOCAL,
  coordinateDecimals = 2,
  exactLocationAcknowledged = false,
  licenseAcknowledged = false,
  assetAllowlist = DEFAULT_EXPORT_ASSET_ALLOWLIST,
  includeSha256 = false,
} = {}) {
  const preparedConfig = preparePropertyConfigForExport(config, { mode, coordinateDecimals });
  const propertyJson = `${JSON.stringify(preparedConfig, null, 2)}\n`;
  const normalizedAssets = normalizeAssets(assets.filter((asset) => asset?.path !== "property.json"));
  const exportAssets = [
    { path: "property.json", data: propertyJson, mediaType: "application/json" },
    ...normalizedAssets,
  ];
  const audit = auditPropertyPackage({
    config: preparedConfig,
    assets: exportAssets,
    mode,
    coordinateDecimals,
    exactLocationAcknowledged,
    licenseAcknowledged,
    assetAllowlist,
  });
  if (!audit.publishable) {
    const message = audit.errors.map((item) => item.message).join(" ");
    throw Object.assign(new Error(`Privacy preflight failed: ${message}`), { audit });
  }
  const manifest = await buildSafeExportManifest({
    config: preparedConfig,
    assets: exportAssets,
    audit,
    includeSha256,
    exactLocationAcknowledged,
    licenseAcknowledged,
    coordinateDecimals,
  });
  return {
    config: preparedConfig,
    propertyJson,
    assets: exportAssets,
    audit,
    manifest,
    manifestJson: `${JSON.stringify(manifest, null, 2)}\n`,
  };
}
