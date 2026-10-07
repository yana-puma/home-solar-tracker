# Release checklist

Use this checklist for every public preview or production deployment. The current approved public scope includes `properties/demo/model.glb` and its referenced property configuration. Raw point clouds, survey/GIS/CAD sources, generated source models, local environment files, and the legacy `viewer/` copy are not public artifacts.

## Automated release gate

Run from the repository root:

```bash
python3 scripts/validate_package.py .
python3 scripts/validate_package.py . --json --output asset-report.json
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

`validate_package.py` exits with status 1 when the deployable tree has a release blocker. The JSON report is machine-readable; do not place a generated report containing local absolute paths in the deployment tree.

The default public-model allowlist contains only `properties/demo/model.glb`. After recording a separate approval for another exact model, pass its deployment-relative path with `--allow-public-glb properties/<slug>/model.glb`; this flag does not override raw-source, GLB-integrity, URL, size, or privacy checks.

The gate checks:

- `.vercelignore` exclusions, deployable symlinks, unsafe names, secrets, and raw survey/GIS/CAD formats;
- per-file size limits and duplicate assets (large wasted copies block release);
- GLB 2 header/chunk integrity, embedded image MIME types, byte size, and an approximate triangle count derived from primitive accessor counts;
- v1 model URLs, v2 asset sizes and SRI digests, package-manifest hashes, and property-registry targets;
- traversal-free local asset references and secure treatment of remote references.

Triangle counts are planning estimates. They count indexed or POSITION accessor entries for triangle, strip, and fan primitives; they do not account for degenerate triangles, instancing, mesh compression semantics, or runtime tessellation.

## Public-data and licensing review

- Confirm `properties/demo/model.glb` is still the exact model approved for public release. A new or modified digest requires a new explicit scope decision.
- Confirm the configured coordinate precision, labels, camera views, textures, and GLB metadata do not reveal more than intended.
- Confirm redistribution rights for the GLB, embedded textures, elevation data, and third-party sources.
- Confirm no `.las`, `.laz`, `.obj`, `.ply`, parcel/GIS files, photographs, exports, credentials, or `.env` files appear in the Vercel file list.
- Review every validator warning. HTTPS remote assets cannot be byte-verified by the local release gate.

## Configuration and solar verification

- Load the default registry entry and a second test package without editing JavaScript.
- Confirm missing and invalid configurations produce an understandable, privacy-safe fallback.
- Confirm model scale, position, north offset, scene bounds, cameras, and zones match the property.
- Check representative winter, equinox, and summer dates, plus daylight-saving boundaries.
- Confirm exposure results display their sampling interval and method/provenance label.
- Treat sun position and exposure as planning estimates rather than surveyed or measured guarantees.

## Browser and deployment verification

- Test the viewer with mouse, touch, and keyboard controls at desktop and mobile widths.
- Confirm the viewer and configurator load without uncaught console errors.
- Inspect response headers: there must be no wildcard `Access-Control-Allow-Origin` header.
- Confirm HTML, `properties/index.json`, property configs/manifests, and mutable alias model paths revalidate on every use.
- Confirm only revisioned directories or hash-bearing filenames receive `max-age=31536000, immutable`.
- Confirm the Content Security Policy permits the pinned `unpkg.com` Three.js imports and blocks framing, plugins, unexpected origins, and browser sensors.
- Validate the preview URL before promoting it; keep the deployment URL and asset-report digest in release notes.

## Cache-safe updates

Never replace bytes at a revisioned or hash-bearing immutable URL. Publish the changed asset under a new revision/hash, update its integrity and size, then update the revalidated registry/config alias. The current unrevisioned `properties/demo/model.glb` is deliberately revalidated so it can be updated safely until the package moves to revisioned asset URLs.
