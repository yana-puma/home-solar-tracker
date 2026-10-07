import {
  compareSolarDates,
  getSeasonalPresetDates,
  sampleSolarDay,
  sampleSolarYear,
} from '../solar-analysis.js';
import { downloadViewerDiagnostics } from './diagnostics-controller.js';
import { createPvEstimateRunner, pvRangeText } from './pv-planning.js';
import { copyText } from './ui-state.js';
import { createViewerStudyReport, downloadViewerStudyReport } from './viewer-report.js';

export function daylightText(hours) {
  const minutes = Math.max(0, Math.round(Number(hours || 0) * 60));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function button(label, id) {
  const node = document.createElement('button');
  node.type = 'button';
  node.id = id;
  node.className = 'study-button';
  node.textContent = label;
  return node;
}

function option(value, label, selected = false) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  node.selected = selected;
  return node;
}

function dayPath(samples) {
  const points = samples.map((sample) => {
    const x = 4 + sample.dayFraction * 232;
    const y = 65 - Math.max(-10, Math.min(90, sample.altitude)) / 100 * 58;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `M ${points.join(' L ')}`;
}

function renderDayChart(container, days) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 240 72');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Solar altitude across ${days.length} selected day${days.length === 1 ? '' : 's'}`);
  svg.classList.add('solar-study-chart');
  const baseline = document.createElementNS(svg.namespaceURI, 'line');
  baseline.setAttribute('x1', '4');
  baseline.setAttribute('x2', '236');
  baseline.setAttribute('y1', '59');
  baseline.setAttribute('y2', '59');
  baseline.setAttribute('class', 'chart-baseline');
  svg.appendChild(baseline);
  days.forEach((day, index) => {
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', dayPath(day.samples));
    path.setAttribute('class', `chart-path chart-path-${index + 1}`);
    svg.appendChild(path);
  });
  container.replaceChildren(svg);
}

export function installSolarStudyControls({
  runtime,
  registrySelection,
  registry,
  historyController,
  buildShareUrl,
  defaults,
  diagnostics,
} = {}) {
  const solarTab = document.getElementById('tab-content-solar');
  const panel = document.createElement('section');
  panel.className = 'solar-study-panel';
  panel.setAttribute('aria-labelledby', 'solar-study-heading');

  const heading = document.createElement('h2');
  heading.id = 'solar-study-heading';
  heading.textContent = 'Solar Study';
  panel.appendChild(heading);
  const gettingStarted = document.createElement('p');
  gettingStarted.className = 'study-qualification';
  gettingStarted.append('Garden study: choose a zone and date, run Model Exposure, then compare another date. Missing trees and nearby buildings cannot cast shade. ');
  const openHouse = document.createElement('a'); openHouse.href = '?local=1'; openHouse.textContent = 'Open your house ZIP'; openHouse.className = 'property-start-link';
  const buildHouse = document.createElement('a'); buildHouse.href = new URL('../../configure/', import.meta.url).href; buildHouse.textContent = 'Build a package'; buildHouse.className = 'property-start-link';
  gettingStarted.append(openHouse, ' · ', buildHouse);
  panel.appendChild(gettingStarted);

  const propertyRow = document.createElement('div');
  propertyRow.className = 'study-grid';
  const propertyLabel = document.createElement('label');
  propertyLabel.htmlFor = 'property-selector';
  propertyLabel.textContent = 'Property';
  const propertySelect = document.createElement('select');
  propertySelect.id = 'property-selector';
  const latestBySlug = new Map();
  for (const entry of registry.properties || []) {
    const current = latestBySlug.get(entry.slug);
    if (!current || Date.parse(entry.updatedAt) > Date.parse(current.updatedAt)) latestBySlug.set(entry.slug, entry);
  }
  for (const entry of latestBySlug.values()) {
    propertySelect.appendChild(option(entry.slug, entry.displayLabel, entry.slug === registrySelection.entry.slug));
  }
  if (registrySelection.direct) {
    propertySelect.replaceChildren(option(registrySelection.entry.slug, registrySelection.entry.displayLabel, true));
    propertySelect.disabled = true;
  }
  if (!latestBySlug.size) propertySelect.appendChild(option('demo', 'Configured property', true));
  const revision = document.createElement('span');
  revision.id = 'loaded-revision';
  revision.className = 'revision-badge';
  revision.textContent = `Revision ${registrySelection.entry.revision}`;
  propertyRow.append(propertyLabel, propertySelect, revision);
  panel.appendChild(propertyRow);

  const zoneLabel = document.createElement('label');
  zoneLabel.htmlFor = 'zone-selector';
  zoneLabel.textContent = 'Study zone';
  const zoneSelect = document.createElement('select');
  zoneSelect.id = 'zone-selector';
  zoneSelect.appendChild(option('', 'Whole property'));
  for (const zone of runtime.property.zones || []) {
    zoneSelect.appendChild(option(zone.id, zone.title || zone.id, zone.id === runtime.state.selectedZone));
  }
  const zoneRow = document.createElement('div');
  zoneRow.className = 'study-grid';
  zoneRow.append(zoneLabel, zoneSelect);
  panel.appendChild(zoneRow);

  const shareButton = button('Copy Share Link', 'copy-share-link');
  const shareStatus = document.createElement('span');
  shareStatus.id = 'share-status';
  shareStatus.className = 'inline-status';
  shareStatus.setAttribute('role', 'status');
  shareStatus.setAttribute('aria-live', 'polite');
  const shareRow = document.createElement('div');
  shareRow.className = 'study-actions';
  shareRow.append(shareButton, shareStatus);
  panel.appendChild(shareRow);
  if (registrySelection.local) {
    shareButton.textContent = 'Copy study settings link';
    const localNote = document.createElement('p');
    localNote.className = 'study-qualification';
    localNote.textContent = 'Local house: this link shares settings only. Anyone opening it must choose the same ZIP on their computer. House geometry is not uploaded or included in the link.';
    panel.appendChild(localNote);
  }

  const compareGroup = document.createElement('fieldset');
  const compareLegend = document.createElement('legend');
  compareLegend.textContent = 'Compare dates';
  const compareToggle = document.createElement('input');
  compareToggle.type = 'checkbox';
  compareToggle.id = 'compare-toggle';
  const compareToggleLabel = document.createElement('label');
  compareToggleLabel.htmlFor = 'compare-toggle';
  compareToggleLabel.className = 'study-checkbox';
  compareToggleLabel.textContent = 'Show second solar path';
  compareToggleLabel.prepend(compareToggle);
  const compareDate = document.createElement('input');
  compareDate.type = 'date';
  compareDate.id = 'compare-date';
  compareDate.setAttribute('aria-label', 'Second comparison date');
  const preset = document.createElement('select');
  preset.id = 'compare-preset';
  preset.setAttribute('aria-label', 'Seasonal comparison preset');
  preset.append(
    option('', 'Custom date'),
    option('marchEquinox', 'March equinox'),
    option('juneSolstice', 'June solstice'),
    option('septemberEquinox', 'September equinox'),
    option('decemberSolstice', 'December solstice'),
  );
  compareGroup.append(compareLegend, compareToggleLabel, preset, compareDate);
  panel.appendChild(compareGroup);

  const summary = document.createElement('div');
  summary.id = 'solar-summary';
  summary.className = 'solar-summary';
  summary.setAttribute('role', 'status');
  summary.setAttribute('aria-live', 'polite');
  summary.setAttribute('aria-atomic', 'true');
  const canvasSummary = document.createElement('p');
  canvasSummary.id = 'canvas-study-summary';
  canvasSummary.className = 'sr-only';
  document.body.appendChild(canvasSummary);
  const method = document.createElement('p');
  method.id = 'solar-method-label';
  method.className = 'method-label';
  method.textContent = 'Calculated solar geometry • Model exposure is reported separately when available.';
  const chart = document.createElement('div');
  chart.id = 'solar-study-chart';
  const table = document.createElement('table');
  table.id = 'solar-study-table';
  table.innerHTML = '<caption>Daylight comparison</caption><thead><tr><th scope="col">Date</th><th scope="col">Sunrise</th><th scope="col">Noon</th><th scope="col">Sunset</th><th scope="col">Daylight</th></tr></thead><tbody></tbody>';
  const legend = document.createElement('ul');
  legend.id = 'solar-study-legend';
  legend.className = 'study-legend';
  legend.setAttribute('aria-label', 'Solar study legend');
  const legendItems = [
    ['primary', 'Solid gold line: primary study date'],
    ['comparison', 'Solid blue line: comparison date'],
    ['full', 'Red exposure: full sun, 8 or more hours'],
    ['moderate', 'Amber exposure: moderate sun, 6 to 8 hours'],
    ['partial', 'Green exposure: partial sun, 3 to 6 hours'],
    ['shade', 'Blue exposure: shade, under 3 hours'],
  ];
  for (const [tone, label] of legendItems) {
    const item = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.className = `legend-swatch legend-${tone}`;
    swatch.setAttribute('aria-hidden', 'true');
    item.append(swatch, document.createTextNode(label));
    legend.appendChild(item);
  }
  panel.append(method, legend, summary, chart, table);

  const annualButton = button('Calculate Annual Summary', 'annual-summary-button');
  const annualStatus = document.createElement('span');
  annualStatus.id = 'annual-summary-status';
  annualStatus.className = 'inline-status';
  annualStatus.setAttribute('role', 'status');
  annualStatus.setAttribute('aria-live', 'polite');
  const annualRow = document.createElement('div');
  annualRow.className = 'study-actions';
  annualRow.append(annualButton, annualStatus);
  panel.appendChild(annualRow);

  const pvPanel = document.createElement('details');
  pvPanel.id = 'pv-planning-panel';
  pvPanel.className = 'pv-planning-panel';
  const pvSummary = document.createElement('summary');
  pvSummary.textContent = 'PV planning estimate (optional)';
  const pvIntro = document.createElement('p');
  pvIntro.className = 'method-label';
  pvIntro.textContent = 'Explore a clear-sky photovoltaic opportunity range. Calculation happens only when you choose Calculate.';

  const pvBasisLabel = document.createElement('label');
  pvBasisLabel.htmlFor = 'pv-basis';
  pvBasisLabel.textContent = 'System input';
  const pvBasis = document.createElement('select');
  pvBasis.id = 'pv-basis';
  pvBasis.append(option('rating', 'DC rating (kW)', true), option('area', 'Array area + efficiency'));

  const pvRatingLabel = document.createElement('label');
  pvRatingLabel.htmlFor = 'pv-rating';
  pvRatingLabel.textContent = 'DC rating (kW)';
  const pvRating = document.createElement('input');
  Object.assign(pvRating, { id: 'pv-rating', type: 'number', min: '0.01', max: '100000', step: '0.1', value: '5' });

  const pvAreaLabel = document.createElement('label');
  pvAreaLabel.htmlFor = 'pv-area';
  pvAreaLabel.textContent = 'Array area (m²)';
  const pvArea = document.createElement('input');
  Object.assign(pvArea, { id: 'pv-area', type: 'number', min: '0.01', max: '100000', step: '0.1', value: '25' });

  const pvEfficiencyLabel = document.createElement('label');
  pvEfficiencyLabel.htmlFor = 'pv-efficiency';
  pvEfficiencyLabel.textContent = 'Module efficiency (%)';
  const pvEfficiency = document.createElement('input');
  Object.assign(pvEfficiency, { id: 'pv-efficiency', type: 'number', min: '0.01', max: '100', step: '0.1', value: '20' });

  const pvTiltLabel = document.createElement('label');
  pvTiltLabel.htmlFor = 'pv-tilt';
  pvTiltLabel.textContent = 'Plane tilt (0–90°)';
  const pvTilt = document.createElement('input');
  Object.assign(pvTilt, { id: 'pv-tilt', type: 'number', min: '0', max: '90', step: '1', value: '30' });

  const pvAzimuthLabel = document.createElement('label');
  pvAzimuthLabel.htmlFor = 'pv-azimuth';
  pvAzimuthLabel.textContent = 'Plane azimuth (0–359°, 180° south)';
  const pvAzimuth = document.createElement('input');
  Object.assign(pvAzimuth, { id: 'pv-azimuth', type: 'number', min: '0', max: '359', step: '1', value: '180' });

  const pvLossLabel = document.createElement('label');
  pvLossLabel.htmlFor = 'pv-losses';
  pvLossLabel.textContent = 'System losses (%)';
  const pvLosses = document.createElement('input');
  Object.assign(pvLosses, { id: 'pv-losses', type: 'number', min: '0', max: '99.9', step: '0.1', value: '14' });

  const pvFields = document.createElement('div');
  pvFields.className = 'pv-input-grid';
  pvFields.append(
    pvBasisLabel, pvBasis,
    pvRatingLabel, pvRating,
    pvAreaLabel, pvArea,
    pvEfficiencyLabel, pvEfficiency,
    pvTiltLabel, pvTilt,
    pvAzimuthLabel, pvAzimuth,
    pvLossLabel, pvLosses,
  );
  const pvCalculate = button('Calculate PV planning estimate', 'calculate-pv-estimate');
  const pvStatus = document.createElement('div');
  pvStatus.id = 'pv-estimate-status';
  pvStatus.className = 'pv-estimate-status';
  pvStatus.setAttribute('role', 'status');
  pvStatus.setAttribute('aria-live', 'polite');
  pvStatus.setAttribute('aria-atomic', 'true');
  const pvResult = document.createElement('div');
  pvResult.id = 'pv-estimate-result';
  pvResult.hidden = true;
  const pvActions = document.createElement('div');
  pvActions.className = 'study-actions';
  pvActions.append(pvCalculate);
  pvPanel.append(pvSummary, pvIntro, pvFields, pvActions, pvStatus, pvResult);
  panel.appendChild(pvPanel);

  const exposureLabel = document.createElement('label');
  exposureLabel.htmlFor = 'exposure-tier';
  exposureLabel.textContent = 'Exposure quality';
  const exposureTier = document.createElement('select');
  exposureTier.id = 'exposure-tier';
  exposureTier.append(option('quick', 'Quick'), option('standard', 'Standard'), option('high', 'High'));
  exposureTier.value = runtime.exposureTier;
  const exposureRun = button('Run Model Exposure', 'run-exposure');
  const exposureCancel = button('Cancel', 'cancel-exposure');
  const exposureProgress = document.createElement('progress');
  exposureProgress.id = 'exposure-progress';
  exposureProgress.max = 1;
  exposureProgress.value = 0;
  exposureProgress.setAttribute('aria-label', 'Exposure calculation progress');
  exposureProgress.setAttribute('aria-valuetext', 'Not started');
  const exposureRow = document.createElement('div');
  exposureRow.className = 'study-grid';
  exposureRow.append(exposureLabel, exposureTier, exposureRun, exposureCancel, exposureProgress);
  panel.appendChild(exposureRow);

  const exportJson = button('Export JSON', 'export-study-json');
  const exportCsv = button('Export CSV', 'export-study-csv');
  const exportRow = document.createElement('div');
  exportRow.className = 'study-actions';
  exportRow.append(exportJson, exportCsv);
  panel.appendChild(exportRow);

  const diagnosticsButton = button('Download diagnostics', 'download-diagnostics');
  const diagnosticsStatus = document.createElement('span');
  diagnosticsStatus.id = 'diagnostics-status';
  diagnosticsStatus.className = 'inline-status';
  diagnosticsStatus.setAttribute('role', 'status');
  diagnosticsStatus.setAttribute('aria-live', 'polite');
  const diagnosticsNote = document.createElement('p');
  diagnosticsNote.className = 'diagnostics-note';
  diagnosticsNote.textContent = 'Diagnostics stay in this browser memory and download only when you choose. Coordinates and model metadata are redacted; nothing is sent.';
  const diagnosticsRow = document.createElement('div');
  diagnosticsRow.className = 'study-actions';
  diagnosticsRow.append(diagnosticsButton, diagnosticsStatus);
  panel.append(diagnosticsNote, diagnosticsRow);

  solarTab.appendChild(panel);

  let day = null;
  let comparison = null;
  let annual = null;
  let pvEstimate = null;
  const pvRunner = createPvEstimateRunner();

  const locationArgs = () => ({
    latitude: runtime.property.location.latitude,
    longitude: runtime.property.location.longitude,
    timeZone: runtime.property.location.timeZone,
  });
  const render = () => {
    const state = runtime.state;
    day = sampleSolarDay({ date: state.date, samplingMinutes: 30, ...locationArgs() });
    const days = [day];
    comparison = null;
    if (compareToggle.checked && compareDate.value && compareDate.value !== state.date) {
      comparison = compareSolarDates({ dateA: state.date, dateB: compareDate.value, samplingMinutes: 30, ...locationArgs() });
      days.push(comparison.second);
    }
    summary.textContent = `${day.summary.sunrise || '—'} sunrise • ${day.summary.sunset || '—'} sunset • ${daylightText(day.summary.daylightHours)} daylight`;
    canvasSummary.textContent = `Accessible solar study summary for ${day.date}: ${summary.textContent}. ${comparison ? `Compared with ${comparison.second.date}, which has ${daylightText(comparison.second.summary.daylightHours)} daylight.` : 'No comparison date selected.'}`;
    renderDayChart(chart, days);
    const body = table.querySelector('tbody');
    body.replaceChildren(...days.map((item) => {
      const row = document.createElement('tr');
      for (const value of [item.date, item.summary.sunrise || '—', item.summary.solarNoon, item.summary.sunset || '—', daylightText(item.summary.daylightHours)]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      }
      return row;
    }));
  };

  const initialCompare = historyController.currentState().compareDates?.[0];
  if (initialCompare) {
    compareToggle.checked = true;
    compareDate.value = initialCompare;
  }
  render();

  const selectedZoneIsPv = () => {
    const zoneId = runtime.state.selectedZone;
    return Boolean((runtime.property.zones || []).find((zone) => zone.id === zoneId)?.purpose === 'pv');
  };
  if (selectedZoneIsPv()) pvPanel.open = true;

  const syncPvBasis = () => {
    const useArea = pvBasis.value === 'area';
    pvRating.disabled = useArea;
    pvArea.disabled = !useArea;
    pvEfficiency.disabled = !useArea;
    pvRating.setAttribute('aria-disabled', String(useArea));
    pvArea.setAttribute('aria-disabled', String(!useArea));
    pvEfficiency.setAttribute('aria-disabled', String(!useArea));
  };
  syncPvBasis();
  pvBasis.addEventListener('change', syncPvBasis);
  const invalidatePvEstimate = () => {
    const hadResult = Boolean(pvEstimate) || pvRunner.active;
    pvRunner.invalidate();
    pvEstimate = null;
    pvResult.hidden = true;
    pvCalculate.disabled = false;
    if (hadResult) pvStatus.textContent = 'PV inputs or study state changed; calculate again.';
  };
  for (const input of [pvBasis, pvRating, pvArea, pvEfficiency, pvTilt, pvAzimuth, pvLosses]) {
    input.addEventListener('input', invalidatePvEstimate);
  }

  propertySelect.addEventListener('change', () => {
    const target = latestBySlug.get(propertySelect.value);
    if (!target) return;
    const state = { ...historyController.currentState(), property: target.slug, revision: target.revision };
    window.location.assign(buildShareUrl(window.location.href, state, { defaults }));
  });
  zoneSelect.addEventListener('change', () => {
    if (zoneSelect.value) runtime.selectZone?.(zoneSelect.value);
    else runtime.selectZone?.(null);
  });
  shareButton.addEventListener('click', async () => {
    try {
      await copyText(historyController.currentUrl());
      shareStatus.textContent = 'Link copied.';
    } catch {
      shareStatus.textContent = 'Copy unavailable; use the browser address bar.';
    }
  });
  const updateCompare = () => {
    const year = Number(runtime.state.date.slice(0, 4));
    if (preset.value) compareDate.value = getSeasonalPresetDates(year)[preset.value];
    runtime.applyState({ compareDates: compareToggle.checked && compareDate.value ? [compareDate.value] : [] });
    render();
  };
  const syncCompareAvailability = () => {
    preset.disabled = !compareToggle.checked;
    compareDate.disabled = !compareToggle.checked;
    compareDate.setAttribute('aria-disabled', String(!compareToggle.checked));
    preset.setAttribute('aria-disabled', String(!compareToggle.checked));
  };
  syncCompareAvailability();
  compareToggle.addEventListener('change', updateCompare);
  compareToggle.addEventListener('change', syncCompareAvailability);
  compareDate.addEventListener('change', updateCompare);
  preset.addEventListener('change', updateCompare);
  window.addEventListener('atlee:statechange', (event) => {
    invalidatePvEstimate();
    zoneSelect.value = runtime.state.selectedZone || '';
    exposureTier.value = runtime.exposureTier;
    if (selectedZoneIsPv()) pvPanel.open = true;
    if (event.detail?.source !== 'history') render();
  });
  annualButton.addEventListener('click', () => {
    annualStatus.textContent = 'Calculating…';
    requestAnimationFrame(() => {
      try {
        const year = Number(runtime.state.date.slice(0, 4));
        annual = sampleSolarYear({ year, samplingMinutes: 60, ...locationArgs() });
        annualStatus.textContent = `${daylightText(annual.summary.averageDaylightMinutes / 60)} average daylight; shortest ${annual.summary.shortestDay.date}; longest ${annual.summary.longestDay.date}.`;
      } catch (error) {
        annualStatus.textContent = error.message;
      }
    });
  });

  pvCalculate.addEventListener('click', async () => {
    pvStatus.textContent = 'Calculating clear-sky annual geometry…';
    pvResult.hidden = true;
    pvCalculate.disabled = true;
    try {
        const year = Number(runtime.state.date.slice(0, 4));
        const shade = runtime.getPvPlanningShadeFactor?.() || null;
        pvEstimate = await pvRunner.run({
          solarYear: annual?.year === year ? annual : null,
          year,
          location: locationArgs(),
          shade,
          inputs: {
            basis: pvBasis.value,
            systemRatingKw: pvRating.value,
            arrayAreaSquareMeters: pvArea.value,
            moduleEfficiencyPercent: pvEfficiency.value,
            planeTiltDegrees: pvTilt.value,
            planeAzimuthDegrees: pvAzimuth.value,
            systemLossPercent: pvLosses.value,
          },
        });
        const range = pvRangeText(pvEstimate.energy?.range);
        if (!range) throw new Error('Choose a system rating or array area to calculate energy.');
        pvStatus.textContent = `PV planning estimate calculated for ${year}. This is not measured or utility-grade output.`;
        const rangeTable = document.createElement('table');
        rangeTable.className = 'pv-range-table';
        const caption = document.createElement('caption');
        caption.textContent = 'Estimated annual photovoltaic energy range';
        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const label of ['Low', 'Central', 'High']) {
          const headingCell = document.createElement('th');
          headingCell.scope = 'col';
          headingCell.textContent = label;
          headRow.appendChild(headingCell);
        }
        head.appendChild(headRow);
        const body = document.createElement('tbody');
        const bodyRow = document.createElement('tr');
        for (const value of [range.low, range.central, range.high]) {
          const cell = document.createElement('td');
          cell.textContent = value;
          bodyRow.appendChild(cell);
        }
        body.appendChild(bodyRow);
        rangeTable.append(caption, head, body);
        const paragraph = (label, value) => {
          const node = document.createElement('p');
          const strong = document.createElement('strong');
          strong.textContent = `${label}: `;
          node.append(strong, document.createTextNode(value));
          return node;
        };
        const assumptionDetails = document.createElement('details');
        const assumptionSummary = document.createElement('summary');
        assumptionSummary.textContent = 'Assumptions';
        const assumptionList = document.createElement('ul');
        for (const assumption of pvEstimate.assumptions) {
          const item = document.createElement('li');
          item.textContent = assumption;
          assumptionList.appendChild(item);
        }
        assumptionDetails.append(assumptionSummary, assumptionList);
        pvResult.replaceChildren(
          rangeTable,
          paragraph('Source', `${pvEstimate.provenance.label}. ${pvEstimate.sourceLabel}`),
          paragraph('Qualification', pvEstimate.qualification),
          paragraph('Limitations', `${pvEstimate.shadeLimitations} ${pvEstimate.provenance.limitations}`),
          assumptionDetails,
        );
        pvResult.hidden = false;
      } catch (error) {
        pvEstimate = null;
        pvStatus.textContent = error.name === 'AbortError'
          ? 'PV inputs or study state changed; calculate again.'
          : `PV estimate could not be calculated: ${error.message}`;
      } finally {
        if (!pvRunner.active) pvCalculate.disabled = false;
      }
  });
  exposureTier.addEventListener('change', () => runtime.setExposureTier(exposureTier.value));
  exposureRun.addEventListener('click', () => void runtime.runExposure());
  exposureCancel.addEventListener('click', () => runtime.cancelExposure());
  window.addEventListener('atlee:exposureprogress', (event) => {
    exposureProgress.value = event.detail?.progress || 0;
    exposureProgress.setAttribute('aria-valuetext', `${Math.round((event.detail?.progress || 0) * 100)} percent complete`);
  });
  window.addEventListener('atlee:exposurecomplete', () => {
    invalidatePvEstimate();
    exposureProgress.value = 1;
    exposureProgress.setAttribute('aria-valuetext', 'Complete');
  });
  window.addEventListener('atlee:exposureerror', (event) => {
    exposureProgress.value = 0;
    exposureProgress.setAttribute('aria-valuetext', event.detail?.message || 'Calculation failed');
  });

  const exportReport = (format) => {
    const report = createViewerStudyReport({
      property: runtime.property,
      registryEntry: registrySelection.entry,
      state: historyController.currentState(),
      daylight: day,
      comparison: comparison ? {
        dates: [comparison.first, comparison.second],
        provenance: comparison.provenance,
        qualification: 'Calculated solar-geometry comparison; model occlusion is reported separately.',
      } : null,
      annual,
      zoneAnalysis: runtime.getZoneAnalysis?.(),
      exposure: runtime.exposure,
    });
    downloadViewerStudyReport(report, format);
  };
  exportJson.addEventListener('click', () => exportReport('json'));
  exportCsv.addEventListener('click', () => exportReport('csv'));

  diagnosticsButton.disabled = !diagnostics;
  diagnosticsButton.setAttribute('aria-disabled', String(!diagnostics));
  diagnosticsButton.addEventListener('click', () => {
    try {
      const result = downloadViewerDiagnostics(diagnostics);
      diagnosticsStatus.textContent = `Downloaded ${result.eventCount} redacted local diagnostic event${result.eventCount === 1 ? '' : 's'}. Nothing was sent.`;
    } catch (error) {
      diagnosticsStatus.textContent = `Diagnostics download failed: ${error.message}`;
    }
  });

  return {
    render,
    get daylight() { return day; },
    get comparison() { return comparison; },
    get annual() { return annual; },
    get pvEstimate() { return pvEstimate; },
  };
}
