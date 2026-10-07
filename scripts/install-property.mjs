#!/usr/bin/env node
import { readFile, writeFile, mkdir, lstat, mkdtemp, rename, rm, open } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPropertyPackage } from '../src/property-package.js';
import { validatePropertyRegistry } from '../src/property-registry.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

async function exists(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function safeDirectory(path) {
  const parent = dirname(path);
  if (parent !== path) {
    const current = await exists(parent);
    if (!current) await safeDirectory(parent);
    else if (!current.isDirectory() || current.isSymbolicLink()) throw new Error('Install parent must be a real directory.');
  }
  const current = await exists(path);
  if (current && (!current.isDirectory() || current.isSymbolicLink())) throw new Error('Install paths must not be symlinks.');
  if (!current) await mkdir(path);
}

/** Install privately by default; each revision is immutable and registry writes are atomic. */
export async function installPropertyPackage(source, { root = projectRoot, publicInstall = false } = {}) {
  const loaded = await loadPropertyPackage(source);
  if (publicInstall && !['public-rounded', 'public-exact'].includes(loaded.manifest.privacy?.mode)) throw new Error('Local-only packages cannot be publicly installed.');
  if (publicInstall && (!loaded.manifest.license?.redistributionAcknowledged
    || (loaded.manifest.privacy?.mode === 'public-exact' && !loaded.manifest.privacy?.exactLocationAcknowledged))) {
    throw new Error('Public installation requires the package privacy and asset-rights acknowledgements.');
  }
  const base = join(resolve(root), publicInstall ? 'properties' : 'local-properties');
  await safeDirectory(base);
  const lockPath = join(base, '.install.lock');
  const lock = await open(lockPath, 'wx').catch(() => { throw new Error('Another installation is active. Resolve any stale .install.lock before retrying.'); });
  let staging;
  let installed;
  const { id, revision, label } = loaded.config.package;
  try {
    const registryPath = join(base, 'index.json');
    const registryStat = await exists(registryPath);
    if (registryStat?.isSymbolicLink()) throw new Error('Registry must not be a symlink.');
    const registry = registryStat ? JSON.parse(await readFile(registryPath, 'utf8'))
      : { schemaVersion: 1, defaultProperty: id, properties: [] };
    const registryUrl = 'http://localhost/properties/index.json';
    const before = validatePropertyRegistry(registry, { registryUrl });
    // Empty initial registries gain their default below; existing invalid registries are never replaced.
    if (registryStat && !before.valid) throw new Error(`Invalid existing registry: ${before.errors.join(' ')}`);
    if (registry.properties.some(entry => entry.slug === id && entry.revision === revision)) throw new Error('This property revision is already installed. Export a new revision.');
    const revisions = join(base, id, 'revisions');
    await safeDirectory(revisions);
    const target = join(revisions, revision);
    if (await exists(target)) throw new Error('Revision folder already exists; refusing to overwrite.');
    staging = await mkdtemp(join(revisions, '.install-'));
    for (const [name, bytes] of loaded.entries) await writeFile(join(staging, name), bytes, { flag: 'wx' });
    const prefix = `./${id}/revisions/${revision}`;
    registry.properties.push({ slug: id, title: label, displayLabel: loaded.config.location.displayLabel,
      revision, configUrl: `${prefix}/property.json`, modelUrl: `${prefix}/model.glb`,
      privacyTier: publicInstall ? 'public' : 'private', updatedAt: new Date().toISOString() });
    const after = validatePropertyRegistry(registry, { registryUrl });
    if (!after.valid) throw new Error(`Invalid registry update: ${after.errors.join(' ')}`);
    const temporaryRegistry = join(staging, '.registry-update');
    await writeFile(temporaryRegistry, `${JSON.stringify(registry, null, 2)}\n`, { flag: 'wx' });
    await rename(staging, target); staging = null; installed = target;
    await rename(join(target, '.registry-update'), registryPath);
    return { directory: target, url: `/?property=${id}&v=${revision}${publicInstall ? '' : '&registry=local'}` };
  } catch (error) {
    if (staging) await rm(staging, { recursive: true, force: true });
    if (installed) await rm(installed, { recursive: true, force: true });
    throw error;
  } finally {
    await lock.close(); await rm(lockPath, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const publicInstall = args.includes('--public');
  const paths = args.filter(arg => arg !== '--public');
  if (paths.length !== 1) {
    process.stderr.write('Usage: node scripts/install-property.mjs package.zip [--public]\nDefaults to ignored local-properties/. Public install is an explicit publishing-scope choice.\n');
    process.exitCode = 1;
  } else {
    try {
      const result = await installPropertyPackage(new Uint8Array(await readFile(resolve(paths[0]))), { publicInstall });
      process.stdout.write(`Installed ${result.directory}\nOpen http://127.0.0.1:8080${result.url}\n`);
    } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
  }
}
