/**
 * Poster & QR automation helpers (Phase 2 — Merchant Core).
 * Server-side only: uses the `qrcode` package (see TECH_STACK.md).
 * Poster-template merging with `sharp` is deferred until poster uploads ship;
 * for now the QR result page composes the poster preview client-side.
 */
import type { NextRequest } from 'next/server';
import QRCode from 'qrcode';

/** Customer route the printed QR resolves to (TEST.md §3 — /scan/[offerId]). */
export function buildScanUrl(origin: string, offerId: string): string {
  return `${origin.replace(/\/$/, '')}/scan/${offerId}`;
}

/**
 * Request origin for building absolute URLs inside route handlers.
 * Prefers forwarded headers (Vercel/proxy) and falls back to nextUrl.
 */
export function resolveRequestOrigin(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '');
  if (host) return `${proto}://${host}`;
  return req.nextUrl.origin;
}

/**
 * Renders a scannable QR PNG as a data URL.
 * Brand slate modules on white with high error correction so the code still
 * scans after print-shop resizing; green stays reserved for actions.
 */
export async function generateQrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 640,
    color: { dark: '#0F172AFF', light: '#FFFFFFFF' },
  });
}
