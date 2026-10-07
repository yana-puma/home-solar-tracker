import { validateSelfContainedGlb } from './glb-container.js';
import { crc32, sha256Integrity } from './configurator-package.js';
import { importPropertyJson } from './property-io.js';
import { validatePropertyConfig } from './property-config.js';

export const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
const FILES = ['README.md', 'manifest.json', 'model.glb', 'property.json'];
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Read the deterministic stored ZIP format produced by the local builder. */
export function readPropertyZip(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 22 || bytes.length > MAX_PACKAGE_BYTES) throw new Error('Package must be a ZIP under 64 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  if (view.getUint32(end, true) !== 0x06054b50 || view.getUint16(end + 20, true) !== 0
    || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0
    || view.getUint16(end + 8, true) !== FILES.length || view.getUint16(end + 10, true) !== FILES.length) {
    throw new Error('Choose a complete ZIP exported by the property builder.');
  }
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (centralOffset + centralSize !== end) throw new Error('Invalid ZIP directory.');
  const entries = new Map();
  let offset = centralOffset;
  let localEnd = 0;
  for (let index = 0; index < FILES.length; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid ZIP entry.');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const checksum = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 24, true);
    const nameSize = view.getUint16(offset + 28, true);
    const extraSize = view.getUint16(offset + 30, true);
    const commentSize = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (flags !== 0x0800 || method !== 0 || view.getUint32(offset + 20, true) !== size
      || view.getUint16(offset + 34, true) !== 0 || extraSize || commentSize || offset + 46 + nameSize > end) {
      throw new Error('Only uncompressed builder ZIPs are supported. Re-export the package.');
    }
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameSize));
    if (!FILES.includes(name) || entries.has(name) || localOffset !== localEnd || localOffset + 30 + nameSize > centralOffset) {
      throw new Error('Unexpected, duplicate, or unsafe ZIP path.');
    }
    if (view.getUint32(localOffset, true) !== 0x04034b50 || view.getUint16(localOffset + 6, true) !== flags
      || view.getUint16(localOffset + 8, true) !== method || view.getUint32(localOffset + 14, true) !== checksum
      || view.getUint32(localOffset + 18, true) !== size || view.getUint32(localOffset + 22, true) !== size
      || view.getUint16(localOffset + 26, true) !== nameSize || view.getUint16(localOffset + 28, true) !== 0
      || decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + nameSize)) !== name) {
      throw new Error('ZIP headers disagree.');
    }
    const dataStart = localOffset + 30 + nameSize;
    localEnd = dataStart + size;
    if (localEnd > centralOffset) throw new Error('Truncated ZIP asset.');
    const data = bytes.subarray(dataStart, localEnd);
    if (crc32(data) !== checksum) throw new Error(`ZIP checksum failed for ${name}.`);
    entries.set(name, data);
    offset += 46 + nameSize;
  }
  if (offset !== end || localEnd !== centralOffset) throw new Error('Unexpected ZIP data.');
  return entries;
}


/** Validate the schema, asset digest, and every manifest entry before use/install. */
export async function loadPropertyPackage(source, { expectedProperty, expectedRevision } = {}) {
  if (Number.isFinite(source?.size) && source.size > MAX_PACKAGE_BYTES) throw new Error('Package exceeds 64 MB.');
  const bytes = typeof source?.arrayBuffer === 'function' ? new Uint8Array(await source.arrayBuffer()) : source;
  const entries = readPropertyZip(bytes);
  const authored = await importPropertyJson(entries.get('property.json'));
  const result = validatePropertyConfig(authored);
  if (authored.schemaVersion !== 2 || !result.valid) throw new Error(`Invalid v2 property: ${result.errors.join(' ')}`);
  if ((expectedProperty && authored.package.id !== expectedProperty)
    || (expectedRevision && authored.package.revision !== expectedRevision)) {
    throw new Error('Choose the house ZIP with the property and revision specified by this study link.');
  }
  const model = entries.get('model.glb');
  const config = result.runtimeConfig;
  if (config.assets.length !== 1 || config.assets[0].id !== config.model.assetId
    || config.assets[0].type !== 'model' || !['model.glb', './model.glb'].includes(config.assets[0].url)) {
    throw new Error('Local packages must contain one embedded model.glb asset.');
  }
  if (config.assets[0].size !== model.length || config.assets[0].integrity !== await sha256Integrity(model)) {
    throw new Error('Model size or integrity does not match property.json.');
  }
  validateSelfContainedGlb(model);
  const manifest = await importPropertyJson(entries.get('manifest.json'));
  const required = ['property.json', 'model.glb', 'README.md'];
  if (manifest.manifestVersion !== 1 || manifest.property?.slug !== config.package.id
    || !Array.isArray(manifest.assetAllowlist) || manifest.assetAllowlist.length !== FILES.length
    || new Set(manifest.assetAllowlist).size !== FILES.length || !FILES.every(name => manifest.assetAllowlist.includes(name))
    || !Array.isArray(manifest.assets) || manifest.assets.length !== required.length) throw new Error('Invalid package manifest.');
  const mode = manifest.privacy?.mode;
  if (!['local', 'public-rounded', 'public-exact'].includes(mode)
    || config.privacy.visibility !== (mode === 'local' ? 'private' : 'public')
    || (mode === 'public-rounded' && config.location.precision !== 'rounded')
    || (mode === 'public-exact' && config.location.precision !== 'exact')) {
    throw new Error('Package privacy mode disagrees with property.json.');
  }
  const seen = new Set();
  for (const asset of manifest.assets) {
    if (!required.includes(asset.path) || seen.has(asset.path)) throw new Error('Unexpected manifest asset.');
    seen.add(asset.path);
    const data = entries.get(asset.path);
    const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(x => x.toString(16).padStart(2, '0')).join('');
    if (asset.bytes !== data.length || asset.sha256 !== hex) throw new Error(`Manifest integrity failed for ${asset.path}.`);
  }
  return { config, authored, modelBytes: model, entries, manifest, warnings: result.warnings };
}
