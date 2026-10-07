function setPressed(button, pressed) {
  if (!button) return;
  button.setAttribute('aria-pressed', String(Boolean(pressed)));
}

export function prefersReducedMotion(windowRef = globalThis.window) {
  return Boolean(windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

export function viewerStateAnnouncement(state, source) {
  if (!state) return 'Viewer updated.';
  if (source === 'date') return `Study date changed to ${state.date}.`;
  if (source === 'time') return 'Local solar time changed.';
  if (source === 'view') return `Camera view changed to ${state.view || 'the selected view'}.`;
  if (source === 'markers') return `Hourly sun markers ${state.markers === 'on' ? 'shown' : 'hidden'}.`;
  if (source === 'compass') return `Compass ${state.compass === 'on' ? 'shown' : 'hidden'}.`;
  if (source === 'map') return `Sun map ${state.map === 'off' ? 'hidden' : `${state.map} mode shown`}.`;
  if (source === 'zone') return state.selectedZone ? `Selected zone ${state.selectedZone}.` : 'Zone selection cleared.';
  if (source === 'speed') return `Playback speed set to ${state.playbackSpeed} times.`;
  if (source === 'playback') return state.playing ? 'Solar timelapse playing.' : 'Solar timelapse paused.';
  return 'Viewer controls updated.';
}

function configureTabs(documentRef) {
  const tabList = documentRef.querySelector('.tab-btn-group');
  const tabs = [
    { button: documentRef.getElementById('tab-btn-solar'), panel: documentRef.getElementById('tab-content-solar') },
    { button: documentRef.getElementById('tab-btn-camera'), panel: documentRef.getElementById('tab-content-camera') },
  ];
  tabList?.setAttribute('role', 'tablist');
  tabList?.setAttribute('aria-label', 'Viewer control sections');
  const sync = () => {
    tabs.forEach(({ button, panel }) => {
      const selected = panel?.classList.contains('active') || false;
      button?.setAttribute('role', 'tab');
      button?.setAttribute('aria-controls', panel?.id || '');
      button?.setAttribute('aria-selected', String(selected));
      button?.setAttribute('tabindex', selected ? '0' : '-1');
      panel?.setAttribute('role', 'tabpanel');
      panel?.setAttribute('aria-labelledby', button?.id || '');
      panel?.toggleAttribute('hidden', !selected);
    });
  };
  tabs.forEach(({ button }, index) => {
    button?.addEventListener('click', sync);
    button?.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const targetIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[targetIndex].button.click();
      tabs[targetIndex].button.focus();
    });
  });
  sync();
}

function disableMotionControls(documentRef, runtime, reduced) {
  runtime.setReducedMotion?.(reduced);
  documentRef.documentElement.classList.toggle('reduced-motion', reduced);
  for (const id of ['btn-play-loop', 'btn-speed', 'btn-spin', 'btn-demo-reel']) {
    const control = documentRef.getElementById(id);
    if (!control) continue;
    control.disabled = reduced;
    control.setAttribute('aria-disabled', String(reduced));
  }
  const play = documentRef.getElementById('btn-play-loop');
  if (play) play.title = reduced
    ? 'Animation disabled by reduced-motion preference'
    : 'Play a 24-hour solar timelapse';
}

export function installViewerAccessibility({ runtime, documentRef = document, windowRef = window } = {}) {
  const live = documentRef.createElement('div');
  live.id = 'viewer-announcer';
  live.className = 'sr-only';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  documentRef.body.appendChild(live);

  const menu = documentRef.getElementById('fab-menu-card');
  const fab = documentRef.getElementById('fab-toggle');
  const modal = documentRef.getElementById('plant-modal');
  const modalClose = documentRef.getElementById('btn-close-modal');
  const timeSlider = documentRef.getElementById('time-slider');
  let modalReturnFocus = fab;

  fab?.setAttribute('aria-controls', 'fab-menu-card');
  fab?.setAttribute('aria-expanded', String(menu?.classList.contains('active')));
  menu?.setAttribute('role', 'dialog');
  menu?.setAttribute('aria-label', 'Solar viewer controls');
  menu?.setAttribute('aria-modal', 'false');
  modal?.setAttribute('role', 'dialog');
  modal?.setAttribute('aria-modal', 'true');
  modal?.setAttribute('aria-labelledby', 'modal-zone-title');
  modal?.setAttribute('aria-describedby', 'modal-zone-desc modal-gardener-tip');
  modal?.setAttribute('aria-hidden', 'true');
  timeSlider?.setAttribute('aria-label', 'Local solar time');
  documentRef.getElementById('date-input')?.setAttribute('aria-describedby', 'solar-method-label');
  configureTabs(documentRef);

  const sync = () => {
    const state = runtime.state;
    setPressed(documentRef.getElementById('toggle-arc'), state.markers === 'on');
    setPressed(documentRef.getElementById('toggle-compass'), state.compass === 'on');
    setPressed(documentRef.getElementById('toggle-heatmap'), state.map !== 'off');
    setPressed(documentRef.getElementById('btn-spin'), state.autoRotate);
    setPressed(documentRef.getElementById('btn-play-loop'), state.playing);
    for (const [id, button] of Object.entries({ street: 'btn-street', top: 'btn-top', rear: 'btn-rear', sky: 'btn-sky', iso: 'btn-iso' })) {
      setPressed(documentRef.getElementById(button), state.view === id);
    }
  };
  sync();

  const onState = (event) => {
    sync();
    live.textContent = viewerStateAnnouncement(runtime.state, event.detail?.source);
  };
  const onModel = (event) => { live.textContent = event.detail?.message || 'The 3D model is ready.'; };
  const onZoneOpen = (event) => {
    modalReturnFocus = documentRef.activeElement || fab;
    modal?.setAttribute('aria-hidden', 'false');
    live.textContent = `${event.detail?.title || 'Zone'} recommendations opened.`;
    windowRef.setTimeout(() => modalClose?.focus(), 0);
  };
  const onZoneClose = () => {
    modal?.setAttribute('aria-hidden', 'true');
    if (modalReturnFocus?.isConnected) windowRef.setTimeout(() => modalReturnFocus.focus(), 0);
  };
  windowRef.addEventListener('atlee:statechange', onState);
  windowRef.addEventListener('atlee:modelloaded', onModel);
  windowRef.addEventListener('atlee:modelerror', onModel);
  windowRef.addEventListener('atlee:zoneopen', onZoneOpen);
  windowRef.addEventListener('atlee:zoneclose', onZoneClose);

  documentRef.addEventListener('keydown', (event) => {
    const modalOpen = modal?.getAttribute('aria-hidden') === 'false';
    if (modalOpen && event.key === 'Tab') {
      event.preventDefault();
      modalClose?.focus();
      return;
    }
    if (event.key === 'Escape') {
      if (modalOpen) modalClose?.click();
      else if (menu?.classList.contains('active')) documentRef.getElementById('btn-close-menu')?.click();
    }
  });

  const motionQuery = windowRef.matchMedia?.('(prefers-reduced-motion: reduce)');
  const syncMotion = () => disableMotionControls(documentRef, runtime, Boolean(motionQuery?.matches));
  syncMotion();
  motionQuery?.addEventListener?.('change', syncMotion);

  return () => {
    windowRef.removeEventListener('atlee:statechange', onState);
    windowRef.removeEventListener('atlee:modelloaded', onModel);
    windowRef.removeEventListener('atlee:modelerror', onModel);
    windowRef.removeEventListener('atlee:zoneopen', onZoneOpen);
    windowRef.removeEventListener('atlee:zoneclose', onZoneClose);
    motionQuery?.removeEventListener?.('change', syncMotion);
  };
}
