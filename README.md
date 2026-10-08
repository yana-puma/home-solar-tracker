# Home Solar Tracker

[Open the live fictional garden sample](https://home-solar-tracker.vercel.app/). You can also open a house ZIP locally in the browser; choosing a ZIP does not upload it.

Home Solar Tracker is a static 3D viewer for exploring how the Sun moves across a property during the year. It combines a calibrated GLB house model with local date, time, coordinates, and time-zone settings to show cast shadows, solar paths, daylight comparisons, model-derived direct-sun exposure, and an optional clear-sky PV planning range.

It is designed for homeowner questions such as:

- How different are the winter and summer solar paths?
- When does a patio, window, garden bed, or possible PV area receive direct Sun?
- Which view and study settings should I send to a friend?
- Can I package another property without changing the viewer code?

The included demo is an invented house, trees, fence, patio, and garden made from procedural primitives. It uses no personal house geometry, surveys, photos, or textures. Regenerate it with `python3 scripts/generate_demo.py`. Other properties can open from a private local ZIP or a registered static package. For a friend cloning this repository, start with the [garden quickstart](docs/friend-garden-quickstart.md).

> Home Solar Tracker produces planning estimates. It is not a survey, a measured site condition, a professional solar-access assessment, a code-compliance result, or an energy-production guarantee. Results depend on location, time zone, model completeness, scale, placement, true-north calibration, terrain, and sampling choices. Live weather, clouds, and unmodeled vegetation or neighboring obstructions are not included.

## Run locally

Home Solar Tracker has no application build step. From the repository root, serve the files over HTTP:

```bash
python3 scripts/serve.py
```

On Windows, use `py -3 scripts/serve.py`. The launcher serves viewer assets only, on loopback, and hides raw sources, scripts, dotfiles, and directory listings. No scientific Python libraries are needed.

Then open:

- your private house ZIP: `http://127.0.0.1:8080/?local=1`
- demo viewer: `http://127.0.0.1:8080/?property=demo`
- local property builder: `http://localhost:8080/configure/`

Do not open `index.html` with a `file://` URL. Browsers restrict the module and data requests the viewer needs. The current viewer and configurator load pinned Three.js modules from `unpkg.com`, so their first load also requires network access.

## Explore and share a study

Open **Controls**, then use the **Sun & Shade** tab to change the date and local time. The Summer, Today, and Winter shortcuts provide fast seasonal checks. **Sun Arc** shows the path for the primary date; **Compass** helps inspect orientation; **Ground Sun Map** starts neutral with no hours assigned; opening it or choosing **Run Model Exposure** calculates ground exposure from the loaded model.

The **Solar Study** section adds the analysis workflow:

1. Choose a **Study zone**, or leave **Whole property** selected.
2. Under **Compare dates**, enable **Show second solar path** and choose an equinox, solstice, or custom date.
3. Read the calculated sunrise, solar noon, sunset, and daylight table.
4. Optionally select an **Exposure quality** tier and choose **Run Model Exposure** for model-derived direct-sun sampling on the primary date.
5. Choose **Calculate Annual Summary** for the selected year's astronomical daylight summary.
6. Optionally open **PV planning estimate (optional)**, enter system assumptions, and choose **Calculate PV planning estimate**.
7. Download a privacy-minimized study summary with **Export JSON** or **Export CSV**.
8. If troubleshooting is needed, choose **Download diagnostics** to save the redacted in-memory event log; nothing is sent.

Use **Copy Share Link** after choosing the property, date, time, camera, zone, overlays, exposure quality, playback speed, and comparison date. For a local ZIP, the link shares settings and the recipient must choose the same ZIP; geometry stays local. A registered property link includes both its property slug and revision, for example:

```text
?property=demo&v=fictional-1
```

That revision pin makes a shared study repeatable. State is encoded in the URL; no server account or database is involved. See the [friend and homeowner guide](docs/user-guide.md) for a nontechnical walkthrough and [property registry documentation](docs/sharing.md) for the complete URL contract.

## Exposure tiers

Model exposure samples rays from a ground grid toward the calculated Sun and tests them against the loaded model. It measures modeled direct Sun, not diffuse sky light or expected weather.

| Tier | Ground grid | Time interval | Best use |
| --- | ---: | ---: | --- |
| Quick | 12 × 16 | 60 minutes | Fast orientation and workflow checks |
| Standard | 20 × 28 | 30 minutes | Normal homeowner comparisons |
| High | 32 × 44 | 15 minutes | Finer review after calibration and model completeness are trusted |

Denser grids and shorter intervals increase work multiplicatively. The first analysis of a large GLB also has to serialize its model triangles; later identical studies may use the bounded in-memory cache. **Cancel** stops an active calculation. [Exposure methodology and limits](docs/exposure.md) describes the calculation contract.

The viewer labels result colors as:

- red: 8 or more direct-sun hours;
- amber: 6 to 8 hours;
- green: 3 to 6 hours; and
- blue: under 3 hours.

These bands are general presentation categories, not crop-, room-, or equipment-specific requirements. A property's ground zones may include a minimum daily-hour target, which is checked against the daily mean. Preferred time windows are recorded but not assessed. Roofs, windows, and elevated surfaces receive no ground result.

After model exposure completes, JSON and CSV reports aggregate rectangle and polygon zones from grid-point centers inside each authored area. Point zones use the nearest grid point. If an area contains no grid-point center, the report explicitly uses `area-representative-fallback`: the nearest grid point to the zone's representative point, qualified as not being an area average.

## Optional PV planning estimate

Open **PV planning estimate (optional)** to explore a low, central, and high annual energy range. Choose either **DC rating (kW)** or **Array area + efficiency**, then set plane tilt, plane azimuth, and aggregate system losses. The result lists its source, qualification, limitations, and assumptions.

This is a clear-sky planning calculation, not measured or utility-grade output. Without a completed model exposure run it is unshaded. When exposure is available, the viewer applies a coarse direct-sun fraction from the selected date—using the same qualified ground-zone summary shown in details and reports when supported, otherwise a whole-property average when no zone is selected—across the full year's clear-sky geometry. It does not model seasonal obstruction changes, clouds, temperature, clipping, snow, soiling, degradation, or electrical design.

Generating the full 60-minute annual geometry from scratch runs in a module Worker on supported browsers so the viewer remains responsive. The acceptance run took about 19 seconds; actual time depends on the browser and device. If annual geometry was already calculated, it is reused.

## Local diagnostics

**Download diagnostics** is an explicit local JSON download. Home Solar Tracker retains at most 200 redacted events in browser memory for configuration, model loading, first render, exposure timing, and categorized errors. Reloading clears the log. The default viewer has no diagnostics transport, telemetry endpoint, automatic upload, browser-storage persistence, or background export.

Coordinates, address-like strings, URL query values, filesystem paths, secrets, and model metadata are redacted before events enter memory. Redaction reduces accidental disclosure but is not proof that arbitrary text is anonymous; review the downloaded file before sharing it. See [local diagnostics and observability](docs/observability.md).

## Build a local property ZIP

Open `/configure/` through the local server. The builder keeps the chosen GLB and configuration in the browser; it does not upload them. You can:

- import schema-v1 or schema-v2 `property.json`;
- choose and preview a local GLB;
- calibrate units, scale, true-north offset, XYZ origin, and ground bounds;
- review calibration QA and use the optional two-point bearing helper;
- add point, rectangle, and polygon decision zones;
- run privacy and license preflight; and
- export `property.json` or a complete ZIP.

**Export complete ZIP** creates an uncompressed, deterministic archive containing exactly:

```text
property.json
model.glb
manifest.json
README.md
```

The manifest records the privacy mode, acknowledgements, asset allowlist, sizes, and SHA-256 hashes without copying coordinates or source filenames into the manifest. The ZIP is not automatically published.

Open the exported ZIP with `?local=1`; no extraction or registry editing is needed. **Save draft ZIP** and **Reopen ZIP** preserve a working model, calibration, and zones. Complete-study export requires a successful preview, calibration QA without errors, your calibration review, and privacy preflight. A new property starts with flat terrain and no demo zones or cameras.

For repeated local use without choosing a ZIP each time, install it with Node 22 or later:

```bash
node scripts/install-property.mjs /path/to/house-package.zip
```

The installer verifies schema, ZIP paths, sizes, SHA-256 hashes, and embedded model resources. It writes immutable revisions under ignored `local-properties/`, updates the private registry atomically, and prints a `registry=local` link. It refuses overwrite. `--public` is reserved for explicitly reviewed public packages and still requires the public release gates; see [property package authoring](properties/README.md).

The schema-v1 CLI remains available for simple packages:

```bash
python3 scripts/package_property.py \
  --slug garden-demo \
  --title "Fictional Garden Study" \
  --model path/to/model.glb \
  --latitude 40.0 \
  --longitude -105.0 \
  --time-zone America/Denver \
  --display-label "Fictional example region"
```

The deliberately coarse coordinates above are documentation placeholders, not a real property. The CLI creates `properties/garden-demo/` and refuses to overwrite an existing package. Register the new folder before opening it by property slug.

## Privacy modes

| Mode | Coordinate handling | Required acknowledgement | Intended use |
| --- | --- | --- | --- |
| `local` | Exact coordinates retained | None | Private local study; not publication approval |
| `public-rounded` | Coordinates rounded, two decimals by default | Redistribution rights for every included asset | Neighborhood-scale public study with an accuracy tradeoff |
| `public-exact` | Exact coordinates retained | Redistribution rights and explicit exact-location disclosure | Public study only after accepting that the coordinates are downloadable |

Public modes force address and exact-location display flags off, but interface flags are not access control. Anyone who can reach a static deployment can download its `property.json`, GLB, and textures. Geometry or imagery may still identify a house even when labels and coordinates are rounded. Review [privacy guidance](docs/privacy.md) before sharing any real property.

## Repository and deployment safety

- Keep house ZIPs, source surveys, LAS/LAZ, GIS, CAD, photos, private exports, and local environment files outside the deployable tree. `local-properties/` is ignored by Git and deployment. `.vercelignore` excludes known private inputs, build tools, tests, and documentation, but it does not replace human review.
- `privacyTier` values such as `unlisted` are metadata, not authentication.
- Only `properties/demo/model.glb` is in the validator's default public-model allowlist. Every additional public GLB needs an explicit release-scope decision.
- Never replace bytes at a revisioned or hash-bearing immutable URL. Publish a new revision or content hash, update size/integrity metadata, and then update the revalidated registry entry.
- Confirm redistribution rights for the model, embedded textures, elevation data, fonts, and every third-party source.
- Review the actual deployment file list and preview URL before promotion. UI hiding cannot secure a public static asset.

The detailed operational checklist is in [docs/release-checklist.md](docs/release-checklist.md).

Public GitHub clones include history, unlike a static deployment. For the initial clean handoff, use `python3 scripts/export_public_source.py` and publish the resulting snapshot with fresh Git history. The old checkout history must remain private. See [source privacy](docs/privacy.md#share-source-on-public-github).

## Test and release commands

Run all commands from the repository root:

```bash
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/validate_package.py .
python3 scripts/validate_package.py . --json --output /tmp/atlee-asset-report.json
```

The first two commands run the JavaScript and Python suites. The validator exits nonzero for release blockers and inventories deployable assets, GLB integrity and approximate triangle counts, v2 size/SRI declarations, registry targets, unsafe paths, secrets, raw sources, precise coordinate pairs in deployable text, and unapproved public models.

For a separately approved model, add its deploy-relative path explicitly:

```bash
python3 scripts/validate_package.py . \
  --allow-public-glb properties/garden-demo/model.glb
```

An allowlist flag records release scope; it does not bypass privacy, integrity, size, URL, or raw-source checks. Complete the [product acceptance scenarios](docs/product-acceptance.md) and [release checklist](docs/release-checklist.md) before publishing.

## Modeling pipeline

The viewer and builder do not require the scientific pipeline. When processing surveys, use a separate environment with the dependencies in `requirements.txt`. Generic source data uses east/north/up axes; GLB export converts it to the viewer’s −X east, −Z north, Y up axes, while OBJ/STL retain source axes. Verify survey units, CRS, and grid-to-true-north alignment before using the result. Existing viewer-axis meshes can opt into `source_axes="viewer"` in the export function.

USGS bounding-box elevation sampling supplies **terrain only**, not buildings or trees. Acquisition failures stop without synthetic substitution. Real-property packaging rejects terrain-only bounding boxes and fictional demo inputs. Synthetic generation requires explicit `--demo`. Never treat demo output as a survey of the friend’s house.

## Documentation

- [Friend’s garden quickstart](docs/friend-garden-quickstart.md)
- [Execution plan and continuation checkpoint](docs/project-review-2026-10-07.md)
- [User guide](docs/user-guide.md)
- [Product acceptance and release gates](docs/product-acceptance.md)
- [Property packages and decision zones](properties/README.md)
- [Property registry and share URLs](docs/sharing.md)
- [Privacy guidance](docs/privacy.md)
- [Solar calculation accuracy](docs/solar-accuracy.md)
- [Model-derived exposure](docs/exposure.md)
- [Model calibration and QA](docs/model-calibration.md)
- [Clear-sky irradiance and PV planning](docs/irradiance.md)
- [Local diagnostics and observability](docs/observability.md)
- [Architecture and trust boundaries](docs/architecture.md)
