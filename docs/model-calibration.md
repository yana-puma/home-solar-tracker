# Model calibration and QA

`src/model-calibration.js` provides pure, deterministic calibration helpers. It has no DOM or Three.js dependency, does not load a model, and does not infer survey-grade facts. Callers supply decoded model measurements, a known bearing or dimension, and scene settings; the module calculates adjustments and reports QA findings.

## Coordinate and bearing convention

The viewer is Y-up, with `-Z` as model north and `-X` as model east. Bearings are degrees clockwise from north. `model.northOffsetDegrees` means the true bearing of model north: a positive offset rotates model north clockwise from true north.

`calculateNorthOffset()` uses a directed model-local line and the true bearing from its first point to its second point:

```js
import { calculateNorthOffset } from '../src/model-calibration.js';

const north = calculateNorthOffset({
  from: [0, 0, 0],
  to: [0, 0, -12],
  trueBearingDegrees: 12,
});

// north.northOffsetDegrees === 12
```

The line must have nonzero horizontal separation. Reversing only the points or only the true bearing changes the result by 180 degrees. Use a directed surveyed, plat, GIS, or otherwise traceable bearing when available; an unoriented wall axis is insufficient by itself.

## Units and scale

Supported units match the property contract: `meters`, `feet`, `centimeters`, and `millimeters`.

`model.scale` is applied directly by the current Three.js runtime. `model.units` records which unit conversion would normally be expected; it is not applied a second time. For a raw model distance `d`, the viewer’s physical prediction is:

```text
predicted scene meters = d × model.scale
```

For a feet-authored model, the ordinary unit-derived scale is `0.3048`; for centimeters it is `0.01`. Dimension evidence may recommend a slightly different direct multiplier when the export itself has residual scale error. `scaleCorrectionFactor` compares the configured/recommended multiplier with that declared-unit baseline.

Use `calculateScaleFromDimension()` for one reference or `assessModelScale()` for several:

```js
import { assessModelScale } from '../src/model-calibration.js';

const scale = assessModelScale({
  modelUnits: 'meters',
  configuredScale: 1,
  dimensions: [
    { id: 'rear-wall', modelLength: 10.04, realLength: 10, realUnits: 'meters' },
    { id: 'door-height', modelLength: 2.01, realLength: 2, realUnits: 'meters' },
  ],
});
```

The recommended scale is the median implied by the references, which is less sensitive to one outlier than a mean. Default absolute error thresholds are 2% for a warning and 10% for an error. Multiple dimensions that imply inconsistent scales generate a separate finding. Long, independently measured dimensions are preferable to short features where endpoint uncertainty dominates.

## Scene placement and containment

`validateSceneCalibration()` checks:

- the model origin lies inside `groundBounds`;
- a nonempty terrain profile is strictly increasing and covers the complete ground Z range;
- transformed local model bounds fit inside the ground footprint;
- the model base is near the interpolated terrain elevation at the origin;
- camera targets remain inside the scene and positions remain within a deliberately generous QA envelope;
- camera position and target are distinct.

Vectors may be `[x, y, z]` arrays or finite `{x, y, z}` objects. Model bounds use `{min, max}` vectors. Terrain points use the viewer contract’s `[z, elevation]` form.

```js
import { validateSceneCalibration } from '../src/model-calibration.js';

const scene = validateSceneCalibration({
  origin: [0, 0, 0],
  groundBounds: { minX: -25, maxX: 25, minZ: -25, maxZ: 55 },
  terrainProfile: [[-25, 0], [55, -3]],
  modelBounds: { min: [-5, 0, -6], max: [5, 8, 6] },
  modelScale: 1,
  cameraPresets: {
    overview: { position: [-28, 18, -16], target: [0, 2, 5] },
  },
});
```

An empty terrain profile is an explicit flat-ground assumption, not an error. Ground contact is a point check at the origin; for sloped or irregular terrain, callers should also inspect contact around the footprint. The camera envelope is a QA heuristic, not a visibility or clipping proof.

## Model statistics

`assessModelGeometry()` accepts decoded local bounds and optional `triangleCount`, `vertexCount`, and `meshCount`. It reports scene-meter extents after the direct runtime scale, the declared-unit baseline, unusual sizes/aspect ratios, empty geometry, and triangle budgets. Default triangle thresholds are 500,000 for a warning and 2,000,000 for an error; applications can override both.

Triangle statistics must describe decoded render primitives. File size is not a substitute, and compression can make file size diverge substantially from runtime complexity. The static release validator provides a container-level approximation when only GLB accessor counts are available.

## Composite assessment and findings

`createCalibrationAssessment()` runs the supplied checks and returns:

- `status`: `pass`, `review`, or `fail`;
- counts and deterministic `findings`;
- individual north, scale, geometry, and scene results;
- a normalized `calibration` record;
- solar-noon field-check guidance when north evidence is supplied;
- canonical UTF-8 SHA-256 `revisionInput`.

Every finding contains:

- `severity`: `error`, `warning`, or `info`;
- stable `code` for automation;
- human-readable `message`;
- actionable `remediation`;
- structured `details`.

Malformed or nonfinite inputs throw rather than yielding a misleading result. Valid but incomplete evidence produces warnings. `fail` means at least one error; `review` means warnings but no errors.

```js
import {
  createCalibrationAssessment,
  hashCalibrationRevision,
} from '../src/model-calibration.js';

const assessment = createCalibrationAssessment({
  northReference: {
    from: [0, 0, 0],
    to: [0, 0, -10],
    trueBearingDegrees: 12,
  },
  scaleEvidence: {
    modelUnits: 'meters',
    configuredScale: 1,
    dimensions: [{ id: 'wall', modelLength: 10, realLength: 10 }],
  },
  model: {
    bounds: { min: [-5, 0, -6], max: [5, 8, 6] },
    triangleCount: 21148,
    vertexCount: 12000,
    meshCount: 1,
  },
  scene: {
    origin: [0, 0, 0],
    groundBounds: { minX: -25, maxX: 25, minZ: -25, maxZ: 55 },
    terrainProfile: [[-25, 0], [55, 0]],
    cameraPresets: {
      overview: { position: [-28, 18, -16], target: [0, 2, 5] },
    },
  },
  assetHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
});

const revision = await hashCalibrationRevision(assessment.revisionInput);
// revision.revision resembles cal-v1-6c857b1a2e6f83d2
```

The revision digest covers normalized calibration evidence, placement, camera presets, model statistics, and the optional asset digest. It deliberately excludes derived finding prose so wording changes do not alter calibration identity. A shortened revision is convenient for display; retain the full SHA-256 digest when using it as a content-integrity identifier.

## Solar-noon alignment qualification

`solarNoonAlignmentGuidance()` describes a shadow-axis check at calculated local solar noon. It is useful for catching a gross north error. It is not automatic survey calibration.

The check requires a verified vertical reference, accurate time/location inputs, usable weather, and a way to resolve the shadow axis’s 180-degree ambiguity. Terrain, horizon obstruction, atmospheric effects, coordinate uncertainty, an unlevel object, or imprecise markings can all affect the result. Use a surveyed or authoritative bearing for decisions where orientation accuracy is consequential.
