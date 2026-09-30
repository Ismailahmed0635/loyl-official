# AUDIT_05_UIUX_PERF.md — Phase 5: UI/UX + Performance + Speed

**Date:** 2026-09-29 · **Auditor:** Audit Master · **Mode:** read-only (no source edited)
**Method correction (honest):** first Lighthouse run vs `next dev` scored perf 0.42/0.37 — dev numbers are meaningless (unminified + HMR + sourcemaps). All verdicts below are vs **`next build` + `next start` on :3111** (prod-equivalent). Raw JSON in `audit/scans/`.
**Tools installed this phase (global, not repo deps):** lighthouse 13.5.0, @axe-core/cli 4.13.0 (axe CLI needs chromedriver — blocked; Lighthouse's built-in axe audits used instead).

## §A Raw numbers (prod)

```
BUILD: exit 0 · First Load shared 87.4 kB · heaviest public page /welcome 34.8 kB (164 kB first load) · lightest /scan path fine
/welcome DESKTOP: perf 0.97 · a11y 1.0 · bp 1.0 · seo 0.63 | LCP 937ms · CLS 0 · TBT 0 · FCP 917ms · SI 1194 · TTFB 21ms
/welcome MOBILE (4x throttle): perf 0.75 · a11y 1.0 · bp 1.0 · seo 0.63 | LCP 3227ms · CLS 0 · TBT 412ms · FCP 2807ms · interactive 3466ms
/scan DESKTOP: perf 0.99 · a11y 1.0 · seo 0.63 | LCP 892ms · TBT 0 · CLS ~0
Mobile LCP breakdown: TTFB 58ms + element-render-delay 2703ms; LCP element = hero <p> copy (text, not image).
  Render-blocking: Google Fonts CSS (910ms wasted) + local chunks. Long tasks: 423/188/184/129ms.
  Unused JS (mobile): one chunk 21 kB wasted (dev showed 400 kB+ unused = dev artifact, ignore).
Tap targets /welcome @375px: 6 interactive, 0 under 44px ✅. Screenshot: audit/screenshots/welcome-375.png.
SEO 0.63 everywhere = deliberate root noindex (auth-gated app) — not a defect.
```

## Findings

### PERF-01 | `frontend/app/layout.tsx` (Google Fonts `<link>`) | MEDIUM | LCP on mobile
- **Metric:** mobile LCP 3227ms vs 2500ms target; element-render-delay 2703ms, Fonts CSS render-blocking 910ms.
- **Why:** two display fonts load render-blocking; the LCP element is text so it waits for the font CSS.
- **Fix:** add `preconnect` (if absent) + non-blocking font CSS (`media="print" onload="this.media='all'"` with `<noscript>` fallback), keep `font-display:swap`; keep the no-build-network decision (CODIN) — this is runtime-only.
  ```html
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="…display=swap" media="print" onLoad="this.media='all'" />
  ```
- **Verify:** prod Lighthouse mobile LCP < 2500ms. **Target:** LCP <2.5s, perf ≥0.9 mobile.
- **Regression:** `lighthouserc.json` assert (RULE 6) — fails CI on regress.
- **Hours:** 1

### PERF-02 | `frontend/app/(auth)/welcome` 164 kB first load | LOW | Bundle
- **What:** heaviest public page (Skiper39 gsap canvas + peeps sprite + firebase client + framer-motion).
- **Why it matters:** walks straight into mobile TBT 412ms (423ms long task).
- **Fix:** dynamic-import the crowd canvas (`ssr:false`, below-fold anyway) + firebase auth chunk only when the email tab opens; measure after PERF-01 (fonts may dominate).
- **Verify:** build table shows /welcome first-load down; mobile TBT < 200ms.
- **Hours:** 3

### PERF-03 | budgets unenforced | LOW | Prevention
- **What:** no `PERF_BUDGET.json` / `lighthouserc.json` in repo — today's good numbers can regress silently.
- **Fix:** write both per RULE 6 (budgets: script 200 kB / total 700 kB / LCP 2500ms / CLS 0.1 / TBT 200ms) + CI job.
- **Verify:** CI red on a deliberately heavy commit (RULE 10 proof).
- **Hours:** 1

### UX-01 | C-01 carried: phone in `?phone=` | LOW | Form UX / privacy
- Tracked in Phase 4; fix moves phone to sessionStorage/session read. Hours 1.5 (already estimated).

### UX-02 | a11y: Lighthouse axe 1.0 on 3 page-loads, full axe CLI deferred | LOW
- **What:** page-level axe (via Lighthouse) is perfect on welcome×2 + scan; interactive flows (OTP entry errors announced? scratch canvas keyboard path exists; dice result aria-live?) were code-reviewed, not screen-reader run.
- **Fix:** one NVDA/VoiceOver pass over welcome→otp→scan→reward before launch; add `aria-live` audit to PR checklist.
- **Hours:** 2 (manual pass)

## Verified GOOD (with numbers)

| Check | Result |
|---|---|
| Desktop perf | 0.97–0.99, TBT 0, CLS 0 |
| Tap targets | 6/6 ≥ 44px @375px |
| CLS | 0 everywhere (width/height discipline holds) |
| TTFB prod | 21–58ms (no backend drag) |
| UI flows | welcome→otp→setup, scan→PENDING→approve→stamp, checkout→approve covered by 9 smokes 568/568 + Playwright snapshots (Phases 12–13 evidence) |
| Loading/Empty/Error states | Skeleton + ErrorState + per-page empty states shipped (Phase 8) |
| Contrast/tokens | Sovereign Green pairs computed by WCAG luminance (`lib/color.ts` + tests) |

## NOT run (honest gaps)

- Full 6-breakpoint × every-page screenshot matrix (1 screenshot saved; snapshots used instead).
- Offline + 3G-throttle interaction runs; 5-min idle heap-diff memory test.
- Standalone axe CLI (chromedriver blocked) — Lighthouse axe used as equivalent.
- unlighthouse bulk crawl (single-origin app; 3 representative pages measured).

---
*3-line summary: Prod desktop 0.97–0.99, mobile welcome 0.75 with a diagnosed cause (render-blocking Fonts CSS → text LCP 3.2s). Top: PERF-01 non-blocking font load. Next: Phase 6 production readiness (needs your go).*
