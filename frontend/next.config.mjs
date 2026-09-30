import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Next app lives in frontend/ but imports backend/ + node_modules from the
  // repo root, so trace from the repo root or the serverless bundle misses them
  // (notably the Prisma query engine).
  experimental: {
    outputFileTracingRoot: path.join(__dirname, ".."),
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
    ],
  },
  /**
   * SEC-05: baseline security headers on every response. CSP is deny-by-
   * default with narrow allowances for this app's real third parties:
   * Google Fonts (display CSS + files), Firebase Auth + reCAPTCHA
   * (phone transport #2). `unsafe-inline` on scripts/styles is required by
   * Next.js hydration + Tailwind runtime without a nonce pipeline; there are
   * no `eval` allowances. HSTS ships in production only — pinning it on
   * localhost http would poison local browsers.
   */
  async headers() {
    // Next.js dev runtime (react-refresh/webpack HMR) evaluates code with
    // `eval`, which a CSP without 'unsafe-eval' blocks — the EvalError aborts
    // the dev client bootstrap, so React never hydrates and every client gate,
    // form and interactive element is dead in `next dev` (found 2026-09-30 by
    // headless Playwright: no react fiber, clicks no-op, /menu stuck on
    // "Loading Loyl…"). Production chunks never eval, so the allowance is
    // dev-only; prod keeps the strict policy.
    const devScriptExtra =
      process.env.NODE_ENV !== 'production' ? " 'unsafe-eval'" : '';
    const csp = [
      "default-src 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
      `script-src 'self' 'unsafe-inline'${devScriptExtra} https://www.gstatic.com https://www.google.com`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://res.cloudinary.com",
      "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://www.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com",
      "frame-src 'self' https://www.google.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");
    const securityHeaders = [
      { key: "Content-Security-Policy", value: csp },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
      ...(process.env.NODE_ENV === "production"
        ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
        : []),
    ];
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
