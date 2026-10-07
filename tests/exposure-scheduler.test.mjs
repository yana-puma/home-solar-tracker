import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPOSURE_TIERS,
  calculateSerializableExposure,
  createExposureCacheKey,
  createExposureRayPlan,
  normalizeExposureJob,
} from '../src/exposure.js';
import {
  ExposureMemoryCache,
  ExposureScheduler,
  StaleExposureResultError,
} from '../src/exposure-scheduler.js';
import { installExposureWorker } from '../src/workers/exposure-worker.js';

function job(overrides = {}) {
  return {
    jobVersion: 1,
    propertyRevision: 'property-revision-a',
    modelHash: 'sha256:model-a',
    date: '2026-03-20',
    latitude: 0,
    longitude: 0,
    timeZone: 'UTC',
    northOffsetDegrees: 0,
    tier: 'quick',
    samplingMinutes: 120,
    grid: {
      bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
      columns: 2,
      rows: 1,
    },
    occlusion: { type: 'none' },
    ...overrides,
  };
}

function clone(value) {
  return structuredClone(value);
}

test('quick, standard, and high tiers normalize to documented defaults', () => {
  for (const [tier, expected] of Object.entries(EXPOSURE_TIERS)) {
    const input = job({
      tier,
      samplingMinutes: undefined,
      grid: {
        bounds: { minX: -10, maxX: 10, minZ: -20, maxZ: 20 },
      },
    });
    const normalized = normalizeExposureJob(input);
    assert.equal(normalized.tier, tier);
    assert.equal(normalized.samplingMinutes, expected.samplingMinutes);
    assert.equal(normalized.grid.columns, expected.columns);
    assert.equal(normalized.grid.rows, expected.rows);
    assert.equal(normalized.grid.pointCount, expected.columns * expected.rows);
    assert.equal(normalized.batchSolarSamples, expected.batchSolarSamples);
  }
});

test('cache keys include property, model, date, grid, sampling, and north alignment', () => {
  const baseline = job();
  const baselineKey = createExposureCacheKey(baseline);
  const variations = [
    { propertyRevision: 'property-revision-b' },
    { modelHash: 'sha256:model-b' },
    { date: '2026-03-21' },
    { samplingMinutes: 60 },
    { northOffsetDegrees: 12 },
    { latitude: 1 },
    { longitude: 1 },
    { timeZone: 'Europe/London' },
    {
      grid: {
        bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
        columns: 3,
        rows: 1,
      },
    },
  ];

  assert.equal(createExposureCacheKey(clone(baseline)), baselineKey);
  for (const variation of variations) {
    assert.notEqual(createExposureCacheKey(job(variation)), baselineKey, JSON.stringify(variation));
  }
});

test('serializable unobstructed jobs emit monotonic progressive updates', async () => {
  const updates = [];
  const result = await calculateSerializableExposure(job(), {
    onProgress(update) {
      updates.push(update);
    },
  });

  assert.equal(result.grid.pointCount, 2);
  assert.ok(result.sampleCount >= 5 && result.sampleCount <= 7);
  assert.equal(result.rayCount, result.sampleCount * 2);
  assert.equal(result.exposures.length, 2);
  assert.ok(result.exposures.every((exposure) => exposure.sunMinutes > 0));
  assert.ok(updates.length >= 2);
  assert.equal(updates.at(-1).progress, 1);
  assert.equal(updates.at(-1).sunMinutes.length, 2);
  for (let index = 1; index < updates.length; index += 1) {
    assert.ok(updates[index].progress >= updates[index - 1].progress);
    assert.ok(updates[index].completedRays >= updates[index - 1].completedRays);
  }
  assert.equal(result.provenance.occlusionContract, 'none');
});

test('polar night completes with a final zero-ray progress update', async () => {
  const updates = [];
  const result = await calculateSerializableExposure(job({
    date: '2026-12-21',
    latitude: 69.6492,
    longitude: 18.9553,
    timeZone: 'Europe/Oslo',
    grid: {
      bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
      columns: 1,
      rows: 1,
    },
  }), { onProgress: (update) => updates.push(update) });

  assert.equal(result.sampleCount, 0);
  assert.equal(result.rayCount, 0);
  assert.equal(result.exposures[0].sunMinutes, 0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].progress, 1);
  assert.equal(updates[0].totalRays, 0);
});

test('triangle-soup jobs perform two-sided serialized occlusion', async () => {
  const roof = new Float32Array([
    -100, 1, -100, 100, 1, -100, 100, 1, 100,
    -100, 1, -100, 100, 1, 100, -100, 1, 100,
  ]);
  const result = await calculateSerializableExposure(job({
    grid: {
      bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
      columns: 1,
      rows: 1,
    },
    occlusion: {
      type: 'triangle-soup',
      triangles: roof,
      originOffset: 0.03,
      maxDistance: 1000,
    },
  }));

  assert.equal(result.exposures[0].sunMinutes, 0);
  assert.equal(result.exposures[0].sunHours, 0);
  assert.equal(result.provenance.method, 'model-derived-direct-sun');
  assert.equal(result.provenance.occlusionContract, 'triangle-soup');
});

test('visibility matrices provide a serializable bridge for caller-owned raycasters', async () => {
  const plan = createExposureRayPlan(job());
  const unobstructed = await calculateSerializableExposure(job());
  const blocked = await calculateSerializableExposure(job({
    occlusion: {
      type: 'visibility-matrix',
      blocked: new Uint8Array(plan.rayCount).fill(1),
    },
  }));

  assert.equal(plan.pointCount, 2);
  assert.equal(plan.rayCount, plan.pointCount * plan.solarSampleCount);
  assert.equal(plan.rayCount, unobstructed.rayCount);
  assert.ok(plan.solarSamples.every((sample) => sample.altitude > 0));
  assert.ok(unobstructed.exposures.every((exposure) => exposure.sunMinutes > 0));
  assert.ok(blocked.exposures.every((exposure) => exposure.sunMinutes === 0));
  assert.equal(blocked.provenance.occlusionContract, 'visibility-matrix');

  await assert.rejects(
    calculateSerializableExposure(job({
      occlusion: { type: 'visibility-matrix', blocked: [1, 0] },
    })),
    /must contain exactly/i,
  );
});

test('the synchronous scheduler reports progress and reuses its memory cache', async () => {
  const cache = new ExposureMemoryCache({ maxEntries: 2 });
  const scheduler = new ExposureScheduler({ preferWorker: false, cache });
  const progress = [];
  const first = await scheduler.run(job(), {
    onProgress(update) {
      progress.push(update);
    },
  });
  const second = await scheduler.run(clone(job()));

  assert.equal(scheduler.mode, 'synchronous');
  assert.equal(first.source, 'synchronous');
  assert.equal(second.source, 'cache');
  assert.equal(first.cacheKey, second.cacheKey);
  assert.equal(cache.size, 1);
  assert.ok(progress.length > 0);
  assert.ok(progress.every((update) => update.source === 'synchronous'));
  scheduler.dispose();
});

test('AbortSignal cancels a cooperative synchronous calculation', async () => {
  const scheduler = new ExposureScheduler({ preferWorker: false });
  const controller = new AbortController();
  const pending = scheduler.run(job({
    samplingMinutes: 15,
    grid: {
      bounds: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 },
      columns: 16,
      rows: 16,
    },
    batchSolarSamples: 1,
  }), {
    signal: controller.signal,
    onProgress() {
      controller.abort();
    },
  });

  await assert.rejects(pending, (error) => error.name === 'AbortError');
  assert.equal(scheduler.active, false);
  scheduler.dispose();
});

test('a newer synchronous run rejects the previous run as stale', async () => {
  const scheduler = new ExposureScheduler({ preferWorker: false });
  const first = scheduler.run(job({ date: '2026-03-20' }), { useCache: false });
  const second = scheduler.run(job({ date: '2026-03-21' }), { useCache: false });

  await assert.rejects(first, (error) => error instanceof StaleExposureResultError);
  const current = await second;
  assert.equal(current.date, '2026-03-21');
  assert.equal(current.source, 'synchronous');
  scheduler.dispose();
});

class FakeWorker {
  static latest;

  constructor() {
    FakeWorker.latest = this;
    this.listeners = { message: new Set(), error: new Set() };
    this.messages = [];
    this.terminated = false;
  }

  addEventListener(type, listener) {
    this.listeners[type].add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners[type].delete(listener);
  }

  postMessage(message) {
    this.messages.push(message);
    if (message.type !== 'run') return;
    queueMicrotask(() => {
      if (this.terminated || this.messages.some((item) => item.type === 'cancel' && item.jobId === message.jobId)) return;
      this.emit('message', {
        data: {
          type: 'progress',
          jobId: message.jobId,
          update: { progress: 0.5, completedRays: 1, totalRays: 2 },
        },
      });
      this.emit('message', {
        data: {
          type: 'result',
          jobId: message.jobId,
          result: {
            date: message.job.date,
            sampleCount: 1,
            rayCount: 2,
            exposures: [],
          },
        },
      });
    });
  }

  emit(type, event) {
    for (const listener of this.listeners[type]) listener(event);
  }

  terminate() {
    this.terminated = true;
  }
}

test('worker mode uses the message protocol and caches completed results', async () => {
  const scheduler = new ExposureScheduler({ WorkerClass: FakeWorker });
  const progress = [];
  const first = await scheduler.run(job(), {
    onProgress(update) {
      progress.push(update);
    },
  });
  const second = await scheduler.run(job());

  assert.equal(scheduler.mode, 'worker');
  assert.equal(first.source, 'worker');
  assert.equal(second.source, 'cache');
  assert.equal(progress.length, 1);
  assert.equal(progress[0].source, 'worker');
  assert.equal(FakeWorker.latest.messages[0].type, 'run');
  scheduler.dispose();
  assert.equal(FakeWorker.latest.terminated, true);
});

test('worker construction failure degrades to the synchronous path', async () => {
  class BrokenWorker {
    constructor() {
      throw new Error('workers unavailable');
    }
  }
  const scheduler = new ExposureScheduler({ WorkerClass: BrokenWorker });
  const result = await scheduler.run(job());

  assert.equal(scheduler.mode, 'synchronous');
  assert.equal(result.source, 'synchronous');
  scheduler.dispose();
});

class ManualWorker extends FakeWorker {
  postMessage(message) {
    this.messages.push(message);
  }
}

test('late worker messages cannot replace a newer request', async () => {
  const scheduler = new ExposureScheduler({ WorkerClass: ManualWorker });
  const worker = ManualWorker.latest;
  const first = scheduler.run(job({ date: '2026-03-20' }), { useCache: false });
  const firstRun = worker.messages.find((message) => message.type === 'run');
  const second = scheduler.run(job({ date: '2026-03-21' }), { useCache: false });
  const runs = worker.messages.filter((message) => message.type === 'run');
  const secondRun = runs[1];

  await assert.rejects(first, (error) => error instanceof StaleExposureResultError);
  assert.ok(worker.messages.some((message) => (
    message.type === 'cancel' && message.jobId === firstRun.jobId
  )));

  worker.emit('message', {
    data: {
      type: 'result',
      jobId: firstRun.jobId,
      result: { date: 'wrong-stale-date', exposures: [] },
    },
  });
  worker.emit('message', {
    data: {
      type: 'result',
      jobId: secondRun.jobId,
      result: { date: '2026-03-21', exposures: [] },
    },
  });
  const current = await second;

  assert.equal(current.date, '2026-03-21');
  assert.equal(current.source, 'worker');
  scheduler.dispose();
});

test('the real worker handler emits progressive and final protocol messages', async () => {
  const listeners = new Set();
  const messages = [];
  let resolveResult;
  const resultMessage = new Promise((resolve) => { resolveResult = resolve; });
  const scope = {
    addEventListener(type, listener) {
      if (type === 'message') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'message') listeners.delete(listener);
    },
    postMessage(message) {
      messages.push(message);
      if (message.type === 'result') resolveResult(message);
    },
  };
  const uninstall = installExposureWorker(scope);
  for (const listener of listeners) {
    listener({ data: { type: 'run', jobId: 'real-worker-job', job: job() } });
  }
  const result = await resultMessage;

  assert.equal(result.jobId, 'real-worker-job');
  assert.ok(messages.some((message) => message.type === 'progress'));
  assert.equal(messages.at(-1).type, 'result');
  assert.ok(result.result.exposures.every((exposure) => exposure.sunMinutes > 0));
  uninstall();
  assert.equal(listeners.size, 0);
});

test('memory cache is bounded and least-recently-used', () => {
  const cache = new ExposureMemoryCache({ maxEntries: 2 });
  cache.set('a', { value: 1 });
  cache.set('b', { value: 2 });
  assert.deepEqual(cache.get('a'), { value: 1 });
  cache.set('c', { value: 3 });

  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.has('c'), true);
  assert.deepEqual(cache.keys(), ['a', 'c']);
});

test('invalid serializable jobs fail before worker dispatch', async () => {
  const scheduler = new ExposureScheduler({ WorkerClass: FakeWorker });
  await assert.rejects(scheduler.run(job({ propertyRevision: '' })), /propertyRevision/i);
  await assert.rejects(scheduler.run(job({ modelHash: '' })), /modelHash/i);
  await assert.rejects(scheduler.run(job({ tier: 'ultra' })), /tier must be one of/i);
  await assert.rejects(scheduler.run(job({ timeZone: 'Not\/A_Zone' })), /Invalid IANA/i);
  assert.equal(FakeWorker.latest.messages.length, 0);
  scheduler.dispose();
});
