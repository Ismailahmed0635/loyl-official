import type { Metadata, MetadataRoute } from 'next';
import { APP_NAME, APP_SLOGAN } from '@/lib/constants';

/**
 * Phase 8 — SEO & PWA metadata helpers.
 *
 * Everything here is pure and unit-tested (`metadata.test.ts`); the files in
 * `app/` that Next turns into routes (`manifest.ts`, `robots.ts`,
 * `sitemap.ts`) are thin callers, and `layout.tsx` composes its `metadata`
 * export from the same constants — so the favicon, theme colour, canonical
 * base and crawler rules can never disagree between files.
 *
 * `NEXT_PUBLIC_APP_URL` is the production origin. It is unset until the
 * domain is fixed after publish (user decision, 2026-09-26), so every helper
 * falls back to localhost and tolerates an invalid/trailing-slash value.
 */

const FALLBACK_APP_URL = 'http://localhost:3000';

/** Public origin for canonical URLs, OG tags, robots and the sitemap. */
export const APP_URL = resolveAppUrl(process.env.NEXT_PUBLIC_APP_URL);

/** Normalise a configured origin: trim, strip trailing slashes, validate. */
export function resolveAppUrl(raw: string | undefined | null): string {
  const candidate = (raw ?? '').trim().replace(/\/+$/, '');
  if (!candidate) return FALLBACK_APP_URL;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return FALLBACK_APP_URL;
    return url.origin;
  } catch {
    return FALLBACK_APP_URL;
  }
}

interface PageMetaInput {
  title?: string;
  description?: string;
  /** Absolute path starting with `/` — canonical + OG url. */
  path?: string;
  /**
   * `'noindex'` sets an explicit negative; `'index'` opts the page into
   * crawling (the root layout defaults the whole app to noindex because it
   * is auth-gated); omitted = no robots key, so the root default applies.
   */
  robots?: 'index' | 'noindex';
}

const ROBOTS_DIRECTIVES = {
  index: { index: true, follow: true },
  noindex: { index: false, follow: false },
} as const;

/**
 * Shared metadata shape for pages that set their own canonical/OG data. Use
 * `robots: 'index'` to opt a public page into crawling over the root
 * layout's noindex default (published menu pages do); omit the key to
 * inherit the root default.
 */
export function pageMetadata(input: PageMetaInput, base: string = APP_URL): Metadata {
  const { title, description, path = '/', robots } = input;
  const url = new URL(path, base).toString();

  return {
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    alternates: { canonical: path },
    openGraph: {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      url,
      siteName: APP_NAME,
      type: 'website',
    },
    ...(robots ? { robots: ROBOTS_DIRECTIVES[robots] } : {}),
  };
}

/**
 * Web-app manifest. Deliberately `display: 'browser'` (a product decision,
 * 2026-09-26): the web app is NOT installable — customers never install
 * anything (CODIN §11) and the merchant surface is the native app — so the
 * manifest exists to carry the favicon, theme colour and app identity only.
 */
export function buildManifest(): MetadataRoute.Manifest {
  return {
    name: `Loyl — ${APP_SLOGAN}`,
    short_name: APP_NAME,
    description: 'Digital loyalty and stamp card platform for Bangladesh merchants',
    start_url: '/',
    display: 'browser',
    background_color: '#F1FCF4',
    theme_color: '#0D472A',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}

/**
 * Crawler policy: this origin hosts the auth-gated app, so `Disallow: /` is
 * the default and `Allow: /menu/` opts in the one crawlable surface - the
 * published digital menus. Robots uses longest-match semantics, so
 * `/menu/slug` wins `Allow: /menu/` while `/` stays blocked.
 *
 * The marketing landing is NOT served here: it is the standalone static site
 * in `landing page/`, deployed to its own host with its own robots.txt, which
 * is why this app must not advertise `/` (it only 307s to /welcome).
 */
export function buildRobots(base: string = APP_URL): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/menu/',
        disallow: '/',
      },
    ],
    sitemap: new URL('/sitemap.xml', base).toString(),
  };
}

/**
 * Sitemap entries: published digital menus only; `slugs` comes from the DB at
 * request time (sitemap.ts is force-dynamic) and is empty when none exist.
 * `/` is deliberately absent - it redirects to /welcome on this origin, and a
 * redirect target must never be advertised.
 */
export function buildSitemapEntries(slugs: string[], base: string = APP_URL): MetadataRoute.Sitemap {
  return slugs.map((slug) => ({
    url: new URL(`/menu/${slug}`, base).toString(),
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }));
}
