import Link from 'next/link';

/**
 * Landing page — public home. Shows clear sign-up options (email + Google)
 * and a subtle WhatsApp button at bottom-right.
 */
export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 bg-surface-container-lowest">
      <div className="text-center space-y-3">
        <img src="/logo.png" alt="Loyl" className="h-16 w-auto mx-auto" />
        <h1 className="font-headline-lg-mobile text-headline-lg-mobile tracking-tight">
          Digital loyalty for Bangladesh merchants
        </h1>
        <p className="font-body-md text-body-md text-on-surface-variant max-w-xs mx-auto">
          Stamp cards, repeat customers, and simple rewards — built for local shops.
        </p>

        {/* Sign up with email */}
        <Link
          href="/welcome?mode=register"
          className="flex items-center justify-center gap-2 px-6 py-3 bg-brand-green text-white rounded-lg font-semibold text-body-md hover:bg-brand-green/90 transition-colors w-full md:w-auto"
        >
          Sign up with email
        </Link>

        {/* Continue with Google */}
        <Link
          href="/welcome"
          className="flex items-center justify-center gap-2 px-6 py-3 border border-hairline rounded-lg font-semibold text-body-md text-on-surface bg-white hover:bg-surface-container-low transition-colors w-full md:w-auto"
        >
          Continue with Google
        </Link>
      </div>

      {/* WhatsApp — subtle, bottom-right */}
      <a
        href="https://wa.me/8801339563649"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 bg-brand-green text-white text-sm font-medium rounded-full shadow-lg hover:bg-brand-green/90 transition-colors border border-white/20"
      >
        <span aria-label="WhatsApp">💬</span>
        <span>Message on WhatsApp</span>
      </a>
    </main>
  );
}
