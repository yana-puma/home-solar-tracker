import { createLocalDiagnostics } from '../diagnostics.js';

export function createViewerDiagnostics(options = {}) {
  return createLocalDiagnostics({
    appVersion: 'atlee-static-viewer-v1',
    ...options,
    transport: null,
  });
}

export function diagnosticsFilename(date = new Date()) {
  const value = date instanceof Date && !Number.isNaN(date.valueOf())
    ? date.toISOString().slice(0, 10)
    : 'local';
  return `atlee-viewer-diagnostics-${value}.json`;
}

export function diagnosticsDownloadPayload(diagnostics, date = new Date()) {
  if (!diagnostics || typeof diagnostics.exportJson !== 'function') {
    throw new TypeError('A local diagnostics recorder is required');
  }
  return {
    filename: diagnosticsFilename(date),
    mediaType: 'application/json;charset=utf-8',
    text: diagnostics.exportJson({ userInitiated: true, pretty: true }),
  };
}

export function downloadViewerDiagnostics(diagnostics, {
  documentRef = document,
  urlApi = URL,
  date = new Date(),
} = {}) {
  const payload = diagnosticsDownloadPayload(diagnostics, date);
  const url = urlApi.createObjectURL(new Blob([payload.text], { type: payload.mediaType }));
  try {
    const anchor = documentRef.createElement('a');
    anchor.href = url;
    anchor.download = payload.filename;
    anchor.hidden = true;
    documentRef.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    urlApi.revokeObjectURL(url);
  }
  return { filename: payload.filename, eventCount: diagnostics.size };
}
