import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LocalDiagnostics,
  categorizeDiagnosticError,
  createLocalDiagnostics,
  redactDiagnostics,
} from '../src/diagnostics.js';

function clockFrom(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function deterministicOptions(clock = () => 1_700_000_000_000) {
  return {
    clock,
    idFactory: (kind, sequence) => `${kind}-${sequence}`,
  };
}

test('records the four local performance stages with deterministic durations and ids', () => {
  const diagnostics = new LocalDiagnostics(deterministicOptions(clockFrom([
    1_700_000_000_000,
    1_700_000_000_010,
    1_700_000_000_035,
    1_700_000_000_040,
    1_700_000_000_050,
    1_700_000_000_060,
    1_700_000_000_070,
  ])));

  const config = diagnostics.startTiming('config');
  const completed = diagnostics.endTiming(config);
  diagnostics.mark('model');
  diagnostics.mark('first-render');
  diagnostics.mark('exposure');

  assert.deepEqual(config, { correlationId: 'timing-1', stage: 'config' });
  assert.equal(completed.durationMs, 25);
  assert.deepEqual(
    diagnostics.getEvents().map(({ stage, state }) => [stage, state]),
    [
      ['config', 'start'],
      ['config', 'complete'],
      ['model', 'mark'],
      ['first-render', 'mark'],
      ['exposure', 'mark'],
    ],
  );
  assert.deepEqual(diagnostics.getEvents().map(({ sequence }) => sequence), [1, 2, 3, 4, 5]);
  assert.equal(diagnostics.sessionId, 'session-0');
});

test('maintains a bounded FIFO event log and detached snapshots', () => {
  const diagnostics = createLocalDiagnostics({
    ...deterministicOptions(),
    maxEvents: 3,
  });
  diagnostics.mark('config', { ordinal: 1 });
  diagnostics.mark('model', { ordinal: 2 });
  diagnostics.mark('first-render', { ordinal: 3 });
  diagnostics.mark('exposure', { ordinal: 4 });

  assert.equal(diagnostics.size, 3);
  assert.deepEqual(diagnostics.getEvents().map((event) => event.details.ordinal), [2, 3, 4]);
  const snapshot = diagnostics.getEvents();
  snapshot[0].details.ordinal = 999;
  assert.equal(diagnostics.getEvents()[0].details.ordinal, 2);
});

test('categorizes errors and gives every recorded error a correlation id', () => {
  assert.equal(categorizeDiagnosticError(new Error('GLTF model parse failed')), 'model');
  assert.equal(categorizeDiagnosticError(new Error('WebGL shader failed')), 'render');
  assert.equal(categorizeDiagnosticError(new Error('Exposure raycast aborted')), 'exposure');
  assert.equal(categorizeDiagnosticError(new Error('Could not fetch asset')), 'network');
  assert.equal(categorizeDiagnosticError(new TypeError('bad value')), 'validation');
  assert.equal(categorizeDiagnosticError(new Error('anything'), { category: 'config' }), 'config');

  const diagnostics = new LocalDiagnostics(deterministicOptions());
  const event = diagnostics.recordError(new Error('GLB model parse failed'));
  assert.equal(event.type, 'error');
  assert.equal(event.category, 'model');
  assert.equal(event.correlationId, 'error-1');
  assert.equal(event.error.message, 'GLB model parse failed');
});

test('redacts coordinates, address labels, query values, filesystem paths, secrets, and model metadata', () => {
  const source = {
    location: {
      latitude: 38.897676,
      longitude: -77.03653,
      label: '742 Evergreen Terrace, Springfield',
    },
    coordinates: [38.897676, -77.03653],
    assetUrl: 'https://cdn.example/model.glb?token=top-secret&version=4#private',
    sourcePath: '/Users/alice/Houses/742 Evergreen Terrace/model.glb',
    customPath: '/workspaces/private-house/model.glb',
    windowsPath: 'C:\\Users\\alice\\house.glb',
    apiKey: 'sk-secret-value',
    modelMetadata: { owner: 'Alice', copyright: 'Private survey' },
    nested: {
      extras: { parcelId: 'ABC-123' },
      relativeAsset: 'models/house.glb?X-Amz-Signature=relative-secret&v=1',
      description: 'View at lat=38.897676 lon=-77.036530; pair 38.897676, -77.036530',
    },
  };
  const redacted = redactDiagnostics(source);
  const serialized = JSON.stringify(redacted);

  for (const secret of [
    '38.897676',
    '-77.03653',
    '742 Evergreen Terrace',
    'top-secret',
    '/Users/alice',
    '/workspaces/private-house',
    'C:\\Users\\alice',
    'sk-secret-value',
    'Alice',
    'ABC-123',
    'relative-secret',
  ]) {
    assert.doesNotMatch(serialized, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  assert.equal(redacted.location.latitude, '[redacted-coordinate]');
  assert.equal(redacted.location.label, '[redacted-address]');
  assert.equal(redacted.coordinates, '[redacted-coordinate]');
  assert.match(redacted.assetUrl, /redacted-query-value/);
  assert.equal(redacted.modelMetadata, '[redacted]');
  assert.equal(redacted.nested.extras, '[redacted]');
});

test('normalizes camelCase, snake_case, and kebab-case sensitive keys before storage', () => {
  const diagnostics = new LocalDiagnostics(deterministicOptions());
  diagnostics.mark('model', {
    gpsPosition: [38.897676, -77.03653],
    homeLatitude: 38.897676,
    home_longitude: -77.03653,
    'geo-location': { latitudeDegrees: 38.897676, longitudeDegrees: -77.03653 },
    nested: {
      streetAddress: '742 Evergreen Terrace',
      authToken: 'private-auth-token',
      modelUserData: { owner: 'Alice' },
    },
    safeMetrics: { durationMs: 25, sampleCount: 148, stage: 'model' },
  });

  const event = diagnostics.getEvents()[0];
  const serialized = JSON.stringify(event);
  assert.equal(event.details.gpsPosition, '[redacted-coordinate]');
  assert.equal(event.details.homeLatitude, '[redacted-coordinate]');
  assert.equal(event.details.home_longitude, '[redacted-coordinate]');
  assert.equal(event.details['geo-location'], '[redacted-coordinate]');
  assert.equal(event.details.nested.streetAddress, '[redacted-coordinate]');
  assert.equal(event.details.nested.authToken, '[redacted]');
  assert.equal(event.details.nested.modelUserData, '[redacted]');
  assert.deepEqual(event.details.safeMetrics, { durationMs: 25, sampleCount: 148, stage: 'model' });
  assert.doesNotMatch(serialized, /38\.897676|-77\.03653|Evergreen|private-auth-token|Alice/i);
});

test('redacts unlabeled coordinate pairs and nested coordinate objects conservatively', () => {
  const redacted = redactDiagnostics({
    samples: [
      [38.897676, -77.03653],
      { latitudeDegrees: 38.8, longitudeDegrees: -77.2 },
    ],
    safeCounts: [365, 148],
  });

  assert.equal(redacted.samples[0], '[redacted-coordinate]');
  assert.equal(redacted.samples[1].latitudeDegrees, '[redacted-coordinate]');
  assert.equal(redacted.samples[1].longitudeDegrees, '[redacted-coordinate]');
  assert.deepEqual(redacted.safeCounts, [365, 148]);
});

test('HTTP URL redaction removes credentials, path details, fragments, and query values', () => {
  const redacted = redactDiagnostics({
    asset: 'https://alice:supersecret@cdn.example/private/private-house/model.glb?token=download-secret&version=4#parcel',
    urlObject: new URL('https://bob:password@example.test/private/config.json?signature=signed-secret'),
  });
  const serialized = JSON.stringify(redacted);

  assert.match(redacted.asset, /^https:\/\/cdn\.example\/\[redacted-path\]\?/);
  assert.match(redacted.asset, /redacted-parameter=\[redacted-query-value\]/);
  assert.match(redacted.asset, /version=\[redacted-query-value\]/);
  assert.match(redacted.urlObject, /^https:\/\/example\.test\/\[redacted-path\]/);
  assert.doesNotMatch(serialized, /alice|bob|supersecret|password|private-house|model\.glb|download-secret|signed-secret|parcel/i);
});

test('malformed and punctuation-bearing credential URLs fail closed', () => {
  const redacted = redactDiagnostics({
    malformed: 'Fetch https://alice:sec,ret@example.invalid/model.glb failed',
    punctuation: 'Fetch https://bob:pa)ss@example.invalid/model.glb failed',
  });
  const serialized = JSON.stringify(redacted);

  assert.doesNotMatch(serialized, /alice|bob|sec,ret|pa\)ss|model\.glb/i);
  assert.match(serialized, /redacted/);
});

test('stored error messages and stacks are redacted before entering memory', () => {
  const diagnostics = new LocalDiagnostics(deterministicOptions());
  const error = new Error('Failed /Users/alice/private/model.glb for 1600 Pennsylvania Avenue');
  error.stack = 'Error at file:///Users/alice/private/viewer.js:10:2?token=secret';
  diagnostics.recordError(error, {
    category: 'model',
    latitude: 38.897676,
    metadata: { owner: 'Alice' },
  });
  const serialized = JSON.stringify(diagnostics.getEvents());

  assert.doesNotMatch(serialized, /Users|Pennsylvania|38\.897676|secret|Alice/i);
  assert.match(serialized, /redacted/);
});

test('credential URLs and camelCase coordinates are redacted in stored errors and stacks', () => {
  const diagnostics = new LocalDiagnostics(deterministicOptions());
  const error = new Error('Fetch https://alice:supersecret@cdn.example/private/model.glb?token=hidden failed');
  error.stack = 'Error: failed\n at https://bob:password@app.example/private/viewer.js?signature=secret:10:2';
  diagnostics.recordError(error, {
    category: 'network',
    nestedContext: { gpsPosition: [38.897676, -77.03653] },
  });

  const serialized = JSON.stringify(diagnostics.getEvents());
  assert.doesNotMatch(serialized, /alice|bob|supersecret|password|hidden|signature=secret|38\.897676|-77\.03653|private\/model|private\/viewer/i);
  assert.match(serialized, /redacted/);
});

test('export is available only for an explicit user action and is redacted', () => {
  const diagnostics = new LocalDiagnostics(deterministicOptions());
  diagnostics.mark('model', {
    asset: 'https://assets.example/house.glb?signature=download-secret',
  });

  assert.throws(() => diagnostics.exportJson(), /explicit user action/i);
  assert.throws(() => diagnostics.exportJson({ userInitiated: false }), /explicit user action/i);
  const exported = diagnostics.exportJson({ userInitiated: true, pretty: false });
  const payload = JSON.parse(exported);
  assert.equal(payload.format, 'atlee-local-diagnostics');
  assert.equal(payload.formatVersion, 1);
  assert.equal(payload.eventCount, 1);
  assert.doesNotMatch(exported, /download-secret/);
});

test('recording and exporting have no default network behavior', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls += 1;
    throw new Error('network must not be called');
  };
  try {
    const diagnostics = new LocalDiagnostics(deterministicOptions());
    diagnostics.mark('config');
    diagnostics.recordError(new Error('configuration failed'));
    diagnostics.exportJson({ userInitiated: true });
    assert.equal(diagnostics.hasTransport, false);
    assert.equal(fetchCalls, 0);
    await assert.rejects(
      diagnostics.transmit({ userInitiated: true }),
      /transport is disabled/i,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an opt-in transport is idle until explicitly invoked and receives only redacted data', async () => {
  const payloads = [];
  const transport = {
    send(payload) {
      payloads.push(payload);
      return { accepted: true };
    },
  };
  const diagnostics = new LocalDiagnostics({
    ...deterministicOptions(),
    transport,
  });
  diagnostics.mark('model', {
    latitude: 38.897676,
    asset: 'https://assets.example/house.glb?token=private-token',
  });
  assert.equal(diagnostics.hasTransport, true);
  assert.equal(payloads.length, 0);
  await assert.rejects(diagnostics.transmit(), /explicit user action/i);
  assert.equal(payloads.length, 0);

  const result = await diagnostics.transmit({ userInitiated: true });
  assert.deepEqual(result, { accepted: true });
  assert.equal(payloads.length, 1);
  const serialized = JSON.stringify(payloads[0]);
  assert.doesNotMatch(serialized, /38\.897676|private-token/);
});
