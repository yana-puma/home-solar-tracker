# Product acceptance and release gates

This document is the observable acceptance package for the Home Solar Tracker static viewer, property builder, and public property packages. It complements automated tests: a release is acceptable only when the relevant automated gates pass and the end-to-end scenarios can be observed in a supported browser.

## Acceptance scope

The current product supports:

- registry-selected, revisioned static property packages;
- 3D date/time shadow exploration and prepared camera views;
- one secondary seasonal or custom date comparison;
- on-demand annual astronomical daylight summaries;
- date-specific model-derived direct-sun exposure with three quality tiers, progress, cancellation, and an in-memory cache;
- point, rectangle, and polygon decision-zone authoring and exposure aggregation, with v1 point-zone compatibility;
- an explicit, optional clear-sky PV planning range with rating or area/efficiency inputs;
- privacy-minimized JSON/CSV study reports;
- explicit-download, redacted, local in-memory diagnostics with no default transport;
- local JSON import/export and deterministic complete-ZIP construction;
- local, public-rounded, and public-exact privacy preflight modes; and
- keyboard, live-region, modal-focus, and reduced-motion behavior for core viewer controls.

It does not claim survey accuracy, measured shade, weather-aware irradiance, certified energy production, private access control, or automatic deployment.

## Observable acceptance scenarios

### A. Viewer startup and property identity

| ID | Setup and action | Observable result | Implementation evidence |
| --- | --- | --- | --- |
| A1 | Serve the repository with `python3 -m http.server 8080` and open `http://localhost:8080/?property=demo`. | The loader clears, the GLB appears, **Controls** is available, and no uncaught startup error appears in the console. | `index.html`, `src/viewer/bootstrap.js`, `src/viewer/runtime.js` |
| A2 | Open the demo without a `v` parameter. | The URL is canonicalized to the latest registered demo revision and the **Revision** badge shows that revision. | `properties/index.json`, `src/property-registry.js`, `src/share-url.js`, `src/viewer/solar-controls.js` |
| A3 | Request an unknown property or revision. | The viewer loads its safe registered default and emits an initialization warning rather than following an unsafe path or failing open. | `src/property-registry.js`, `src/viewer/bootstrap.js` |
| A4 | Change the available **Property** selector. | The viewer navigates to the latest registered revision for that property. If only demo is registered, demo is the only property option. | `src/viewer/solar-controls.js` |

### B. Date, time, paths, and shadows

| ID | Setup and action | Observable result | Implementation evidence |
| --- | --- | --- | --- |
| B1 | Change **Date** and drag the local-time slider. | Sun altitude/azimuth, clock labels, lighting, and cast shadows update for the configured coordinates and IANA time zone. | `src/solar.js`, `src/viewer/runtime.js` |
| B2 | Select **Summer (Jun 21)** and **Winter (Dec 21)** in turn. | The primary date changes and the Sun path/shadow geometry visibly differs for the two seasons. | `index.html`, `src/viewer/runtime.js` |
| B3 | Toggle **Sun Arc** and **Compass**. | The selected overlay becomes visible and its pressed state is exposed to assistive technology. | `index.html`, `src/viewer/runtime.js`, `src/viewer/accessibility.js` |
| B4 | Enable **Show second solar path** and choose **June solstice** or **December solstice**. | A blue comparison path and a second daylight-table row appear alongside the gold primary path; sunrise, noon, sunset, and daylight values are populated. | `src/solar-analysis.js`, `src/viewer/solar-controls.js` |
| B5 | Choose **Calculate Annual Summary**. | The status reports average daylight plus the shortest and longest dates for the primary date's year. | `src/solar-analysis.js`, `src/viewer/solar-controls.js` |

Acceptance qualification: B1–B5 demonstrate calculated astronomical geometry. They do not demonstrate model occlusion, live weather, or annual energy production.

### C. Model-derived exposure

| ID | Setup and action | Observable result | Implementation evidence |
| --- | --- | --- | --- |
| C1 | With the demo loaded, choose **Quick** and **Run Model Exposure**, then export JSON. | The Sun Map becomes visible, progress advances, completion status identifies quick tier and a 60-minute interval, and the report records 192 grid points. | `src/exposure.js`, `src/exposure-scheduler.js`, `src/viewer/exposure-controller.js`, `src/viewer/runtime.js`, `src/study-report.js` |
| C2 | Repeat C1 with **Standard**. | Completion identifies a 30-minute interval and the exported report records 560 grid points, corresponding to the 20 × 28 grid. | `src/exposure-scheduler.js`, `src/viewer/exposure-controller.js`, `src/study-report.js` |
| C3 | Repeat C1 with **High** on a suitable device/model. | Completion identifies a 15-minute interval and the exported report records 1,408 grid points, corresponding to the 32 × 44 grid. | `src/exposure-scheduler.js`, `src/viewer/exposure-controller.js`, `src/study-report.js` |
| C4 | Start an exposure run and choose **Cancel** before completion. | Progress stops and status announces cancellation; the ground map and details reset to Not calculated. | `src/viewer/runtime.js`, `src/viewer/solar-controls.js` |
| C5 | Repeat an identical completed study in the same browser session. | The result may identify `cache` as its source. A non-cache source is acceptable after reload, eviction, or any input/revision change. | `src/exposure-scheduler.js` |
| C6 | Inspect the completed colors and legend. | Red means at least 8 hours, amber 6–8, green 3–6, and blue under 3 modeled direct-sun hours. | `src/viewer/runtime.js`, `src/viewer/solar-controls.js` |
| C7 | Open **PV planning estimate (optional)**, leave **DC rating (kW)** selected, enter valid tilt/azimuth/loss values, and choose **Calculate PV planning estimate** without first running exposure. | Status starts with **Calculating clear-sky annual geometry…**, then reports the selected year and says the output is not measured or utility-grade. Low, Central, and High `kWh/year` values appear with Source, Qualification, Limitations, and Assumptions; source identifies an unshaded clear-sky estimate. | `src/viewer/pv-planning.js`, `src/viewer/pv-worker.js`, `src/irradiance.js`, `src/viewer/solar-controls.js` |
| C8 | Repeat C7 from a fresh page on the reference browser while interacting with the 3D view. | The full 60-minute annual calculation runs in a module Worker, the viewer remains responsive, and the acceptance run completes in about 19 seconds. Duration is informational and hardware-dependent; lack of UI blocking and successful completion are the release gates. | `src/viewer/pv-planning.js`, `src/viewer/pv-worker.js`, `src/viewer/solar-controls.js` |
| C9 | Complete **Run Model Exposure**, optionally select a zone, then calculate the PV estimate again. | Source identifies a model-derived direct-sun fraction from the selected date, scoped to the nearest grid point for the selected zone's representative point or a whole-property average, and Limitations disclose that one modeled day is extrapolated across annual clear-sky geometry. | `src/viewer/runtime.js`, `src/viewer/pv-planning.js`, `src/viewer/solar-controls.js` |
| C10 | Change **System input** to **Array area + efficiency**, enter valid values, and calculate; then try an out-of-range value. | The active basis calculates a range. Invalid rating, area, efficiency, tilt, azimuth, or loss values produce **PV estimate could not be calculated:** followed by a validation message instead of a misleading result. | `src/viewer/pv-planning.js`, `src/viewer/solar-controls.js` |

Acceptance qualification: exposure is the intersection of sampled solar rays and opaque serialized model triangles. Quality tiers improve sampling density, not model calibration or completeness. PV output is a clear-sky planning range; it is not measured production, utility-grade analysis, or a weather-aware forecast.

### D. Zones, share state, and reports

| ID | Setup and action | Observable result | Implementation evidence |
| --- | --- | --- | --- |
| D1 | Choose a named **Study zone**. | The zone becomes the selected study target and `zone=<id>` appears in canonical share state. **Whole property** clears the zone. | `src/viewer/solar-controls.js`, `src/viewer/runtime.js`, `src/share-url.js` |
| D2 | Set a date, time, view, zone, overlays, speed, and comparison date; choose **Copy Share Link**. | Status says **Link copied.** or gives the address-bar fallback. Reopening the URL restores supported state and pins `property` plus `v`. | `src/share-url.js`, `src/viewer/ui-state.js`, `src/viewer/solar-controls.js` |
| D3 | Choose **Export JSON** after setting a comparison, calculating annual summary, and completing exposure. | A JSON file downloads with `planningUseOnly: true`, registry slug/revision identity (including the schema-v1 demo), selected state, daylight/comparison/annual/exposure summaries, decision-zone results, and zone-analysis provenance. Exact coordinates and model URLs are absent. | `src/study-report.js`, `src/viewer/viewer-report.js` |
| D4 | Choose **Export CSV** after exposure completes. | A CSV downloads with report/property/daylight fields plus decision-zone rows containing geometry type, method, grid-point count, representative point, and qualification. It contains no exact coordinates or model URL. | `src/study-report.js`, `src/viewer/viewer-report.js` |
| D5 | Inspect rectangle and polygon report rows whose boundaries contain one or more exposure grid-point centers. | Method is `area-grid-mean`; the reported hours are the mean of those included grid points and `gridPointCount` records how many contributed. | `src/viewer/zone-analysis.js`, `src/viewer/viewer-report.js` |
| D6 | Use an area zone small enough that no exposure grid-point center falls inside it, then export after exposure. | Method is `area-representative-fallback`; one nearest grid point is reported and qualification explicitly says the result is not an area average. Point zones similarly use `representative-nearest-grid-point`. | `src/viewer/zone-analysis.js`, `src/viewer/viewer-report.js` |

Report boundary: zone summaries exist only after a model exposure result is available. Area means depend on grid density and authored geometry. The qualified representative fallback prevents an empty result but must not be interpreted as an area average. The optional PV estimate is displayed in the viewer and is not currently included in JSON or CSV study reports.

### E. Local configurator and package persistence

| ID | Setup and action | Observable result | Implementation evidence |
| --- | --- | --- | --- |
| E1 | Open `http://localhost:8080/configure/` and choose a local GLB. | The model previews locally; calibration fields affect the preview; the app performs no model upload. | `configure/index.html` |
| E2 | Import a schema-v1 or schema-v2 JSON file with **Import JSON**. | The form is populated with a normalized schema-v2 configuration and asks for the matching GLB separately. | `src/configurator-package.js`, `src/property-config.js`, `configure/index.html` |
| E3 | Change units, scale, north offset, origin, or bounds. Use **Center model on ground**, **Use model bounds**, or the two-point bearing helper. | The preview/calibration fields update and **Calibration QA** reports pass, review, fail, or why it cannot evaluate. The source GLB bytes are unchanged. | `src/model-calibration.js`, `configure/index.html` |
| E4 | Add point, rectangle, and polygon zones; edit purpose, surface, elevation, and optional sunlight thresholds; remove one zone. | The accessible numeric zone list reflects the edits. **Export property.json** preserves the remaining valid geometry and thresholds. | `configure/index.html`, `src/property-config.js`, `schemas/property.schema.v2.json` |
| E5 | Choose a valid local GLB and a publishable privacy configuration; choose **Export complete ZIP**. | A ZIP downloads named `<package-id>-<revision>.zip` with exactly `property.json`, `model.glb`, `manifest.json`, and `README.md`. Repeating identical inputs produces identical stored ZIP bytes. | `src/configurator-package.js` |
| E6 | Inspect the ZIP manifest. | It records privacy mode, acknowledgements, allowlist, byte sizes, and SHA-256 hashes without coordinates, public labels, original source paths, or copied GLB metadata. | `src/property-io.js`, `src/configurator-package.js` |
| E7 | Extract the ZIP under `properties/<package-id>/` and add a valid, unique slug/revision entry to `properties/index.json`. | `?property=<package-id>&v=<revision>` loads that exact registered package. | `src/property-registry.js`, `properties/index.json` |

### F. Privacy and publication gates

| ID | Setup and action | Observable result | Implementation evidence |
| --- | --- | --- | --- |
| F1 | Select **Local only**. | Exact coordinates can remain for local calculation, the package is marked private, and no public-distribution acknowledgement is implied. | `src/property-io.js`, `src/privacy-audit.js`, `configure/index.html` |
| F2 | Select **Public — rounded coordinates** without the license confirmation. | Complete ZIP export remains blocked. After acknowledgement and a passing audit, exported coordinates are rounded to the selected 0–5 decimal precision. | `src/property-io.js`, `src/privacy-audit.js`, `configure/index.html` |
| F3 | Select **Public — exact coordinates** without both confirmations. | Complete ZIP export remains blocked until redistribution rights and exact-coordinate downloadability are separately acknowledged. | `src/privacy-audit.js`, `configure/index.html` |
| F4 | Supply an address-like public label, identifying filename/metadata, unsafe or remote asset, raw LAS/LAZ/GIS/GeoJSON source, malformed GLB, or non-allowlisted asset. | Preflight reports a warning or error according to mode; public blockers prevent ZIP export. Embedded/referenced GLB images prompt manual review when detectable. | `src/privacy-audit.js`, `scripts/package_property.py` |
| F5 | Run `python3 scripts/validate_package.py .`. | The command exits 0 only when the deployable tree has no blocker. A newly added public GLB outside the approved default scope blocks until separately approved and named with `--allow-public-glb`. | `scripts/validate_package.py`, `scripts/asset_report.py` |

Privacy acceptance is a release gate, not a security guarantee. A public static deployment still permits direct downloads of every deployed configuration, GLB, and texture.

### G. Accessibility and resilience

| ID | Setup and action | Observable result | Implementation evidence |
| --- | --- | --- | --- |
| G1 | Navigate the **Sun & Shade** and **Views** tabs with keyboard focus and Left/Right arrows. | Tab selection, focus, `aria-selected`, and tab panels remain synchronized. | `src/viewer/accessibility.js` |
| G2 | Open a zone/plant modal, use Tab/Shift+Tab, then press Escape. | Focus remains inside the open modal, Escape closes it, and focus returns to the launching control when available. | `src/viewer/accessibility.js` |
| G3 | Enable the operating system's reduced-motion preference and reload. | Timelapse, auto-spin, and demo-reel motion controls are disabled; manual study controls remain usable. | `src/viewer/accessibility.js`, `src/viewer/runtime.js` |
| G4 | Force Worker unavailability in a compatible test environment. | Exposure uses the cooperative synchronous fallback and retains progress/cancellation semantics, though complex geometry may cause more visible main-thread work. | `src/exposure-scheduler.js` |
| G5 | Choose **Download diagnostics** after the model loads and an exposure run completes. | A dated `atlee-viewer-diagnostics-YYYY-MM-DD.json` downloads only on the click. Status reports the redacted event count and **Nothing was sent.** The file contains bounded configuration/model/first-render/exposure events or categorized errors, with coordinates, address-like strings, query secrets, filesystem paths, and model metadata redacted. | `src/diagnostics.js`, `src/viewer/diagnostics-controller.js`, `src/viewer/bootstrap.js`, `src/viewer/runtime.js`, `src/viewer/solar-controls.js` |
| G6 | Inspect network and browser storage before and after recording diagnostics without choosing the button. | No diagnostics request, beacon, analytics transport, automatic file download, or persisted diagnostics record occurs. Reloading clears the in-memory log. | `src/diagnostics.js`, `src/viewer/diagnostics-controller.js` |

## Automated release gates

Run from the repository root:

```bash
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/validate_package.py .
python3 scripts/validate_package.py . --json --output /tmp/atlee-asset-report.json
```

Required outcomes:

1. Every Node test passes.
2. Every Python unit test passes.
3. Static package validation reports `PASS` and exits 0.
4. The JSON validator report is reviewed outside the deployable tree; no local absolute-path report is published.
5. Any additional public GLB has a recorded approval and is explicitly named with `--allow-public-glb properties/<slug>/model.glb` for the gate run.
6. The deployed preview passes A1, B1, B4, C1, C7, C8, D2, D3, D5, F5, G1, G3, G5, and G6 at minimum. Run the complete matrix for a new property contract, calibration change, exposure/PV-engine change, diagnostics change, or public model revision.

Also complete [the operational release checklist](release-checklist.md), including response headers, caching, CSP, mobile/touch, and public-data/license review.

## Property release evidence

Retain the following outside the public deployable tree:

- property slug and revision;
- preview URL and final canonical share URL;
- source-asset and redistribution-rights review;
- chosen privacy mode and required acknowledgements;
- calibration evidence and QA outcome;
- model digest, byte size, and approximate triangle count;
- validator JSON report and command invocation, including any explicit model allowlist;
- Node/Python test results;
- browser/device matrix and any accepted exceptions; and
- approver/date for exact-coordinate or newly public model scope.

## Known limitations and non-goals

### Model calibration

- All shadow and exposure results inherit errors in scale, north offset, origin, ground bounds, terrain, and camera/zone placement.
- The calibration QA panel checks internal consistency and heuristic bounds. It does not decode authoritative survey evidence or certify a field alignment.
- The two-point north helper is only as reliable as the directed model points and real bearing supplied. Reversing one but not the other introduces a 180-degree error.
- A solar-noon field check can catch gross orientation mistakes, but weather, reference verticality, timing, terrain, and shadow-axis ambiguity prevent it from replacing a surveyed bearing.

### Weather, horizon, and vegetation

- Solar geometry is clear-sky astronomy, not a live or historical weather forecast.
- The viewer does not automatically import clouds, haze, snow, neighboring terrain/buildings, or a distant horizon.
- Vegetation shades only when represented by model geometry. Leaf-on/leaf-off change, seasonal growth, transparency, and wind are not simulated; serialized triangles are treated as opaque and two-sided.
- General exposure colors are not species-specific horticultural advice, thermal-comfort criteria, or PV design thresholds.

### Large-GLB first analysis

- The first model-exposure run must traverse the loaded model and serialize world-space triangles on the main thread before repeated ray tests can move to a Worker.
- Large or highly detailed GLBs can cause a slow first run, memory pressure, or visible main-thread work, especially when Worker support falls back to cooperative synchronous execution.
- The built-in triangle test has no BVH. High quality increases the grid and temporal samples but cannot repair missing geometry or poor calibration.
- Identical completed studies may be faster from a bounded in-memory cache. A reload, eviction, property revision, geometry transform, date, tier, grid, or other input change requires new work.

### Annual PV calculation

- A full PV calculation generates 60-minute clear-sky samples for all 365 or 366 local calendar days. The reference acceptance run took about 19 seconds; browser and device performance varies.
- Supported browsers generate a previously uncached year in a module Worker so the 3D UI remains responsive. Without Worker support, the synchronous fallback can temporarily reduce responsiveness. A Worker runtime error is surfaced to the user rather than silently relabeled as a result.
- A prior **Calculate Annual Summary** result is reused, but that daylight summary itself is currently generated on the main thread.
- Without completed model exposure, the PV result is explicitly unshaded. With exposure, one selected-day sun fraction is extrapolated over the year; a selected zone uses its nearest representative grid point rather than the report's area mean, and seasonal shade change is not calculated.
- Low and high values are assumption multipliers, not statistical confidence bounds. The viewer does not supply climate factors, measured weather, detailed equipment response, electrical design, utility rates, or financial payback.

### Public downloads and access control

- Home Solar Tracker is a static application. A deployed `property.json`, GLB, manifest, texture, or report-linked public label is directly downloadable by anyone who can reach its URL.
- `private`, `unlisted`, and `public` registry/package labels are metadata unless the hosting layer separately enforces authentication.
- Disabling address display does not remove coordinates from the configuration. Public-exact coordinates are intentionally readable; public-rounded coordinates still reveal an approximate area and reduce solar-location accuracy.
- Privacy audits use conservative patterns and limited GLB metadata/image cues. They cannot prove anonymity, detect every identifying texture or binary payload, or establish redistribution rights.
- Share links reproduce controls and revision identity; they do not carry completed exposure grids, access credentials, or private server-side state.

### Analysis and reporting

- **Calculate Annual Summary** covers daylight geometry, not annual model occlusion, expected weather, or electricity production. The separate optional PV panel performs a qualified clear-sky irradiance/energy planning calculation.
- Model exposure estimates direct-sun hours for one selected date. Diffuse sky light and material transmission are not modeled.
- JSON/CSV reports are privacy-minimized summaries, not evidence-grade calculations. Area-zone results depend on grid coverage; `area-representative-fallback` is one nearby sample, not an area mean.
- Report construction injects the selected registry slug and revision, including for the schema-v1 demo. Reports still omit exact coordinates, asset URLs, raw exposure grids, and the optional PV estimate.

### Local diagnostics

- Diagnostics are limited to the current page session and the newest 200 redacted events. Reloading discards them; they are not durable monitoring.
- The viewer records configuration, model, first-render, and exposure stages, not every UI action or the PV Worker duration.
- Redaction is conservative but heuristic. A downloaded file should still be reviewed before it is shared.
- The default viewer deliberately supplies no transport. **Download diagnostics** creates a local file only after the user clicks; it does not send the file to support or any server.

No limitation should be hidden by selecting a higher quality tier or a more precise coordinate mode. Release decisions must preserve the displayed planning-use qualification.
