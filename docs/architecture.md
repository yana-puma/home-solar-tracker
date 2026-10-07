# Architecture

## Runtime

The public application is a static, client-side Three.js viewer. It does not require an application server or database.

1. The URL selects a property with `?property=<slug>` or an explicit configuration with `?config=<safe-url>`.
2. `src/property-config.js` loads, validates, and normalizes `property.json`.
3. The viewer loads the configured GLB, applies its scale and north rotation, and builds configured cameras and zones.
4. `src/solar.js` calculates sun position and daylight using the configured coordinates, date, and IANA timezone.

## Property package contract

The original machine-readable contract is `schemas/property.schema.json`.
Schema version 1 remains supported without changes to its public validation API.
`validatePropertyConfig(...)` returns the same normalized v1 object in `config`
and also exposes its forward-compatible form in `runtimeConfig`.

New packages should use the strict `schemas/property.schema.v2.json` contract.
Unlike v1, v2 rejects unknown fields at every authored object boundary. This
prevents misspelled or private metadata from being silently carried into a
public package. Native v2 validation returns the same object in `config` and
`runtimeConfig`.

Schema version 1 separates:

- display identity and privacy settings;
- geographic inputs needed for solar calculations;
- the model URL and transform;
- scene bounds, terrain profile, and cameras;
- optional observation zones;
- solar sampling settings.

Model URLs are resolved relative to the configuration file, so a package can be copied as a directory.

### Version 2 authoring shape

Version 2 adds an explicit package identity and asset manifest:

- `package.id`, `package.label`, and `package.revision` identify an immutable
  shareable revision;
- every `assets[]` entry declares its semantic type, URL, byte size, and SRI
  integrity digest;
- `model.assetId` selects one manifest entry whose type is `model`;
- `location.precision` records whether published coordinates are exact,
  rounded, or regional;
- `privacy.visibility` and disclosure flags capture publishing intent without
  implying that coordinates have been anonymized;
- solar feature defaults and the optional UI theme are configuration data,
  rather than viewer constants.

The v2 validator accepts traversal-free relative asset paths and HTTP(S) URLs.
It rejects unsafe schemes, blob URLs in published packages, encoded path
traversal, duplicate asset/zone identifiers, invalid IANA timezones, and
out-of-range coordinates.

### Normalized runtime contract

Viewer modules should consume `runtimeConfig`. It always has schema version 2
and contains `package`, `assets`, `location`, `model`, `scene`, `zones`,
`solar`, `privacy`, and `ui`. The runtime shape also provides `slug`, `title`,
and `description` aliases during the viewer migration. A v1 model becomes a
legacy manifest entry with unknown size and integrity; those values are never
fabricated. `sourceSchemaVersion` records whether the authored input was v1 or
v2.

`adaptV1PropertyConfig(...)` is the explicit adapter for code that wants the
v2 runtime object in `config` immediately. Existing code can continue using
`validatePropertyConfig(...)` and `loadPropertyConfig(...)` unchanged.

## Trust boundaries

- Configuration and models are treated as untrusted input.
- Only HTTP(S) and same-site relative configuration/model URLs are accepted.
- The browser configurator keeps local GLB files in memory for preview and does not upload them.
- UI copy uses `displayLabel` unless exact-location display is explicitly enabled.

## Accuracy levels

- **Calculated:** solar altitude, azimuth, sunrise, sunset, and rendered direct shadows.
- **Not calculated:** the neutral ground map and zone labels before model exposure completes. No preset sunlight hours are displayed.
- **Calculated exposure:** accumulated direct-sun raycasts from terrain samples into the configured GLB over the selected day. This accounts for modeled obstructions but not objects outside the model or weather.

The UI must not describe estimated exposure as measured or professionally certified.
