/**
 * Non-blocking Google Fonts loader (PERF-01).
 *
 * Server component: the `print` → `all` swap must be armed DURING HTML parse,
 * not at hydration. The previous client version relied on React's `onLoad`,
 * which only attaches when React hydrates — the small Google Fonts CSS beat
 * hydration on fast loads, the `load` event fired unhandled, `media` stayed
 * `"print"` forever, and the entire site silently rendered in fallback fonts
 * (verified by headless audit 2026-10-02: `document.fonts` had 0 faces and no
 * woff2 was ever requested, on both a local and a throttled run).
 *
 * The inline script creates the stylesheet link itself, so its `onload`
 * listener exists before the request can possibly complete — the swap is
 * guaranteed in both orderings. `media="print"` keeps the stylesheet
 * non-render-blocking for first paint; `display=swap` avoids invisible text
 * once it applies. `<noscript>` keeps a plain link for no-JS readers.
 * No build-time network — runtime only. CSP: `script-src` allows
 * `'unsafe-inline'`, `style-src`/`font-src` allow fonts.googleapis.com /
 * fonts.gstatic.com (next.config.mjs SEC-05).
 */
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700&display=swap';

const FONT_BOOTSTRAP = `(function(){var l=document.createElement("link");l.rel="stylesheet";l.href="${FONT_HREF}";l.media="print";l.onload=function(){this.media="all";};document.head.appendChild(l);})();`;

export function FontLoader() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: FONT_BOOTSTRAP }} />
      <noscript>
        <link href={FONT_HREF} rel="stylesheet" />
      </noscript>
    </>
  );
}
