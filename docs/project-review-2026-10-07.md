# Project review and plan for a friend’s house

Reviewed October 7, 2026, against commit `e54fcf9`. The working tree was clean at the start. Implementation was authorized afterward; live progress and continuation instructions are recorded below. No real property is published by this work.

## Execution checkpoint — start here when continuing

Status: **reusable implementation and clean GitHub publication complete; real-house/device acceptance remains**. Original review findings below describe the baseline, not necessarily the current code. Update this checkpoint after each implementation slice and before stopping.

Constraints: never use Firefox; keep real property data private; preserve existing work; do not publish a fictional fixture as the friend's house. Work directly in this checkout. No subagents were requested. User explicitly authorized execution and ongoing plan updates.

| Workstream | Status | Next action / gate |
| --- | --- | --- |
| Phase 1: friend pilot brief | Partly defined | Friend is a gardener in Strasburg, VA. Access: clone public GitHub, keep house files local. No model/source supplied yet. |
| Phase 2A: truthful exposure and zone results | Complete | Badges, details, targets, PV shade and reports share qualified ground-zone summaries. Legacy exposure settings calculate. No preset hours or unsupported-surface ground results. |
| Phase 2B: package install and identity | Complete | Strict local ZIP opening and immutable private installer; direct/local identity and manifest verification covered by regression tests and second-house browser checks. |
| Phase 2C: generic pipeline | Complete | Axis conversion, no synthetic fallback, explicit demo, terrain/synthetic real-property rejection tested. Survey CRS/units/true north still require input review. |
| Public source privacy | Published clean history | `https://github.com/yana-puma/home-solar-tracker` on `codex/public-handoff`, fresh root commit `15fff5b`. 110 audited files; original history/data excluded; public pseudonym and GitHub no-reply attribution. Original local checkout remains private. |
| Phase 3: actual friend's model | Needs input | No real model/source supplied. Do not substitute demo geometry. |
| Phase 4: simple handoff | Implemented | Restricted Python launcher, garden quickstart, measured scale, readiness gate, draft ZIP save/reopen, blue zone outlines, property cameras, share tier. Device download/draft acceptance remains. |
| Phase 5: verification | Automated and core browser flows passed | 167 JS; 35 Python with science environment; standard Python 32 pass + 3 science skips; public audit clean. Browser sample exposure, second-house ZIP, identity, qualified zone details, and builder scale/gates checked. Downloads, draft reopen and physical devices remain unconfirmed. |

Baseline checks: 157 JS tests and 26 Python tests passed; release audit clean. Browser/probe findings are recorded below. Source changes are in progress. The baseline counts above are not final verification of those changes.

Resume commands: `git status --short`, read this section and the latest work log, then inspect diffs before editing. Run `node --test tests/*.test.mjs`, `python3 -m unittest discover -s tests -p 'test_*.py'`, and `python3 scripts/validate_package.py .`. Pipeline tests requiring scientific packages should use `.venv/bin/python`. Browser work uses the in-app browser and a localhost server; sandbox may require escalation for binding a port. Temporary review fixtures are under `/tmp` and are not durable handoff inputs.

### Work log

- October 7, 2026: execution authorized. Added this durable checkpoint and requested missing pilot inputs. Starting reusable correctness changes; original application baseline remains `e54fcf9`.
- Pilot clarification: gardener in Strasburg, Virginia; she will clone the public GitHub repository. Prioritize a local package-opening path and simple launcher. Do not place her house files in the public repository. House geometry/source still needed for Phase 3. Deployment/protected-hosting work is out of the current handoff path.

- Implementation slice 1: removed procedural hours/preset zone leakage; shared ground-zone aggregation drives badges/details/PV/report inputs; unsupported surfaces get no ground hours. Explicit exposure works for legacy/default packages. Added exposure tier to share state.
- Implementation slice 2: added strict browser-local ZIP opening (`?local=1`), ignored private revision installer, restricted loopback launcher, correct direct/local identity, visible fallback warning, canonical manifest verification, package camera buttons and fitted fallback view. Local packages stay out of Git/deployment.
- Implementation slice 3: generic GLB export converts east/north/up to viewer axes; offline acquisition raises instead of generating a fictional house; terrain-only/synthetic real-property packaging is rejected. Regression tests, builder readiness/drafts, docs, and end-to-end verification remain in progress.

- Privacy steering: user requires personal information excluded from public GitHub while retaining a modeled sample. Found private property-specific source and old model assets in tracked files/history. Original files preserved under ignored `data/private/pre-public-cleanup/`. Remove them from the public tree and generate an invented sample. Do not push existing Git history. Prepare and audit a clean source snapshot; GitHub remote state has not been verified (web fetch unavailable, gh not installed).
- Reusable implementation checks: 165 JS tests and 31 scientific-environment Python tests passed; deployable asset audit passed before the new privacy cleanup. Fictional asymmetric second-house ZIP opened in browser with correct identity/custom overview; legacy exposure setting calculated successfully and different ground-zone means appeared (north 7.7 hours, south 11.0 hours). Browser filechooser was extremely slow (~23 minutes); avoid repeating it. Remaining: final cleanup verification, source snapshot, builder browser checks, downloads and real-device/real-house acceptance.

- Final checks: 167 JavaScript tests passed; 35 Python tests passed in `.venv`; standard Python passed 32 and skipped 3 scientific tests. Public deployment audit: 46 files, one fictional 332-triangle GLB, zero blockers/warnings. `git diff --check` passed. Public source export also checks privately recorded personal markers/old model hashes and regenerates the fictional GLB to require an exact match.
- Browser checks: fictional sample June 21 Standard exposure completed in Worker; Garden A 11.1 hours, Garden B 14.4 hours, patio 10.8 hours. Details matched badges and the 6-hour garden target. Screenshot saved privately in `output/fictional-sample-preview.jpg`. Builder measured-scale helper applied 0.1524 m/unit for 20 decoded units = 10 feet; zone editor and no-preview export gate rendered correctly. JSON export click was exercised but delivered download bytes and clipboard text were not captured. Filechooser latency makes repeat draft-UI verification unsuitable in this harness.
- Privacy cleanup: preserved originals in ignored `data/private/pre-public-cleanup/`; private marker policy at ignored `data/private/sensitive-markers.json`. Existing checkout history remains sensitive. Use clean source ZIP under `output/public-source/` and a fresh initial Git commit with a public pseudonym/no-reply email; never push the existing history. No force push. Repository reachability/empty refs checked read-only.

- Publication: created an isolated clean repository from the audited 110-file archive and pushed `codex/public-handoff` to the user-provided empty GitHub repository. Fresh root commit `15fff5b`; author and committer use `yana-puma` and its GitHub no-reply email. Existing local two-commit history was not pushed. The original checkout still has no remote. Public source audits were rerun on the exact publication tree before pushing. Fallback warning was browser-confirmed visible with the fictional sample identity.

- Fresh-clone verification: cloned the public GitHub default branch into ignored `output/public-source/clone-check/`; 110 tracked files, only the fresh pseudonymous commits, no old history. All 167 JS and scientific Python tests passed in that clone. Source audit with the local private marker policy passed on the clone. GitHub HEAD points at `codex/public-handoff`, so a normal clone selects it. Added a final guard: an explicitly requested missing private marker policy blocks export instead of silently skipping it.

- Added Git ignore safeguards for private ZIP/GLB/property.json downloads and common raw survey/CAD/GIS formats, with explicit fictional-demo/example exceptions. Verified with real `git check-ignore --no-index` behavior before publication.

### Remaining steps for the next harness

1. Read this checkpoint and `git status --short`; preserve the ignored personal backups. Regenerate the source archive after any edit: `python3 scripts/export_public_source.py`. The `.inventory.json` lists exactly what is exported. Do not add `data/`, `output/`, `local-properties/`, or this checkout's old `.git` history to public GitHub.
2. Publication is complete. For further public updates, use the clean publication checkout at `output/public-source/publish-checkout/` or a fresh clone of the GitHub repository, never this original checkout’s history. Copy only re-audited current files, preserve public pseudonym/no-reply attribution, and push normally. Do not force-push or copy private backups. The source ZIP contains no Git history.
3. On the friend's actual browser/device, verify complete ZIP/draft download and reopen, report download, settings-link copy/reopen with the same ZIP, and narrow-screen usability. The importer rejects a different property/revision supplied for a pinned local link.
4. Obtain her actual GLB, measured footprint/heights, or survey. Keep it private. Review units/CRS, terrain and true north, include important obstructions, add ground garden zones, and compare modeled shadows against several observed dates/times. No real-house package exists yet.
5. Continue science only as needed for the garden pilot. Windows/roofs/elevated surfaces and preferred-time-window exposure are intentionally not claimed by daily ground results.

## Assessment

Home Solar Tracker has a substantial foundation for a homeowner solar and shade tool. The static viewer, property contracts, local package builder, solar calculations, worker-based exposure, sharing, reports, and privacy tooling already exist. The next release should focus on making a second house work reliably and making every displayed result traceable to that house.

It is ready for a maintainer-assisted pilot after the correctness and installation issues below are addressed. It is not yet a complete self-service workflow where a friend can enter her address and immediately study her house. The builder requires an existing GLB, technical calibration, and manual package installation. The generic acquisition pipeline does not currently supply a dependable house model from an address or bounding box.

The proposed first milestone is: **your friend opens her own house, checks sunlight at two or three places she cares about, compares representative dates, and can reopen the same study without editing code.** Assume garden/yard shade as the initial use case until her intended use and available model inputs are known. Window and rooftop analysis require additional work described below.

## Evidence and scope

| Check | Result |
| --- | --- |
| JavaScript suite: `node --test tests/*.test.mjs` | 157 passed; no failures or skips |
| Python suite: `python3 -m unittest discover -s tests -p 'test_*.py'` | 26 passed |
| Public asset validator | Passed; zero blockers and warnings; 42 files, 951,117 bytes |
| Demo model audit | 428,148 bytes; approximately 21,148 triangles |
| Browser startup | Demo loaded in the Codex in-app browser; no captured startup errors |
| Demo exposure | Quick calculation completed in a Worker and reported 60-minute samples |
| Sharing UI | Copy action displayed “Link copied”; clipboard contents were not independently confirmed |
| Browser builder | Local demo GLB preview loaded; calibration failures and export readiness were inspected |
| Second-property package | Produced a four-file ZIP with the real packaging module in an isolated temporary site |
| Installation and identity | Unregistered slug fell back to demo; direct config loaded with incorrect demo identity; registration restored correct slug/revision |
| Model export probe | Z-up test geometry remained Z-up in exported GLB |
| Acquisition failure probe | Stubbed offline elevation requests returned synthetic input, without making external requests |
| Manifest tampering probe | Validator passed an exported package whose `manifest.json` contained a deliberately wrong hash |

The fictional second property reused demo geometry solely for local testing. It is not a model of your friend’s house and was not published. Review artifacts and probes were kept under `/tmp`.

The review covered the runtime and browser controls, configuration and registry contracts, sharing and report integration, package builder, exposure and calibration paths, acquisition/export scripts, deployment exclusions, and existing tests and documentation. Passing tests establish a useful regression baseline; they do not prove real-property calibration or scientific accuracy.

Not confirmed: the current production deployment, production headers or access protection, physical phone/tablet behavior, cross-browser downloads, a complete reconstruction from a real survey, real-world shade observations, or an independent astronomical reference comparison. A browser JSON-download capture timed out, so downloaded study-file delivery remains an acceptance check. Narrow-screen device validation is also still required; the attempted viewport override did not provide a reliable phone-sized observation.

## What is worth keeping

- A lightweight static architecture with no required account system, application backend, database, or build step.
- Strict v2 property validation, v1 compatibility, URL trust rules, and separate property packages.
- Solar geometry that uses the property’s IANA timezone, with daylight-saving, leap-year, fractional-offset, and polar cases covered by tests.
- Worker-based daily exposure, cancellation, progressive updates, and bounded caching.
- Local model handling, deterministic ZIPs, privacy preflight, asset inventories, redacted diagnostics, and privacy-minimized reports.
- Existing keyboard, focus, live-region, and reduced-motion support.

Keep these foundations. A broad rewrite would delay the friend pilot without resolving its main uncertainties: model inputs, truthful results, and a complete setup path.

## Findings

Priority P1 means resolve before the affected workflow is handed to your friend. P2 means improve the pilot experience or resolve before broadening its claims. Browser observations, executable probes, and code-only findings are distinguished below.

### 1. P1 — Shade values and zone recommendations still inherit the original property

**Browser-confirmed and code-confirmed.** `src/viewer/runtime.js:234` contains fixed seasonal hours for the original front lawn, driveway, patio, and woods. Unknown zone IDs fall back to `profile.frontLawn` at line 864. A new `garden-bed` zone displayed **10.5 hours / full sun** even though no exposure was calculated for it.

This also affects calculated studies: after completing demo exposure, selecting Walkout Patio displayed the preset **3.5 hours / partial shade**. `selectZone()` at line 1851 and ground-click handling at line 1171 read seasonal presets. Calculated badges use a separate nearest-grid calculation; area reports use another aggregation path. `rebuildCalculatedBadges()` also omits the zone ID from the new badge metadata.

**Next step:** make the calculated zone summary the shared source for badges, selected-zone details, reports, and any shade-based suggestions. Preserve zone IDs. Show “Not calculated” before results exist. Keep illustrative preset maps explicitly confined to the demo. Verify a shaded custom zone cannot inherit the demo lawn’s values.

### 2. P1 — Newly authored packages can show a calculation button that never calculates

**Browser-confirmed.** The builder starts with `solar.exposureMethod = "estimated"` from `src/property-config.js:75`. The viewer always exposes Run Model Exposure, but `src/viewer/runtime.js:981` returns to the preset map unless the package is configured for `raycast`.

On the second-property fixture, clicking Run Model Exposure left progress at zero and displayed the seasonal estimate. This is especially confusing because a valid model was loaded.

**Next step:** default new model-backed packages to raycast exposure. Make the explicit calculation action run the model calculation, or disable it with a useful explanation when unavailable. Distinguish the default overlay from the ability to request a calculation.

### 3. P1 — Generic point-cloud export and viewer disagree about the vertical axis

**Executable-probe-confirmed.** Acquisition and reconstruction treat Z as elevation (`scripts/fetch_elevation.py:316`, `scripts/process_pointcloud.py:311`). `optimize_and_export_mesh()` exports those vertices directly. The viewer is Y-up and its package transform provides scale, translation, and rotation about Y, without a pitch correction.

A test solid with XYZ extents `[2, 3, 10]`, representing ten units of Z height, retained `[2, 3, 10]` in its exported GLB. In the viewer, that height lies horizontally. This affects the generic pipeline; the existing hand-built demo does not establish that pipeline’s correctness.

**Next step:** convert source coordinates into the documented viewer axes at a single explicit boundary, including the horizontal east/north convention. Retain origin, CRS, units, and orientation provenance outside the public package as appropriate. Add an asymmetric upright model fixture and verify its height, directed bearing, placement, and shadow in the viewer.

### 4. P1 — Bounding-box acquisition is terrain sampling and can silently continue with a fictional house

**Code-confirmed with a stubbed failure probe.** `scripts/fetch_elevation.py:366` queries the elevation point endpoint on a 50 × 50 grid. The code builds a terrain cloud; this path does not obtain roof, wall, tree, or neighboring-building geometry. If all requests fail, line 415 substitutes synthetic residential data. `scripts/pipeline.py:86` does not use the returned acquisition provenance to prevent packaging that result under a requested real property.

The default grid makes 2,500 sequential requests, each with a five-second timeout. It is also an unsuitable interactive “load my house” path.

**Next step:** fail clearly for real-property acquisition failures; allow synthetic data only in an explicit demo workflow. Separate terrain acquisition from house/obstruction acquisition. For the pilot, use a known GLB or a deliberately prepared model from actual footprint/height or survey inputs. Do not promise address-to-house modeling until that path is implemented and validated.

### 5. P1 — Export-to-viewer installation is incomplete and mistakes look like a successful demo load

**Browser-confirmed.** The exported README from `src/configurator-package.js:257` tells the recipient to open `?property=<id>`. The install section in `properties/README.md` likewise omits registry installation. Extracting the package alone does not register it; the fixture link changed to the demo URL and loaded the demo.

The fallback warning appears in the console (`src/viewer/bootstrap.js:135`), without a prominent user-facing explanation. The root README does mention the registry, so the instructions disagree.

**Next step:** provide one supported installation command that validates a v2 ZIP, installs without overwriting an existing revision, updates the registry, and prints the exact URL. Update all generated and repository instructions. Show a visible warning naming the unavailable requested property and the fallback; prevent fallback studies from appearing to be the requested house’s results.

### 6. P2 — Direct configuration links retain the registry demo’s identity

**Browser-confirmed and code-confirmed.** Opening the fictional property through `?config=properties/friend-fixture/property.json` loaded its region and Garden Bed zone, but the Property selector and Revision badge still showed the demo and `2026.08.24-1`. The URL contained demo identity alongside the custom config.

`src/viewer/bootstrap.js` retains registry selection when an explicit config wins. `getViewerState()` prefers that selection, and `src/viewer/viewer-report.js` overwrites package identity with the registry entry. The incorrect report identity is established by code, rather than a captured browser download.

**Next step:** choose identity from the actual loaded configuration for direct-config mode, and derive state, badges, and reports consistently. Test it as a distinct supported route. Use registered links for the initial pilot until this is fixed.

### 7. P2 — Calibration readiness and the builder’s controls can mislead an inexperienced author

**Browser-confirmed and code-confirmed.** Loading the demo GLB into the builder’s default scene produced **Calibration QA: fail · 2 errors** for containment and ground contact, while Privacy preflight was ready and Export complete ZIP was enabled. Schema validity, privacy readiness, and geometric correctness are separate, but the final export does not explain their combined readiness.

The Units selector records units without changing the applied multiplier: `applyModelTransform()` at `configure/index.html:138` uses only scale. The documentation explains that a feet-authored model ordinarily needs scale `0.3048`, but the form does not make this clear. Ground bounds are labeled “model units” even though their values are compared with transformed scene coordinates. Camera and terrain data are retained from imports without dedicated editors, and there is no durable draft save or reload recovery.

**Next step:** clearly label source units versus scene meters; offer a measured-dimension scale helper and explicit unit-derived scale. Summarize calibration, model completeness, and privacy separately at final review. Require resolution or deliberate acknowledgement of calibration errors before calling a package ready. Add explicit local save/reopen and visible zone previews. For the pilot, a maintainer should perform calibration.

### 8. P2 — Generic camera presets and scene dimensions are only partly honored

**Code-confirmed.** Packages may define arbitrary presets such as `overview`, the builder’s default. The runtime exposes only `street`, `top`, `rear`, `sky`, and `iso` (`src/viewer/runtime.js:1677`), otherwise using cameras from the original house. The fixture with only `overview` opened with `view=street`. Shadow bounds and other scene dimensions also remain fixed constants.

**Next step:** derive the initial view and preset controls from the package; add a fit-to-property fallback. Derive shadow coverage from the relevant bounds, with performance limits. Until then, author supported preset IDs and inspect all views for the pilot house.

### 9. P2 — Exported manifest names do not match the release validator

**Tampering-probe-confirmed.** Browser packages export `manifest.json`. `scripts/asset_report.py:471` only routes `package-manifest.json` into manifest inspection. An isolated second-property package with a deliberately incorrect exported manifest hash still passed the validator; the file was inventoried but its manifest entries were not checked. Vercel’s explicit manifest cache header also names `package-manifest.json`.

**Next step:** settle on one name across browser export, CLI, documentation, headers, and validation. Reject altered asset hashes/sizes and missing allowlisted entries in a package produced by the actual export path.

### 10. P1 for window/roof claims; P2 for a yard pilot — Zone analysis samples ground, not authored elevated surfaces

**Code-confirmed.** `src/viewer/exposure-controller.js` constructs a terrain ground grid. `src/viewer/zone-analysis.js` selects samples using X/Z only; authored zone elevation and surface do not affect ray origins. A roof or window zone therefore gets nearby ground exposure, not exposure at its actual surface. Minimum daily hours and preferred time windows are authored but are not evaluated in this viewer aggregation path.

PV planning applies a selected day’s coarse direct-sun fraction to annual clear-sky geometry. Its limitations are documented, but it is not a roof-specific shade or production assessment.

**Next step:** scope the first release to ground/yard studies. Make surface limitations visible. If windows or roofs are the goal, sample their actual positions/elevations and surface geometry before offering those answers. Evaluate sunlight targets and preferred windows from a suitable time series. Keep PV optional while that work is pending.

## Additional release considerations

- **Repeatability:** the demo registry revision points to mutable `property.json` and `model.glb` aliases. The revision parameter alone does not freeze those bytes. Install new pilot revisions under revision-specific paths and retain old ones.
- **Share state:** exposure quality and arbitrary orbit-camera coordinates are absent from the share contract. Preserve the chosen tier for repeatable calculated studies; clearly explain that results are recomputed and only prepared views are currently shared.
- **Privacy:** metadata such as `private` or `unlisted` is not access control. Choose local use, a deployment with real access protection, or an explicitly public package before installing the friend’s data. Review actual model/texture/location contents. The repository code license expressly excludes blanket redistribution rights for property assets.
- **Dependencies:** viewer and builder load pinned modules from `unpkg.com`. Consider shipping those modules with the pilot so an external CDN failure does not prevent startup.
- **Performance:** the demo is small. Exposure’s triangle loop lacks a spatial index; its cost rises with triangles, grid points, and time samples. Establish a practical model budget on the friend’s device before optimizing or enabling High by default.
- **Test coverage:** many integration tests inspect source text or exercise pure helpers. They did not catch the browser integration problems above. Add a small set of end-to-end stories using a genuinely distinct property fixture.
- **Maintenance:** the 2,032-line runtime and densely compressed inline configurator script make integration changes harder to review. Extract shared zone-result logic and builder state first; defer a broad framework migration.

## Next-step plan

### Phase 1 — Define the friend pilot and obtain trustworthy inputs

Collect her primary question, city/region and timezone, device/browser, available model/survey/footprint inputs, and preferred privacy/access arrangement. Identify two or three useful study zones. If no model exists, assess the smallest faithful model that includes her house and the nearby obstructions that matter to those zones. Record absent trees/buildings and any flat-terrain assumption.

**Deliverable:** a short pilot brief and a model-input decision. An address alone is not treated as an existing model. Exact location can stay private; regional information is enough to decide the acquisition approach initially.

### Phase 2 — Correct the reusable property and result paths

Implement findings 1, 2, and 5 first: truthful zone results, working model calculation defaults, complete installation, and visible fallback behavior. Fix direct-config identity if that route remains exposed. Align manifest names and adopt revision-specific package paths. Address the axis and acquisition failures before using the generic pipeline for a real house.

Add meaningful regression cases: a custom shaded zone; selected-zone details after calculation; default builder package running exposure; an exported v2 package installed from scratch; direct-config identity; unavailable slug/revision; upright generic export; acquisition failure; and altered manifest hashes.

**Exit gate:** a second property installs and loads with its own identity, produces its own values, and fails visibly when unavailable. No preset demo hours appear as that property’s result.

### Phase 3 — Prepare and calibrate her house

Prepare a compact Y-up model, confirm units from an independent dimension, align true north from a directed reference, check ground contact and yard bounds, and supply useful cameras. Author the chosen ground zones with visible geometry. Record model source, completeness, calibration evidence, and the package revision. Compare a few predicted shadow locations/times with photos or observations where available.

**Exit gate:** reviewed calibration and model completeness; her questions can be answered at the relevant locations with known assumptions. Windows/roofs remain out of scope unless their sampling path has been implemented.

### Phase 4 — Make the handoff simple

Provide an obvious “Open my house” route and, if self-service setup is desired, a local package import/open flow in the viewer. A local import needs a clear boundary: a local-only model cannot become available to another person merely by copying a URL. Retain maintainer installation for hosted links.

Add brief in-app guidance: choose a zone, choose dates, run exposure, read the result, and save/share settings. Add final package readiness, explicit save/reopen, visible model assumptions, and helpful failure recovery. Keep optional advanced controls collapsed. Prepare a one-page guide specific to the chosen access method.

**Exit gate:** your friend can complete the core study without terminal commands, JSON edits, or a developer console.

### Phase 5 — Verify the actual handoff and release

Run the existing suites and public asset validator for the chosen release scope. Test the complete export/install/open/study/share/reopen path with the pilot package. Inspect actual deployment contents and headers if hosted. Test the friend’s target browser/device, narrow-screen layout, keyboard flow, downloads, cancellation, and model/dependency failure recovery. Verify links reopen the intended revision and exposure tier.

**Exit gate:** a stable access method, correct property identity, truthful results, usable controls, working reports, and a successful walkthrough by your friend. Retain an existing release for rollback if hosted. Record remaining accuracy limits with the handoff.

## First implementation slice

Start with **a correct, repeatable second-property workflow**: eliminate preset-hour leakage, make Run Model Exposure behave as labeled, unify selected-zone results, and provide reliable package installation with a visible fallback warning. Then prepare her real model. This slice directly advances the handoff goal and supplies the integration tests needed for later UX improvements.

Defer automatic address modeling, accounts, cloud editing, advanced PV, extensive plant recommendations, and a framework rewrite until the pilot demonstrates what she actually needs.
