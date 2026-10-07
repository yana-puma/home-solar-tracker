import { sampleSolarYear } from '../solar-analysis.js';
import { calculatePvPlanningEstimate } from './pv-planning.js';

self.addEventListener('message', (event) => {
  try {
    const { year, location, inputs, shade } = event.data || {};
    const solarYear = sampleSolarYear({ year, samplingMinutes: 60, ...location });
    const estimate = calculatePvPlanningEstimate({ solarYear, inputs, shade });
    const { days: _days, months: _months, ...compactEstimate } = estimate;
    self.postMessage({ estimate: compactEstimate });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
});
