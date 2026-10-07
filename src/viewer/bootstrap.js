import { installViewerAccessibility } from './accessibility.js';
import { createViewerDiagnostics } from './diagnostics-controller.js';
import { installSolarStudyControls } from './solar-controls.js';
import { createHistoryController } from './ui-state.js';
import { loadedPropertyEntry } from './property-scene.js';
import { chooseLocalProperty } from './local-package.js';

export const viewerDiagnostics = createViewerDiagnostics();

export function appBaseFromDocument(documentUrl) {
  const url = new URL(documentUrl);
  const isViewerCopy = /\/viewer(?:\/index\.html)?\/?$/.test(url.pathname);
  return new URL(isViewerCopy ? '../' : './', url);
}

function applyConfiguredFeatures(runtime, documentRef) {
  const features = runtime.property.solar?.features || {};
  const controls = {
    sunPath: ['toggle-arc'],
    sunMap: ['toggle-heatmap'],
    compass: ['toggle-compass'],
    timelapse: ['btn-play-loop', 'btn-speed'],
  };
  for (const [feature, ids] of Object.entries(controls)) {
    if (features[feature] !== false) continue;
    ids.forEach((id) => documentRef.getElementById(id)?.setAttribute('hidden', ''));
  }
  const accent = runtime.property.ui?.theme?.accentColor;
  if (/^#[0-9a-f]{6}$/i.test(accent || '')) {
    documentRef.documentElement.style.setProperty('--viewer-accent', accent);
  }
}

function authoredRegistry(registry) {
  return {
    schemaVersion: registry.schemaVersion,
    defaultProperty: registry.defaultProperty,
    properties: (registry.properties || []).map((entry) => ({
      slug: entry.slug,
      title: entry.title,
      displayLabel: entry.displayLabel,
      revision: entry.revision,
      configUrl: entry.configUrl,
      modelUrl: entry.modelUrl,
      privacyTier: entry.privacyTier,
      updatedAt: entry.updatedAt,
    })),
  };
}

export async function bootViewer({
  windowRef = window,
  documentRef = document,
  diagnostics = viewerDiagnostics,
} = {}) {
  const configTiming = diagnostics.startTiming('config', { source: 'static-property-registry' });
  const appBaseUrl = appBaseFromDocument(documentRef.baseURI);
  let registryModule;
  let shareModule;
  let selection;
  let loadedRegistry;
  let configComplete = false;
  try {
    [registryModule, shareModule] = await Promise.all([
      import(new URL('src/property-registry.js', appBaseUrl)),
      import(new URL('src/share-url.js', appBaseUrl)),
    ]);
  const defaults = {
    ...shareModule.DEFAULT_SHARE_STATE,
    localTimeMinutes: 870,
    playbackSpeed: 2,
    compareDates: [],
  };
  const explicitConfig = new URLSearchParams(windowRef.location.search).get('config');
  const localMode = new URLSearchParams(windowRef.location.search).get('local') === '1';
  const localProperty = localMode ? await chooseLocalProperty(documentRef, { expectedProperty: new URLSearchParams(windowRef.location.search).get('property'), expectedRevision: new URLSearchParams(windowRef.location.search).get('v') }) : null;
  const localRegistry = new URLSearchParams(windowRef.location.search).get('registry') === 'local';
  const preserveParams = [...(explicitConfig && !localMode ? ['config'] : []), ...(localRegistry ? ['registry'] : []), ...(localMode ? ['local'] : [])];
  const parsed = shareModule.parseShareState(windowRef.location.search, {
    defaults,
    preserveParams,
  });
  const registryUrl = new URL(localRegistry ? 'local-properties/index.json' : 'properties/index.json', appBaseUrl);
  loadedRegistry = await registryModule.loadPropertyRegistry({ url: registryUrl.href });
  selection = registryModule.resolvePropertyEntry(authoredRegistry(loadedRegistry.registry), {
    property: parsed.state.property,
    revision: parsed.state.revision,
    registryUrl: registryUrl.href,
  });
  const configSearch = explicitConfig
    ? windowRef.location.search
    : `?config=${encodeURIComponent(selection.entry.configUrl)}`;
  windowRef.__ATLEE_BOOTSTRAP_CONTEXT__ = {
    appBaseUrl: appBaseUrl.href,
    shareState: {
      ...parsed.state,
      property: selection.entry.slug,
      revision: selection.entry.revision,
    },
    registrySelection: selection,
    configSearch,
    localProperty,
    diagnostics,
    warnings: [...parsed.warnings, ...loadedRegistry.warnings, ...selection.warnings],
  };

  const stylesheet = documentRef.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('src/viewer/viewer-controls.css', appBaseUrl).href;
  documentRef.head.appendChild(stylesheet);

  const { viewerRuntime: runtime } = await import(new URL('src/viewer/runtime.js', appBaseUrl));
  selection = {
    ...selection,
    entry: loadedPropertyEntry(runtime.property, selection.entry, { direct: localMode || Boolean(explicitConfig) || runtime.usedFallback }),
    direct: localMode || Boolean(explicitConfig),
    local: localMode,
  };
  windowRef.__ATLEE_BOOTSTRAP_CONTEXT__.registrySelection = selection;
  Object.assign(windowRef.__ATLEE_BOOTSTRAP_CONTEXT__.shareState, {
    property: selection.entry.slug, revision: selection.entry.revision,
  });
  if ((!explicitConfig && !localMode && selection.fallback) || runtime.usedFallback) {
    const warning = documentRef.createElement('aside');
    warning.id = 'property-warning';
    warning.setAttribute('role', 'alert');
    warning.textContent = `The requested house or revision could not be loaded. Showing ${selection.entry.displayLabel || 'the demo'} instead. These results are not for the requested house. Open your house package or check the link.`;
    documentRef.body.appendChild(warning);
  }
  diagnostics.endTiming(configTiming, {
    status: 'ready',
    schemaVersion: runtime.property.schemaVersion || runtime.property.package?.schemaVersion || 'normalized',
    revision: selection.entry.revision,
  });
  configComplete = true;
  runtime.applyState(windowRef.__ATLEE_BOOTSTRAP_CONTEXT__.shareState, { notify: false });
  applyConfiguredFeatures(runtime, documentRef);
  const historyController = createHistoryController({
    windowRef,
    runtime,
    parseShareState: shareModule.parseShareState,
    buildShareUrl: shareModule.buildShareUrl,
    defaults,
    preserveParams,
  });
  historyController.replace();
  installViewerAccessibility({ runtime, documentRef, windowRef });
  const study = installSolarStudyControls({
    runtime,
    registrySelection: selection,
    registry: loadedRegistry.registry,
    historyController,
    buildShareUrl: shareModule.buildShareUrl,
    defaults,
    diagnostics,
  });

  if (windowRef.__ATLEE_BOOTSTRAP_CONTEXT__.warnings.length) {
    console.warn('Viewer initialization warnings:', ...windowRef.__ATLEE_BOOTSTRAP_CONTEXT__.warnings);
  }
  return { runtime, study, historyController, selection, diagnostics };
  } catch (error) {
    if (!configComplete) diagnostics.endTiming(configTiming, { status: 'failed' });
    diagnostics.recordError(error, {
      category: configComplete ? 'render' : 'config',
      stage: configComplete ? 'first-render' : 'config',
      component: 'viewer-bootstrap',
    });
    throw error;
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  bootViewer().catch((error) => {
    console.error('Could not start the solar viewer.', error);
    const message = document.querySelector('#loader div:last-child');
    if (message) message.textContent = `Could not start the solar viewer: ${error.message}`;
    document.getElementById('loader')?.setAttribute('aria-busy', 'false');
  });
}
