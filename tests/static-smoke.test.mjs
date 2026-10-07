import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

async function page(path) {
  return readFile(new URL(path, `file://${root}`), 'utf8');
}

test('viewer contains its configurable module entry points and accessible calendar control', async () => {
  const [html, viewerCopy, bootstrap, runtime, accessibility, controls, controlStyles, pv, pvWorker, diagnosticController, zoneAnalysis, viewerReport] = await Promise.all([
    page('index.html'),
    page('viewer/index.html'),
    page('src/viewer/bootstrap.js'),
    page('src/viewer/runtime.js'),
    page('src/viewer/accessibility.js'),
    page('src/viewer/solar-controls.js'),
    page('src/viewer/viewer-controls.css'),
    page('src/viewer/pv-planning.js'),
    page('src/viewer/pv-worker.js'),
    page('src/viewer/diagnostics-controller.js'),
    page('src/viewer/zone-analysis.js'),
    page('src/viewer/viewer-report.js'),
  ]);

  assert.match(html, /<script\s+type=["']module["']/i);
  assert.match(html, /src\/viewer\/bootstrap\.js/);
  assert.equal(viewerCopy, html, 'root and /viewer entry documents should stay identical');
  assert.match(bootstrap, /src\/property-registry\.js/);
  assert.match(bootstrap, /src\/share-url\.js/);
  assert.match(bootstrap, /createViewerDiagnostics/);
  assert.match(runtime, /src\/property-config\.js/);
  assert.match(runtime, /src\/solar\.js/);
  assert.match(runtime, /SUN_PATH_RADIUS\s*=\s*26(?:\.0)?/);
  assert.doesNotMatch(runtime, /new THREE\.CylinderGeometry\(0\.14/);
  assert.match(html, /id=["']date-input["'][^>]+type=["']date["'][^>]+aria-label=["']Solar study date["']/i);
  assert.match(html, /id=["']time-slider["'][^>]+aria-label=["']Local solar time["']/i);
  assert.match(html, /id=["']fab-menu-card["'][^>]+aria-hidden=["']true["'][^>]+inert/i);
  assert.match(html, /id=["']loader["'][^>]+role=["']status["'][^>]+aria-live=["']polite["'][^>]+aria-busy=["']true["']/i);
  assert.match(html, /id=["']canvas-container["'][^>]+role=["']img["'][^>]+aria-describedby=["']canvas-study-summary solar-study-table["']/i);
  assert.match(controls, /canvas-study-summary/);
  assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i);
  assert.match(accessibility, /aria-selected/);
  assert.match(accessibility, /ArrowLeft/);
  assert.match(accessibility, /prefers-reduced-motion/);
  assert.match(accessibility, /modalReturnFocus/);
  assert.match(controls, /id = 'zone-selector'|id = "zone-selector"/);
  assert.match(controls, /Solar study legend/);
  assert.match(controls, /PV planning estimate \(optional\)/);
  assert.match(controls, /Download diagnostics/);
  assert.match(controls, /nothing is sent/i);
  assert.match(pv, /estimateIrradianceYear/);
  assert.match(pv, /new WorkerClass/);
  assert.match(pvWorker, /sampleSolarYear/);
  assert.match(pv, /planning estimate/i);
  assert.match(diagnosticController, /userInitiated: true/);
  assert.doesNotMatch(diagnosticController, /\.transmit\s*\(/);
  assert.match(zoneAnalysis, /area-grid-mean/);
  assert.match(viewerReport, /registryEntry.*revision|revision: registryEntry/s);
  assert.match(runtime, /getPvPlanningShadeFactor/);
  assert.match(runtime, /getZoneAnalysis/);
  assert.doesNotMatch(runtime, /loadPropertyConfig\s*\(\s*\{[^}]*allowedHosts/s);
  assert.match(controlStyles, /min-height:\s*44px/);
  assert.match(controlStyles, /@media \(max-width: 360px\)/);
  assert.match(html, /id=["']location-display["']/i);
  assert.match(html, /Configured property/i);
  assert.match(html, /Not calculated\. Run Model Exposure/i);
});

test('configurator advertises local-only handling and labels interactive status', async () => {
  const [html, deployment] = await Promise.all([page('configure/index.html'), page('vercel.json')]);

  assert.match(html, /<script\s+type=["']importmap["']/i);
  assert.match(html, /<script\s+type=["']module["']/i);
  assert.match(html, /from ["']\.\.\/src\/property-config\.js["']/);
  assert.match(html, /Import JSON/);
  assert.match(html, /Preview a local GLB/);
  assert.match(html, /Export property\.json/);
  assert.match(html, /aria-live=["']polite["']/i);
  assert.match(html, /aria-labelledby=["']form-title["']/i);
  assert.match(html, /aria-labelledby=["']preview-title["']/i);
  assert.match(html, /Nothing on this page uploads your model or configuration/i);
  assert.match(html, /Keep both options off for a public link/i);
  assert.match(html, /No private file was uploaded by this wizard/i);
  assert.match(html, /−Z is model north and −X is model east/i);
  assert.match(html, /positive offset rotates model north clockwise from true north/i);
  assert.doesNotMatch(html, /Rotates the model counterclockwise relative to true north/i);
  const config = JSON.parse(deployment);
  const csp = config.headers[0].headers.find((header) => header.key === 'Content-Security-Policy')?.value || '';
  assert.match(csp, /connect-src 'self' blob: https:\/\/unpkg\.com/);
  assert.match(csp, /worker-src 'self' blob:/);
  assert.doesNotMatch(csp, /connect-src[^;]*https:\/\/\*/);
});

test('public pages contain no project-specific street-address label', async () => {
  const [viewer, configurator] = await Promise.all([page('index.html'), page('configure/index.html')]);

  for (const html of [viewer, configurator]) {
    assert.doesNotMatch(html, /[0-9]+\s+Private\s+Street/i);
    assert.doesNotMatch(html, /Atlee\s+(Place|Road|Street|Avenue|Lane)/i);
  }
});
