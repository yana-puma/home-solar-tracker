export function publicPropertyLabel(property) {
  const exact = property.location?.showExactLocation || property.location?.precision === 'exact';
  return exact
    ? (property.title || property.package?.label || 'Property Solar Study')
    : (property.location?.displayLabel || 'Configured property');
}

export function resolveModelUrl(property, { configUrl, appBaseUrl, fallbackUrl } = {}) {
  const reference = property?.model?.url || fallbackUrl;
  if (!reference) throw new Error('The property does not define a model URL.');
  return new URL(reference, configUrl || appBaseUrl).href;
}

export function cameraPreset(property, id, fallback) {
  const configured = property.scene?.cameraPresets || {};
  const value = Array.isArray(configured)
    ? configured.find((candidate) => candidate.id === id)
    : configured[id];
  return { ...fallback, ...(value || {}) };
}

export function loadedPropertyEntry(property, registryEntry, { direct = false } = {}) {
  if (!direct && registryEntry) return registryEntry;
  return {
    slug: property.package?.id || property.slug || 'demo',
    revision: property.package?.revision || property.revision || 'unversioned',
    title: property.title || property.package?.label || 'Property Solar Study',
    displayLabel: property.location?.displayLabel || 'Configured property',
  };
}

export function fitPropertyCamera(bounds) {
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const radius = Math.max(width, depth, 10);
  const center = [(bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2];
  return { label: 'Overview', position: [center[0] - radius, radius * 0.8, center[2] - radius], target: center };
}
