# Annual and seasonal solar decision engine

`src/solar-analysis.js` is a dependency-free decision layer over
`src/solar.js`. It normalizes daily, monthly, and annual solar samples; compares
dates and representative seasonal presets; summarizes daylight; and aggregates
time-resolved zone exposure. It contains no DOM or Three.js code, so it can run
in the viewer, a Web Worker, Node tests, or a future precomputation pipeline.

## What the engine can claim

The module keeps method provenance with every result:

| Method | UI label | Meaning |
| --- | --- | --- |
| `geometric-solar` | Calculated solar geometry | Astronomical sun position and daylight from date, coordinates, and IANA time zone. |
| `model-derived-direct-sun` | Model-derived direct sun | Supplied time samples were tested against configured model geometry. |
| `seasonal-estimate` | Seasonal estimate | A planning approximation, not model-derived or measured exposure. |

Use `getMethodProvenance(method)` when rendering status or exporting results.
Unknown method names are rejected so a result cannot silently acquire a
stronger claim.

None of these methods is professional solar-access certification. Geometric
solar calculations do not account for clouds or obstructions. Model-derived
results additionally depend on model completeness, scale, orientation,
terrain, vegetation, sample interval, and spatial resolution.

## Daily samples

```js
import { sampleSolarDay } from '../src/solar-analysis.js';

const day = sampleSolarDay({
  date: '2026-06-21',
  latitude: 38.8,
  longitude: -77.2,
  timeZone: 'America/New_York',
  samplingMinutes: 30,
});
```

The result contains:

- `samples`: local-clock samples from minute `0` through less than `1440`;
- `intervalMinutes`: the represented interval, shortened at the end of a day
  when the sampling interval does not divide 1440;
- altitude, true-north azimuth, and above-horizon state;
- `summary`: sunrise, calculated solar noon, sunset, daylight duration,
  noon altitude/azimuth, noon UTC offset, and polar state;
- calculated-geometric provenance.

Clock fields are normalized to `0 <= minutes < 1440`. Sunrise and sunset are
`null` during polar day and polar night. Solar noon remains available in both
cases and is found from the maximum calculated solar altitude.

Sampling intervals must be whole minutes from 1 through 120. A smaller value
increases temporal detail and work. Sunrise, sunset, and daylight duration come
from `calculateDaylightStats()` and do not become more precise when the display
sampling interval is reduced.

## Month and year samples

```js
import { sampleSolarMonth, sampleSolarYear } from '../src/solar-analysis.js';

const month = sampleSolarMonth({
  year: 2026,
  month: 3,
  latitude: 38.8,
  longitude: -77.2,
  timeZone: 'America/New_York',
  samplingMinutes: 60,
});

const year = sampleSolarYear({
  year: 2024,
  latitude: 38.8,
  longitude: -77.2,
  timeZone: 'America/New_York',
  samplingMinutes: 120,
});
```

Month results contain every local calendar date in the month. Year results
contain 365 or 366 daily results plus twelve month summaries. Leap years use
the Gregorian rule, including the century exception. Every daily result asks
the IANA time-zone database for that date, so DST and fractional offsets are
not frozen to a single annual value.

Annual sampling can be computationally expensive in a browser. Use a coarse
interval for charts and summaries, move detailed calculation to a Web Worker,
or progressively replace coarse results with finer ones.

## Date and seasonal comparison

```js
import {
  compareSolarDates,
  compareSeasonalPresets,
  getSeasonalPresetDates,
} from '../src/solar-analysis.js';

const dates = getSeasonalPresetDates(2026);
const custom = compareSolarDates({
  dateA: '2026-04-15',
  dateB: '2026-10-15',
  latitude: 38.8,
  longitude: -77.2,
  timeZone: 'America/New_York',
});

const solstices = compareSeasonalPresets({
  year: 2026,
  presetA: 'juneSolstice',
  presetB: 'decemberSolstice',
  latitude: 38.8,
  longitude: -77.2,
  timeZone: 'America/New_York',
});
```

The preset keys are `marchEquinox`, `juneSolstice`, `septemberEquinox`, and
`decemberSolstice`. They use representative calendar dates (March 20, June 21,
September 22, and December 21). They are useful stable comparison presets but
are not predictions of the exact astronomical event instant, which varies by
year and time zone.

Comparison differences are `second - first`. Sunrise or sunset differences are
`null` when either date is polar day or polar night.

## Zone time-window aggregation

`aggregateZoneTimeWindows()` consumes normalized local-clock snapshots. Each
snapshot covers one non-overlapping interval and contains one or more named
zones:

```js
import { aggregateZoneTimeWindows } from '../src/solar-analysis.js';

const result = aggregateZoneTimeWindows({
  series: [
    {
      date: '2026-06-21',
      timeMinutes: 480,
      intervalMinutes: 30,
      zones: {
        patio: true,
        garden: 0.75,
        window: { sunMinutes: 15 },
      },
    },
  ],
  windows: [
    { id: 'morning', label: 'Morning', startMinutes: 360, endMinutes: 720 },
    { id: 'afternoon', label: 'Afternoon', startMinutes: 720, endMinutes: 1080 },
  ],
  method: 'model-derived-direct-sun',
  minimumSunFraction: 0.5,
});
```

A zone value can be:

- a boolean for a point that is exposed or blocked;
- a number from 0 through 1 for the exposed fraction of a polygon or sample
  group;
- an object with `sunFraction`, `exposed`, or `sunMinutes`.

`sunMinutes` is spatially weighted when a fraction is supplied. First sun,
last sun, and longest continuous sun use `minimumSunFraction` as the decision
threshold. Missing zones are treated as missing observations, not shade.
Results include per-date details and multi-date totals/averages.

Intervals and windows use local clock minutes and may not overlap or cross the
calendar-day boundary. On a DST transition date, the caller remains
responsible for creating the intended local-clock exposure series; the
aggregator does not invent or duplicate the skipped/repeated civil hour.

## Reference fixtures and tolerances

`tests/solar-analysis.test.mjs` includes deterministic golden fixtures for the
same NOAA fractional-year engine used by `src/solar.js`:

| Fixture | Expected values | Test tolerance |
| --- | --- | --- |
| Northern Virginia, 2026-06-21 | sunrise 05:44, solar noon 13:11, sunset 20:37, daylight 893 minutes, noon altitude 74.65 degrees | 5 clock minutes; 0.5 degree |
| Kathmandu, 2026-03-20 | sunrise 06:09, sunset 18:15, UTC offset +5.75 | 5 clock minutes; exact offset |
| Tromso, 2026 solstices | polar day in June; polar night in December | exact polar classification |

The clock and altitude tolerances are regression tolerances, not a claim that
all real sites are accurate within those limits. Model orientation, terrain,
nearby obstructions, atmospheric conditions, and incomplete geometry can
produce substantially larger site-study error than the astronomical formula.

The test suite also covers:

- DST changes within a sampled month;
- Gregorian leap day and 366-day annual output;
- fractional IANA offsets;
- solstice/equinox comparison presets;
- weighted zone windows and missing observations;
- invalid dates, coordinates, time zones, intervals, presets, fractions, and
  overlapping exposure records.
