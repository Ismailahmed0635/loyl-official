import type { Metadata, Viewport } from 'next';
import './globals.css';
import { APP_NAME, APP_SLOGAN } from '@/lib/constants';
import { APP_URL } from '@/lib/metadata';
import { FontLoader } from '@/components/FontLoader';

/**
 * Phase 8 — root SEO metadata. Pages under gated route groups override the
 * title via their group layouts (template applied), and public menu pages
 * already ship per-merchant `generateMetadata`. `APP_URL` resolves
 * `NEXT_PUBLIC_APP_URL` (localhost fallback until the domain is fixed).
 */
const ROOT_DESCRIPTION =
  'Loyl gives Bangladesh merchants digital loyalty & stamp cards, scratch cards, dice offers and a free digital menu — customers just scan a QR, no app needed.';

// Production misconfiguration alarm: canonicals/OG/sitemap would advertise
// localhost until NEXT_PUBLIC_APP_URL is set (domain fixed after publish).
if (process.env.NODE_ENV === 'production' && APP_URL.startsWith('http://localhost')) {
  console.warn(
    'NEXT_PUBLIC_APP_URL is unset — canonical URLs, OG tags and sitemap advertise localhost. Set it to the production origin.'
  );
}

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: 'Loyl — Digital Loyalty & Stamp Cards',
    template: '%s — Loyl',
  },
  description: ROOT_DESCRIPTION,
  applicationName: APP_NAME,
  keywords: [
    'loyalty program Bangladesh',
    'digital stamp card',
    'customer loyalty app',
    'QR loyalty',
    'digital menu',
    'scratch card offers',
  ],
  authors: [{ name: 'Loyl' }],
  openGraph: {
    type: 'website',
    siteName: APP_NAME,
    title: `Loyl — ${APP_SLOGAN}`,
    description: ROOT_DESCRIPTION,
    url: APP_URL,
  },
  twitter: {
    card: 'summary',
    title: `Loyl — ${APP_SLOGAN}`,
    description: ROOT_DESCRIPTION,
  },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icon.svg' }],
  },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    // No statusBarStyle: any value would force a color scheme, and the app is
    // light-only (Sovereign Green porcelain).
  },
  // The main app is auth-gated; public menu pages and Phase 6 marketing pages
  // opt in explicitly. Nothing crawlable today except /menu/[slug].
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // Sovereign Green primary (brain.md §3) — browser chrome / status bar tint.
  themeColor: '#0D472A',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Headlines: Plus Jakarta Sans · body & data: Inter (Sovereign Green).
            Non-blocking via FontLoader: an inline script creates the link
            during head parse so the print→all swap is armed before the CSS
            can load (a React onLoad only attaches at hydration and was losing
            that race, leaving the site on fallback fonts — see FontLoader). */}
        <FontLoader />
      </head>
      <body className="min-h-screen bg-surface text-on-surface antialiased">
        {children}
      </body>
    </html>
  );
}
