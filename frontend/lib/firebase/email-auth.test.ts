import { describe, it, expect } from 'vitest';
import {
  validateEmail,
  validatePassword,
  normalizeOptionalPhone,
  isValidOptionalPhone,
  buildUserDoc,
  authErrorMessage,
  withTimeout,
  AUTH_SLOW_NETWORK_MESSAGE,
} from './email-auth';

describe('email-auth pure helpers', () => {
  it('validates email without touching the SDK', () => {
    expect(validateEmail('user@example.com')).toBeNull();
    expect(validateEmail('')).toBe('Email is required.');
    expect(validateEmail('not-an-email')).toBe('Enter a valid email address.');
    expect(validateEmail('a@b')).toBe('Enter a valid email address.');
  });

  it('enforces the password bar', () => {
    expect(validatePassword('')).toBe('Password is required.');
    expect(validatePassword('Short1')).toBe('Password must be at least 8 characters.');
    expect(validatePassword('alllowercase1')).not.toBeNull();
    expect(validatePassword('ALLUPPERCASE1')).not.toBeNull();
    expect(validatePassword('NoNumbersHere')).not.toBeNull();
    expect(validatePassword('Loyl2026Bd')).toBeNull();
  });

  it('treats phone as optional', () => {
    expect(normalizeOptionalPhone(undefined)).toBeNull();
    expect(normalizeOptionalPhone('   ')).toBeNull();
    expect(normalizeOptionalPhone('01712345678')).toBe('01712345678');
    expect(normalizeOptionalPhone('+8801712345678')).toBe('+8801712345678');
    expect(normalizeOptionalPhone('abc')).toBeNull();
    expect(isValidOptionalPhone('')).toBe(true);
    expect(isValidOptionalPhone('abc')).toBe(false);
  });

  it('omits phone from the user doc when not provided', () => {
    expect(buildUserDoc('uid1', 'a@b.com')).toEqual({ uid: 'uid1', email: 'a@b.com' });
    expect(buildUserDoc('uid1', 'a@b.com', '  ')).toEqual({ uid: 'uid1', email: 'a@b.com' });
    expect(buildUserDoc('uid1', 'a@b.com', '01712345678')).toEqual({
      uid: 'uid1',
      email: 'a@b.com',
      phone: '01712345678',
    });
  });

  it('maps common auth failures to friendly messages', () => {
    expect(authErrorMessage({ code: 'auth/email-already-in-use' })).toContain('already registered');
    expect(authErrorMessage({ code: 'auth/weak-password' })).toContain('too weak');
    expect(authErrorMessage({ code: 'auth/invalid-credential' })).toContain('Wrong email');
    expect(authErrorMessage({ code: 'auth/too-many-requests' })).toContain('Too many');
    expect(authErrorMessage(new Error('Custom validation message'))).toBe('Custom validation message');
    expect(authErrorMessage({ code: 'auth/something-new' })).toContain('Something went wrong');
  });

  it('maps aborted requests to the slow-network message', () => {
    expect(authErrorMessage(new DOMException('The operation was aborted.', 'AbortError'))).toBe(
      AUTH_SLOW_NETWORK_MESSAGE
    );
  });

  it('withTimeout resolves fast promises and clears the timer', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'slow')).resolves.toBe(42);
  });

  it('withTimeout rejects with the message when the inner promise stalls', async () => {
    await expect(withTimeout(new Promise(() => {}), 10, 'Too slow.')).rejects.toThrow('Too slow.');
  });

  it('withTimeout propagates inner rejections, not the timeout', async () => {
    await expect(withTimeout(Promise.reject(new Error('inner boom')), 1000, 'slow')).rejects.toThrow(
      'inner boom'
    );
  });
});
