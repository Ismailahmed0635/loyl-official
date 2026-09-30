import { describe, it, expect } from 'vitest';
import {
  MENU_DEFAULT_BACKGROUND,
  contrastOn,
  isHexColor,
  normalizeHexColor,
  relativeLuminance,
  surfaceOn,
} from './color';

describe('normalizeHexColor — the only colours that reach the page', () => {
  it('canonicalises 3- and 6-digit hex, with or without a leading hash', () => {
    expect(normalizeHexColor('#abc')).toBe('#AABBCC');
    expect(normalizeHexColor('abc')).toBe('#AABBCC');
    expect(normalizeHexColor('#AABBCC')).toBe('#AABBCC');
    expect(normalizeHexColor('aabbcc')).toBe('#AABBCC');
    expect(normalizeHexColor('  #ff0000  ')).toBe('#FF0000');
  });

  it('returns null for anything that is not a bare hex colour', () => {
    for (const bad of ['', '#ab', '#ggg', '#abcdef0', 'rgb(1,2,3)', 'red', '# abcd']) {
      expect(normalizeHexColor(bad)).toBeNull();
    }
    expect(normalizeHexColor(null)).toBeNull();
    expect(normalizeHexColor(undefined)).toBeNull();
    expect(normalizeHexColor(0xff0000 as unknown as string)).toBeNull();
  });

  it('isHexColor mirrors that decision', () => {
    expect(isHexColor('#123456')).toBe(true);
    expect(isHexColor('123456')).toBe(true);
    expect(isHexColor('not a colour')).toBe(false);
    expect(isHexColor(null)).toBe(false);
  });
});

describe('relativeLuminance — WCAG 2.1', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('sits in between for a mid grey', () => {
    const l = relativeLuminance('#808080');
    expect(l).toBeGreaterThan(0.15);
    expect(l).toBeLessThan(0.3);
  });

  it('falls back to the default when handed junk (never NaN)', () => {
    expect(relativeLuminance('nope')).toBeCloseTo(1, 5);
    expect(relativeLuminance(MENU_DEFAULT_BACKGROUND)).toBeCloseTo(1, 5);
  });
});

describe('contrastOn — black or white text, whichever is readable', () => {
  it('puts black text on light backgrounds', () => {
    expect(contrastOn('#FFFFFF')).toBe('#000000');
    expect(contrastOn('#FFF7ED')).toBe('#000000');
    expect(contrastOn('#FFFF00')).toBe('#000000');
  });

  it('puts white text on dark backgrounds', () => {
    expect(contrastOn('#000000')).toBe('#FFFFFF');
    expect(contrastOn('#0F172A')).toBe('#FFFFFF');
    expect(contrastOn('#14532D')).toBe('#FFFFFF');
  });

  it('defaults to black for an unparseable colour', () => {
    expect(contrastOn('not-a-colour')).toBe('#000000');
    expect(contrastOn(null)).toBe('#000000');
  });

  it('always produces a pair with a usable contrast ratio (WCAG AA ≥ 4.5)', () => {
    const luminanceOf = (hex: '#000000' | '#FFFFFF') =>
      hex === '#FFFFFF' ? 1 : 0;
    for (const bg of ['#FFFFFF', '#FFF7ED', '#FEF3C7', '#ECFDF5', '#0F172A', '#14532D', '#7C3AED']) {
      const fg = contrastOn(bg);
      const l1 = Math.max(relativeLuminance(bg), luminanceOf(fg));
      const l2 = Math.min(relativeLuminance(bg), luminanceOf(fg));
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('surfaceOn — panels always differ from the page, never the text', () => {
  it('lightens panels on light backgrounds', () => {
    expect(surfaceOn('#FFFFFF')).toBe('rgba(255,255,255,0.14)');
    expect(surfaceOn('#FFF7ED')).toBe('rgba(255,255,255,0.14)');
  });

  it('darkens panels on dark backgrounds', () => {
    expect(surfaceOn('#000000')).toBe('rgba(0,0,0,0.05)');
    expect(surfaceOn('#0F172A')).toBe('rgba(0,0,0,0.05)');
  });

  it('never throws on junk input', () => {
    expect(surfaceOn('junk')).toBe('rgba(255,255,255,0.14)');
    expect(surfaceOn(null)).toBe('rgba(255,255,255,0.14)');
  });
});
