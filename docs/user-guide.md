# Home Solar Tracker user guide

This guide is for a homeowner, friend, gardener, designer, or neighbor opening an Home Solar Tracker solar study. You do not need 3D or solar-analysis experience.

## What this viewer can answer

Home Solar Tracker can help you explore questions such as:

- Where will the Sun be at a particular local date and time?
- How do winter and summer daylight paths differ?
- Which parts of the modeled yard receive more or less direct Sun?
- What view, date, and zone did the person who shared this link intend me to see?

It is a planning aid, not a field measurement. The result is only as good as the model's size, position, north direction, terrain, and included obstructions. It does not automatically know about current clouds, seasonal leaves, a neighbor's unmodeled tree, or a future addition.

For a private house on your own computer, follow the [garden quickstart](friend-garden-quickstart.md): start `scripts/serve.py`, open `?local=1`, and choose your ZIP. No registry edit is required.

## Open a shared study

1. Open the link you received in a current desktop or mobile browser.
2. Wait for the house model and the **Controls** button to appear.
3. If the view is not the one you expected, ask the sender to use **Copy Share Link** again after setting the study. A complete share link normally contains a property and revision, such as `?property=demo&v=fictional-1`.

A revision identifies the version of the model and configuration. This matters when comparing notes: two people should use the same revision before deciding that their shadows differ.

Anyone who can open a public Home Solar Tracker link may also be able to download its model and property configuration. An “unlisted” label is not a password.

## Move around the model

Use the canvas to orbit, pan, and zoom with the pointer or touch gestures supported by your browser. If you prefer a prepared angle:

1. Open **Controls**.
2. Choose the **Views** tab.
3. Select one of the named property views, such as **Street View**, **Garden Top**, **Rear Walkout**, **Sky View**, or **3D Orbit**.

**Auto Spin** and **Play 20s Demo Reel** are presentation aids. They are disabled when your device requests reduced motion. The solar study itself does not require animation.

## Check a date and time

1. In **Controls**, choose the **Sun & Shade** tab.
2. Set **Date**, or choose **Summer (Jun 21)**, **Today**, or **Winter (Dec 21)**.
3. Drag the local-time slider. The viewer updates the Sun and cast shadows for the property's local time zone.
4. Read the sunrise, sunset, daylight, solar altitude, and azimuth values.
5. Turn on **Sun Arc** to show the selected day's solar path.
6. Turn on **Compass** when you need an orientation reference.

The animated shadow is a geometric simulation. It is not a photograph or weather forecast. A correctly placed shadow still depends on a correctly calibrated model.

## Compare two seasons

The quickest useful comparison is often a solstice-to-solstice check.

1. Scroll to **Solar Study** in the **Sun & Shade** tab.
2. Under **Compare dates**, enable **Show second solar path**.
3. Choose **June solstice**, **December solstice**, either equinox, or **Custom date**.
4. Compare the gold primary path with the blue comparison path.
5. Use the table to compare sunrise, solar noon, sunset, and total daylight.

The comparison is calculated astronomical geometry. It does not run a second model-occlusion analysis. Use **Run Model Exposure** separately for the primary date when modeled shade matters.

## Use a decision zone

A property author may define named places such as a garden bed, patio, window, or possible PV area.

1. Open the **Study zone** list.
2. Choose a named zone, or select **Whole property**.
3. Continue changing the date, time, view, and comparison settings.
4. Use **Copy Share Link** so your zone choice travels with the link.

Zones can be points, rectangles, or polygons. Their author may also record a desired number of daily sunlight hours and a preferred local-time window. These are planning goals, not guarantees, and the viewer's red/amber/green/blue categories remain general-purpose bands.

After you complete **Run Model Exposure**, exported reports summarize every authored zone. Rectangle and polygon results average the exposure grid-point centers inside the area. A point uses its nearest grid point. If no grid-point center falls inside a rectangle or polygon, the report uses the nearest point to the area's representative location and labels the method `area-representative-fallback`. That fallback is not an area average; try a finer exposure tier or review the zone size and placement when the distinction matters.

## Understand Sun Map and model exposure

**Ground Sun Map** starts neutral with no hours assigned. Opening it or choosing **Run Model Exposure** calculates ground sunlight for the loaded model and selected date.

For model-derived direct Sun:

1. Select an **Exposure quality**:
   - **Quick** for a fast first pass;
   - **Standard** for the normal balance of detail and wait time; or
   - **High** for a finer pass after you trust the model calibration.
2. Choose **Run Model Exposure**.
3. Watch the progress indicator. You can choose **Cancel** at any time.
4. When complete, read the status line for the tier, sampling interval, maximum hours, and whether the result came from a worker, synchronous fallback, or cache.

The colors mean:

- red: 8 or more modeled direct-sun hours;
- amber: 6 to 8 hours;
- green: 3 to 6 hours; and
- blue: under 3 hours.

This calculation treats model triangles as opaque blockers. Transparent or leaf textures can therefore shade differently from real life. Missing trees, fences, neighboring buildings, terrain, or horizon features cannot cast modeled shade. The calculation measures direct-sun opportunity, not diffuse light, plant health, indoor comfort, or PV production.

The first exposure run on a large model may take noticeably longer because the viewer must prepare the model geometry. **High** also performs many more ray checks than **Quick**. Repeating the same study during the same browser session may be faster because completed results are cached in memory.

## Calculate an annual daylight summary

Choose **Calculate Annual Summary** to calculate one-hour astronomical samples for every day in the year selected by the primary date. The summary reports average daylight and the year's shortest and longest days.

This is an annual daylight-geometry summary. It is not an annual model-exposure run, a weather simulation, or an electricity forecast.

## Explore an optional PV planning estimate

Open **PV planning estimate (optional)** only when you want an annual photovoltaic opportunity range. The panel may open automatically when the selected decision zone has the **Solar PV** purpose.

1. Under **System input**, choose **DC rating (kW)** or **Array area + efficiency**.
2. Enter the system rating, or the active module area and module efficiency.
3. Set **Plane tilt (0–90°)**, **Plane azimuth (0–359°, 180° south)**, and **System losses (%)**.
4. Choose **Calculate PV planning estimate**.
5. Read the **Estimated annual photovoltaic energy range**, plus **Source**, **Qualification**, **Limitations**, and **Assumptions**.

The panel initially says **Calculating clear-sky annual geometry…**. When it must build a complete year from scratch, a supported browser performs that work in a module Worker so the 3D viewer stays responsive. The full acceptance run took about 19 seconds; your device and browser may be faster or slower. Previously calculated annual geometry is reused.

Without a completed **Run Model Exposure** result, the PV estimate is clear-sky and unshaded. With a result, Home Solar Tracker applies one coarse model-derived direct-sun fraction from the selected date across the annual clear-sky geometry. It uses the same supported ground-zone mean or qualified nearest-point fallback as the details and reports, or a whole-property average when no zone is active. Roof, window, and elevated zones do not supply a ground shade factor. The one-day extrapolation does not reproduce changing seasonal shadows.

The displayed low, central, and high values are a planning range, not a statistical confidence interval or production promise. The estimate does not fetch weather and does not model equipment temperature, inverter clipping, snow, soiling, degradation, construction, electrical design, or utility billing. A completed PV estimate is not currently included in **Export JSON** or **Export CSV**; save the displayed assumptions separately if you need to reproduce it.

## Save or share your result

### Copy a study link

Choose **Copy Share Link** after setting the property, date, time, view, study zone, overlays, playback speed, and comparison date. If clipboard access is unavailable, the viewer tells you to copy the browser address instead.

The link stores visible study state in its query string. It does not store a screenshot or a completed exposure grid. A recipient may need to choose **Run Model Exposure** again.

### Export a report

Choose **Export JSON** for a structured summary or **Export CSV** for a compact table. Reports are planning-use-only and omit exact coordinates and model asset URLs. A JSON report includes the registry property revision, selected zone identifier, and, when available, daylight, comparison, annual, completed exposure, and decision-zone summaries. CSV includes the zone method, geometry type, grid-point count, representative point, and qualification. Neither format contains the GLB, a screenshot, or the optional PV estimate.

Review a downloaded report before forwarding it. It still identifies the property package, registry revision, title, public display region, date, and study settings.

### Download local diagnostics

Choose **Download diagnostics** only when you want a troubleshooting file. The adjacent note reads: **Diagnostics stay in this browser memory and download only when you choose. Coordinates and model metadata are redacted; nothing is sent.**

The JSON contains up to 200 redacted events from the current page session: configuration, model loading, first render, exposure timings, and categorized errors with correlation IDs. Reloading clears the in-memory log. The normal viewer has no diagnostics server transport, analytics upload, automatic download, or browser-storage persistence.

Redaction removes coordinates, address-like strings, filesystem paths, URL query values and secrets, and model metadata before events are stored. It is still prudent to review the file before sending it to someone. The successful status confirms how many events were downloaded and ends with **Nothing was sent.**

## Build a package for another property

The local builder is meant for the property owner or package author.

1. Run the local server described in the project README and open `/configure/`.
2. Choose the local GLB. The app previews it in your browser and does not upload it.
3. Enter the package label, revision, location, and time zone.
4. Calibrate model units and scale, true north, XYZ origin, and ground bounds.
5. Use **Set north from two known points** only when you know a directed line in the model and its real compass bearing.
6. Review **Calibration QA**. “Pass” means the configured values pass the implemented consistency checks; it is not survey certification.
7. Add or edit decision zones with numeric X/Z coordinates and elevation.
8. Choose a privacy mode and review every preflight finding.
9. Choose **Export complete ZIP**.

The ZIP contains `property.json`, `model.glb`, `manifest.json`, and `README.md`. Nothing is published automatically. Open it locally with `?local=1`. Save drafts with **Save draft ZIP** and restore them with **Reopen ZIP** in the builder. Complete-study export requires a successful preview, no calibration QA errors, and your calibration review checkbox. Publishing is a separate, deliberate release workflow.

## Choose a privacy mode

- **Local only** keeps exact coordinates for local solar calculations. It is not permission to publish.
- **Public — rounded coordinates** reduces coordinate precision and requires confirmation that every included asset may be redistributed. Rounding improves privacy but moves the calculated solar location.
- **Public — exact coordinates** keeps exact coordinates and requires both the redistribution confirmation and a separate acknowledgement that anyone with deployment access can download them.

Turning off an address display does not remove coordinates from `property.json`. The shape of the house, textures, entrances, parcel layout, embedded model metadata, or filenames can also identify a property. Privacy preflight is a helpful warning system, not proof of anonymity or proof of a license.

## Troubleshooting

### The page does not load from a local file

Use a local HTTP server; do not use a `file://` URL. The viewer needs module and JSON requests that browsers block for local files.

### The wrong property opens

The requested slug or revision may not be registered. Check that the link contains the intended `property` and `v` values. The viewer shows a visible warning when it falls back to its default. Those results are for the fallback house; open your ZIP or correct the link before using them.

### The Ground Sun Map says “Not calculated”

Choose **Run Model Exposure**. No preset hours are assigned. If the model failed to load, open the correct ZIP or fix its model asset before interpreting sunlight.

### Exposure is slow

Choose **Quick**, especially for a first run or large GLB. Let the first geometry preparation finish, reduce model complexity before publication, or choose **Cancel**. High quality cannot repair an incorrectly aligned or incomplete model.

### A tree or building casts no shade

It probably is not present in the GLB, lies outside the modeled horizon, or was simplified out. Home Solar Tracker does not fetch nearby structures or vegetation automatically.

### Shadows point the wrong way

Confirm the package location, IANA time zone, daylight-saving date, and true-north offset. Then verify model scale and placement. A visual solar-noon check can catch a large error but does not replace a reliable bearing.

### A shared link does not show a completed exposure result

Links preserve controls, not the calculated grid. Select the same exposure tier and run the model exposure again.

### The PV calculation takes several seconds

A full year contains 365 or 366 days of 60-minute solar samples. From scratch, the supported-browser Worker may run for about 19 seconds on the acceptance device. Keep the tab open; the 3D viewer should remain responsive. If it fails, verify the numeric inputs and try a current browser with module Worker support. When Worker support is absent, the calculation has a synchronous fallback that can make the page less responsive.

For package-author details, see [property packages](../properties/README.md), [privacy guidance](privacy.md), and [model calibration](model-calibration.md).

Ground-only scope: minimum daily-hour targets are checked after calculation; preferred time windows are not assessed. Roofs, windows, and elevated surfaces show no ground sunlight result.
