import { describe, expect, it } from 'vitest';
import { formatDuration } from '../src/lib/format.js';

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [213, '3:33'],
    [213.7, '3:33'],
    ['213', '3:33'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
  ])('formats %j as %s', (value, expected) => {
    expect(formatDuration(value)).toBe(expected);
  });

  it.each([null, undefined, '', 'NA', -1, Number.NaN])('shows %j as Unknown', (value) => {
    expect(formatDuration(value)).toBe('Unknown');
  });
});
