# Local diagnostics and observability

The viewer's diagnostics contract is local-first. `src/diagnostics.js` keeps a
small, redacted event log in the current JavaScript runtime. It does not call
`fetch`, `sendBeacon`, analytics SDKs, browser storage, or a telemetry endpoint.
Reloading the page discards the log.

This module provides troubleshooting evidence without silently turning a home
model into telemetry. It is suitable for both browsers and Node and has no
dependencies.

## What is recorded

Performance events use four stable stages:

| Stage | Intended interval or mark |
| --- | --- |
| `config` | Property configuration loading and validation |
| `model` | Local GLB loading and parsing |
| `first-render` | The first usable 3D frame |
| `exposure` | A solar exposure calculation |

Errors receive a correlation ID and one coarse category: `config`, `model`,
`render`, `exposure`, `validation`, `storage`, `network`, or `unknown`. The
correlation ID lets the interface show a stable support reference without
showing the unredacted error. Events are held in a bounded FIFO log; the oldest
event is dropped when `maxEvents` is reached.

Example integration:

```js
import { createLocalDiagnostics } from './src/diagnostics.js';

const diagnostics = createLocalDiagnostics({ maxEvents: 200 });

const configTiming = diagnostics.startTiming('config');
try {
  // Load and validate property.json locally.
  diagnostics.endTiming(configTiming, { schemaVersion: 2 });
} catch (error) {
  const event = diagnostics.recordError(error, { stage: 'config' });
  console.error(`Configuration failed (${event.correlationId})`);
}

diagnostics.mark('first-render');
```

`startTiming` and `endTiming` use the injected clock to calculate duration in
milliseconds. Tests can inject both `clock` and `idFactory`, making timestamps,
durations, session IDs, and correlation IDs deterministic.

## Redaction boundary

Values are redacted before entering the in-memory event log, not merely during
export. The redactor removes or replaces:

- latitude, longitude, coordinate, GPS, geolocation, and position fields;
- equivalent camelCase, snake_case, and kebab-case keys such as
  `homeLatitude`, `gps_position`, and `geo-location`;
- unlabeled numeric latitude/longitude pairs and nested coordinate objects;
- coordinate pairs and labeled coordinates embedded in strings;
- address-like street strings;
- absolute filesystem paths and values stored under path-like keys;
- HTTP(S) URL credentials, fragments, detailed paths, and query values,
  including signed model and texture URLs; only the origin and query-key names
  are retained for coarse network troubleshooting, and sensitive query-key
  names are replaced as well;
- authentication, token, credential, cookie, signature, and API-key fields;
- GLB/model metadata such as `extras`, `userData`, generator, authorship, and
  embedded-image cues; and
- oversized, deeply nested, circular, or binary values.

Redaction is deliberately conservative. It reduces accidental disclosure but
cannot prove that arbitrary text is anonymous. Call sites should pass operational
facts such as stage, duration, schema version, file size, and result counts—not
property configuration objects, geometry, GLB documents, filenames, or labels.
Plausible two-number latitude/longitude arrays are therefore redacted even when
their containing key is generic; use named count/duration fields for safe metrics.

## User-controlled export

Export is gated so it can be connected directly to a visible user action:

```js
exportButton.addEventListener('click', () => {
  const json = diagnostics.exportJson({ userInitiated: true });
  const blob = new Blob([json], { type: 'application/json' });
  // The application may now offer this local Blob as a download.
});
```

Calling `exportJson()` without `userInitiated: true` throws. Merely recording an
event or reading `getEvents()` never exports, persists, uploads, or downloads
anything.

The exported format is versioned as `atlee-local-diagnostics` version 1. It
contains the redacted session information and the currently retained event log;
it does not contain raw configuration, exact location, model contents, or model
metadata.

## Optional transport

There is no default transport. A caller may explicitly supply a function or an
object with a `send(payload)` method:

```js
const diagnostics = createLocalDiagnostics({
  transport: {
    send(redactedPayload) {
      return supportClient.submit(redactedPayload);
    },
  },
});
```

Supplying a transport does not invoke it. `transmit({ userInitiated: true })`
must still be called explicitly; it throws when the acknowledgement is absent or
when no transport was supplied. The diagnostics module never retries, batches,
schedules, discovers, or configures network destinations.

An application that adds a transport owns the consent language, endpoint
security, retention policy, deletion process, and any additional server-side
redaction. Keep transport disabled for the default local viewer.
