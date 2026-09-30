import { describe, it, expect, vi, afterEach } from 'vitest';
import { logger } from './logger';

afterEach(() => {
  vi.restoreAllMocks();
});

function lastJsonLine(spy: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  const raw = spy.mock.calls[0][0] as string;
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('logger PII scrub (P-03)', () => {
  it('redacts BD phone runs and emails in strings and nested fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('check-in', { phone: '01712345678', email: 'shop@example.com', ok: true });
    const line = lastJsonLine(spy);
    expect(line.level).toBe('info');
    expect(line.msg).toBe('check-in');
    expect(line.phone).toBe('[PHONE]');
    expect(line.email).toBe('[EMAIL]');
    expect(line.ok).toBe(true);
    expect(typeof line.ts).toBe('string');
  });

  it('logs errors as name+message only (no stack/token leak)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('boom 01712345678');
    logger.error('failed', { requestId: 'r1', error: err });
    const line = lastJsonLine(spy);
    expect(line.error).toEqual({ name: 'Error', message: 'boom [PHONE]' });
  });
});
