import {
  createStudyReport,
  csvSafeText,
  studyReportFilename,
  studyReportToCsv,
  studyReportToJson,
} from '../study-report.js';

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object'
    ? JSON.stringify(value)
    : (typeof value === 'string' ? csvSafeText(value) : String(value));
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function createViewerStudyReport({ property, registryEntry, zoneAnalysis, ...study } = {}) {
  const reportProperty = {
    ...property,
    package: {
      ...(property?.package || {}),
      id: registryEntry?.slug || property?.package?.id,
      revision: registryEntry?.revision || property?.package?.revision,
    },
  };
  const report = createStudyReport({
    ...study,
    property: reportProperty,
    zoneAnalysis,
  });
  const details = zoneAnalysis?.zones || {};
  report.zones = report.zones.map((zone) => {
    const detail = details[zone.zoneId];
    if (!detail) return zone;
    return {
      ...zone,
      geometryType: detail.geometryType,
      method: detail.method,
      gridPointCount: detail.gridPointCount,
      representative: detail.representative,
      qualification: detail.qualification,
    };
  });
  report.zoneAnalysisProvenance = zoneAnalysis?.provenance || null;
  return report;
}

export function viewerStudyReportToCsv(report) {
  const base = studyReportToCsv(report).trimEnd();
  const rows = [
    [],
    ['decision-zone details'],
    ['zoneId', 'geometryType', 'method', 'gridPointCount', 'representative', 'qualification'],
    ...(report.zones || []).map((zone) => [
      zone.zoneId,
      zone.geometryType,
      zone.method,
      zone.gridPointCount,
      zone.representative,
      zone.qualification,
    ]),
  ];
  return `${base}\r\n${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function downloadViewerStudyReport(report, format = 'json', documentRef = document) {
  const normalized = format === 'csv' ? 'csv' : 'json';
  const body = normalized === 'csv' ? viewerStudyReportToCsv(report) : studyReportToJson(report);
  const url = URL.createObjectURL(new Blob([body], {
    type: normalized === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
  }));
  try {
    const anchor = documentRef.createElement('a');
    anchor.href = url;
    anchor.download = studyReportFilename(report, normalized);
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
