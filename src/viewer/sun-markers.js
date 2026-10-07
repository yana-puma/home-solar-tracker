export const DEFAULT_MARKER_RADIUS = 26;

/** Convert solar altitude/azimuth into the viewer's north-oriented scene. */
export function sunMarkerPosition({
  altitude,
  azimuth,
  radius = DEFAULT_MARKER_RADIUS,
  baseHeight = 2.5,
  altitudeScale = 0.5,
  minimumAltitude = -12,
} = {}) {
  if (![altitude, azimuth, radius, baseHeight, altitudeScale].every(Number.isFinite)) {
    throw new TypeError('Solar marker inputs must be finite numbers.');
  }
  const radians = Math.PI / 180;
  const altitudeRadians = Math.max(minimumAltitude, altitude) * radians;
  const azimuthRadians = azimuth * radians;
  return {
    x: -radius * Math.cos(altitudeRadians) * Math.sin(azimuthRadians),
    y: Math.max(1, radius * Math.sin(altitudeRadians) * altitudeScale + baseHeight),
    z: -radius * Math.cos(altitudeRadians) * Math.cos(azimuthRadians),
  };
}
