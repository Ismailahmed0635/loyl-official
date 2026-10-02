/**
 * Crowd sprite decoder (skiper39) — runs OFF the main thread.
 *
 * The 3600x2268 all-peeps.png decode measured ~185 ms on the main thread at
 * Lighthouse's 4x CPU throttle — the single largest long task at page load
 * once hydration finished. Fetching + decoding in a Worker moves all of it
 * off the UI thread; the ImageBitmap is transferred back zero-copy.
 *
 * Bundled as a real same-origin chunk via `new Worker(new URL(...))` because
 * production CSP has no `blob:` allowance (next.config.mjs SEC-05:
 * default-src 'self').
 */
const scope = self as unknown as Worker;

scope.onmessage = async (e: MessageEvent<{ src: string }>) => {
  try {
    const res = await fetch(e.data.src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    scope.postMessage({ ok: true, bitmap }, [bitmap]);
  } catch {
    scope.postMessage({ ok: false });
  }
};
