import { describe, expect, it } from 'vitest';
import {
  buildManifest,
  buildRobots,
  buildSitemapEntries,
  pageMetadata,
  resolveAppUrl,
} from './metadata';

describe('resolveAppUrl', () => {
  it('falls back to localhost when unset/blank', () => {
    expect(resolveAppUrl(undefined)).toBe('http://localhost:3000');
    expect(resolveAppUrl(null)).toBe('http://localhost:3000');
    expect(resolveAppUrl('   ')).toBe('http://localhost:3000');
    expect(resolveAppUrl('')).toBe('http://localhost:3000');
  });

  it('strips trailing slashes and surrounding whitespace', () => {
    expect(resolveAppUrl('https://loyl.io/')).toBe('https://loyl.io');
    expect(resolveAppUrl('  https://loyl.io///  ')).toBe('https://loyl.io');
  });

  it('keeps a non-default port', () => {
    expect(resolveAppUrl('http://localhost:3111')).toBe('http://localhost:3111');
  });

  it('falls back on non-http(s) or garbage values', () => {
    expect(resolveAppUrl('ftp://loyl.io')).toBe('http://localhost:3000');
    expect(resolveAppUrl('not a url')).toBe('http://localhost:3000');
    expect(resolveAppUrl('loyl.io')).toBe('http://localhost:3000');
  });
});

describe('pageMetadata', () => {
  it('builds a canonical path and an absolute OG url from the base', () => {
    const meta = pageMetadata(
      { title: 'Menu', description: 'd', path: '/menu/caffe-corner' },
      'https://loyl.io'
    );
    expect(meta.alternates).toEqual({ canonical: '/menu/caffe-corner' });
    expect(meta.openGraph).toMatchObject({
      title: 'Menu',
      description: 'd',
      url: 'https://loyl.io/menu/caffe-corner',
      siteName: 'Loyl',
      type: 'website',
    });
  });

  it('defaults the path to / and the base to APP_URL resolution', () => {
    const meta = pageMetadata({ title: 'x' });
    expect(meta.openGraph!.url).toMatch(/^https?:\/\/[^/]+\/$/);
  });

  it('omits title/description keys that were not given', () => {
    const meta = pageMetadata({ path: '/menu/a' }, 'https://loyl.io');
    expect(meta).not.toHaveProperty('title');
    expect(meta).not.toHaveProperty('description');
    expect(meta.openGraph).not.toHaveProperty('title');
  });

  it('sets robots directives only when asked', () => {
    expect(pageMetadata({ robots: 'noindex' }).robots).toEqual({ index: false, follow: false });
    expect(pageMetadata({ robots: 'index' }).robots).toEqual({ index: true, follow: true });
    // No key = inherit the root layout default (the app is noindex at the root).
    expect(pageMetadata({}).robots).toBeUndefined();
  });
});

describe('buildManifest', () => {
  const manifest = buildManifest();

  it('is deliberately not installable (web-only product decision)', () => {
    expect(manifest.display).toBe('browser');
  });

  it('carries the Loyl identity and Sovereign Green colours', () => {
    expect(manifest.name).toContain('Loyl');
    expect(manifest.short_name).toBe('Loyl');
    expect(manifest.theme_color).toBe('#0D472A');
    expect(manifest.background_color).toBe('#F1FCF4');
    expect(manifest.start_url).toBe('/');
  });

  it('declares the regular and maskable SVG icons', () => {
    expect(manifest.icons).toEqual([
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ]);
  });
});

describe('buildRobots', () => {
  it('disallows the whole app and opts in only the public menus', () => {
    const robots = buildRobots('https://loyl.io');
    expect(robots.rules).toEqual([
      {
        userAgent: '*',
        allow: '/menu/',
        disallow: '/',
      },
    ]);
  });

  it('points at the sitemap on the configured base', () => {
    expect(buildRobots('https://loyl.io').sitemap).toBe('https://loyl.io/sitemap.xml');
    expect(buildRobots().sitemap).toMatch(/\/sitemap\.xml$/);
  });
});

describe('buildSitemapEntries', () => {
  it('maps published menu slugs to absolute urls', () => {
    const entries = buildSitemapEntries(['caffe-corner', 'salon-blue'], 'https://loyl.io/');
    expect(entries.map((e) => e.url)).toEqual([
      'https://loyl.io/menu/caffe-corner',
      'https://loyl.io/menu/salon-blue',
    ]);
    expect(entries[0]).toMatchObject({ changeFrequency: 'weekly', priority: 0.6 });
    expect(entries[0].lastModified).toBeInstanceOf(Date);
  });

  it('advertises nothing at all when no menu is published', () => {
    expect(buildSitemapEntries([], 'https://loyl.io')).toEqual([]);
  });
});
