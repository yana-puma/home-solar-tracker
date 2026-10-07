function finitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.z);
}

export function zoneRepresentativePoint(zone = {}) {
  const geometry = zone.geometry || {};
  if (Array.isArray(zone.position) && Number.isFinite(Number(zone.position[0])) && Number.isFinite(Number(zone.position[2]))) {
    return { x: Number(zone.position[0]), z: Number(zone.position[2]) };
  }
  if (geometry.type === 'rectangle') {
    return { x: (geometry.minX + geometry.maxX) / 2, z: (geometry.minZ + geometry.maxZ) / 2 };
  }
  if (geometry.type === 'polygon' && geometry.vertices?.length) {
    const total = geometry.vertices.reduce((sum, [x, z]) => ({ x: sum.x + x, z: sum.z + z }), { x: 0, z: 0 });
    return { x: total.x / geometry.vertices.length, z: total.z / geometry.vertices.length };
  }
  if (geometry.type === 'point') return { x: geometry.x, z: geometry.z };
  return { x: 0, z: 0 };
}

export function pointInZoneGeometry(point, geometry = {}) {
  if (!finitePoint(point)) return false;
  if (geometry.type === 'rectangle') {
    return point.x >= geometry.minX && point.x <= geometry.maxX
      && point.z >= geometry.minZ && point.z <= geometry.maxZ;
  }
  if (geometry.type === 'polygon' && Array.isArray(geometry.vertices)) {
    let inside = false;
    for (let index = 0, prior = geometry.vertices.length - 1; index < geometry.vertices.length; prior = index++) {
      const [x, z] = geometry.vertices[index];
      const [priorX, priorZ] = geometry.vertices[prior];
      const intersects = ((z > point.z) !== (priorZ > point.z))
        && point.x < ((priorX - x) * (point.z - z)) / (priorZ - z) + x;
      if (intersects) inside = !inside;
    }
    return inside;
  }
  if (geometry.type === 'point') return point.x === geometry.x && point.z === geometry.z;
  return false;
}

function nearestExposure(exposures, representative) {
  return exposures.reduce((nearest, exposure) => {
    const distance = Math.hypot(exposure.point.x - representative.x, exposure.point.z - representative.z);
    const nearestDistance = Math.hypot(nearest.point.x - representative.x, nearest.point.z - representative.z);
    return distance < nearestDistance ? exposure : nearest;
  }, exposures[0]);
}

/** Aggregate daily exposure grid samples into explicitly qualified decision-zone summaries. */
export function aggregateZoneExposure({ zones = [], exposure, daylightMinutes = null } = {}) {
  const samples = Array.isArray(exposure?.exposures)
    ? exposure.exposures.filter((item) => finitePoint(item.point) && Number.isFinite(item.sunMinutes))
    : [];
  const summaries = {};
  if (!samples.length) return { zones: summaries, provenance: null };
  for (const zone of zones) {
    const representative = zoneRepresentativePoint(zone);
    if (zone.purpose === 'window' || zone.purpose === 'pv' || (zone.surface && zone.surface !== 'ground')) {
      summaries[zone.id] = {
        zoneId: zone.id, representative, geometryType: zone.geometry?.type || 'point',
        method: 'unsupported-surface', gridPointCount: 0, daysObserved: 0,
        sunMinutes: null, averageDailySunMinutes: null, sunFraction: null,
        qualification: 'This study samples the ground. Windows, roofs, and elevated surfaces need a separate surface study.',
      };
      continue;
    }
    const isArea = zone.geometry?.type === 'rectangle' || zone.geometry?.type === 'polygon';
    let included = isArea
      ? samples.filter((sample) => pointInZoneGeometry(sample.point, zone.geometry))
      : [];
    let method = isArea ? 'area-grid-mean' : 'representative-nearest-grid-point';
    if (!included.length) {
      included = [nearestExposure(samples, representative)];
      method = isArea ? 'area-representative-fallback' : method;
    }
    const sunMinutes = included.reduce((sum, sample) => sum + sample.sunMinutes, 0) / included.length;
    summaries[zone.id] = {
      zoneId: zone.id,
      geometryType: zone.geometry?.type || 'point',
      method,
      gridPointCount: included.length,
      representative,
      daysObserved: 1,
      sunMinutes,
      averageDailySunMinutes: sunMinutes,
      minimumDailyHours: zone.sunlightThresholds?.minimumDailyHours ?? null,
      meetsMinimum: Number.isFinite(zone.sunlightThresholds?.minimumDailyHours)
        ? sunMinutes >= zone.sunlightThresholds.minimumDailyHours * 60 : null,
      sunFraction: Number.isFinite(daylightMinutes) && daylightMinutes > 0
        ? Math.max(0, Math.min(1, sunMinutes / daylightMinutes))
        : null,
      qualification: method === 'area-grid-mean'
        ? 'Mean of modeled ground grid points whose centers fall inside the authored decision-zone geometry.'
        : 'Nearest modeled ground grid point to the authored representative point; not an area average.',
    };
  }
  return {
    zones: summaries,
    provenance: {
      method: 'viewer-decision-zone-grid-aggregation',
      claimLevel: 'model-derived',
      qualification: 'Decision support only. Accuracy depends on model alignment, zone geometry, grid density, and solar sampling.',
    },
  };
}

/** One presentation contract for badges, details, and shade-based suggestions. */
export function zoneExposurePresentation(zone, summary) {
  if (!Number.isFinite(summary?.sunMinutes)) {
    return {
      key: null, color: '#94a3b8', label: 'Not calculated', hoursText: 'Not calculated',
      qualification: summary?.qualification || 'Run Model Exposure to calculate ground sunlight for this date. No preset hours are assigned to this zone.',
    };
  }
  const hours = summary.sunMinutes / 60;
  const category = hours >= 8 ? ['full_sun', '#ef4444', 'Full Sun']
    : hours >= 6 ? ['mod_sun', '#eab308', 'Moderate Sun']
    : hours >= 3 ? ['part_sun', '#10b981', 'Partial Sun']
    : ['deep_shade', '#38bdf8', 'Shade'];
  const target = summary.meetsMinimum === null || summary.meetsMinimum === undefined ? ''
    : ` ${summary.meetsMinimum ? 'Meets' : 'Below'} the ${summary.minimumDailyHours}-hour daily target.`;
  const window = zone.sunlightThresholds?.preferredTimeWindow
    ? ' The preferred time window is not assessed by this daily ground summary.' : '';
  return { key: category[0], color: category[1], label: category[2],
    hoursText: `${hours.toFixed(1)} hrs (${category[2]})`,
    qualification: `${summary.qualification}${target}${window}` };
}
