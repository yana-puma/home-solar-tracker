/**
 * Dependency-free privacy preflight for portable property packages.
 *
 * The audit is intentionally conservative. It only inspects the configuration,
 * published asset names, and the JSON chunk of GLB 2.0 files. It cannot prove
 * that binary textures, geometry, or external data are anonymous.
 */

export const PRIVACY_MODES = Object.freeze({
  LOCAL: "local",
  PUBLIC_ROUNDED: "public-rounded",
  PUBLIC_EXACT: "public-exact",
});

export const RAW_SOURCE_EXTENSIONS = Object.freeze(new Set([
  ".las", ".laz", ".geojson", ".jsonl", ".shp", ".shx", ".dbf", ".prj",
  ".gpkg", ".gdb", ".kml", ".kmz", ".dxf", ".dwg", ".e57", ".ply",
]));

const ADDRESS_PATTERN = /\b(?:p\.?\s*o\.?\s*box\s+\d+|\d{1,6}[a-z]?\s+(?:[a-z0-9.'-]+\s+){0,5}(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|court|ct|boulevard|blvd|place|pl|terrace|ter|trail|trl|circle|cir|parkway|pkwy|highway|hwy|way))\b/i;
const IDENTIFYING_NAME_PATTERN = /(?:^|[\s._-])(?:address|parcel|apn|owner|deed|survey|tax[-_ ]?map|lot[-_ ]?\d+|\d{2,6}[-_ ][a-z]{2,})(?:$|[\s._-])/i;
const SENSITIVE_METADATA_KEY = /(?:address|street|parcel|apn|owner|latitude|longitude|gps|geolocation|easting|northing)/i;
const SAFE_ASSET_PATH = /^(?![/.])(?:[a-zA-Z0-9][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function finding(severity, code, message, details = {}) {
  return { severity, code, message, ...details };
}

function publicSeverity(mode, localSeverity = "warning") {
  return mode === PRIVACY_MODES.LOCAL ? localSeverity : "error";
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

export function normalizeAssetPath(value) {
  if (typeof value !== "string") return null;
  const path = value.trim().replaceAll("\\", "/");
  if (!path || !SAFE_ASSET_PATH.test(path) || path.split("/").includes("..")) return null;
  return path;
}

export function looksLikeAddress(value) {
  return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

export function looksIdentifying(value) {
  if (typeof value !== "string") return false;
  return looksLikeAddress(value.replaceAll(/[\\/_-]+/g, " ")) || IDENTIFYING_NAME_PATTERN.test(value);
}

function extensionOf(path) {
  const match = /(?:^|\/)[^/]*(\.[a-z0-9]+)$/i.exec(path);
  return match ? match[1].toLowerCase() : "";
}

function scanMetadata(value, path, findings, mode) {
  if (typeof value === "string") {
    if (looksLikeAddress(value)) {
      findings.push(finding(publicSeverity(mode), "glb_address_metadata", "GLB metadata appears to contain a street address.", { field: path }));
    } else if (looksIdentifying(value)) {
      findings.push(finding(publicSeverity(mode), "glb_identifying_metadata", "GLB metadata contains a potentially identifying name.", { field: path }));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanMetadata(item, `${path}[${index}]`, findings, mode));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (SENSITIVE_METADATA_KEY.test(key)) {
      findings.push(finding(publicSeverity(mode), "glb_sensitive_metadata_key", `GLB metadata contains the sensitive field “${key}”.`, { field: childPath }));
    }
    scanMetadata(child, childPath, findings, mode);
  }
}

/** Inspect the JSON chunk of a GLB 2.0 asset. */
export function inspectGlbMetadata(data, { path = "model.glb", mode = PRIVACY_MODES.LOCAL } = {}) {
  const findings = [];
  const bytes = toBytes(data);
  if (!bytes || bytes.byteLength < 20) {
    return [finding(publicSeverity(mode), "glb_unreadable", "The GLB header is missing or too short to inspect.", { asset: path })];
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    return [finding(publicSeverity(mode), "glb_unreadable", "The model is not a readable GLB 2.0 file.", { asset: path })];
  }
  const declaredLength = view.getUint32(8, true);
  if (declaredLength > bytes.byteLength || declaredLength < 20) {
    return [finding(publicSeverity(mode), "glb_unreadable", "The GLB declares an invalid file length.", { asset: path })];
  }

  let offset = 12;
  let document = null;
  while (offset + 8 <= declaredLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > declaredLength) {
      findings.push(finding(publicSeverity(mode), "glb_unreadable", "A GLB chunk extends past the declared file length.", { asset: path }));
      break;
    }
    if (chunkType === 0x4e4f534a && document === null) {
      try {
        const text = new TextDecoder().decode(bytes.subarray(chunkStart, chunkEnd)).replace(/[\0\s]+$/g, "");
        document = JSON.parse(text);
      } catch {
        findings.push(finding(publicSeverity(mode), "glb_unreadable", "The GLB JSON metadata could not be parsed.", { asset: path }));
      }
    }
    offset = chunkEnd;
  }

  if (!document) {
    findings.push(finding(publicSeverity(mode), "glb_unreadable", "The GLB has no readable JSON metadata chunk.", { asset: path }));
    return findings;
  }
  scanMetadata(document, "glb", findings, mode);
  if (Array.isArray(document.images) && document.images.length > 0) {
    findings.push(finding("warning", "glb_images_present", `The GLB contains ${document.images.length} embedded or referenced image asset${document.images.length === 1 ? "" : "s"}; review textures for photographs, labels, and EXIF-derived cues.`, { asset: path }));
  }
  return findings;
}

function assetReferenceFindings(reference, field, allowlist, mode) {
  const findings = [];
  if (typeof reference !== "string" || !reference.trim()) {
    findings.push(finding("error", "asset_reference_missing", `${field} must name a packaged asset.`, { field }));
    return findings;
  }
  let parsed;
  try {
    parsed = new URL(reference, "https://package.invalid/");
  } catch {
    findings.push(finding("error", "asset_reference_unsafe", `${field} is not a valid asset reference.`, { field }));
    return findings;
  }
  const isRemote = parsed.origin !== "https://package.invalid";
  if (isRemote) {
    findings.push(finding(publicSeverity(mode), "remote_asset", `${field} loads a remote asset (${parsed.origin}); public packages must be self-contained.`, { field }));
    return findings;
  }
  const relative = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const normalized = normalizeAssetPath(relative);
  if (!normalized) {
    findings.push(finding("error", "asset_reference_unsafe", `${field} must be a safe relative package path without traversal.`, { field }));
  } else if (!allowlist.has(normalized)) {
    findings.push(finding(publicSeverity(mode), "asset_not_allowlisted", `${field} references “${normalized}”, which is not in the asset allowlist.`, { field, asset: normalized }));
  }
  return findings;
}

/**
 * Audit a property configuration and the exact files intended for export.
 *
 * Assets use `{ path, data? }`. Supplying `data` for a GLB enables metadata
 * inspection. Public modes require an explicit asset allowlist and a license
 * redistribution acknowledgement. Public exact additionally requires a
 * separate acknowledgement of downloadable exact coordinates.
 */
export function auditPropertyPackage({
  config,
  assets = [],
  mode = PRIVACY_MODES.LOCAL,
  coordinateDecimals = 2,
  exactLocationAcknowledged = false,
  licenseAcknowledged = false,
  assetAllowlist = [],
} = {}) {
  const findings = [];
  const validModes = new Set(Object.values(PRIVACY_MODES));
  if (!validModes.has(mode)) {
    findings.push(finding("error", "privacy_mode_invalid", `Privacy mode must be one of: ${[...validModes].join(", ")}.`));
  }
  const effectiveMode = validModes.has(mode) ? mode : PRIVACY_MODES.LOCAL;
  const isPublic = effectiveMode !== PRIVACY_MODES.LOCAL;

  if (!isRecord(config)) {
    findings.push(finding("error", "config_missing", "A property configuration object is required."));
  }
  if (!Number.isInteger(coordinateDecimals) || coordinateDecimals < 0 || coordinateDecimals > 5) {
    findings.push(finding("error", "coordinate_precision_invalid", "coordinateDecimals must be an integer from 0 through 5."));
  }
  if (isPublic && !licenseAcknowledged) {
    findings.push(finding("error", "license_acknowledgement_required", "Public export requires acknowledgement that every included asset may be redistributed."));
  }
  if (effectiveMode === PRIVACY_MODES.PUBLIC_EXACT && !exactLocationAcknowledged) {
    findings.push(finding("error", "exact_location_acknowledgement_required", "Public exact export requires explicit acknowledgement that exact coordinates will be downloadable."));
  }

  const allowlist = new Set();
  for (const entry of assetAllowlist) {
    const normalized = normalizeAssetPath(entry);
    if (!normalized) {
      findings.push(finding("error", "asset_allowlist_unsafe", `Asset allowlist entry “${String(entry)}” is not a safe relative path.`));
    } else if (RAW_SOURCE_EXTENSIONS.has(extensionOf(normalized))) {
      findings.push(finding("error", "raw_source_allowlisted", `Raw source asset “${normalized}” cannot be included in a public package allowlist.`, { asset: normalized }));
    } else {
      allowlist.add(normalized);
    }
  }
  if (isPublic && allowlist.size === 0) {
    findings.push(finding("error", "asset_allowlist_required", "Public export requires a non-empty asset allowlist."));
  }

  if (isRecord(config)) {
    if (looksIdentifying(config.slug)) {
      findings.push(finding(publicSeverity(effectiveMode), "identifying_slug", "The property slug may reveal an address, parcel, owner, or survey identifier.", { field: "slug" }));
    }
    const labels = [
      ["title", config.title],
      ["description", config.description],
      ["location.displayLabel", config.location?.displayLabel],
    ];
    for (const [field, value] of labels) {
      if (looksLikeAddress(value)) {
        findings.push(finding(publicSeverity(effectiveMode), "address_like_label", `${field} appears to contain a street address.`, { field }));
      }
    }
    if (isPublic && (config.location?.showExactLocation || config.privacy?.showAddress)) {
      findings.push(finding("error", "public_location_display_enabled", "Public exports must keep exact-location and address display flags off."));
    }
    if (effectiveMode === PRIVACY_MODES.PUBLIC_ROUNDED && Number.isInteger(coordinateDecimals)) {
      const factor = 10 ** coordinateDecimals;
      for (const field of ["latitude", "longitude"]) {
        const value = config.location?.[field];
        if (!Number.isFinite(value) || Math.abs(value * factor - Math.round(value * factor)) > 1e-7) {
          findings.push(finding("error", "coordinates_not_rounded", `location.${field} must be rounded to ${coordinateDecimals} decimal place${coordinateDecimals === 1 ? "" : "s"} for public-rounded export.`, { field: `location.${field}` }));
        }
      }
    }
    findings.push(...assetReferenceFindings(config.model?.url, "model.url", allowlist, effectiveMode));
  }

  for (const asset of assets) {
    const path = normalizeAssetPath(asset?.path);
    if (!path) {
      findings.push(finding("error", "asset_path_unsafe", `Asset path “${String(asset?.path)}” must be a safe relative package path.`));
      continue;
    }
    const extension = extensionOf(path);
    if (RAW_SOURCE_EXTENSIONS.has(extension)) {
      findings.push(finding(publicSeverity(effectiveMode), "raw_source_asset", `“${path}” is a raw GIS, survey, point-cloud, or CAD source file and must not be published.`, { asset: path }));
    }
    if (looksIdentifying(path)) {
      findings.push(finding(publicSeverity(effectiveMode), "identifying_filename", `Asset filename “${path}” may reveal an address, parcel, owner, or survey identifier.`, { asset: path }));
    }
    if (!allowlist.has(path)) {
      findings.push(finding(publicSeverity(effectiveMode), "asset_not_allowlisted", `Asset “${path}” is not in the export allowlist.`, { asset: path }));
    }
    if (extension === ".glb" && asset.data !== undefined) {
      findings.push(...inspectGlbMetadata(asset.data, { path, mode: effectiveMode }));
    }
  }

  const errors = findings.filter((item) => item.severity === "error");
  const warnings = findings.filter((item) => item.severity === "warning");
  return {
    mode: effectiveMode,
    publishable: errors.length === 0,
    findings,
    errors,
    warnings,
    assetAllowlist: [...allowlist].sort(),
  };
}
