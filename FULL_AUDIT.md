# FULL_AUDIT.md — Last-chance production audit (2026-09-30)

Mission: zero bugs, zero slow loads, smooth navigation, production-ready.
Owner: Codin. This file is the resume ledger — if the session/PC stops,
the next session reads this file and continues from the first unchecked box.

## How to resume
1. Read this file (status + findings).
2. Continue at the first `- [ ]` checkbox.
3. Keep every code rule in CODIN.md (thin routes, guard order, stable codes,
   Tailwind+motion recipes only, no new deps without asking).
4. Definition of done per fix batch: typecheck + vitest + build (dev stopped,
   .next cleaned) + relevant smoke(s). Log evidence under § Verification log.

## Phase 0 — Map (status: DONE 2026-09-30)
- [x] Ledger created; 5 parallel audit workstreams launched (A–E).

## Phase 1 — Audit (read-only sweeps)
- [x] A: pages/layouts/middleware/navigation perf report received (re-run 2026-09-30: 2 HIGH — CustomerNav plain <a> full-reload, /pricing|/terms|/privacy bounced by middleware; 2 MED — edge gate role-agnostic, customer layout flash; rest LOW/INFO)
- [x] B: API routes/guards/envelopes report received (re-run 2026-09-30: guard order CORRECT, atomic transitions PASS, cross-tenant 404 PASS; 3 LOW — raw NextResponse.json bypass, menu PUT 400 vs 422 convention, auth/me masks 500 as 200)
- [x] C: auth end-to-end report received (re-run 2026-09-30: JWT fail-fast/closed OK, Firebase modular getAuth OK, verify 10s bound OK, NAME guard per-route only (MED), logoutEmail unbounded (MED), no INVALID_TOKEN retry (MED), middleware no revocation/role (MED))
- [x] D: data/validation/DB/scripts report received (re-run 2026-09-30: 7 MED — grantStamp 2-write race, approval orphan (claim outside txn), PENDING never expires, ScratchResult/PaymentRequest lack DB unique backstop, null-installId dupes + register race, admin applySubscriptionAction unguarded, PATCH update schemas lose .strict())
- [x] E: production-readiness report received (re-run 2026-09-30: 2 CRIT — secrets on disk (gitignored, tracked-scan only), still no git repo/CI; 4 HIGH — CSP missing firestore.googleapis.com, checkout+extract unthrottled, ephemeral storage/, no migrations/backups; rest MED/LOW)

## Phase 2 — Fix batches (highest severity first)
- [x] Batch 1 (blockers: crashes, auth, data loss risk) — DONE 2026-09-30: middleware PUBLIC_PATHS += /pricing|/terms|/privacy; CustomerNav <a>→Link (5 spots); CSP connect-src += firestore.googleapis.com; menu PUT 400→422 VALIDATION_ERROR; auth/me catch → 500 apiError (was masked 200); checkout+extract per-merchant throttles (10/10min, 429 RATE_LIMITED); not-found /→/welcome direct; logoutEmail bounded.
- [x] Batch 2 (perf: slow loads, nav jank, waterfalls, bundle) — DONE 2026-09-30: font CSS non-blocking (media=print + onLoad swap, matches PERF-01 comment); MerchantNav badge poll skips hidden tabs; dashboard timeProgress zero-guard (durationDays=0 → 100, no Inf/NaN pill).
- [x] Batch 3 (correctness: mis-wired errors, edge cases, validation gaps) — DONE 2026-09-30: PATCH update schemas .strict() (unknown keys 422, test updated + mixed-key test added); Firebase verify timer cleared in finally; getAuthMe no longer caches {success:false} payloads; devices register P2002 race → rotate-winner instead of 500; claim+grantStamp in ONE $transaction (no APPROVED-without-stamp orphan); +rateLimit spend-brake test.
- [x] Batch 4 (production hardening) — DONE what code can do 2026-09-30: CSP += object-src 'none' + upgrade-insecure-requests; dead ALLOW_TEST_CODE removed from .env.example/.env.local (OTP gone since Phase 14, nothing read it). OPEN, needs user/infra: git init + CI activate, prod DB + migrations baseline + backups, storage/ → object storage, NEXT_PUBLIC_APP_URL prod value, Sentry/uptime, admin runbook.

## Phase 3 — Verify
- [x] typecheck clean
- [x] vitest all pass (count: 337)
- [x] build exit 0 (pages: 61)
- [x] smokes all pass (543/543)
- [ ] Playwright walkthrough 0 console errors
- [x] brain.md changelog appended

## Findings (append-only; format: [SEV] area — file:line — fact)
- [HIGH] nav-perf — frontend/components/customer/CustomerNav.tsx:37,51,90 — plain <a> full document reload (FIXED Batch 1: → next/link)
- [HIGH] guards — frontend/middleware.ts:41 — /pricing|/terms|/privacy pages exist but not public, guests bounced (FIXED Batch 1: added to PUBLIC_PATHS)
- [HIGH] CSP — frontend/next.config.mjs:48 — connect-src missing firestore.googleapis.com, profile setDoc blocked (FIXED Batch 1)
- [HIGH] spend — frontend/app/api/billing/checkout/route.ts + menu/extract/route.ts — no throttle, unlimited 5MB writes / OpenAI spend (FIXED Batch 1: 10/10min per-merchant 429)
- [LOW] envelope — frontend/app/api/merchant/menu/route.ts:61 — malformed JSON 400 vs repo 422 convention (FIXED Batch 1)
- [LOW] masking — frontend/app/api/auth/me/route.ts:25 — catch returned 200-success on server failure (FIXED Batch 1: 500 apiError)
- [MED] schema — backend/validation/schemas.ts:305 — updateScratch/Dice/Offer PATCH lose .strict() (FIXED Batch 3: .strict() + tests)
- [LOW] nav — frontend/app/not-found.tsx:94 — Return Home via / → 307 hop (FIXED Batch 1: direct /welcome)
- [MED] auth — frontend/lib/firebase/email-auth.ts:200 — logoutEmail unbounded, delays logout (FIXED Batch 1: bounded 15s)
- [MED] middleware — frontend/middleware.ts:53 — raw jwtVerify only, no claim/revocation/role check (OPEN Batch 3)
- [MED] data — backend/scan.ts:120 — grantStamp 2-write non-transactional (FIXED Batch 3: injectable client, approval wraps claim+grant in one $transaction)
- [MED] data — scan-requests/[id]/route.ts:60 — stamp grant outside claim txn, orphan risk (FIXED Batch 3: single txn, CLAIM_LOST → 409)
- [MED] data — customer/scan/route.ts:136 — PENDING never expires, no cancel (OPEN: product decision)
- [MED] schema — backend/validation/schemas.ts:305 — updateScratch/Dice/Offer PATCH lose .strict() (OPEN Batch 3)
- [MED] db — schema.prisma:174,242,322 — ScratchResult/PaymentRequest lack unique backstop; null-installId dupes (PART-FIXED Batch 3: register P2002 race → rotate; DB backstops need migration, OPEN with Batch 4 infra)
- [CRIT] git/CI — not a git repo, secure-deploy.yml can never run (OPEN Batch 4, needs user)
- [HIGH] storage — backend/billing.ts:9, backend/menu.ts:154 — ephemeral storage/ lost on redeploy (OPEN Batch 4)
- [HIGH] migrations — backend/prisma/ has no migrations/, only db:push (OPEN Batch 4)

## Verification log (append-only)
- 2026-09-30 Batch 1a (redeem/review atomic claims, business-setup mock→500, withCustomer MERCHANT_SESSION, checkout locked txn): typecheck clean; phase7 53/53, phase4 57/57, phase3 77/77 on :3001 (first phase3 attempt showed 30 transient fails mid-recompile, clean on re-run).
- 2026-09-30 Batch 1b (ScanRequest.pendingKey unique race guard + approval clears key + scan 500→409 OFFER_NOT_CONFIGURED): db:push + db:generate applied (31 existing PENDING backfilled, 0 dupe groups; dev stopped for locked engine file, orphaned node workers cleared, dev restarted :3001); typecheck clean; vitest 336/336; phase3 77/77, phase5 63/63, offer-type 107/107. Corrections to audit: checkout orphan-file claim was wrong (deleteScreenshot runs in catch, null-safe); middleware JWT_SECRET throw is caught fail-closed, not a 500.
- 2026-09-30 Batch 1c (scratch serialized claim + all api-wrapper fetch timeouts + server verify 10s bound): typecheck clean; offer-type smoke 107/107 on :3001.
- 2026-09-30 FULL_AUDIT retry Batch 1 (middleware PUBLIC_PATHS += pricing/terms/privacy; CustomerNav <a>→Link; CSP connect-src += firestore; menu PUT 400→422; auth/me 500 mask fix; checkout+extract 10/10min throttles; not-found →/welcome; logoutEmail bound): typecheck clean; vitest 336/336; build exit 0 61/61.
- 2026-09-30 FULL_AUDIT Batch 2 (font non-blocking media=print swap; badge poll hidden-tab guard; timeProgress zero-guard): typecheck clean; vitest 336/336.
- 2026-09-30 FULL_AUDIT Batch 3 (PATCH .strict() + tests; Firebase timer finally-clear; getAuthMe error-payload no-cache; devices P2002 rotate; claim+grant single $transaction): typecheck clean; vitest 337/337; all 9 smokes 543/543 on :3001.
- 2026-09-30 FULL_AUDIT Batch 4 (code-side: CSP object-src/upgrade-insecure-requests; dead ALLOW_TEST_CODE removed from .env.example/.env.local): typecheck clean. OPEN for user: git init + CI, prod DB/migrations/backups, storage→object store, NEXT_PUBLIC_APP_URL, monitoring.
- 2026-09-30 15-point pre-shipment pass: withCustomer {requireName} (scan/scratch/dice/redeem/review 422 NAME_REQUIRED at guard; cards/context read-only stay free); MUTATION_MERCHANT/MUTATION_IP throttles on business-setup + devices POST + menu PUT/photo POST; Confetti/ErrorState logs dev-gated + ErrorState home →/welcome; new firestore.rules (own-users/{uid} only, deny-all default). Verified: typecheck clean, vitest 337/337, all 9 smokes 543/543 on :3001.
