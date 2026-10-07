import {
  calculateSerializableExposure,
  createExposureAbortError,
} from '../exposure.js';

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: error?.stack,
  };
}

/** Install the exposure protocol on a Worker-like global scope. */
export function installExposureWorker(scope) {
  if (!scope || typeof scope.addEventListener !== 'function' || typeof scope.postMessage !== 'function') {
    throw new TypeError('scope must provide addEventListener and postMessage');
  }
  const controllers = new Map();

  const handleMessage = (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'cancel') {
      controllers.get(message.jobId)?.abort();
      return;
    }
    if (message.type !== 'run') return;
    if (typeof message.jobId !== 'string' || !message.jobId) {
      scope.postMessage({
        type: 'error',
        jobId: message.jobId,
        error: serializeError(new TypeError('jobId must be a non-empty string')),
      });
      return;
    }

    controllers.get(message.jobId)?.abort();
    const controller = new AbortController();
    controllers.set(message.jobId, controller);

    void calculateSerializableExposure(message.job, {
      signal: controller.signal,
      onProgress(update) {
        scope.postMessage({ type: 'progress', jobId: message.jobId, update });
      },
    }).then((result) => {
      if (controller.signal.aborted) throw createExposureAbortError();
      scope.postMessage({ type: 'result', jobId: message.jobId, result });
    }).catch((error) => {
      scope.postMessage({
        type: 'error',
        jobId: message.jobId,
        error: serializeError(error),
      });
    }).finally(() => {
      if (controllers.get(message.jobId) === controller) controllers.delete(message.jobId);
    });
  };

  scope.addEventListener('message', handleMessage);
  return () => {
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    scope.removeEventListener?.('message', handleMessage);
  };
}

if (
  typeof globalThis.WorkerGlobalScope !== 'undefined'
  && globalThis instanceof globalThis.WorkerGlobalScope
) {
  installExposureWorker(globalThis);
}
