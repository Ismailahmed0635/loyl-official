import { describe, it, expect } from 'vitest';
import { localPhoneToE164Client } from './phone-format';

describe('firebase client phone format', () => {
  it('builds E.164 for the signInWithPhoneNumber call', () => {
    expect(localPhoneToE164Client('01712345678')).toBe('+8801712345678');
    expect(localPhoneToE164Client('+8801712345678')).toBe('+8801712345678');
  });

  it('rejects malformed numbers before touching the SDK', () => {
    expect(localPhoneToE164Client('12345')).toBeNull();
    expect(localPhoneToE164Client('')).toBeNull();
  });
});
