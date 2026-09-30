'use client';

/**
 * Non-blocking Google Fonts loader (PERF-01).
 *
 * Lives in its own Client Component because the root layout is a Server
 * Component and event handlers are forbidden there. The stylesheet loads
 * with `media="print"` (never render-blocking) and swaps to `all` on load,
 * so the text LCP element is not gated on the font CSS; `display=swap`
 * avoids invisible text once it arrives. No build-time network — runtime only.
 */
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700&display=swap';

export function FontLoader() {
  return (
    <>
      <link href={FONT_HREF} rel="stylesheet" media="print" onLoad={(e) => {
        e.currentTarget.media = 'all';
      }} />
      <noscript>
        <link href={FONT_HREF} rel="stylesheet" />
      </noscript>
    </>
  );
}
