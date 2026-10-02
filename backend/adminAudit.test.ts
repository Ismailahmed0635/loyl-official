import { describe, it, expect } from 'vitest';
import {
  ADMIN_ACTIONS,
  merchantActionName,
  serializeActionDetail,
} from './adminAudit';

describe('RT-02 serializeActionDetail', () => {
  it('returns null for missing or empty detail (column stays NULL)', () => {
    expect(serializeActionDetail(undefined)).toBeNull();
    expect(serializeActionDetail({})).toBeNull();
  });

  it('keeps primitive facts as valid JSON', () => {
    const json = serializeActionDetail({
      merchantId: 'm_1',
      grantedTier: 'YEARLY',
      amount: 1200,
      resumed: false,
      rejectedAt: null,
    });
    expect(json).not.toBeNull();
    expect(JSON.parse(json!)).toEqual({
      merchantId: 'm_1',
      grantedTier: 'YEARLY',
      amount: 1200,
      resumed: false,
      rejectedAt: null,
    });
  });

  it('drops undefined values instead of emitting them', () => {
    const json = serializeActionDetail({ merchantId: 'm_1', grantedTier: undefined });
    expect(JSON.parse(json!)).toEqual({ merchantId: 'm_1' });
  });

  it('refuses a detail blob that would not fit (facts, not payloads)', () => {
    expect(() =>
      serializeActionDetail({ blob: 'x'.repeat(2100) })
    ).toThrow(/too large/);
  });
});

describe('RT-02 merchantActionName', () => {
  it('maps every supported merchant action to its audit name', () => {
    expect(merchantActionName('activate')).toBe('MERCHANT_ACTIVATE');
    expect(merchantActionName('expire')).toBe('MERCHANT_EXPIRE');
    expect(merchantActionName('revoke')).toBe('MERCHANT_REVOKE');
    expect(merchantActionName('suspend')).toBe('MERCHANT_SUSPEND');
    expect(merchantActionName('restore')).toBe('MERCHANT_RESTORE');
  });

  it('throws on an unknown action instead of logging a bogus name', () => {
    expect(() => merchantActionName('drop-table')).toThrow(/Unknown merchant action/);
  });

  it('every mapped name is in the stable action set', () => {
    for (const action of ['activate', 'expire', 'revoke', 'suspend', 'restore']) {
      expect(ADMIN_ACTIONS).toContain(merchantActionName(action));
    }
  });
});
