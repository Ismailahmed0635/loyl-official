/** Small display helpers shared by customer-facing pages (Phase 3). */

/** "23h 5m" / "12m" / "any moment now" — time remaining until an ISO timestamp. */
export function timeUntil(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'any moment now';
  const mins = Math.ceil(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * "23:59:41" / "00:04:12" — a ticking HH:MM:SS countdown to an ISO timestamp.
 * Returns "00:00:00" once the target has passed (or if it never parsed), so a
 * caller can flip its UI the moment the window opens instead of waiting for a
 * refetch. Returns "" when no target was supplied at all.
 */
export function timeLeftClock(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return '00:00:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** 01712345678 → 017••••5678 (customer profile display). */
export function maskPhone(phone: string): string {
  const p = (phone || '').replace(/^\+88/, '');
  if (p.length < 7) return p;
  return `${p.slice(0, 4)}••••${p.slice(-3)}`;
}
