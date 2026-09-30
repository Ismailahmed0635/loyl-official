'use client';

import React, { useEffect } from 'react';

/**
 * Phase 8 — last-resort boundary: catches anything that escapes the route
 * groups, including failures in the root layout itself. It replaces the
 * whole document, so it renders its own <html>/<body> (Next contract) and
 * deliberately avoids every shared component/style — those are exactly what
 * may have failed to load. Plain CSS-ish inline classes only.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Fatal UI error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          backgroundColor: '#F1FCF4',
          color: '#141E19',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <main style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>
            Loyl could not load
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: '#414942', margin: '0 0 24px' }}>
            A fatal error stopped the app from starting. Reload the page — if it
            keeps happening, come back in a few minutes.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 44,
              padding: '0 20px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: '#0D472A',
              color: '#FFFFFF',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload Loyl
          </button>
          {error.digest && (
            <p style={{ marginTop: 24, fontSize: 12, color: '#414942' }}>
              Error ID: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
