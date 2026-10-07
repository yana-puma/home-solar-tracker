import { validateSelfContainedGlb } from './glb-container.js';
import { validatePropertyConfig } from "./property-config.js";
import { auditPropertyPackage, PRIVACY_MODES } from "./privacy-audit.js";
import {
  buildSafeExportManifest,
  importPropertyJson,
  preparePropertyConfigForExport,
} from "./property-io.js";

const EMPTY_SHA256_SRI = "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
const DOS_EPOCH_DATE = 0x0021;
const UTF8_FLAG = 0x0800;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asBytes(data) {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError("Entry data must be text, an ArrayBuffer, or a typed array");
}

function safeZipPath(value) {
  if (typeof value !== "string") return null;
  const path = value.trim().replaceAll("\\", "/");
  if (!path || path.startsWith("/") || path.includes("://")) return null;
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  return path;
}

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** Return the standard unsigned ZIP CRC-32 for bytes or text. */
export function crc32(data) {
  const bytes = asBytes(data);
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function localHeader(name, data, checksum) {
  const header = new Uint8Array(30 + name.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, UTF8_FLAG, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, DOS_EPOCH_DATE, true);
  view.setUint32(14, checksum, true);
  view.setUint32(18, data.byteLength, true);
  view.setUint32(22, data.byteLength, true);
  view.setUint16(26, name.byteLength, true);
  view.setUint16(28, 0, true);
  header.set(name, 30);
  return header;
}

function centralHeader(name, data, checksum, localOffset) {
  const header = new Uint8Array(46 + name.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, UTF8_FLAG, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, DOS_EPOCH_DATE, true);
  view.setUint32(16, checksum, true);
  view.setUint32(20, data.byteLength, true);
  view.setUint32(24, data.byteLength, true);
  view.setUint16(28, name.byteLength, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, localOffset, true);
  header.set(name, 46);
  return header;
}

/** Build a deterministic ZIP with uncompressed, UTF-8, lexicographically sorted entries. */
export function buildStoredZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError("entries must be a non-empty array");
  const seen = new Set();
  const normalized = entries.map((entry, index) => {
    const path = safeZipPath(entry?.path);
    if (!path) throw new TypeError(`entries[${index}].path is not a safe ZIP path`);
    if (seen.has(path)) throw new TypeError(`Duplicate ZIP entry: ${path}`);
    seen.add(path);
    return { path, name: new TextEncoder().encode(path), data: asBytes(entry.data) };
  }).sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const entry of normalized) {
    const checksum = crc32(entry.data);
    const header = localHeader(entry.name, entry.data, checksum);
    localParts.push(header, entry.data);
    centralParts.push(centralHeader(entry.name, entry.data, checksum, localOffset));
    localOffset += header.byteLength + entry.data.byteLength;
  }
  const centralDirectory = concatBytes(centralParts);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, normalized.length, true);
  view.setUint16(10, normalized.length, true);
  view.setUint32(12, centralDirectory.byteLength, true);
  view.setUint32(16, localOffset, true);
  view.setUint16(20, 0, true);
  return concatBytes([...localParts, centralDirectory, end]);
}

async function sha256Bytes(data) {
  if (!globalThis.crypto?.subtle) throw new Error("Package hashing requires the Web Crypto API");
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", asBytes(data)));
}

function base64(bytes) {
  if (typeof btoa === "function") {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}

export async function sha256Integrity(data) {
  return `sha256-${base64(await sha256Bytes(data))}`;
}

function authoredV2(runtime) {
  const modelAsset = runtime.assets?.find((asset) => asset.id === runtime.model?.assetId)
    || runtime.assets?.find((asset) => asset.type === "model")
    || {};
  return {
    $schema: "../../schemas/property.schema.v2.json",
    schemaVersion: 2,
    package: {
      id: runtime.package.id,
      label: runtime.package.label,
      revision: runtime.package.revision,
      description: runtime.package.description || "",
    },
    location: {
      latitude: runtime.location.latitude,
      longitude: runtime.location.longitude,
      timeZone: runtime.location.timeZone,
      displayLabel: runtime.location.displayLabel,
      precision: runtime.location.precision || "regional",
    },
    assets: (runtime.assets || [modelAsset]).map((asset, index) => ({
      id: asset.id || `asset-${index + 1}`,
      type: asset.type || "data",
      url: asset.sourceUrl || asset.url || `./asset-${index + 1}`,
      size: Number.isInteger(asset.size) && asset.size >= 0 ? asset.size : 0,
      integrity: typeof asset.integrity === "string" ? asset.integrity : EMPTY_SHA256_SRI,
    })),
    model: {
      assetId: runtime.model.assetId || modelAsset.id || "model",
      units: runtime.model.units || "meters",
      scale: runtime.model.scale ?? 1,
      northOffsetDegrees: runtime.model.northOffsetDegrees ?? 0,
      position: [...(runtime.model.position || [0, 0, 0])],
    },
    scene: {
      groundBounds: { ...runtime.scene.groundBounds },
      terrainProfile: clone(runtime.scene.terrainProfile || []),
      cameraPresets: clone(runtime.scene.cameraPresets || {}),
    },
    zones: clone(runtime.zones || []),
    solar: {
      defaultDate: runtime.solar.defaultDate || "today",
      samplingMinutes: runtime.solar.samplingMinutes ?? 15,
      exposureMethod: runtime.solar.exposureMethod || "estimated",
      features: clone(runtime.solar.features || {
        sunPath: true, sunMap: true, compass: true, timelapse: true, annualStudy: false,
      }),
    },
    privacy: {
      visibility: runtime.privacy.visibility || "private",
      showExactLocation: Boolean(runtime.privacy.showExactLocation),
      showAddress: Boolean(runtime.privacy.showAddress),
    },
    ui: clone(runtime.ui || { theme: { mode: "auto", accentColor: "#f59e0b", skyStyle: "gradient" } }),
  };
}

/** Accept either supported authoring version and return a strict authored v2 document. */
export function normalizeToAuthoredV2(input) {
  const result = validatePropertyConfig(input);
  if (!result.valid) {
    throw Object.assign(new TypeError(`Property configuration is invalid: ${result.errors.join(" ")}`), { validation: result });
  }
  return authoredV2(result.runtimeConfig);
}

/** Import guarded JSON and normalize v1/v2 into the strict v2 authoring contract. */
export async function importConfiguratorProperty(source, options) {
  return normalizeToAuthoredV2(await importPropertyJson(source, options));
}

function compatibilityAuditConfig(config) {
  const modelAsset = config.assets.find((asset) => asset.id === config.model.assetId);
  return {
    schemaVersion: config.schemaVersion,
    slug: config.package.id,
    title: config.package.label,
    description: config.package.description,
    location: {
      latitude: config.location.latitude,
      longitude: config.location.longitude,
      timeZone: config.location.timeZone,
      displayLabel: config.location.displayLabel,
      showExactLocation: config.privacy.showExactLocation,
    },
    model: { url: modelAsset?.url || "model.glb" },
    privacy: { showAddress: config.privacy.showAddress },
  };
}

function readmeFor(config, mode, coordinateDecimals) {
  const coordinateText = mode === PRIVACY_MODES.PUBLIC_ROUNDED
    ? `Coordinates were rounded to ${coordinateDecimals} decimal places before export.`
    : mode === PRIVACY_MODES.PUBLIC_EXACT
      ? "This package contains exact coordinates. Anyone with the package can read them from property.json."
      : "This package is intended for local use and has not been approved for public distribution.";
  return `# Property solar package\n\nPackage ID: ${config.package.id}\nRevision: ${config.package.revision}\nPrivacy mode: ${mode}\n\n${coordinateText}\n\nOpen the viewer with ?local=1 and choose this ZIP. No registry edit or upload is needed.\n\nOptional maintainer installation: node scripts/install-property.mjs package.zip\nThis installs into ignored local-properties/ and prints the exact revision link. Do not commit private house files. Public installation requires --public and a reviewed public package. No file was uploaded by the configurator.\n`;
}

async function modelBytes(model) {
  if (!model) throw new TypeError("Choose a local GLB before exporting a complete package");
  if (model.data !== undefined) return asBytes(model.data);
  if (typeof model.arrayBuffer === "function") return asBytes(await model.arrayBuffer());
  return asBytes(model);
}

function prepareForPrivacy(config, mode, coordinateDecimals) {
  const auditSource = compatibilityAuditConfig(config);
  const privacyPrepared = preparePropertyConfigForExport(auditSource, { mode, coordinateDecimals });
  const prepared = clone(config);
  prepared.location.latitude = privacyPrepared.location.latitude;
  prepared.location.longitude = privacyPrepared.location.longitude;
  if (mode === PRIVACY_MODES.PUBLIC_ROUNDED) prepared.location.precision = "rounded";
  if (mode === PRIVACY_MODES.PUBLIC_EXACT) prepared.location.precision = "exact";
  prepared.privacy.visibility = mode === PRIVACY_MODES.LOCAL ? "private" : "public";
  prepared.privacy.showExactLocation = false;
  prepared.privacy.showAddress = false;
  return { prepared, auditConfig: compatibilityAuditConfig(prepared) };
}

/** Run the same audit used by ZIP export without generating a download. */
export async function auditConfiguratorPackage({
  config,
  model,
  mode = PRIVACY_MODES.LOCAL,
  coordinateDecimals = 2,
  exactLocationAcknowledged = false,
  licenseAcknowledged = false,
} = {}) {
  const authored = normalizeToAuthoredV2(config);
  const bytes = model ? await modelBytes(model) : null;
  const { prepared, auditConfig } = prepareForPrivacy(authored, mode, coordinateDecimals);
  const readme = readmeFor(prepared, mode, coordinateDecimals);
  const propertyJson = `${JSON.stringify(prepared, null, 2)}\n`;
  const assets = [
    { path: "property.json", data: propertyJson },
    { path: "README.md", data: readme },
  ];
  if (bytes) assets.push({ path: "model.glb", data: bytes });
  const audit = auditPropertyPackage({
    config: auditConfig,
    assets,
    mode,
    coordinateDecimals,
    exactLocationAcknowledged,
    licenseAcknowledged,
    assetAllowlist: ["property.json", "model.glb", "manifest.json", "README.md"],
  });
  if (model?.name && !model.name.toLowerCase().endsWith(".glb")) {
    const invalidType = {
      severity: "error",
      code: "model_type_invalid",
      message: "The selected model must be a .glb file.",
    };
    audit.findings.push(invalidType);
    audit.errors.push(invalidType);
    audit.publishable = false;
  }
  if (bytes && audit.findings.some((item) => item.code === "glb_unreadable")) {
    const unreadable = {
      severity: "error",
      code: "model_glb_invalid",
      message: "The selected file is not a readable GLB 2.0 model.",
    };
    audit.findings.push(unreadable);
    audit.errors.push(unreadable);
    audit.publishable = false;
  }
  if (!bytes) {
    const missing = {
      severity: "error",
      code: "model_required",
      message: "Choose a local GLB before exporting a complete package.",
    };
    audit.findings.push(missing);
    audit.errors.push(missing);
    audit.publishable = false;
  }
  return { config: prepared, auditConfig, propertyJson, readme, modelBytes: bytes, audit };
}

/** Create a complete, deterministic, dependency-free ZIP package. */
export async function createConfiguratorPackage(options = {}) {
  const staged = await auditConfiguratorPackage(options);
  if (!staged.audit.publishable) {
    throw Object.assign(new Error(`Privacy preflight failed: ${staged.audit.errors.map((item) => item.message).join(" ")}`), { audit: staged.audit });
  }

  validateSelfContainedGlb(staged.modelBytes);
  const integrity = await sha256Integrity(staged.modelBytes);
  const config = clone(staged.config);
  config.assets = [{ id: "model", type: "model", url: "model.glb", size: staged.modelBytes.byteLength, integrity }];
  config.model.assetId = "model";
  const validation = validatePropertyConfig(config);
  if (!validation.valid) {
    throw Object.assign(new Error(`Generated v2 property is invalid: ${validation.errors.join(" ")}`), { validation });
  }
  const propertyJson = `${JSON.stringify(config, null, 2)}\n`;
  const auditConfig = compatibilityAuditConfig(config);
  const audit = auditPropertyPackage({
    config: auditConfig,
    assets: [
      { path: "property.json", data: propertyJson },
      { path: "model.glb", data: staged.modelBytes },
      { path: "README.md", data: staged.readme },
    ],
    mode: options.mode || PRIVACY_MODES.LOCAL,
    coordinateDecimals: options.coordinateDecimals ?? 2,
    exactLocationAcknowledged: options.exactLocationAcknowledged,
    licenseAcknowledged: options.licenseAcknowledged,
    assetAllowlist: ["property.json", "model.glb", "manifest.json", "README.md"],
  });
  if (!audit.publishable) {
    throw Object.assign(new Error(`Privacy preflight failed: ${audit.errors.map((item) => item.message).join(" ")}`), { audit });
  }
  const manifest = await buildSafeExportManifest({
    config: auditConfig,
    assets: [
      { path: "property.json", data: propertyJson },
      { path: "model.glb", data: staged.modelBytes },
      { path: "README.md", data: staged.readme },
    ],
    audit,
    includeSha256: true,
    exactLocationAcknowledged: options.exactLocationAcknowledged,
    licenseAcknowledged: options.licenseAcknowledged,
    coordinateDecimals: options.coordinateDecimals ?? 2,
  });
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  const entries = [
    { path: "property.json", data: propertyJson },
    { path: "model.glb", data: staged.modelBytes },
    { path: "manifest.json", data: manifestJson },
    { path: "README.md", data: staged.readme },
  ];
  return {
    config,
    propertyJson,
    manifest,
    manifestJson,
    readme: staged.readme,
    audit,
    entries,
    zip: buildStoredZip(entries),
    filename: `${config.package.id}-${config.package.revision}.zip`,
  };
}
