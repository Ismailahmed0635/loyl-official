/**
 * frontend/lib/firebase/phone-format.ts — pure E.164 helpers (no Firebase
 * imports, so colocated unit tests need no SDK or DOM).
 */

/** Local 017... -> E.164 +880... Null when not a BD mobile. */
export function localPhoneToE164Client(local: string): string | null {
  const clean = local.trim().replace(/^\+88/, '');
  return /^01[3-9]\d{8}$/.test(clean) ? `+88${clean}` : null;
}
