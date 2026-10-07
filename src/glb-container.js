const decoder = new TextDecoder('utf-8', { fatal: true });

export function validateSelfContainedGlb(bytes) {
  if (bytes.length < 20 || bytes.length > 50 * 1024 * 1024) throw new Error('Model must be a GLB under 50 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) {
    throw new Error('Model is not a complete GLB 2.0 file.');
  }
  let offset = 12;
  let document;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error('Truncated GLB chunk.');
    const size = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (size % 4 || offset + 8 + size > bytes.length) throw new Error('Invalid GLB chunk length.');
    if (offset === 12 && type !== 0x4e4f534a) throw new Error('GLB must start with JSON.');
    if (type === 0x4e4f534a) {
      if (document) throw new Error('Duplicate GLB JSON chunk.');
      document = JSON.parse(decoder.decode(bytes.subarray(offset + 8, offset + 8 + size)));
    }
    offset += 8 + size;
  }
  if (document?.asset?.version !== '2.0') throw new Error('GLB is missing glTF 2.0 metadata.');
  // External URIs would defeat local-only opening and leak requests to other hosts.
  function inspect(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'uri' && (typeof child !== 'string' || !/^data:(image\/|application\/)/.test(child))) {
        throw new Error('Model references external files. Export a self-contained GLB with embedded textures.');
      }
      inspect(child);
    }
  }
  inspect(document);
}

