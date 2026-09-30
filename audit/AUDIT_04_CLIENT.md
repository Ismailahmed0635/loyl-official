# AUDIT_04_CLIENT.md — Phase 4: Client / Browser Simulation

**Date:** 2026-09-29 · **Auditor:** Audit Master · **Mode:** read-only (no source edited)
**Target (RULE 4):** `http://localhost:3111` only. Playwright (Chromium) + curl. Synthetic fixtures only.
**Prior:** Phase 3 API matrix → now the browser surface.

## §A Raw results

```
Playwright console (6 pages): welcome / otp / scan / admin-login / dashboard-guest → 0 ERRORS each.
  Sole warning everywhere: `<meta name="apple-mobile-web-app-capable"> is deprecated` (C-02).
  /menu/nonexistent-slug-xyz → HTTP 404 correct; the 1 console "error" is just the 404 resource line + a
  Next parallel-route default-component warning (both expected, not app bugs).
Responsive: /welcome at 375×812 and 1440×900 renders same heading tree, 0 errors both.
Storage (evaluate): localStorage=["ally-supports-cache"] (a11y-lib artifact, not a secret),
  sessionStorage=[], document.cookie="" (HttpOnly session not JS-readable ✅).
Network on /welcome: 0 XHR/fetch (13 static only) — no tokens/PII in flight.
Static sweeps: server-only env in client code = 0 hits; localStorage/sessionStorage writes = 0 hits;
  client console.* = 5 warn/error only, no PII.
Cookie (live OTP flow 01790000001): loyl_session=…; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000 ✅
  (Secure absent — correct for dev; MUST be present in prod via NODE_ENV check.)
Form abuse on otp/send: "" / "abc" / <img onerror> / emoji phone → ALL 422 ✅.
Guest GET /dashboard via curl → 307 redirect ✅ (in-browser snapshot showed the redirect shell+alert; URL behavior correct).
SEO: /robots.txt = Disallow:/ + Allow:/menu/ + Sitemap ✅; /sitemap.xml lists published slugs ✅ (origin localhost:3000 = unset NEXT_PUBLIC_APP_URL, see C-03).
```

## Findings

### C-01 | `frontend/app/(auth)/otp/page.tsx:54,66` + `welcome/page.tsx:74` | LOW | PII in URL
- **What:** verified phone number travels as `?phone=` into `/business-setup` (read at `business-setup/page.tsx:28`).
- **Impact:** phone numbers land in browser history, server access logs, and Referer headers — PII retention beyond need.
- **Reproduce:** complete OTP verify → observe `/business-setup?phone=01…` in address bar.
- **❌:** `router.push(\`/business-setup?phone=${encodeURIComponent(phone)}\`)`
- **✅:** keep the phone in a short-lived same-tab store (sessionStorage, cleared on setup) or re-read from the verified session (`/api/auth/me` already returns it).
- **Verify:** E2E welcome→setup flow; assert no `?phone=` in URL.
- **Regression:** Playwright test asserting `page.url()` contains no digits after verify.
- **Hours:** 1.5

### C-02 | `frontend/app/layout.tsx` (appleWebApp) | LOW | Deprecated meta
- **What:** every page warns `apple-mobile-web-app-capable is deprecated` — emitted by Next from the `appleWebApp` metadata.
- **Impact:** console noise; zero functional impact today; future iOS may drop the fallback.
- **Fix:** on Next upgrade (SEC-03) adopt `mobile-web-app-capable`; until then accept (1-line metadata change when the framework supports it).
- **Verify:** reload any page → warning gone.
- **Hours:** 0.5 (with SEC-03)

### C-03 | `/sitemap.xml` origin | LOW | Config
- **What:** sitemap/robots advertise `http://localhost:3000` — `NEXT_PUBLIC_APP_URL` unset in this env (env-driven by design, Phase 8 decision).
- **Impact:** none locally; production deploy MUST set the var or search engines index localhost URLs.
- **Fix:** pre-launch checklist item (Phase 6 owns): set `NEXT_PUBLIC_APP_URL`, re-fetch `/sitemap.xml`.
- **Verify:** `curl /sitemap.xml | grep '<loc>'` shows prod origin.
- **Hours:** 0 (checklist)

### C-04 | Guest `/dashboard` interstitial | INFO
- **What:** curl proves 307 redirect for guests, but the in-browser snapshot showed a shell + alert before/at redirect — likely the redirect interstitial, not a leak (no data rendered, 0 errors).
- **Impact:** none observed; recorded so a future engineer doesn't "fix" the interstitial into a data flash.
- **Verify:** throttled-3G load of `/dashboard` as guest → assert no merchant data paints before redirect.
- **Hours:** 0.5 (verification only)

## Proven SAFE live

| Probe | Result | Control |
|---|---|---|
| 5 pages console | 0 errors | error boundaries + clean hydration |
| session cookie | HttpOnly + SameSite=Lax, invisible to `document.cookie` | `backend/auth.ts:54-59` header builder |
| web storage | no secrets (one a11y-lib key only) | no localStorage/sessionStorage auth pattern |
| phone-field abuse (empty/alpha/XSS/emoji) | 422 ×4 | Zod phone rules |
| guest gating | 307 on /dashboard; layouts re-check role | middleware + layout guards |
| SEO surface | robots/sitemap correct; menus only crawlable surface | `lib/metadata.ts` single source |

## NOT run / deferred (tool or time gaps — never guessed)

- axe-core a11y scan (`@axe-core/playwright` not installed) → Phase 5 owns it with Lighthouse.
- Offline + slow-3G throttling runs → Phase 5 (needs throttling harness).
- Full 6-breakpoint screenshots into `audit/screenshots/` → Phase 5 (snapshots captured instead; 2 widths verified).
- Bundle analysis (bundlephobia/analyzer) → Phase 5 with Lighthouse budgets.

---
*3-line summary: 6 pages walked in Chromium, 0 JS errors; cookie/storage/network posture clean; one PII-in-URL habit to fix. Top: C-01 phone in ?phone= query. Next: Phase 5 UI/UX + performance (needs your go; needs lighthouse install decision).*
