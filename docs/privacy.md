# Privacy guidance

Property models can reveal a home’s shape, entrances, landscaping, and exact location. Treat them as potentially sensitive.

## Privacy modes

Property export uses one of three explicit modes:

- **`local`** keeps the original coordinates for local solar calculations. It is not a publication approval and does not require a redistribution acknowledgement.
- **`public-rounded`** rounds latitude and longitude before writing `property.json`. Two decimal places is the default (roughly neighborhood scale, with distance varying by latitude). It requires acknowledgement that every packaged asset may be redistributed.
- **`public-exact`** writes the original coordinates. It requires both the redistribution acknowledgement and a separate acknowledgement that exact coordinates will be downloadable by anyone who can reach the deployment.

All exported modes keep `location.showExactLocation` and `privacy.showAddress` off. Those flags control the interface only; they do not remove coordinates from `property.json`.

## Public defaults

- Use a regional `displayLabel`, not a street address.
- Keep `location.showExactLocation` and `privacy.showAddress` set to `false`.
- Remove identifying filenames, embedded GLB metadata, photographs, parcel identifiers, and raw survey files from public packages.
- Publish only the optimized GLB needed by the viewer; do not publish LAS/LAZ, source GeoJSON, or high-resolution CAD unless intended.
- Confirm that source GIS, LiDAR, imagery, textures, and fonts permit redistribution.

The publishing preflight also checks for:

- address-like titles, descriptions, and public labels;
- potentially identifying asset filenames;
- remote, unsafe, traversal, or non-allowlisted asset references;
- raw LAS/LAZ, GIS, GeoJSON, survey, point-cloud, and CAD source extensions;
- sensitive names and keys in the JSON metadata chunk of GLB 2.0 files; and
- embedded or referenced GLB images that need a manual review for photographs, labels, and metadata cues.

These checks are conservative heuristics, not proof of anonymity. Geometry can reveal a property even when every string and image is removed. The audit does not decode every texture, inspect arbitrary binary payloads, or establish that an asset’s license permits redistribution.

Coordinates remain present in `property.json` because accurate solar calculations require them. Hiding coordinates in the interface is not anonymization: anyone who can download the configuration can inspect them. For stronger privacy, round coordinates to a tolerable regional precision and document the resulting accuracy tradeoff, or keep the deployment private.

The release validator also scans deployable UTF-8 text for plausible latitude/longitude pairs where both values carry four or more decimal places. This catches precise pairs copied into HTML, JavaScript, JSON, Markdown, or text examples without echoing the values into its report. Coarse documentation placeholders, normalized values near zero, ignored test fixtures, and the separately approved `properties/demo/property.json` scope remain valid. Any additional exception must name one exact deploy-relative file with `--allow-precise-coordinate-text`; the validator records that approval and blocks missing, unsafe, non-text, or unused exceptions.

The setup wizard performs no uploads. Deployment is a separate, explicit action.

## Packaging CLI

The existing local command remains valid. It now also writes a coordinate-free `package-manifest.json` containing the privacy mode, acknowledgement state, export allowlist, asset sizes, and preflight warning codes.

Create a rounded public package:

```bash
python3 scripts/package_property.py \
  --slug garden-demo \
  --title "Fictional Garden Study" \
  --model path/to/model.glb \
  --latitude 40.0 \
  --longitude -105.0 \
  --time-zone America/Denver \
  --display-label "Fictional example region" \
  --privacy-mode public-rounded \
  --coordinate-decimals 2 \
  --acknowledge-license \
  --sha256-manifest
```

Create an exact-coordinate public package only after reviewing the disclosure:

```bash
python3 scripts/package_property.py \
  --slug exact-study \
  --title "Fictional Exact-Mode Study" \
  --model path/to/model.glb \
  --latitude 40.0 \
  --longitude -105.0 \
  --time-zone America/Denver \
  --display-label "Fictional example region" \
  --privacy-mode public-exact \
  --acknowledge-license \
  --acknowledge-exact-location
```

Both examples deliberately use coarse, fictional documentation coordinates. Replace them only in a private working copy, and never place a real precise pair in repository documentation or another deployable text file.

`--asset-allow <relative-path>` adds a safe packaged path to the manifest allowlist. Raw source extensions and paths containing traversal are rejected. The standard `model.glb`, `property.json`, and `package-manifest.json` assets are allowlisted automatically.

`--sha256-manifest` adds SHA-256 digests for `model.glb` and `property.json`. Hashes help recipients confirm integrity; they do not make the package private or prove that an asset is safe or licensed.

## Browser-side API

`src/privacy-audit.js` provides the dependency-free preflight used by browser workflows. `src/property-io.js` applies coordinate rounding, forces public display flags off, and creates a safe manifest without copying coordinates, labels, original source paths, or GLB metadata into that manifest. A future configurator can call `preparePropertyExport(...)` without changing the viewer’s property schema.

## Share source on public GitHub

Deployment exclusions do not protect a public Git repository. Every committed file and every historical commit may be cloned, including source scripts, binary models, author names, and commit email addresses.

For this handoff, use `python3 scripts/export_public_source.py`. It exports the reviewed current source into `output/public-source/home-solar-tracker-source.zip`, with a size/hash inventory. The archive has no `.git`, raw sources, local house packages, environment files, or extra models. The default GLB must reproduce exactly from the fictional primitive generator. When a private marker policy exists at ignored `data/private/sensitive-markers.json`, known personal text and old model hashes block the export. This policy stays local and must not be added to GitHub.

The current checkout's older history contains personal property files. Deleting them in a new commit does not remove them from older commits. Do not push that history. Publish the clean source snapshot as a fresh repository history, using a public pseudonym and a GitHub no-reply email for commit attribution. If a destination already has branches, inspect its contents and history before choosing any migration; do not force-push by default.

The source export audit covers the files it inventories. It does not certify every future file as anonymous. Keep personal house data outside the public source, reopen ZIPs locally, and repeat both the source audit and public-asset validator before publishing changes.
