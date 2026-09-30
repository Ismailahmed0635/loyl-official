/**
 * Background/foreground colour maths for the Digital Menu Card (Phase 12).
 *
 * Lives in `lib/` rather than `backend/` because BOTH ends need it: the public
 * server page computes the text colour, and the merchant editor previews the
 * exact same pairing while the merchant is still choosing. Sharing one
 * implementation is the only way the preview and the published page can be
 * guaranteed to agree.
 *
 * No Node imports — this module is safe in a client component.
 */

/** Default background of the public menu page. */
export const MENU_DEFAULT_BACKGROUND = '#FFFFFF';

/**
 * Accepts `#abc`, `abc`, `#AABBCC` or `AABBCC` and returns canonical
 * `#RRGGBB`. Anything else returns null so the caller can reject it rather
 * than paint the page with user-supplied CSS.
 */
export function normalizeHexColor(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw
      .split('')
      .map((c) => (c + c).toUpperCase())
      .join('')}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toUpperCase()}`;
  return null;
}

/** True when the string is a colour `normalizeHexColor` would accept. */
export function isHexColor(input: string | null | undefined): boolean {
  return normalizeHexColor(input) !== null;
}

function srgbChannel(value8: number): number {
  const s = value8 / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance of a `#RRGGBB` colour (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const clean = normalizeHexColor(hex) ?? MENU_DEFAULT_BACKGROUND;
  const r = parseInt(clean.slice(1, 3), 16);
  const g = parseInt(clean.slice(3, 5), 16);
  const b = parseInt(clean.slice(5, 7), 16);
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

/**
 * Readable foreground for a background: picks whichever of pure black / pure
 * white has the higher WCAG contrast ratio against it. The merchant may pick
 * any colour they like — the customer still has to be able to read the page.
 */
export function contrastOn(hex: string | null | undefined): '#000000' | '#FFFFFF' {
  const normalised = normalizeHexColor(hex);
  if (!normalised) return '#000000';
  const l = relativeLuminance(normalised);
  // Contrast vs white = 1.05 / (L + 0.05); vs black = (L + 0.05) / 0.05.
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#FFFFFF' : '#000000';
}

/**
 * Tint for cards and rules on the page. The overlay always runs *away* from
 * the chosen text colour (light overlay on light backgrounds, dark on dark),
 * so a panel stays a panel instead of swallowing the copy.
 */
export function surfaceOn(hex: string | null | undefined): string {
  const normalised = normalizeHexColor(hex) ?? MENU_DEFAULT_BACKGROUND;
  return relativeLuminance(normalised) > 0.4
    ? 'rgba(255,255,255,0.14)'
    : 'rgba(0,0,0,0.05)';
}
