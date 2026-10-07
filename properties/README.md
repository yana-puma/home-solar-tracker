> For private local use, open the complete builder ZIP with `?local=1`, or run `node scripts/install-property.mjs package.zip` (Node 22+). The installer uses ignored `local-properties/`, validates hashes and paths, creates immutable revision folders, and prints the exact local link. Do not commit private files. The public registry workflow below is only for deliberately reviewed public assets; the installer’s `--public` flag does not publish or bypass release gates.

# Property packages

Each folder contains one portable viewer configuration and its allowlisted assets. New browser-built packages use the strict schema-v2 contract.

Open a package with `/?property=<folder-name>`. The default package is `demo`.

Keep exact addresses out of package labels, display labels, revisions, filenames, and embedded GLB metadata. The viewer still needs latitude and longitude for solar calculations. Hiding them in the interface does not remove them from a downloadable `property.json`.

Create packages through `/configure/` or with `scripts/package_property.py`.

## Local browser builder

Open `/configure/` over local HTTP. The builder does not upload files and can:

- import an existing schema-v1 or schema-v2 `property.json` and normalize it to authored v2;
- choose and preview a local GLB;
- calibrate model scale, north offset, XYZ origin, and ground bounds;
- edit package ID, label, revision, location, timezone, precision, and solar sampling;
- author point, rectangle, and polygon decision zones in model-local coordinates;
- select `local`, `public-rounded`, or `public-exact` privacy mode;
- show schema and privacy findings before export; and
- export either `property.json` or a complete dependency-free ZIP.

A complete ZIP contains exactly:

```text
property.json
model.glb
manifest.json
README.md
```

The ZIP uses deterministic, uncompressed entries so the same inputs produce the same bytes. `manifest.json` contains the privacy mode, acknowledgements, allowlist, byte sizes, and SHA-256 hashes without repeating coordinates, labels, or original source filenames.

## Calibration workflow

1. Choose the GLB and use **Fit view**.
2. Set the model units and scale.
3. Set north offset so model north agrees with true north.
4. Edit XYZ origin, or use **Center model on ground** as a starting point.
5. Use **Use model bounds**, then expand the ground rectangle if the solar study needs surrounding yard space.
6. Review the schema and privacy panels before downloading.

The calibration buttons update only the in-memory preview and exported configuration. They do not modify the source GLB.

When a directed line and its real compass bearing are known, **Set north from two known points** calculates the offset using the viewer's `-Z` north and `-X` east convention. The local calibration QA summary checks origin, ground coverage, model containment when a GLB is loaded, and camera presets; review its findings before relying on zone results.

## Decision zones

Decision zones describe places where a homeowner wants a solar answer, such as a garden bed, patio, window, or possible PV area. The configurator provides a keyboard-accessible numeric editor; it does not require canvas picking.

Coordinates are evaluated after the model calibration is applied:

- `X` and `Z` locate geometry on the model-local ground plane;
- `elevation` is model-local `Y`;
- point geometry uses one `x`/`z` pair;
- rectangle geometry uses finite `minX`, `maxX`, `minZ`, and `maxZ` values with each minimum smaller than its maximum; and
- polygon geometry uses at least three finite `[x, z]` vertices around a simple, non-crossing boundary. A repeated closing vertex is accepted and removed during normalization.

Each schema-v2 runtime zone has this stable shape:

```json
{
  "id": "kitchen-garden",
  "title": "Kitchen garden",
  "purpose": "garden",
  "surface": "raised-bed",
  "elevation": 0.5,
  "position": [0, 0.5, 6],
  "geometry": {
    "type": "rectangle",
    "minX": -3,
    "maxX": 3,
    "minZ": 4,
    "maxZ": 8
  },
  "sunlightThresholds": {
    "minimumDailyHours": 6,
    "preferredTimeWindow": {"start": "09:00", "end": "16:00"}
  }
}
```

`purpose` is one of `general`, `garden`, `patio`, `window`, or `pv`. `surface` is a short descriptive value such as `ground`, `roof`, `facade`, or `raised-bed`. `sunlightThresholds` is always present in normalized runtime data and may be empty. Its fields are optional; preferred times use the property's local clock.

`position` is the compatibility/representative `[x, elevation, z]` point: the point itself, the rectangle center, or the polygon area centroid. Existing schema-v1 point zones keep their original authored `position` API and receive additive geometry fields only in `runtimeConfig`. Zone IDs must be unique lowercase slugs.

Zone geometry and thresholds are part of `property.json`, so both JSON export and complete ZIP export retain them.

## Privacy gates

- `local` preserves coordinate precision and marks the package private. It is not approval to publish.
- `public-rounded` rounds coordinates to the selected number of decimals and requires a redistribution-rights acknowledgement.
- `public-exact` preserves exact coordinates and requires both redistribution-rights and exact-location acknowledgements.

Public export always disables address and exact-location display flags, but exact coordinates remain readable in `property.json` for `public-exact`. The preflight is heuristic: geometry and textures can identify a house even when filenames and metadata are clean.

## Install an exported ZIP

Extract the four files into `properties/<package-id>/`, then open:

```text
/?property=<package-id>
```

No JavaScript edit is required. Keep the package ID synchronized with the folder and URL selector.
