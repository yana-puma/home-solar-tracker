export function mergeViewerShareState(shareState, runtimeState) {
  return {
    ...shareState,
    ...runtimeState,
    compareDates: [...(runtimeState.compareDates || shareState.compareDates || [])],
  };
}

export function createHistoryController({
  windowRef = window,
  runtime,
  parseShareState,
  buildShareUrl,
  defaults,
  preserveParams = [],
} = {}) {
  let applyingHistory = false;
  let pending = 0;

  const parsedLocation = () => parseShareState(windowRef.location.search, { defaults, preserveParams });
  const currentState = () => mergeViewerShareState(
    parsedLocation().state,
    runtime.state,
  );
  const currentUrl = () => {
    const parsed = parsedLocation();
    return buildShareUrl(windowRef.location.href, currentState(), {
      defaults,
      preserveParams,
      preservedParams: parsed.preservedParams,
    });
  };
  const replace = () => {
    if (applyingHistory) return;
    windowRef.history.replaceState({ atlee: true }, '', currentUrl());
  };
  const scheduleReplace = () => {
    windowRef.clearTimeout(pending);
    pending = windowRef.setTimeout(replace, 100);
  };
  const popstate = () => {
    applyingHistory = true;
    runtime.applyState(parsedLocation().state, { notify: false });
    applyingHistory = false;
  };
  windowRef.addEventListener('atlee:statechange', scheduleReplace);
  windowRef.addEventListener('popstate', popstate);
  return {
    currentState,
    currentUrl,
    replace,
    dispose() {
      windowRef.clearTimeout(pending);
      windowRef.removeEventListener('atlee:statechange', scheduleReplace);
      windowRef.removeEventListener('popstate', popstate);
    },
  };
}

export async function copyText(text, { navigatorRef = navigator, documentRef = document } = {}) {
  try {
    if (navigatorRef?.clipboard?.writeText) {
      await navigatorRef.clipboard.writeText(text);
      return 'clipboard';
    }
  } catch {
    // Continue to the selection-based fallback.
  }
  const input = documentRef.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  documentRef.body.appendChild(input);
  input.select();
  const copied = documentRef.execCommand?.('copy');
  input.remove();
  if (!copied) throw new Error('Clipboard copy was unavailable.');
  return 'fallback';
}
