import {
  calculateSerializableExposure,
  createExposureAbortError,
  createExposureCacheKey,
  normalizeExposureJob,
} from './exposure.js';

function cloneSerializable(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function assertSignal(signal) {
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean')) {
    throw new TypeError('signal must be an AbortSignal');
  }
}

function assertProgressCallback(onProgress) {
  if (onProgress !== undefined && typeof onProgress !== 'function') {
    throw new TypeError('onProgress must be a function');
  }
}

export class StaleExposureResultError extends Error {
  constructor(message = 'Exposure result was superseded by a newer request') {
    super(message);
    this.name = 'StaleExposureResultError';
  }
}

/** Small LRU cache for completed serializable exposure results. */
export class ExposureMemoryCache {
  constructor({ maxEntries = 8 } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 1000) {
      throw new RangeError('maxEntries must be an integer between 1 and 1000');
    }
    this.maxEntries = maxEntries;
    this._entries = new Map();
  }

  get size() {
    return this._entries.size;
  }

  has(key) {
    return this._entries.has(key);
  }

  get(key) {
    if (!this._entries.has(key)) return undefined;
    const value = this._entries.get(key);
    this._entries.delete(key);
    this._entries.set(key, value);
    return value;
  }

  set(key, value) {
    if (this._entries.has(key)) this._entries.delete(key);
    this._entries.set(key, value);
    while (this._entries.size > this.maxEntries) {
      this._entries.delete(this._entries.keys().next().value);
    }
    return this;
  }

  delete(key) {
    return this._entries.delete(key);
  }

  clear() {
    this._entries.clear();
  }

  keys() {
    return [...this._entries.keys()];
  }
}

function deserializeWorkerError(serialized) {
  const error = serialized?.name === 'AbortError'
    ? createExposureAbortError(serialized.message)
    : new Error(serialized?.message || 'Exposure worker failed');
  if (serialized?.name && serialized.name !== 'AbortError') error.name = serialized.name;
  if (serialized?.stack) error.stack = serialized.stack;
  return error;
}

/**
 * Latest-request-wins scheduler for worker or cooperative synchronous exposure.
 *
 * A scheduler instance is intended to back one interactive result surface. A
 * new run supersedes the previous run, preventing late progress or results
 * from replacing the current selection.
 */
export class ExposureScheduler {
  constructor({
    cache = new ExposureMemoryCache(),
    preferWorker = true,
    WorkerClass = globalThis.Worker,
    workerFactory,
    workerUrl = new URL('./workers/exposure-worker.js', import.meta.url),
  } = {}) {
    if (!cache || typeof cache.get !== 'function' || typeof cache.set !== 'function') {
      throw new TypeError('cache must provide get and set methods');
    }
    if (workerFactory !== undefined && typeof workerFactory !== 'function') {
      throw new TypeError('workerFactory must be a function');
    }
    this.cache = cache;
    this._worker = null;
    this._active = null;
    this._sequence = 0;
    this._disposed = false;
    this._workerMessageHandler = (event) => this._handleWorkerMessage(event.data);
    this._workerErrorHandler = (event) => this._handleWorkerFailure(event);

    if (preferWorker) {
      try {
        if (workerFactory) {
          this._worker = workerFactory(workerUrl);
        } else if (typeof WorkerClass === 'function') {
          this._worker = new WorkerClass(workerUrl, {
            type: 'module',
            name: 'property-solar-exposure',
          });
        }
      } catch {
        this._worker = null;
      }
    }
    if (this._worker && typeof this._worker.postMessage !== 'function') {
      this._worker = null;
    }
    if (this._worker) this._attachWorkerListeners();
  }

  get mode() {
    return this._worker ? 'worker' : 'synchronous';
  }

  get active() {
    return this._active !== null;
  }

  _attachWorkerListeners() {
    if (typeof this._worker.addEventListener === 'function') {
      this._worker.addEventListener('message', this._workerMessageHandler);
      this._worker.addEventListener('error', this._workerErrorHandler);
    } else {
      this._worker.onmessage = this._workerMessageHandler;
      this._worker.onerror = this._workerErrorHandler;
    }
  }

  _detachWorkerListeners() {
    if (!this._worker) return;
    if (typeof this._worker.removeEventListener === 'function') {
      this._worker.removeEventListener('message', this._workerMessageHandler);
      this._worker.removeEventListener('error', this._workerErrorHandler);
    } else {
      this._worker.onmessage = null;
      this._worker.onerror = null;
    }
  }

  _cleanContext(context) {
    if (context.signal && context.externalAbortHandler) {
      context.signal.removeEventListener('abort', context.externalAbortHandler);
    }
    if (this._active === context) this._active = null;
  }

  _rejectContext(context, error) {
    if (context.settled) return;
    context.settled = true;
    context.controller.abort();
    if (context.usesWorker && this._worker) {
      try {
        this._worker.postMessage({ type: 'cancel', jobId: context.jobId });
      } catch {
        // The worker may already have failed or terminated; rejection below is
        // still the authoritative outcome for the caller.
      }
    }
    this._cleanContext(context);
    context.reject(error);
  }

  _supersedeActive() {
    if (!this._active) return;
    this._active.stale = true;
    this._rejectContext(this._active, new StaleExposureResultError());
  }

  _resultWithExecution(result, context, source) {
    return {
      ...cloneSerializable(result),
      cacheKey: context.cacheKey,
      source,
    };
  }

  _resolveContext(context, result, source) {
    if (context.settled) return;
    if (this._active !== context || context.generation !== this._sequence) {
      this._rejectContext(context, new StaleExposureResultError());
      return;
    }
    context.settled = true;
    this.cache.set(context.cacheKey, cloneSerializable(result));
    this._cleanContext(context);
    context.resolve(this._resultWithExecution(result, context, source));
  }

  _handleWorkerMessage(message) {
    const context = this._active;
    if (!context || !context.usesWorker || message?.jobId !== context.jobId || context.settled) return;
    if (context.generation !== this._sequence) {
      this._rejectContext(context, new StaleExposureResultError());
      return;
    }

    if (message.type === 'progress') {
      if (!context.onProgress) return;
      context.progressChain = context.progressChain.then(() => context.onProgress({
        ...cloneSerializable(message.update),
        cacheKey: context.cacheKey,
        source: 'worker',
      }));
      context.progressChain.catch((error) => this._rejectContext(context, error));
      return;
    }
    if (message.type === 'result') {
      context.progressChain
        .then(() => this._resolveContext(context, message.result, 'worker'))
        .catch((error) => this._rejectContext(context, error));
      return;
    }
    if (message.type === 'error') {
      this._rejectContext(context, deserializeWorkerError(message.error));
    }
  }

  _handleWorkerFailure(event) {
    const error = event?.error instanceof Error
      ? event.error
      : new Error(event?.message || 'Exposure worker failed');
    if (this._active?.usesWorker) this._rejectContext(this._active, error);
    this._detachWorkerListeners();
    this._worker?.terminate?.();
    this._worker = null;
  }

  _createContext({ cacheKey, signal, onProgress, usesWorker, resolve, reject }) {
    const generation = ++this._sequence;
    const context = {
      jobId: `exposure-${generation}`,
      generation,
      cacheKey,
      signal,
      onProgress,
      usesWorker,
      resolve,
      reject,
      controller: new AbortController(),
      externalAbortHandler: null,
      stale: false,
      settled: false,
      progressChain: Promise.resolve(),
    };
    if (signal) {
      context.externalAbortHandler = () => {
        this._rejectContext(context, createExposureAbortError());
      };
      signal.addEventListener('abort', context.externalAbortHandler, { once: true });
    }
    return context;
  }

  /** Run a serializable exposure job; a newer run supersedes this one. */
  run(job, { signal, onProgress, useCache = true } = {}) {
    if (this._disposed) return Promise.reject(new Error('ExposureScheduler is disposed'));
    try {
      assertSignal(signal);
      assertProgressCallback(onProgress);
      if (typeof useCache !== 'boolean') throw new TypeError('useCache must be boolean');
      if (signal?.aborted) return Promise.reject(createExposureAbortError());
      const normalizedJob = normalizeExposureJob(job);
      const cacheKey = createExposureCacheKey(normalizedJob);
      this._supersedeActive();

      if (useCache) {
        const cached = this.cache.get(cacheKey);
        if (cached !== undefined) {
          const context = { cacheKey };
          const result = this._resultWithExecution(cached, context, 'cache');
          if (!onProgress) return Promise.resolve(result);
          return Promise.resolve(onProgress({
            progress: 1,
            cacheKey,
            source: 'cache',
            cached: true,
          })).then(() => result);
        }
      }

      return new Promise((resolve, reject) => {
        const context = this._createContext({
          cacheKey,
          signal,
          onProgress,
          usesWorker: Boolean(this._worker),
          resolve,
          reject,
        });
        this._active = context;
        if (signal?.aborted) {
          this._rejectContext(context, createExposureAbortError());
          return;
        }

        if (context.usesWorker) {
          try {
            this._worker.postMessage({
              type: 'run',
              jobId: context.jobId,
              job: normalizedJob,
            });
          } catch (error) {
            this._rejectContext(context, error);
          }
          return;
        }

        void (async () => {
          try {
            const result = await calculateSerializableExposure(normalizedJob, {
              signal: context.controller.signal,
              onProgress: async (update) => {
                if (context.settled || this._active !== context || context.generation !== this._sequence) {
                  throw new StaleExposureResultError();
                }
                if (context.onProgress) {
                  await context.onProgress({
                    ...cloneSerializable(update),
                    cacheKey: context.cacheKey,
                    source: 'synchronous',
                  });
                }
              },
            });
            this._resolveContext(context, result, 'synchronous');
          } catch (error) {
            if (context.settled) return;
            if (context.stale || this._active !== context || context.generation !== this._sequence) {
              this._rejectContext(context, new StaleExposureResultError());
            } else {
              this._rejectContext(context, error);
            }
          }
        })();
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  cancel() {
    if (!this._active) return false;
    this._rejectContext(this._active, createExposureAbortError());
    return true;
  }

  clearCache() {
    this.cache.clear?.();
  }

  dispose() {
    if (this._disposed) return;
    this.cancel();
    this._detachWorkerListeners();
    this._worker?.terminate?.();
    this._worker = null;
    this._disposed = true;
  }
}

export function createExposureScheduler(options) {
  return new ExposureScheduler(options);
}
