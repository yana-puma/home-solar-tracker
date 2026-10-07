# Model-derived direct-sun exposure

`src/exposure.js` samples solar position through one local calendar day and
asks an injected occlusion function whether each ground point can see the Sun.
This keeps the calculation independent of Three.js: the viewer can implement
`isOccluded(point, direction)` with `THREE.Raycaster`, while Node tests can use
simple deterministic callbacks.

## Coordinate convention

The viewer uses Y up, **-Z north**, **-X east**, +Z south, and +X west.
`sunDirection(...)` returns a normalized ray pointing from a ground sample
toward the Sun. Solar azimuth is clockwise from true north. A positive
`northOffsetDegrees` means model north is rotated clockwise from true north, so
the offset is subtracted when converting the true azimuth to model-local axes.

If a caller raycasts entirely in world coordinates and has already applied the
model's north rotation to its scene node, it should pass an offset of zero. If
it raycasts in the unrotated model's local coordinates, it should pass the
configured north offset.

## Sampling a grid

```js
const points = generateGroundSampleGrid(
  { minX: -25, maxX: 25, minZ: -25, maxZ: 55 },
  (x, z) => terrainElevation(x, z),
  { columns: 30, rows: 40 },
);
```

Samples are placed at cell centers, not directly on the bounds. Each returned
point has `{ x, y, z }` coordinates.

## Calculating exposure

```js
const result = await calculateDirectSunExposure({
  date: '2026-08-15',
  latitude: 38.8,
  longitude: -77.2,
  timeZone: 'America/New_York',
  northOffsetDegrees: 0,
  samplingMinutes: 15,
  points,
  isOccluded(point, direction) {
    // Return true when model geometry intersects the ray toward the Sun.
    return raycastModel(point, direction);
  },
  signal: abortController.signal,
});
```

The result is `{ sampleCount, samplingMinutes, exposures }`. `sampleCount` is
the number of above-horizon time samples. Each exposure contains the original
`point` reference plus `sunMinutes` and `sunHours`. Occlusion callbacks may be
synchronous or asynchronous.

The calculation yields to the event loop after batches of ray tests and checks
an optional `AbortSignal`. Finer intervals and denser grids improve spatial and
temporal resolution but increase raycasting cost roughly in proportion to
`daylight samples × points`.

This measures modeled **direct** sunlight only. Results remain estimates: they
depend on geometry completeness, model scale and north alignment, horizon
coverage, sampling interval, and whether foliage or neighboring structures are
present in the model.

## Off-main-thread jobs

`src/exposure-scheduler.js` adds a latest-request-wins execution layer for
interactive and annual studies. It uses `src/workers/exposure-worker.js` when a
module Worker is available and otherwise runs the same calculation
cooperatively on the main thread. The fallback yields between progressive
batches, but a complex triangle soup can still cause visible main-thread work;
the fallback is resilience, not a performance equivalent to a Worker.

Create one scheduler per interactive result surface:

```js
import { ExposureScheduler } from './src/exposure-scheduler.js';

const scheduler = new ExposureScheduler();
const controller = new AbortController();
const result = await scheduler.run(job, {
  signal: controller.signal,
  onProgress(update) {
    updateHeatmap(update.sunMinutes, update.progress);
  },
});
```

Starting another `run()` on the same scheduler supersedes the active run. Late
progress and result messages are ignored, and the superseded Promise rejects
with `StaleExposureResultError`. A user cancellation rejects with `AbortError`.
Call `dispose()` when the owning viewer is removed.

Completed results use a bounded in-memory LRU cache. A result reports
`source` as `worker`, `synchronous`, or `cache`, and includes its `cacheKey`.
The deterministic key includes:

- property revision;
- model hash;
- local date, coordinates, and IANA time zone;
- grid bounds, rows, columns, base/elevation samples;
- temporal sampling interval;
- model north offset;
- tier and occlusion contract;
- serialized geometry or visibility checksum.

`propertyRevision` and `modelHash` are required. Callers must change them when
the property configuration or world-space model geometry changes. The content
checksums are defense in depth and do not replace proper revision management.

## Quality tiers

Jobs select `quick`, `standard`, or `high`. Explicit grid and sampling values
may override tier defaults.

| Tier | Default grid | Time interval | Progressive batch |
| --- | ---: | ---: | ---: |
| `quick` | 12 × 16 | 60 minutes | 2 solar samples |
| `standard` | 20 × 28 | 30 minutes | 2 solar samples |
| `high` | 32 × 44 | 15 minutes | 1 solar sample |

Smaller intervals and denser grids increase ray count multiplicatively. They
improve temporal and spatial resolution but cannot compensate for incorrect
north alignment, missing geometry, absent vegetation, or an incomplete local
horizon.

## Serializable job contract

Workers cannot receive Three.js `Mesh`, `Scene`, `Raycaster`, functions, or
other live class instances. A job therefore contains only structured-clone
data:

```js
const job = {
  jobVersion: 1,
  tier: 'standard',
  propertyRevision: 'property-json-sha256-or-version',
  modelHash: 'world-geometry-sha256',
  date: '2026-08-15',
  latitude: 38.8,
  longitude: -77.2,
  timeZone: 'America/New_York',
  northOffsetDegrees: 0,
  grid: {
    bounds: { minX: -25, maxX: 25, minZ: -25, maxZ: 55 },
    columns: 20,
    rows: 28,
    // Optional row-major terrain height for every grid cell center.
    elevations: new Float32Array(20 * 28),
  },
  occlusion: {
    type: 'triangle-soup',
    triangles: worldSpaceTrianglePositions,
    originOffset: 0.03,
    maxDistance: 1000,
  },
};
```

`normalizeExposureJob()` validates this contract before worker dispatch.
`calculateSerializableExposure()` is the shared pure/cooperative executor used
by both the worker and fallback.

### Triangle-soup contract

`occlusion.type = "triangle-soup"` performs the ray tests inside the Worker.
`triangles` is a flat array or typed array containing nine numbers per
triangle: three world-space XYZ vertices. Triangles are treated as two-sided.
The ray origin is moved a small distance toward the Sun to reduce self-hits.

A Three.js integration should update every mesh's world matrix, iterate indexed
or non-indexed geometry, transform each vertex by `mesh.matrixWorld`, and append
the resulting triangle coordinates. The extraction happens on the main thread;
the expensive repeated solar ray tests then happen in the Worker.

If the extracted world matrices already include the configured model north
rotation, set the job's `northOffsetDegrees` to zero. If triangles and grid
points remain in the unrotated model coordinate system, pass the configured
north offset. Applying the offset in both the scene transform and the job would
rotate the solar rays twice and produce incorrect exposure.

Practical limitations:

- the built-in triangle loop is dependency-free, not a BVH;
- alpha-tested or transparent materials remain opaque geometry;
- material side/culling settings are ignored;
- deformed/skinned meshes must be baked before extraction;
- stale triangle data is unsafe, so update `modelHash` after transforms or
  geometry changes.

For large models, produce a simplified occluder mesh or add a worker-compatible
spatial index before selecting the high tier.

### Visibility-matrix bridge

`occlusion.type = "visibility-matrix"` supports an application that must retain
Three.js, `three-mesh-bvh`, or another scene-specific raycaster on the main
thread. The caller supplies a row-major `blocked` byte array ordered by:

1. above-horizon solar samples in chronological order;
2. grid points in stable row-major order.

Each value is `1` when blocked and `0` when visible. The required length is
`above-horizon sample count × grid point count`; mismatches are rejected.
This bridge offloads aggregation and progressive result handling, but not the
scene raycasts themselves.

Use `createExposureRayPlan()` to obtain the exact point and ray order instead
of duplicating it:

```js
import { createExposureRayPlan } from './src/exposure.js';

const plan = createExposureRayPlan({ ...job, occlusion: { type: 'none' } });
const blocked = new Uint8Array(plan.rayCount);
for (let solarIndex = 0; solarIndex < plan.solarSamples.length; solarIndex += 1) {
  for (let pointIndex = 0; pointIndex < plan.points.length; pointIndex += 1) {
    const matrixIndex = solarIndex * plan.points.length + pointIndex;
    blocked[matrixIndex] = raycastScene(
      plan.points[pointIndex],
      plan.solarSamples[solarIndex].direction,
    ) ? 1 : 0;
  }
}
const matrixJob = {
  ...job,
  occlusion: { type: 'visibility-matrix', blocked },
};
```

### Unobstructed baseline

`occlusion.type = "none"` calculates the maximum geometric direct-sun
opportunity for the date. It is useful for diagnostics and convergence tests.
Its provenance explicitly says that no obstruction model was applied.

## Progressive updates and cancellation

Each update contains:

- completed/total solar samples;
- completed/total rays;
- a normalized `progress` value;
- a row-major `sunMinutes` snapshot for the full grid;
- scheduler `source` and `cacheKey`.

Snapshots occur only after complete solar-time batches, so every cell in one
snapshot has been evaluated through the same point in the day. Worker jobs
yield after batches so queued cancellation messages can be processed. The
synchronous fallback uses the same yield points and checks its `AbortSignal`.

Progress is a preview. Persist or export only the final result. Cache entries
are written only for completed, current-generation jobs; canceled, failed, or
stale work cannot populate the cache.

## Accuracy and security boundary

The scheduler changes where work runs, not what the result means. It measures
modeled direct-sun opportunity under the supplied geometry contract. It does
not add weather, diffuse sky radiation, spectral effects, professional solar
access certification, or a photovoltaic production guarantee.

Treat remote models and triangle arrays as untrusted input. The job validator
checks types, ranges, array lengths, and finite coordinates, but package
allowlists, download-size limits, model parsing limits, and privacy review
remain responsibilities of the application boundary.
