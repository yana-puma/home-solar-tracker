import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfiguratorPackage, normalizeToAuthoredV2, buildStoredZip } from '../src/configurator-package.js';
import { DEFAULT_PROPERTY_CONFIG } from '../src/property-config.js';
import { loadPropertyPackage, readPropertyZip } from '../src/property-package.js';
import { installPropertyPackage } from '../scripts/install-property.mjs';

function glb(document = { asset: { version: '2.0' }, scenes: [{}], scene: 0 }) {
  const text = new TextEncoder().encode(JSON.stringify(document));
  const size = Math.ceil(text.length / 4) * 4;
  const bytes = new Uint8Array(size + 20), view = new DataView(bytes.buffer);
  [0x46546c67, 2, bytes.length, size, 0x4e4f534a].forEach((v,i) => view.setUint32(i*4,v,true));
  bytes.fill(32,20); bytes.set(text,20); return bytes;
}
async function fixture(options = {}) {
  const config = normalizeToAuthoredV2(DEFAULT_PROPERTY_CONFIG);
  config.package = { id: 'test-garden', revision: options.revision || '1', label: 'Fictional garden', description: '' };
  return createConfiguratorPackage({ config, model: { name: 'model.glb', data: options.model || glb() }, mode: 'local', ...options });
}
function repack(entries) { return buildStoredZip([...entries].map(([path,data]) => ({path,data}))); }

test('builder ZIP opens with its own identity, bytes, and privacy mode', async () => {
  const exported = await fixture(), loaded = await loadPropertyPackage(exported.zip);
  assert.equal(loaded.config.package.id, 'test-garden');
  assert.deepEqual(loaded.modelBytes, glb());
  assert.equal(loaded.manifest.privacy.mode, 'local');
});

test('ZIP and manifest tampering, unsafe extra files, and external model resources are rejected', async () => {
  const exported = await fixture();
  const damaged = exported.zip.slice(); damaged[50] ^= 1;
  await assert.rejects(loadPropertyPackage(damaged), /checksum|headers|ZIP/);
  const entries = readPropertyZip(exported.zip);
  const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')));
  manifest.assets.find(a => a.path === 'model.glb').sha256 = '0'.repeat(64);
  entries.set('manifest.json',new TextEncoder().encode(JSON.stringify(manifest)));
  await assert.rejects(loadPropertyPackage(repack(entries)), /Manifest integrity/);
  entries.set('surprise.txt',new Uint8Array([1]));
  assert.throws(() => readPropertyZip(repack(entries)), /complete ZIP/);
  await assert.rejects(fixture({model:glb({asset:{version:'2.0'},buffers:[{uri:'https://example.test/private.bin',byteLength:4}]})}), /external files/);
});

test('local installation creates private revision links, rejects overwrite, and supports a second revision', async () => {
  const root = await mkdtemp(join(tmpdir(),'atlee-install-'));
  try {
    const first = await fixture(), second = await fixture({revision:'2'});
    const result = await installPropertyPackage(first.zip,{root});
    assert.equal(result.url,'/?property=test-garden&v=1&registry=local');
    assert.deepEqual(new Uint8Array(await readFile(join(result.directory,'model.glb'))), glb());
    await assert.rejects(installPropertyPackage(first.zip,{root}), /already installed/);
    await installPropertyPackage(second.zip,{root});
    const registry = JSON.parse(await readFile(join(root,'local-properties/index.json'),'utf8'));
    assert.deepEqual(registry.properties.map(p=>p.revision),['1','2']);
    await assert.rejects(installPropertyPackage(first.zip,{root,publicInstall:true}), /Local-only/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('installer rejects symlink destinations before copying house files', async () => {
  const root = await mkdtemp(join(tmpdir(),'atlee-symlink-'));
  try {
    await mkdir(join(root,'elsewhere'));
    await symlink(join(root,'elsewhere'),join(root,'local-properties'));
    await assert.rejects(installPropertyPackage((await fixture()).zip,{root}), /symlinks/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('local settings links reject a ZIP for another house or revision', async () => {
  const exported=await fixture();
  await assert.rejects(loadPropertyPackage(exported.zip,{expectedProperty:'another-house'}), /specified by this study link/);
  await assert.rejects(loadPropertyPackage(exported.zip,{expectedRevision:'2'}), /specified by this study link/);
  const loaded=await loadPropertyPackage(exported.zip,{expectedProperty:'test-garden',expectedRevision:'1'});
  assert.equal(loaded.config.package.revision,'1');
});
