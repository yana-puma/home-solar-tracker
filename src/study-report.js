const REPORT_VERSION = 1;
const SAFE_FILE_PART = /[^a-z0-9_-]+/gi;

function record(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function cleanText(value, fallback = '') {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
    : fallback;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function copyProvenance(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    method: cleanText(value.method),
    label: cleanText(value.label),
    claimLevel: cleanText(value.claimLevel),
    description: cleanText(value.description),
    limitations: cleanText(value.limitations),
  };
}

function daylightSummary(value) {
  if (!value || typeof value !== 'object') return null;
  const summary = value.summary && typeof value.summary === 'object' ? value.summary : value;
  return {
    date: cleanText(value.date || summary.date),
    sunrise: cleanText(summary.sunrise, null),
    solarNoon: cleanText(summary.solarNoon, null),
    sunset: cleanText(summary.sunset, null),
    daylightHours: finiteOrNull(summary.daylightHours),
    solarNoonAltitude: finiteOrNull(summary.solarNoonAltitude),
    polarState: cleanText(summary.polarState, 'normal'),
  };
}

function zoneSummaries(value) {
  const source = value?.zones && typeof value.zones === 'object' ? value.zones : {};
  return Object.values(source).map((zone) => ({
    zoneId: cleanText(zone.zoneId),
    daysObserved: Number.isInteger(zone.daysObserved) ? zone.daysObserved : null,
    sunHours: finiteOrNull(Number.isFinite(zone.sunMinutes) ? zone.sunMinutes / 60 : zone.sunHours),
    averageDailySunHours: finiteOrNull(
      Number.isFinite(zone.averageDailySunMinutes)
        ? zone.averageDailySunMinutes / 60
        : zone.averageDailySunHours,
    ),
    sunFraction: finiteOrNull(zone.sunFraction),
  })).sort((a, b) => a.zoneId.localeCompare(b.zoneId));
}

/**
 * Build a portable, privacy-minimized solar-study report. Coordinates and asset
 * URLs are deliberately omitted; a report identifies the package revision and
 * display region rather than reproducing private source configuration.
 */
export function createStudyReport({
  property,
  state,
  daylight = null,
  comparison = null,
  annual = null,
  zoneAnalysis = null,
  exposure = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  record(property, 'property');
  record(state, 'state');
  if (typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt))) {
    throw new RangeError('generatedAt must be an ISO-compatible timestamp');
  }

  const propertyPackage = property.package || {};
  const location = property.location || {};
  const normalizedState = {
    date: cleanText(state.date, null),
    localTimeMinutes: Number.isInteger(state.localTimeMinutes) ? state.localTimeMinutes : null,
    view: cleanText(state.view, null),
    selectedZone: cleanText(state.selectedZone, null),
    map: cleanText(state.map, 'off'),
    compareDates: Array.isArray(state.compareDates)
      ? state.compareDates.map((date) => cleanText(date)).filter(Boolean)
      : [],
  };

  return {
    reportVersion: REPORT_VERSION,
    generatedAt: new Date(generatedAt).toISOString(),
    planningUseOnly: true,
    qualification: 'Planning estimate only. Results are not a survey, measured site condition, professional solar-access assessment, or energy-production guarantee.',
    property: {
      id: cleanText(propertyPackage.id || property.slug, 'property'),
      revision: cleanText(propertyPackage.revision || property.revision, 'unversioned'),
      title: cleanText(property.title, 'Solar Study'),
      displayLabel: cleanText(location.displayLabel, 'Private location'),
      timeZone: cleanText(location.timeZone),
      locationPrecision: cleanText(location.precision || property.privacy?.locationPrecision, 'unspecified'),
    },
    study: normalizedState,
    daylight: daylightSummary(daylight),
    comparison: comparison ? {
      dates: Array.isArray(comparison.dates)
        ? comparison.dates.map((item) => daylightSummary(item)).filter(Boolean)
        : [],
      provenance: copyProvenance(comparison.provenance),
      qualification: cleanText(comparison.qualification),
    } : null,
    annual: annual ? {
      year: Number.isInteger(annual.year) ? annual.year : null,
      dayCount: Array.isArray(annual.days) ? annual.days.length : finiteOrNull(annual.dayCount),
      provenance: copyProvenance(annual.provenance),
      qualification: cleanText(annual.qualification),
    } : null,
    zones: zoneSummaries(zoneAnalysis),
    exposure: exposure ? {
      method: cleanText(exposure.method || exposure.provenance?.method),
      tier: cleanText(exposure.tier),
      samplingMinutes: finiteOrNull(exposure.samplingMinutes),
      sampleCount: finiteOrNull(exposure.sampleCount),
      gridPoints: Array.isArray(exposure.exposures) ? exposure.exposures.length : finiteOrNull(exposure.gridPoints),
      provenance: copyProvenance(exposure.provenance),
      qualification: cleanText(exposure.qualification),
    } : null,
  };
}

export function studyReportToJson(report, { pretty = true } = {}) {
  record(report, 'report');
  return `${JSON.stringify(report, null, pretty ? 2 : 0)}\n`;
}

export function csvSafeText(value) {
  const text = String(value);
  return /^[\t ]*[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? csvSafeText(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Export the human-reviewable summary and zone decision table as CSV. */
export function studyReportToCsv(report) {
  record(report, 'report');
  const rows = [
    ['section', 'field', 'value'],
    ['report', 'generatedAt', report.generatedAt],
    ['report', 'qualification', report.qualification],
    ['property', 'id', report.property?.id],
    ['property', 'revision', report.property?.revision],
    ['property', 'title', report.property?.title],
    ['property', 'displayLabel', report.property?.displayLabel],
    ['property', 'timeZone', report.property?.timeZone],
    ['study', 'date', report.study?.date],
    ['study', 'localTimeMinutes', report.study?.localTimeMinutes],
    ['daylight', 'sunrise', report.daylight?.sunrise],
    ['daylight', 'solarNoon', report.daylight?.solarNoon],
    ['daylight', 'sunset', report.daylight?.sunset],
    ['daylight', 'daylightHours', report.daylight?.daylightHours],
    [],
    ['zoneId', 'daysObserved', 'sunHours', 'averageDailySunHours', 'sunFraction'],
  ];
  for (const zone of report.zones || []) {
    rows.push([
      zone.zoneId,
      zone.daysObserved,
      zone.sunHours,
      zone.averageDailySunHours,
      zone.sunFraction,
    ]);
  }
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function studyReportFilename(report, extension = 'json') {
  record(report, 'report');
  const id = cleanText(report.property?.id, 'property').replace(SAFE_FILE_PART, '-').replace(/^-+|-+$/g, '') || 'property';
  const date = cleanText(report.study?.date, 'study').replace(SAFE_FILE_PART, '-').replace(/^-+|-+$/g, '') || 'study';
  const safeExtension = cleanText(extension, 'json').toLowerCase().replace(/[^a-z0-9]/g, '') || 'json';
  return `${id}-solar-study-${date}.${safeExtension}`;
}

export function downloadStudyReport(report, format = 'json', documentRef = globalThis.document) {
  if (!documentRef?.createElement || typeof URL === 'undefined' || typeof Blob === 'undefined') {
    throw new Error('Report downloads require a browser document');
  }
  const normalized = format === 'csv' ? 'csv' : 'json';
  const body = normalized === 'csv' ? studyReportToCsv(report) : studyReportToJson(report);
  const blob = new Blob([body], { type: normalized === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = documentRef.createElement('a');
  anchor.href = url;
  anchor.download = studyReportFilename(report, normalized);
  anchor.click();
  URL.revokeObjectURL(url);
}
