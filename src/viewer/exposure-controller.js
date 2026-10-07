import { EXPOSURE_TIERS } from '../exposure.js';
import {
  StaleExposureResultError,
  createExposureScheduler,
} from '../exposure-scheduler.js';

function transformPoint(x, y, z, elements) {
  return [
    elements[0] * x + elements[4] * y + elements[8] * z + elements[12],
    elements[1] * x + elements[5] * y + elements[9] * z + elements[13],
    elements[2] * x + elements[6] * y + elements[10] * z + elements[14],
  ];
}

/** Serialize visible mesh geometry for worker-compatible model ray tests. */
export function modelTriangleSoup(root) {
  if (!root?.traverse) return new Float64Array();
  root.updateMatrixWorld?.(true);
  const values = [];
  root.traverse((node) => {
    if (!node?.isMesh || node.visible === false) return;
    const position = node.geometry?.attributes?.position;
    if (!position || position.itemSize < 3) return;
    const index = node.geometry.index;
    const count = index ? index.count : position.count;
    const elements = node.matrixWorld?.elements;
    if (!elements) return;
    for (let offset = 0; offset + 2 < count; offset += 3) {
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const item = index ? index.getX(offset + vertex) : offset + vertex;
        values.push(...transformPoint(
          position.getX(item),
          position.getY(item),
          position.getZ(item),
          elements,
        ));
      }
    }
  });
  return new Float64Array(values);
}

function gridElevations(bounds, columns, rows, elevationAt) {
  const values = new Float64Array(columns * rows);
  const width = (bounds.maxX - bounds.minX) / columns;
  const depth = (bounds.maxZ - bounds.minZ) / rows;
  for (let row = 0; row < rows; row += 1) {
    const z = bounds.minZ + (row + 0.5) * depth;
    for (let column = 0; column < columns; column += 1) {
      const x = bounds.minX + (column + 0.5) * width;
      values[row * columns + column] = Number(elevationAt?.(x, z)) || 0;
    }
  }
  return values;
}

export function createViewerExposureController({ preferWorker = true } = {}) {
  const scheduler = createExposureScheduler({ preferWorker });
  let geometryRoot = null;
  let triangles = null;

  return {
    get mode() { return scheduler.mode; },
    get active() { return scheduler.active; },
    cancel() { return scheduler.cancel(); },
    clearCache() { scheduler.clearCache(); },
    dispose() { scheduler.dispose(); },

    async run({
      property,
      modelRoot,
      date,
      tier = 'standard',
      elevationAt,
      signal,
      onProgress,
    }) {
      const settings = EXPOSURE_TIERS[tier] || EXPOSURE_TIERS.standard;
      const bounds = property.scene.groundBounds;
      if (geometryRoot !== modelRoot) {
        geometryRoot = modelRoot;
        triangles = modelTriangleSoup(modelRoot);
        scheduler.clearCache();
      }
      if (!triangles?.length) throw new Error('The loaded model has no ray-testable triangles.');
      const revision = property.package?.revision || property.revision || 'unversioned';
      const modelAsset = property.assets?.find?.((asset) => asset.type === 'model');
      const modelHash = modelAsset?.integrity || `${revision}:${property.model.url}`;
      try {
        return await scheduler.run({
          tier,
          propertyRevision: revision,
          modelHash,
          date,
          latitude: property.location.latitude,
          longitude: property.location.longitude,
          timeZone: property.location.timeZone,
          northOffsetDegrees: 0,
          grid: {
            bounds,
            columns: settings.columns,
            rows: settings.rows,
            elevations: gridElevations(bounds, settings.columns, settings.rows, elevationAt),
          },
          occlusion: { type: 'triangle-soup', triangles },
        }, { signal, onProgress });
      } catch (error) {
        if (error instanceof StaleExposureResultError) error.name = 'AbortError';
        throw error;
      }
    },
  };
}
