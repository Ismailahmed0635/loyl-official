/**
 * Phase 12: the customer's name + phone, remembered on the device they scan
 * with.
 *
 * A QR scan often opens in a camera app or an in-app webview (WhatsApp,
 * Facebook) that drops the 30-day `loyl_session` cookie. Without a fallback
 * that sent the customer back through the name/phone form on *every* scan —
 * the exact friction this removes.
 *
 * This is deliberately NOT a security boundary and grants no new privilege:
 * `POST /api/customer/session` already mints a session for any claimed phone
 * number with no OTP step, so re-using the values this device already
 * collected only skips retyping them.
 */

export interface CustomerIdentity {
  name: string;
  phoneNumber: string;
}

/** Versioned so a future reshape can invalidate older entries cleanly. */
const STORAGE_KEY = 'loyl.customer.identity.v1';

/**
 * Read the remembered identity, or null when absent/corrupt/unavailable.
 * localStorage throws in some privacy modes and can be full — a sign-in must
 * never fail because of storage, so every path here degrades to null.
 */
export function loadCustomerIdentity(): CustomerIdentity | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { name, phoneNumber } = parsed as Record<string, unknown>;
    if (typeof name !== 'string' || typeof phoneNumber !== 'string') return null;
    if (!name.trim() || !phoneNumber.trim()) return null;
    return { name: name.trim(), phoneNumber: phoneNumber.trim() };
  } catch {
    return null;
  }
}

/** Remember the identity once a customer session has actually been issued. */
export function saveCustomerIdentity(identity: CustomerIdentity): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ name: identity.name.trim(), phoneNumber: identity.phoneNumber.trim() })
    );
  } catch {
    /* storage full or blocked — the next scan simply asks again */
  }
}

/** Drop the remembered identity (a deliberately different customer signs in). */
export function clearCustomerIdentity(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to recover from */
  }
}
