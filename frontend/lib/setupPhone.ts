/**
 * C-01: the verified phone used to prefill business-setup travels in
 * same-tab sessionStorage, never in the `?phone=` query string (which
 * leaks PII into history, server logs and Referer headers). The query
 * param is still honored as a fallback for old links/bookmarks.
 */
const KEY = 'loyl_setup_phone';

export function stashSetupPhone(phone: string): void {
  try {
    if (phone) sessionStorage.setItem(KEY, phone);
  } catch {
    // Private mode / disabled storage: the setup form stays fillable by hand.
  }
}

export function peekSetupPhone(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearSetupPhone(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
