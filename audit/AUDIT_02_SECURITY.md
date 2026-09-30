# AUDIT_02_SECURITY.md — Phase 2: Security Audit (MOST IMPORTANT)

**Date:** 2026-09-29 · **Auditor:** Audit Master · **Mode:** read-only (no source edited)
**Prior:** `AUDIT_00_RECON.md` R-01…R-18 → proven / rejected below. Phase 1 ST-items referenced, not repeated.
**Tools run:** `npm audit --audit-level=high` (raw output §A), manual `Select-String` sweeps (no-network, no-install). NOT run: semgrep, gitleaks/trufflehog binaries, trivy, nuclei, ZAP (not installed; user chose "start with what exists" — install decision still open for repeat pass).

## §A Raw tool output

```
npm audit: 2 moderate (vitest/vite/esbuild dev-only) + Next.js 14.2.10 →
  CRITICAL advisories incl. GHSA-7m27-7ghc-44w9 (DoS Server Actions),
  GHSA-7gfc-8cq8-jh5f + GHSA-f82v-jwr5-mffw (auth/middleware bypass),
  GHSA-4342-x723-ch2f (SSRF via middleware redirect), GHSA-xv57-4mr9-wg8v
  (content injection image-opt), + ~20 more cache-poisoning/DoS/XSS entries.
  (Full list in shell output; fix = patch 14.2.x, see SEC-03.)

Hardcoded-secret sweep (AKIA/ghp_/sk-/AIza/BEGIN PRIVATE/123456-master):
  → only test phone numbers + OTP-fixture codes in *.test.ts (expected).
testCode: frontend/app/api/auth/otp/send/route.ts:26-27 (NODE_ENV-gated, see SEC-04)
JWT fallback: backend/auth.ts:5 + frontend/middleware.ts:27 (identical string, see SEC-01)
Rate-limit sweep on api/auth: 0 hits (see SEC-02)
Headers/CSP/CORS sweep: 0 hits (see SEC-05)
Raw SQL / child_process / eval sweep: 0 hits (see Safe §S-04)
test-auth public: frontend/middleware.ts:31 PUBLIC_PATHS includes '/test-auth' (see SEC-06)
Upload MIME: backend/menu.ts:191 `MENU_PHOTO_MIME_EXT[file.type...]` — client string only (see SEC-07)
.gitignore covers .env/.env.local — but D:\loyl.io is NOT a git repo (no history to leak-scan; gitleaks deferred)
```

## Findings (every one: ID + file:line + severity + OWASP + CVSS + chain + PoC + before/after + verify + regression + hours)

### 🚨 SEC-01 | `backend/auth.ts:5` + `frontend/middleware.ts:27` | CRITICAL | A07 AuthN
- **What:** identical hardcoded `JWT_SECRET` fallback in two places.
- **Impact:** any deployment with the var unset (preview, self-host, misconfigured Vercel env) accepts attacker-forged `loyl_session` cookies — full merchant/customer impersonation. Secret also lives in repo history.
- **Attack chain:** 1) deploy without JWT_SECRET → 2) `jose` signs with known string → 3) mint `{role:'merchant', userId:<victim>}` → 4) call merchant APIs as victim.
- **PoC (local, synthetic):** unset JWT_SECRET → `createSessionToken` + `verifySessionToken` round-trip succeeds with the public fallback string.
- **❌:** `process.env.JWT_SECRET || 'loyl_default_secure_secret_key_2026_bd_market'` (×2)
- **✅ (proposal):** fail fast at boot in both files: `if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET missing')`; rotate the secret everywhere it was ever set (assume leaked per RULE 5).
- **Verify:** `JWT_SECRET= npm run typecheck` should fail; `npm test` with var set passes.
- **Regression:** `backend/auth.test.ts` (new): boot without var → throw; forged token with wrong secret → `null`.
- **Hours:** 1 (+ rotation ceremony)

### SEC-02 | `frontend/app/api/auth/otp/send/route.ts:8` (+ verify) | HIGH | A07 AuthN
- **What:** zero rate limiting on OTP send/verify; admin throttle exists, OTP has none (sweep = 0 hits).
- **Impact:** SMS-budget drain (Cognito costs per send) + 6-digit code brute force (10⁶ space, no lockout).
- **Chain:** loop `POST /api/auth/otp/send` → victim phone spammed + attacker wallet drained; loop `verify` with rotating codes.
- **PoC:** `for i in 1..20: POST /api/auth/otp/send {phoneNumber}` → all 200, no 429 (run against localhost only).
- **❌:** handler goes straight `sendOtpSchema.safeParse → sendOtp(cleanPhone)`.
- **✅:** per-phone + per-IP throttle (reuse `checkLoginAllowed` pattern, durable store per ST-02), 429 + `Retry-After`; CAPTCHA before prod SMS spend.
- **Verify:** `node scripts/phase1-smoke.mjs` + new throttle test asserting 429 on 6th rapid send.
- **Regression:** `backend/api/auth-throttle.test.ts` (new).
- **Hours:** 3

### SEC-03 | `package.json:28` next 14.2.10 | HIGH | A06 Vulnerable components
- **What:** installed Next.js carries CRITICAL advisories (auth bypass GHSA-7gfc-8cq8-jh5f / GHSA-f82v-jwr5-mffw, SSRF GHSA-4342-x723-ch2f, DoS/XSS/cache-poisoning set — §A).
- **Impact:** framework-level bypass/DoS above any app guard.
- **PoC:** version proof only — `node -e "console.log(require('./node_modules/next/package.json').version)"` → 14.2.10; advisory text in §A. No exploit run (would be DAST against local only — Phase 7 territory).
- **Fix:** upgrade within 14.x to the latest patched release, `npm audit` re-run, full `typecheck + test + build + 9 smokes` (CODIN §7). Do NOT jump majors pre-prod.
- **Verify:** `npm audit --audit-level=high` shows zero critical for next; `npm run build` exit 0.
- **Regression:** CI gate `npm audit --audit-level=high` (AUDIT_CI, Phase 6).
- **Hours:** 2 (incl. full verification)

### SEC-04 | `frontend/app/api/auth/otp/send/route.ts:26-27` | HIGH* | A07 (*CRITICAL on misconfigured hosts)
- **What:** `testCode` returned whenever `NODE_ENV !== 'production'` (R-01 proven).
- **Impact:** correct prod = safe; any non-prod `NODE_ENV` on a reachable host (preview, `next start` misconfig) = OTP bypass for any phone.
- **PoC:** `NODE_ENV=development POST /api/auth/otp/send` → response contains `testCode` → `verify` with it → session.
- **❌:** conditional spread on `NODE_ENV`.
- **✅:** gate on an explicit `ALLOW_TEST_CODE=true` flag instead of `NODE_ENV`, default off; plus startup assert that prod has it off.
- **Verify:** prod-env smoke: response has no `testCode` key.
- **Regression:** extend `backend/api/auth.test.ts` D1 test to the send route (assert key absent under production).
- **Hours:** 1

### SEC-05 | `frontend/next.config.mjs` (+ no vercel.json) | MEDIUM | A05 Misconfig
- **What:** zero security headers (no `headers()` block, no CSP/HSTS/X-Frame/X-Content-Type/Referrer/Permissions-Policy — sweep 0 hits); no `/health` endpoint (recon §0.11).
- **Impact:** clickjacking, MIME-sniff, missing HSTS downgrade; no CSP = stored-XSS blast radius larger (no XSS found in Phase 1, this is depth).
- **Fix:** add `headers()` with deny-by-default CSP + `frame-ancestors 'none'`, HSTS (prod), `nosniff`, `no-referrer-when-downgrade` minimum; document exceptions.
- **Verify:** `curl -sI localhost:3000/welcome | grep -i content-security`.
- **Regression:** extend `scripts/phase8-smoke.mjs` with header assertions.
- **Hours:** 2

### SEC-06 | `frontend/middleware.ts:31` + `frontend/app/test-auth/page.tsx` | MEDIUM | A01 AuthZ
- **What:** `/test-auth` email-auth harness is publicly routable and writes `users/{uid}` to Firestore — outside this repo's auditable scope (R-04 proven; page comment says "Delete before launch").
- **Impact:** public write path to a Firebase project with unknown rules (UNKNOWN-6 in recon).
- **Fix:** delete the route before launch (as its own comment orders) or gate behind admin; rotate/audit Firestore rules in console.
- **Verify:** `GET /test-auth` → 404/redirect after removal.
- **Regression:** smoke asserts `/test-auth` not in PUBLIC_PATHS.
- **Hours:** 0.5

### SEC-07 | `backend/menu.ts:191` | MEDIUM | A04 Upload
- **What:** photo/screenshot validation trusts the client-sent `file.type` MIME string only — no magic-byte sniffing (R-09 proven at line 191; size cap 5MB exists).
- **Impact:** stored "image" may be arbitrary bytes, served back with attacker-influenced content-type (`menu.ts:232` derives content-type from extension).
- **Fix:** sniff magic bytes server-side (e.g. `file-type` pkg — needs dep approval per CODIN) or re-encode via image decoder; serve with fixed `image/*` allowlist + `Content-Disposition: attachment` for downloads.
- **Verify:** upload `%PDF`-bytes-as-`image/png` → 422.
- **Regression:** `backend/menu.test.ts` + `billing.test.ts` polyglot-upload cases.
- **Hours:** 3 (incl. dep decision)

### SEC-08 | `backend/admin.ts` (password-only, no MFA) | MEDIUM | A07
- **What:** admin = single password, no MFA; throttle is in-memory per-instance (ST-02).
- **Impact:** password leak = full platform; throttle weakens ×instances.
- **Fix (pre-prod acceptable):** long generated password in vault + rotation runbook; post-prod: TOTP. Durable throttle with ST-02 sweep.
- **Verify:** login smoke + throttle tests.
- **Hours:** 1 (runbook) / 8 (TOTP — deferred)

### SEC-09 | `storage/menu-photos` + `storage/payment-screenshots` | LOW | Prod integrity
- **What:** uploads on local FS via `process.cwd()` (R-08) — ephemeral/lost on serverless, unbounded growth (19 PNGs already committed).
- **Impact:** data loss on redeploy/scale; disk exhaustion.
- **Fix:** object storage (Supabase Storage/S3) before prod; Phase 6 owns it.
- **Hours:** 8 (deferred, tracked in FIX_PLAN)

## Proven SAFE this phase (with the control that stops it)

| # | Claim | Verdict + proof |
|---|---|---|
| S-01 | role escalation via OTP body (R-03) | SAFE — `schemas.ts:49,73` enum is `['merchant','customer']` only; `role:'admin'` → 422 (schema tests :422); verify route 422 per CODIN §3 |
| S-02 | merchant↔customer session confusion | SAFE — `handler.ts:108-124` explicit ADMIN_SESSION/CUSTOMER_SESSION rejects; customer layouts redirect admin |
| S-03 | approval replay / redirected proof | SAFE — `handler.ts:158-169` binds signature to `ctx.params.id`; PENDING→APPROVED is atomic guarded `updateMany` (CODIN §6); unknown device = same 403 (no oracle) |
| S-04 | SQL/NoSQL/command injection | SAFE at static level — 0 hits for `$queryRaw/$executeRaw/child_process/exec/spawn/eval`; Prisma is the only data path (CODIN §4) |
| S-05 | secrets in git history | NOT APPLICABLE here — `D:\loyl.io` has no `.git` (git check failed); `.gitignore` covers `.env/.env.local`; gitleaks run deferred to the machine that hosts git history |
| S-06 | XSS stored/reflected | NO SOURCE FOUND — 0 `dangerouslySetInnerHTML/innerHTML` (Phase 1 sweep); React auto-escape holds; upload-content-type vector tracked as SEC-07, not an XSS finding |

## UNKNOWNs (not guessed)

- Actual `JWT_SECRET/ADMIN_PASSWORD/DATABASE_URL/AWS_*/FIREBASE_*/OPENAI_*` values in any env (never read).
- Whether Cognito real pool / Firebase Phone / OpenAI Vision are live anywhere.
- Firestore rules for SEC-06 (console-only).
- Exploitability of each Next.js CVE against this app's config (version-level only — dynamic proof is Phase 7, localhost-only).

## Top 10 must-fix (security order)

1. SEC-01 JWT fail-fast + rotate (1h) 2. SEC-02 OTP throttling (3h) 3. SEC-03 Next patch (2h) 4. SEC-04 testCode flag (1h) 5. SEC-05 headers (2h) 6. SEC-06 delete /test-auth (0.5h) 7. SEC-07 magic-byte uploads (3h) 8. SEC-08 admin runbook (1h) 9-10. reserved for Phase 7 red-team confirmations.

---
*3-line summary: Ran npm audit (Next 14.2.10 criticals) + secret/guard/upload sweeps — 9 findings (1 critical, 3 high). Top: hardcoded JWT fallback in 2 files = session forgery on any var-missing deploy. Next: Phase 3 dynamic testing (needs your go).*
