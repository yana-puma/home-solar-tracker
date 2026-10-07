# Property registry and share URLs

The sharing foundation is static and browser-independent. The viewer can fetch
`properties/index.json`, select an immutable property revision, and serialize
its visible state without an application server or database.

## Static property registry

`properties/index.json` uses registry schema version 1:

```json
{
  "schemaVersion": 1,
  "defaultProperty": "demo",
  "properties": [
    {
      "slug": "demo",
      "title": "Residential Solar Study",
      "displayLabel": "Fictional sample garden",
      "revision": "fictional-1",
      "configUrl": "./demo/property.json",
      "modelUrl": "./demo/model.glb",
      "privacyTier": "unlisted",
      "updatedAt": "2026-08-24T13:00:00Z"
    }
  ]
}
```

Each `(slug, revision)` pair must be unique. When a URL omits the revision,
the resolver selects the entry with the most recent `updatedAt`. Supplying a
revision pins the shared link to that immutable package version.

`privacyTier` is metadata, not access control. A file in a public static
deployment remains downloadable regardless of whether its tier is `private`,
`unlisted`, or `public`. Deploy sensitive models and coordinates only after an
explicit privacy review.

### URL trust rules

`src/property-registry.js` resolves entry URLs relative to the registry file,
so a `properties/` directory remains portable under a subpath. It accepts:

- same-origin relative, root-relative, or absolute HTTP(S) URLs;
- cross-origin HTTPS URLs whose exact host appears in the caller-owned
  `allowedHosts` list.

It rejects unsafe schemes, remote HTTP, embedded credentials, backslashes,
raw traversal, and repeatedly encoded traversal. The registry document cannot
expand its own allowlist; the application supplying the registry decides which
remote hosts it trusts.

```js
import {
  loadPropertyRegistry,
  resolvePropertyEntry,
} from "../src/property-registry.js";

const loaded = await loadPropertyRegistry({
  url: new URL("../properties/index.json", import.meta.url),
  allowedHosts: ["cdn.example"],
});

const selection = resolvePropertyEntry(loaded.registry, {
  property: "garden-study",
  revision: "fictional-1",
  registryUrl: loaded.url,
  allowedHosts: ["cdn.example"],
});
```

Malformed selectors, missing revisions, and unusable registries resolve to the
configured default property, then to a built-in same-site demo. Callers should
surface `selection.warnings` when a requested property was not loaded.

### Explicit configuration links

The lower-level `?config=` selector is same-origin by default. Relative,
root-relative, and absolute same-origin HTTP(S) configuration URLs work without
an allowlist. Cross-origin URLs, embedded credentials, unsafe schemes,
backslashes, raw traversal, and repeatedly encoded traversal are rejected.
The shipped viewer passes no remote hosts, so a public link cannot opt itself
into an external configuration origin.

An embedding application may explicitly trust an exact remote HTTPS host via
the caller-owned API option. Host matching is exact and includes the port when
one is present; trusting `cdn.example` does not trust its subdomains:

```js
import { loadPropertyConfig } from "../src/property-config.js";

const loaded = await loadPropertyConfig({
  search: "?config=https://cdn.example/property.json",
  baseUrl: location.href,
  allowedHosts: ["cdn.example"],
});
```

The allowlist is application policy, not query state or property data. A host
cannot add itself to the list. Deployments that intentionally enable a remote
host must also add that exact origin to their `connect-src` Content Security
Policy; the checked-in Vercel policy remains same-origin for property data.
Its `blob:` connection allowance exists only for local configurator GLB
object-URL previews and does not authorize a network host.

## Share-state query contract

`src/share-url.js` maps viewer state to these canonical query keys:

| Order | Query key | State field | Format |
| ---: | --- | --- | --- |
| 1 | `property` | `property` | lowercase slug |
| 2 | `v` | `revision` | revision identifier |
| 3 | `date` | `date` | real `YYYY-MM-DD` date |
| 4 | `time` | `localTimeMinutes` | integer `0`–`1439` |
| 5 | `view` | `view` | camera/view slug |
| 6 | `zone` | `selectedZone` | zone slug |
| 7 | `markers` | `markers` | `on` or `off` |
| 8 | `compass` | `compass` | `on` or `off` |
| 9 | `map` | `map` | `off`, `estimated`, or `calculated` |
| 10 | `speed` | `playbackSpeed` | `0.25`–`16` |
| 11 | `compare` | `compareDates` | up to four comma-separated dates |

The serializer always includes `property`. Other default values are omitted,
so the default state is simply `?property=demo`. Comparison dates are unique
and sorted, duplicate query keys use their final value, and serialization
always follows the table order.

```js
import {
  buildShareUrl,
  parseShareState,
  serializeShareState,
} from "../src/share-url.js";

const parsed = parseShareState(location.search);
const search = serializeShareState(parsed.state);
const shareUrl = buildShareUrl(location.href, parsed.state);
```

Parsing is deliberately forgiving: malformed values become safe defaults and
produce warnings. Serialization is strict and deterministic, making equality
checks suitable for deciding between a history `pushState` and `replaceState`.

### Browser history integration

The module never reads `window`, `location`, or `history`. A viewer owns the
navigation policy:

```js
const nextUrl = buildShareUrl(location.href, nextState);
if (nextUrl !== location.href) history.replaceState(null, "", nextUrl);
```

Use `replaceState` for high-frequency changes such as time scrubbing. A viewer
may use `pushState` for deliberate navigation events such as choosing a new
property or pinned revision. On `popstate`, call `parseShareState` again and
apply the returned state without creating another history entry.

### Unrelated query parameters

Unrelated parameters are dropped by default. A caller may preserve a small,
explicit allowlist such as `embed` or `utm_source`:

```js
const parsed = parseShareState(location.search, {
  preserveParams: ["embed", "utm_source"],
});

const search = serializeShareState(parsed.state, {
  preserveParams: ["embed", "utm_source"],
  preservedParams: parsed.preservedParams,
});
```

Reserved viewer keys cannot be placed in the preserve list. Preserved values
are length-limited and control characters are rejected. This explicit policy
prevents obsolete, secret, or attacker-controlled parameters from being copied
into every newly shared link.

## Local packages and exposure quality

`tier=quick|standard|high` preserves exposure quality (Standard is the default). `local=1` prompts the recipient to choose their ZIP before applying the study settings. The link contains settings and package identity, not geometry or coordinates. `registry=local` resolves privately installed revisions under ignored `local-properties/index.json`; it works only where that revision is installed. Direct `config` links use the loaded package’s own identity in the viewer and reports. Unresolvable property/revision links display a fallback warning.
