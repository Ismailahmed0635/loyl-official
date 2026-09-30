import { describe, it, expect } from 'vitest';
import { timeUntil, timeLeftClock } from './format';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-09-25T12:00:00.000Z').getTime();

function isoIn(ms: number): string {
  return new Date(NOW + ms).toISOString();
}

describe('timeUntil', () => {
  it('returns an empty string when no target was supplied at all', () => {
    expect(timeUntil(null, NOW)).toBe('');
    expect(timeUntil(undefined, NOW)).toBe('');
  });

  it('treats an unparseable target as already elapsed', () => {
    expect(timeUntil('not-a-date', NOW)).toBe('any moment now');
  });

  it('says "any moment now" once the target has passed', () => {
    expect(timeUntil(isoIn(-1), NOW)).toBe('any moment now');
    expect(timeUntil(isoIn(0), NOW)).toBe('any moment now');
  });

  it('rounds up to the next minute so it never promises a partial minute', () => {
    expect(timeUntil(isoIn(30_000), NOW)).toBe('1m');
    expect(timeUntil(isoIn(61_000), NOW)).toBe('2m');
  });

  it('switches to hours once an hour is left', () => {
    expect(timeUntil(isoIn(59 * 60_000), NOW)).toBe('59m');
    expect(timeUntil(isoIn(2 * HOUR), NOW)).toBe('2h 0m');
    expect(timeUntil(isoIn(2 * HOUR + 5 * 60_000), NOW)).toBe('2h 5m');
  });
});

describe('timeLeftClock', () => {
  it('returns an empty string when no target was supplied at all', () => {
    expect(timeLeftClock(null, NOW)).toBe('');
    expect(timeLeftClock(undefined, NOW)).toBe('');
  });

  it('treats an unparseable target as an open window', () => {
    // Matches timeUntil: an unparseable ISO can never lock anyone out.
    expect(timeLeftClock('nope', NOW)).toBe('00:00:00');
  });

  it('reads as a zeroed clock once the window has opened', () => {
    expect(timeLeftClock(isoIn(-1), NOW)).toBe('00:00:00');
    expect(timeLeftClock(isoIn(0), NOW)).toBe('00:00:00');
  });

  it('always renders HH:MM:SS, including under an hour', () => {
    expect(timeLeftClock(isoIn(45_000), NOW)).toBe('00:00:45');
    expect(timeLeftClock(isoIn(4 * 60_000 + 12_000), NOW)).toBe('00:04:12');
    expect(timeLeftClock(isoIn(90_000), NOW)).toBe('00:01:30');
  });

  it('truncates to whole seconds rather than rounding past the target', () => {
    // 1.9s left must show 00:00:01 — rounding up would claim a second that
    // has not elapsed yet, so the button could unlock early on the last tick.
    expect(timeLeftClock(isoIn(1_900), NOW)).toBe('00:00:01');
  });

  it('renders a full 24h window as 23:59:59', () => {
    expect(timeLeftClock(isoIn(24 * HOUR - 1_000), NOW)).toBe('23:59:59');
  });

  it('renders windows longer than a day without wrapping', () => {
    expect(timeLeftClock(isoIn(168 * HOUR - 1_000), NOW)).toBe('167:59:59');
  });
});
