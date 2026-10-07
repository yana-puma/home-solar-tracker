# Model generation and property packaging

The reusable path is the generic point-cloud pipeline in `scripts/pipeline.py`.
It can ingest a local LAS/LAZ file, query USGS 3DEP by bounding box, or generate
synthetic demo input. After reconstruction it exports OBJ, GLB, and STL files.

## Export and package in one run

Supplying `--property-slug` turns on packaging after a successful GLB export.
The title, coordinates, and IANA time zone are required only in this mode:

```bash
python scripts/pipeline.py \
  --input-las path/to/survey.laz \
  --name garden-model \
  --property-slug garden-demo \
  --property-title "Garden Solar Study" \
  --latitude 38.8 \
  --longitude -77.2 \
  --time-zone America/New_York \
  --display-label "Northern Virginia" \
  --north-offset 12
```

This creates `properties/garden-demo/model.glb` and
`properties/garden-demo/property.json`. Existing package directories are never
overwritten. The public configuration hides exact-location and address display
by default; use a broad `--display-label` rather than a street address.

## Package an existing GLB

The same operation is available without running reconstruction:

```bash
python scripts/package_property.py \
  --slug garden-demo \
  --title "Garden Solar Study" \
  --model output/garden-model.glb \
  --latitude 38.8 \
  --longitude -77.2 \
  --time-zone America/New_York
```

Python callers can import `create_property_package(...)` and pass an
`output_root` for automation or testing.

## Coordinate and source safety

The generic source convention is east/north/up. GLB export converts it to the viewer's −X east, −Z north, Y up convention; OBJ/STL retain the source axes. Check survey units, CRS, and true-north alignment before interpreting shade.

Bounding-box EPQS queries supply terrain only and cannot supply the buildings or trees needed for house shade. Offline/empty acquisition fails without synthetic substitution. Use `--demo` explicitly for fictional test data; terrain-only and synthetic input cannot be packaged as a real property by the pipeline.

Private property-specific reconstruction scripts and old house assets are intentionally absent from public source. The default sample is generated from invented primitives by `scripts/generate_demo.py`. For a private house, prefer the local builder and ignored local package workflow described in the garden quickstart. The CLI examples above write to the public `properties/` tree and require deliberate release review; display flags do not protect those files.
