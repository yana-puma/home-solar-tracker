import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  loadPropertyRegistry,
  resolvePropertyEntry,
  resolveTrustedRegistryUrl,
  validatePropertyRegistry,
} from '../src/property-registry.js';

const REGISTRY_URL = 'https://solar.example/app/properties/index.json';

function entry(overrides = {}) {
  return {
    slug: 'demo',
    title: 'Demo solar study',
    displayLabel: 'Mid-Atlantic example',
    revision: '2026.08.24-1',
    configUrl: './demo/property.json',
    modelUrl: './demo/model.glb',
    privacyTier: 'unlisted',
    updatedAt: '2026-08-24T13:00:00Z',
    ...overrides,
  };
}

function registry(properties = [entry()], overrides = {}) {
  return { schemaVersion: 1, defaultProperty: 'demo', properties, ...overrides };
}

test('the checked-in registry is valid and resolves package-relative assets', async () => {
  const input = JSON.parse(await readFile(new URL('../properties/index.json', import.meta.url), 'utf8'));
  const result = validatePropertyRegistry(input, { registryUrl: REGISTRY_URL });

  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.registry.defaultProperty, 'demo');
  assert.equal(result.registry.properties.length, 1);
  assert.equal(result.registry.properties[0].configUrl, 'https://solar.example/app/properties/demo/property.json');
  assert.equal(result.registry.properties[0].modelUrl, 'https://solar.example/app/properties/demo/model.glb');
  assert.equal(result.registry.properties[0].sourceConfigUrl, './demo/property.json');
});

test('registry URLs accept same-site assets and explicit HTTPS hosts only', () => {
  assert.equal(
    resolveTrustedRegistryUrl('/shared/property.json', { registryUrl: REGISTRY_URL }),
    'https://solar.example/shared/property.json',
  );
  assert.equal(
    resolveTrustedRegistryUrl('https://cdn.example/packages/property.json', {
      registryUrl: REGISTRY_URL,
      allowedHosts: ['cdn.example'],
    }),
    'https://cdn.example/packages/property.json',
  );

  for (const value of [
    'javascript:alert(1)',
    'data:application/json,{}',
    'file:///tmp/property.json',
    'blob:https://solar.example/id',
    '../private/property.json',
    '..%2fprivate/property.json',
    '%252e%252e/private/property.json',
    '..%255cprivate%255cproperty.json',
    'https://user:secret@solar.example/property.json',
    'https://other.example/property.json',
  ]) {
    assert.throws(() => resolveTrustedRegistryUrl(value, { registryUrl: REGISTRY_URL }), undefined, value);
  }
  assert.throws(
    () => resolveTrustedRegistryUrl('http://cdn.example/property.json', {
      registryUrl: REGISTRY_URL,
      allowedHosts: ['cdn.example'],
    }),
    /not allowed/,
  );
});

test('invalid and duplicate entries are rejected instead of entering the normalized registry', () => {
  const input = registry([
    entry(),
    entry({title: 'Duplicate'}),
    entry({slug: 'private-house', revision: '1', updatedAt: 'yesterday'}),
    entry({slug: 'unknown', revision: '1', extra: true}),
    entry({slug: 'bad-tier', revision: '1', privacyTier: 'secret'}),
    entry({slug: 'bad-date', revision: '1', updatedAt: '2026-02-30T00:00:00Z'}),
  ], {extra: true});
  const result = validatePropertyRegistry(input, {registryUrl: REGISTRY_URL});

  assert.equal(result.valid, false);
  assert.equal(result.registry.properties.length, 1);
  assert.match(result.errors.join(' '), /registry\.extra is not allowed/);
  assert.match(result.errors.join(' '), /duplicates demo@2026\.08\.24-1/);
  assert.match(result.errors.join(' '), /updatedAt must be an RFC 3339 timestamp/);
  assert.match(result.errors.join(' '), /properties\[3\]\.extra is not allowed/);
  assert.match(result.errors.join(' '), /privacyTier/);
});

test('cross-origin entries validate only with an exact HTTPS host allowlist', () => {
  const remote = registry([entry({
    configUrl: 'https://cdn.example/studies/demo.json',
    modelUrl: 'https://cdn.example/studies/demo.glb',
  })]);
  const blocked = validatePropertyRegistry(remote, {registryUrl: REGISTRY_URL});
  const allowed = validatePropertyRegistry(remote, {
    registryUrl: REGISTRY_URL,
    allowedHosts: ['cdn.example'],
  });

  assert.equal(blocked.valid, false);
  assert.equal(blocked.registry.properties.length, 0);
  assert.equal(allowed.valid, true, allowed.errors.join('\n'));
  assert.equal(allowed.registry.properties[0].modelUrl, 'https://cdn.example/studies/demo.glb');
  assert.throws(
    () => validatePropertyRegistry(remote, {registryUrl: REGISTRY_URL, allowedHosts: ['https://cdn.example/path']}),
    /Invalid allowed HTTPS host/,
  );
});

test('property selection resolves an explicit revision or the latest valid revision', () => {
  const input = registry([
    entry({slug: 'demo', revision: '1', updatedAt: '2026-01-01T00:00:00Z'}),
    entry({slug: 'garden', revision: '1', updatedAt: '2026-03-01T00:00:00Z'}),
    entry({slug: 'garden', revision: '2', updatedAt: '2026-08-01T00:00:00Z'}),
  ]);
  const latest = resolvePropertyEntry(input, {property: 'garden', registryUrl: REGISTRY_URL});
  const pinned = resolvePropertyEntry(input, {property: 'garden', revision: '1', registryUrl: REGISTRY_URL});

  assert.equal(latest.fallback, false);
  assert.equal(latest.entry.revision, '2');
  assert.equal(pinned.fallback, false);
  assert.equal(pinned.entry.revision, '1');
});

test('missing and malformed selectors fall back to a safe demo entry', () => {
  const input = registry([entry({revision: '3'})]);
  for (const options of [
    {property: '../private'},
    {property: 'garden'},
    {property: 'demo', revision: '../old'},
    {property: 'demo', revision: 'missing'},
  ]) {
    const result = resolvePropertyEntry(input, {...options, registryUrl: REGISTRY_URL});
    assert.equal(result.fallback, true, JSON.stringify(options));
    assert.equal(result.entry.slug, 'demo');
    assert.equal(result.entry.revision, '3');
    assert.match(result.warnings.join(' '), /fallback/);
  }

  const empty = resolvePropertyEntry({schemaVersion: 99, properties: []}, {
    property: 'missing',
    registryUrl: REGISTRY_URL,
  });
  assert.equal(empty.entry.slug, 'demo');
  assert.equal(empty.entry.configUrl, 'https://solar.example/app/properties/demo/property.json');
  assert.equal(empty.entry.privacyTier, 'private');
});

test('registry loading validates success and returns a built-in fallback on fetch failure', async () => {
  const success = await loadPropertyRegistry({
    url: REGISTRY_URL,
    fetchImpl: async (url, options) => {
      assert.equal(url, REGISTRY_URL);
      assert.deepEqual(options, {credentials: 'same-origin'});
      return {ok: true, status: 200, json: async () => registry()};
    },
  });
  assert.equal(success.valid, true, success.errors.join('\n'));

  const failure = await loadPropertyRegistry({
    url: REGISTRY_URL,
    fetchImpl: async () => ({ok: false, status: 503}),
  });
  assert.equal(failure.valid, false);
  assert.equal(failure.registry.properties[0].slug, 'demo');
  assert.match(failure.errors.join(' '), /503/);
});
