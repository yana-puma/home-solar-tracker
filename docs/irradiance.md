# Clear-sky irradiance and PV planning estimate

`src/irradiance.js` converts supplied solar-geometry samples into a transparent plane-of-array opportunity estimate. It is dependency-free, does not load weather data, and never recalculates dates or time zones. It can consume `sampleSolarDay()` and `sampleSolarYear()` results from `src/solar-analysis.js` directly.

This is a planning estimate only. It is not measured production, a utility-grade forecast, certified solar access, an interconnection design, or a financial guarantee.

## Transparent calculation model

For each above-horizon solar sample, the module uses the Haurwitz clear-sky global horizontal irradiance approximation:

```text
GHI = 1098 × cos(zenith) × exp(-0.059 / cos(zenith))  W/m²
```

The default diffuse horizontal fraction is a declared constant of 15%:

```text
DHI = GHI × 0.15
DNI = (GHI - DHI) / cos(zenith)
```

The target plane uses:

- cosine incidence for the direct beam;
- isotropic sky diffuse, `DHI × (1 + cos(tilt)) / 2`;
- ground reflection, `GHI × albedo × (1 - cos(tilt)) / 2`;
- default ground albedo `0.2`.

The defaults are intentionally inspectable constants, not a hidden simulation. Callers may override diffuse fraction and albedo when they have a documented basis. This simplified atmosphere does not use aerosol, pressure, humidity, spectral, horizon, or cloud observations.

Azimuths are degrees clockwise from true north. Plane tilt is 0 degrees horizontal through 90 degrees vertical. A plane’s azimuth is the direction its front surface faces.

## One plane sample

```js
import { estimateClearSkyPlaneSample } from '../src/irradiance.js';

const sample = estimateClearSkyPlaneSample({
  altitude: 30,
  azimuth: 180,
  intervalMinutes: 30,
  planeTiltDegrees: 35,
  planeAzimuthDegrees: 180,
  sunFraction: 0.75,
  climateDerate: 0.7,
});
```

The result keeps each stage separate:

- `globalHorizontal`, `directNormal`, and `diffuseHorizontal` irradiance;
- direct, sky-diffuse, and ground-reflected plane components;
- `planeClearSky` before obstruction or weather factors;
- `planeAfterSunFraction` after supplied model-derived availability;
- `planeClimateAdjusted` after the user-declared monthly factor;
- interval energy opportunity in kWh/m² for all three stages.

At or below the horizon, all components are zero. Polar night therefore needs no special production rule; polar-day intervals are integrated from the supplied positive-altitude samples.

Each sample’s geometry is treated as constant across its declared interval (rectangular integration). Shorter source intervals reduce that temporal approximation but do not improve the underlying atmosphere, obstruction, or equipment assumptions.

## Model-derived sun fraction

`estimateIrradianceDay()` accepts:

- one `sunFraction` from 0 through 1 for every sample;
- an array matching `solarDay.samples`; or
- `sample.sunFraction` values already attached to individual samples.

If none is present, the factor is 1. A zero factor makes plane opportunity and estimated energy zero, which makes fully blocked model evidence explicit.

An explicit scalar or array option overrides `sample.sunFraction`; otherwise attached sample values are used.

The factor conservatively multiplies the complete plane-of-array opportunity, including isotropic diffuse and ground reflection. A real obstruction can leave some diffuse-sky irradiance, but the existing raycast evidence describes direct-sun availability rather than a sky-view factor. Treating full model shade as zero avoids inventing diffuse access that the model has not calculated. A future sky-view model could replace this conservative assumption with separate direct and diffuse obstruction factors.

## Daily integration and energy bases

```js
import { estimateIrradianceDay } from '../src/irradiance.js';
import { sampleSolarDay } from '../src/solar-analysis.js';

const solarDay = sampleSolarDay({
  date: '2026-06-21',
  latitude: 40.0,
  longitude: -105.0,
  timeZone: 'America/New_York',
  samplingMinutes: 30,
});

const estimate = estimateIrradianceDay({
  solarDay,
  planeTiltDegrees: 30,
  planeAzimuthDegrees: 180,
  systemRatingKw: 5,
  systemLossFraction: 0.14,
  monthlyClimateDerate: {
    1: 0.55,
    2: 0.60,
    3: 0.65,
    4: 0.70,
    5: 0.75,
    6: 0.78,
    7: 0.76,
    8: 0.74,
    9: 0.70,
    10: 0.66,
    11: 0.58,
    12: 0.52,
  },
});
```

Energy is optional. Supply no sizing input to receive irradiance opportunity only, or choose exactly one basis:

### Area and module efficiency

```text
estimated kWh = climate-adjusted kWh/m²
              × declared array area m²
              × declared module efficiency
              × (1 - system loss fraction)
```

The default module efficiency is 20%. Area must be active module area, not roof or parcel area.

### Declared DC rating

```text
estimated kWh = climate-adjusted plane-sun-hours
              × declared DC rating kW
              × (1 - system loss fraction)
```

Numerically, plane kWh/m² is equivalent sun-hours relative to 1 kW/m² reference irradiance. The declared rating path does not apply module efficiency a second time.

The default system loss fraction is 14%. It is a user-facing aggregate rather than a modeled breakdown. Temperature, inverter clipping, wiring, mismatch, availability, soiling, snow, degradation, and other losses should be represented only when the caller has a documented assumption.

## Monthly climate factors

`monthlyClimateDerate` may be a 12-element array or an object keyed by canonical month numbers `1` through `12`. Each factor is 0 through 1. Omitted object months default to 1.

These are user-declared clear-sky reduction factors. The module does not infer them from location and does not label them measured climate. If no factors are supplied, results remain clear-sky opportunity rather than expected-weather production.

## Annual integration and leap years

```js
import { estimateIrradianceYear } from '../src/irradiance.js';

const annual = estimateIrradianceYear({
  solarYear,
  planeTiltDegrees: 30,
  planeAzimuthDegrees: 180,
  systemRatingKw: 5,
});
```

Annual integration validates unique ISO dates, sums every supplied interval, and groups results into twelve calendar months. A complete 2024 input requires 366 dates and gives February 29 days; a common year requires 365. There is no 365-day normalization that can silently drop or double-weight leap day.

Partial-year input is allowed but never extrapolated. `coverage.complete` is false, the exact supplied/expected day counts are returned, and the qualification identifies the result as a partial-year total.

Annual `sunFraction` must be a scalar or live on individual samples. A single flat array is rejected because it would be ambiguous across day boundaries.

## Time-zone neutrality

The estimator uses only each sample’s supplied `altitude`, `azimuth`, `timeMinutes`, and `intervalMinutes`. It does not create `Date` objects, convert UTC offsets, or read the host time zone. ISO dates are parsed only as calendar labels for month factors and leap-year coverage.

On a daylight-saving transition day, `solar-analysis.js` remains responsible for the local-clock geometry it supplies. The estimator integrates those intervals exactly as authored. It rejects overlaps and intervals extending beyond minute 1440, but does not invent a skipped hour or duplicate a repeated hour.

## Uncertainty range and provenance

Every daily and annual result includes estimated-energy `low`, `estimate`, and `high` values. Defaults multiply the central result by 0.7 and 1.1. Callers may declare different `uncertainty.lowMultiplier` and `uncertainty.highMultiplier` values satisfying:

```text
0 < lowMultiplier <= 1 <= highMultiplier
```

This bracket is an assumption range, not a statistical confidence interval. A site-specific uncertainty analysis should separately characterize weather-year variability, model orientation and completeness, shade sampling, equipment response, construction, and operational losses.

Results include:

- method `haurwitz-isotropic-poa-planning`;
- claim level `estimated`;
- a qualification explicitly excluding measured, utility-grade, certified, and guaranteed interpretations;
- the model equation summary and limitations;
- parameterized assumptions for diffuse fraction, albedo, shade, climate, efficiency, losses, and uncertainty.

## Input validation and reference tests

Invalid or misleading inputs throw rather than being clamped silently. Validation covers:

- solar altitude from -90 through 90 degrees and azimuth from 0 up to 360;
- plane tilt from 0 through 90 and azimuth from 0 up to 360;
- positive intervals contained within one local calendar day;
- ordered, non-overlapping daily samples;
- fractions, loss factors, monthly keys, uncertainty bounds, and positive system sizes;
- mutually exclusive area and rated-capacity bases;
- unique annual dates belonging to the declared year.

`tests/irradiance.test.mjs` includes deterministic checks for:

- the Haurwitz 30-degree-altitude reference value of 487.894 W/m²;
- horizontal GHI identity and higher opportunity on an appropriately tilted plane;
- night and polar-night zero output;
- full shade producing zero;
- monotonically decreasing energy as losses increase;
- equivalent area-efficiency and DC-rating results;
- monthly climate factor ordering;
- timezone-neutral reuse of normalized solar samples;
- complete 366-day leap-year weighting and non-extrapolated partial years.

Those are calculation regression checks, not field-accuracy tolerances. Real output can differ substantially for the limitations listed above.
