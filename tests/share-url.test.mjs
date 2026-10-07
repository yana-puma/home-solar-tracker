import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SHARE_STATE,
  SHARE_QUERY_ORDER,
  buildShareUrl,
  canonicalizeShareUrl,
  normalizeShareState,
  parseShareState,
  serializeShareState,
} from '../src/share-url.js';

const COMPLETE_STATE = {
  property: 'garden-study',
  revision: '2026.08.24-1',
  date: '2026-06-21',
  localTimeMinutes: 870,
  view: 'rear',
  selectedZone: 'patio',
  markers: 'off',
  compass: 'off',
  map: 'calculated',
  exposureTier: 'quick',
  playbackSpeed: 4,
  compareDates: ['2026-12-21', '2026-03-20'],
};

test('complete share state round-trips in canonical query order', () => {
  const search = serializeShareState(COMPLETE_STATE);
  assert.equal(
    search,
    '?property=garden-study&v=2026.08.24-1&date=2026-06-21&time=870&view=rear&zone=patio&markers=off&compass=off&map=calculated&tier=quick&speed=4&compare=2026-03-20%2C2026-12-21',
  );
  const parsed = parseShareState(search);
  assert.deepEqual(parsed.state, {...COMPLETE_STATE, compareDates: ['2026-03-20', '2026-12-21']});
  assert.deepEqual(parsed.warnings, []);
  assert.deepEqual([...new URLSearchParams(search).keys()], SHARE_QUERY_ORDER);
});

test('default values serialize compactly and still round-trip', () => {
  const search = serializeShareState(DEFAULT_SHARE_STATE);
  assert.equal(search, '?property=demo');
  assert.deepEqual(parseShareState(search).state, {...DEFAULT_SHARE_STATE, compareDates: []});
});

test('malformed values normalize to safe defaults with useful warnings', () => {
  const result = parseShareState(
    '?property=../private&v=bad/revision&date=2026-02-30&time=25:00&view=Rear&zone=%2e%2e&markers=yes&compass=no&map=magic&speed=100&compare=2026-03-20,bad,2026-03-20,2026-12-21',
  );

  assert.deepEqual(result.state, {
    ...DEFAULT_SHARE_STATE,
    compareDates: ['2026-03-20', '2026-12-21'],
  });
  assert.match(result.warnings.join(' '), /property selector/);
  assert.match(result.warnings.join(' '), /revision/);
  assert.match(result.warnings.join(' '), /study date/);
  assert.match(result.warnings.join(' '), /local time/);
  assert.match(result.warnings.join(' '), /playback speed/);
  assert.match(result.warnings.join(' '), /comparison date/);
});

test('local clock text, duplicate keys, comparison limits, and speed precision normalize deterministically', () => {
  const parsed = parseShareState(
    '?property=first&property=second&time=14%3A30&speed=1.23456&compare=2026-01-01,2026-02-01,2026-03-01,2026-04-01,2026-05-01',
  );

  assert.equal(parsed.state.property, 'second');
  assert.equal(parsed.state.localTimeMinutes, 870);
  assert.equal(parsed.state.playbackSpeed, 1.235);
  assert.deepEqual(parsed.state.compareDates, ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
  assert.match(parsed.warnings.join(' '), /Duplicate property/);
  assert.match(parsed.warnings.join(' '), /first four/);
});

test('unrelated parameters are dropped unless named in an explicit preserve allowlist', () => {
  const dropped = parseShareState('?property=demo&utm_source=friend&token=secret');
  assert.deepEqual(dropped.preservedParams, {});
  assert.match(dropped.warnings.join(' '), /utm_source was ignored/);
  assert.equal(serializeShareState(dropped.state), '?property=demo');

  const preserved = parseShareState('?property=demo&utm_source=friend&embed=1&token=secret', {
    preserveParams: ['utm_source', 'embed'],
  });
  assert.deepEqual(preserved.preservedParams, {embed: '1', utm_source: 'friend'});
  assert.equal(
    serializeShareState(preserved.state, {
      preserveParams: ['utm_source', 'embed'],
      preservedParams: preserved.preservedParams,
    }),
    '?property=demo&embed=1&utm_source=friend',
  );
  assert.throws(() => parseShareState('?property=demo', {preserveParams: ['property']}), /Cannot preserve/);
});

test('unsafe preserved values are ignored', () => {
  const parsed = parseShareState('?property=demo&embed=hello%0Aworld', {preserveParams: ['embed']});
  assert.deepEqual(parsed.preservedParams, {});
  assert.match(parsed.warnings.join(' '), /Unsafe preserved parameter embed/);
});

test('canonical URL construction is pure, stable, and preserves the fragment', () => {
  const input = 'https://solar.example/viewer/?speed=4&property=garden-study&junk=x&time=870#camera';
  const result = canonicalizeShareUrl(input);

  assert.equal(
    result.url,
    'https://solar.example/viewer/?property=garden-study&time=870&speed=4#camera',
  );
  assert.equal(input, 'https://solar.example/viewer/?speed=4&property=garden-study&junk=x&time=870#camera');
  assert.equal(result.state.localTimeMinutes, 870);
  assert.match(result.warnings.join(' '), /junk was ignored/);

  assert.equal(
    buildShareUrl('http://127.0.0.1:4173/?old=1', COMPLETE_STATE),
    'http://127.0.0.1:4173/?property=garden-study&v=2026.08.24-1&date=2026-06-21&time=870&view=rear&zone=patio&markers=off&compass=off&map=calculated&tier=quick&speed=4&compare=2026-03-20%2C2026-12-21',
  );
});

test('malformed input URLs and unsafe bases fail safely', () => {
  const malformed = parseShareState('https://[');
  assert.deepEqual(malformed.state, {...DEFAULT_SHARE_STATE, compareDates: []});
  assert.match(malformed.warnings.join(' '), /Malformed share URL/);

  for (const url of ['javascript:alert(1)', 'file:///tmp/viewer.html', 'https://user:secret@solar.example/']) {
    assert.throws(() => buildShareUrl(url, DEFAULT_SHARE_STATE), /baseUrl must be/);
  }
});

test('normalization accepts plain state while rejecting invalid object shapes', () => {
  const normalized = normalizeShareState({localTimeMinutes: '08:05', compareDates: '2026-12-21,2026-06-21'});
  assert.equal(normalized.state.localTimeMinutes, 485);
  assert.deepEqual(normalized.state.compareDates, ['2026-06-21', '2026-12-21']);

  const invalid = normalizeShareState([]);
  assert.deepEqual(invalid.state, {...DEFAULT_SHARE_STATE, compareDates: []});
  assert.match(invalid.warnings.join(' '), /not an object/);
});
