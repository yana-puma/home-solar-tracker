import { estimateIrradianceYear, IRRADIANCE_PROVENANCE } from '../irradiance.js';
import { sampleSolarYear } from '../solar-analysis.js';

const DEFAULTS = Object.freeze({
  planeTiltDegrees: 30,
  planeAzimuthDegrees: 180,
  systemLossPercent: 14,
  moduleEfficiencyPercent: 20,
});

function finiteInRange(value, name, minimum, maximum, { maximumExclusive = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be a number`);
  if (number < minimum || (maximumExclusive ? number >= maximum : number > maximum)) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}${maximumExclusive ? ' (exclusive)' : ''}`);
  }
  return number;
}

export function normalizePvInputs(input = {}) {
  const basis = input.basis === 'area' ? 'area' : 'rating';
  const normalized = {
    basis,
    planeTiltDegrees: finiteInRange(
      input.planeTiltDegrees ?? DEFAULTS.planeTiltDegrees,
      'Plane tilt', 0, 90,
    ),
    planeAzimuthDegrees: finiteInRange(
      input.planeAzimuthDegrees ?? DEFAULTS.planeAzimuthDegrees,
      'Plane azimuth', 0, 360, { maximumExclusive: true },
    ),
    systemLossFraction: finiteInRange(
      input.systemLossPercent ?? DEFAULTS.systemLossPercent,
      'System losses', 0, 100, { maximumExclusive: true },
    ) / 100,
  };
  if (basis === 'area') {
    normalized.arrayAreaSquareMeters = finiteInRange(input.arrayAreaSquareMeters, 'Array area', 0.01, 100000);
    normalized.moduleEfficiency = finiteInRange(
      input.moduleEfficiencyPercent ?? DEFAULTS.moduleEfficiencyPercent,
      'Module efficiency', 0.01, 100,
    ) / 100;
  } else {
    normalized.systemRatingKw = finiteInRange(input.systemRatingKw, 'System rating', 0.01, 100000);
  }
  return normalized;
}

export function calculatePvPlanningEstimate({ solarYear, inputs, shade = null } = {}) {
  const normalized = normalizePvInputs(inputs);
  const sunFraction = Number.isFinite(shade?.sunFraction)
    ? finiteInRange(shade.sunFraction, 'Sun fraction', 0, 1)
    : undefined;
  const estimate = estimateIrradianceYear({ solarYear, ...normalized, sunFraction });
  return {
    ...estimate,
    planningLabel: 'PV planning estimate',
    source: shade?.source || 'clear-sky-unshaded',
    sourceLabel: shade?.label || 'Clear-sky solar geometry; no model-derived shade factor is available.',
    shadeLimitations: shade?.limitations || 'Obstructions and site shade are not included. Run model exposure for a coarse shade factor when supported.',
    qualification: IRRADIANCE_PROVENANCE.qualification,
  };
}

function compactEstimate(estimate) {
  const { days: _days, months: _months, ...compact } = estimate;
  return compact;
}

function abortError(message = 'PV planning calculation was canceled') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(typeof signal.reason === 'string' ? signal.reason : undefined);
}

export async function calculatePvPlanningEstimateAsync({
  solarYear,
  year,
  location,
  inputs,
  shade = null,
  WorkerClass = globalThis.Worker,
  signal = null,
} = {}) {
  throwIfAborted(signal);
  if (solarYear) {
    const estimate = calculatePvPlanningEstimate({ solarYear, inputs, shade });
    throwIfAborted(signal);
    return estimate;
  }
  if (typeof WorkerClass === 'function') {
    const worker = new WorkerClass(new URL('./pv-worker.js', import.meta.url), { type: 'module' });
    try {
      return await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener?.('abort', onAbort);
          callback(value);
        };
        const onAbort = () => finish(reject, abortError(
          typeof signal?.reason === 'string' ? signal.reason : undefined,
        ));
        worker.addEventListener('message', (event) => {
          if (event.data?.error) finish(reject, new Error(event.data.error));
          else finish(resolve, event.data?.estimate);
        }, { once: true });
        worker.addEventListener('error', (event) => {
          finish(reject, new Error(event.message || 'PV planning worker failed'));
        }, { once: true });
        signal?.addEventListener?.('abort', onAbort, { once: true });
        if (signal?.aborted) {
          onAbort();
          return;
        }
        worker.postMessage({ year, location, inputs, shade });
      });
    } finally {
      worker.terminate();
    }
  }
  const generatedYear = sampleSolarYear({ year, samplingMinutes: 60, ...location });
  throwIfAborted(signal);
  return compactEstimate(calculatePvPlanningEstimate({ solarYear: generatedYear, inputs, shade }));
}

/** Latest-request-wins controller for long-running annual PV work. */
export function createPvEstimateRunner({ calculate = calculatePvPlanningEstimateAsync } = {}) {
  if (typeof calculate !== 'function') throw new TypeError('calculate must be a function');
  let generation = 0;
  let controller = null;

  return {
    get active() {
      return controller !== null;
    },
    invalidate(reason = 'PV inputs changed; calculate again') {
      generation += 1;
      controller?.abort(reason);
      controller = null;
    },
    async run(options) {
      generation += 1;
      const requestGeneration = generation;
      controller?.abort('Superseded by a newer PV calculation');
      const requestController = new AbortController();
      controller = requestController;
      try {
        const result = await calculate({ ...options, signal: requestController.signal });
        if (requestGeneration !== generation || requestController.signal.aborted) {
          throw abortError('Stale PV planning result was discarded');
        }
        return result;
      } finally {
        if (requestGeneration === generation) controller = null;
      }
    },
  };
}

export function pvRangeText(range) {
  if (!range) return null;
  const format = (value) => Math.round(value).toLocaleString('en-US');
  return {
    low: `${format(range.low)} kWh/year`,
    central: `${format(range.estimate)} kWh/year`,
    high: `${format(range.high)} kWh/year`,
  };
}
