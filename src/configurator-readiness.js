/** Only a previewed, schema-valid, reviewed calibration is a complete study. */
export function packageReadiness({ schemaValid, modelLoaded, calibration, reviewed, privacyReady }) {
  const reasons = [];
  if (!schemaValid) reasons.push('Fix the property schema issues.');
  if (!modelLoaded) reasons.push('Choose a GLB that previews successfully.');
  if (!calibration || calibration.status === 'fail') reasons.push('Fix the calibration errors.');
  if (!reviewed) reasons.push('Check location, scale, true north, ground bounds, and garden placement, then mark them reviewed.');
  if (!privacyReady) reasons.push('Resolve the privacy preflight findings.');
  return { ready: !reasons.length, reasons };
}
