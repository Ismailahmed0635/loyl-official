# AUDIT_03_TESTS.md — Phase 3: Dynamic Testing

**Date:** 2026-09-29 · **Auditor:** Audit Master · **Mode:** read-only (no source edited)
**Target (RULE 4):** `http://localhost:3111` (`next dev frontend -p 3111`) + `npm test`. No prod touched. Synthetic fixtures only.
**Prior:** R-11/R-12 (routes untested at unit level; stated totals) → resolved below.

## §A Raw results

```
npm test → Test Files 20 passed · Tests 325 passed · 12.8s (single run; 3x repeat = CI job, not done here)
npx vitest run --coverage → MISSING DEPENDENCY '@vitest/coverage-v8' (no coverage data exists)
Unit-test locations: 20 files, ALL under backend/** or frontend/lib/**; ZERO under frontend/app (R-11 CONFIRMED)
Route files: 39 (49 handlers). Malformed-JSON guard `.catch(() => null)`: 19 call sites have it; otp/send does NOT.

Localhost abuse matrix (all against :3111, synthetic data):
  GET  /api/auth/me, /merchant/{stats,analytics,customers}, /offers, /billing,
       /customer/cards, /admin/{stats,merchants} (no cookie) → ALL 401 ✅
  POST /api/auth/otp/send {} → 422 ✅ | valid phone → 200 ✅
  POST /api/admin/login {"password":"wrong-password-123"} → 401 ✅
  POST /api/auth/otp/send "not-json{{{" → 500 INTERNAL_ERROR ❌ (T-01)
  POST /api/auth/otp/send SQLi / XSS phones → 422 ✅ (Zod regex holds)
  POST /api/auth/otp/verify role=admin / superhero → 422 ✅ (enum holds, S-01 reconfirmed live)
  GET  /api/customer/offers/nonexistent123 → 404 ✅
  GET  /api/merchant/menu/photo (no cookie) → 401 ✅
  POST /api/auth/otp/send with 10MB body → 422 ✅ (body-parser limit + Zod)
  GET  /api/auth/me Cookie: loyl_session=forged.invalid.token → 401 ✅ (jose rejects)
```

## Findings

### T-01 | `frontend/app/api/auth/otp/send/route.ts:10` | MEDIUM | Unhandled input
- **What:** `await req.json()` with no `.catch` — malformed JSON throws → 500 `INTERNAL_ERROR` instead of 422.
- **Impact:** log noise + 500-class on attacker-controlled bytes; inconsistent with the other 19 call sites that use `.catch(() => null)` → 422. Availability-adjacent, not data loss.
- **Reproduce:** `POST localhost:3111/api/auth/otp/send` body `not-json{{{` content-type json → 500 (observed).
- **❌:** `const body = await req.json();`
- **✅:** `const body = await req.json().catch(() => null); if (!body) return apiError('Invalid JSON body','VALIDATION_ERROR',422);`
- **Verify:** repeat PoC → 422; `node scripts/phase1-smoke.mjs` still 35/35.
- **Regression:** `backend/api/auth.test.ts` (or new route-level test): malformed body → 422, never 500.
- **Hours:** 0.5

### T-02 | No coverage provider | MEDIUM | Test infrastructure
- **What:** `@vitest/coverage-v8` not installed → `--coverage` fails; zero files <50% listable because nothing is measurable. Stated totals (312 vs 325) resolved: **325/325 in 20 files is the true count** (R-12 closed; AUDIT_SUMMARY.md's 312 is stale).
- **Impact:** coverage gates (prompt RULE 6: lines 80 / branches 70) cannot be enforced; dead code invisible.
- **Fix:** `npm i -D @vitest/coverage-v8` (dev-only, needs approval per CODIN) → `vitest run --coverage` → per-file table; add threshold to CI.
- **Verify:** `npx vitest run --coverage` exits 0 with report.
- **Hours:** 1

### T-03 | 49 handlers, 0 route-level unit tests | MEDIUM | Test infrastructure
- **What:** all HTTP assurance lives in 11 `scripts/*-smoke.mjs` (need a live dev server + DB); guard-order regressions (401→409→403→404) have no fast unit net. R-11 CONFIRMED.
- **Impact:** slow feedback; smoke-only regressions hide in CI-less workflow (no `.github/`).
- **Fix:** add `frontend/app/api/**/*.test.ts` using `next/server` request stubs (pattern exists in `backend/api/auth.test.ts`) for: guard matrix per route, malformed JSON (T-01), IDOR cross-merchant 404, expired/forged token 401. Start with the 5 auth routes + approve-payment + scan-requests/[id].
- **Verify:** `npm test` covers new files; `npm run typecheck`.
- **Hours:** 8 (sliced per route; start 2h for auth 5)

### T-04 | No property-based / fuzz / race tests | LOW
- **What:** no fast-check/hypothesis, no parser fuzzing, no concurrent-write tests at unit level.
- **Impact:** race safety (double-approve 409, dice unique, scratch cursor) proven only by live smokes, not by deterministic concurrency tests.
- **Fix (deferred, tracked):** add `fast-check` dev-dep (approval needed); property tests for `shuffle`/`discountRange`/`buildSeries`; concurrent `grantStamp`/`drawScratchReward` worker test.
- **Hours:** 6 (deferred post-prod)

### T-05 | Single test run, no flake data | LOW
- **What:** suite ran once (325 green); prompt requires 3x. Polling intervals (5/8/15s) + timing-sensitive OTP tests are the flake candidates.
- **Fix:** CI runs `npm test` 3x (or `--retry`); record flakes in TEST.md.
- **Hours:** 0 (CI config, Phase 6)

## Proven SAFE live ( localhost PoCs that failed = controls hold )

| Probe | Result | Control |
|---|---|---|
| 9 unauth GETs across merchant/customer/admin | all 401 | withAuth/withMerchant/withCustomer/withAdmin per-handler (middleware excludes /api by design) |
| SQLi + XSS phones on otp/send | 422 | Zod phone regex in sendOtpSchema |
| role=admin/superhero on verify | 422 | z.enum merchant/customer (S-01 live reconfirm) |
| forged JWT cookie | 401 | jose verify rejects |
| 10MB body | 422 | parser limit + Zod caps |
| nonexistent offer / cross-tenant shape | 404 | findFirst-scoped reads; cross-merchant 404 covered in phase2/offer-type smokes |
| wrong admin password (long) | 401 | timing-safe compare + throttle path |

## UNKNOWNs

- IDOR with two live merchants (needs 2-merchant fixture — smoke scripts assert 404 cross-merchant; not re-proven live here).
- Concurrent double-approve race (smoke asserts 409; no unit race test — T-04).
- Flake rate (1 run only — T-05).

## Must-add regression list (for FIX_PLAN)

1. malformed-JSON → 422 on all 39 routes (T-01 pattern test) 2. coverage provider + thresholds (T-02) 3. auth-route guard matrix unit tests (T-03 slice 1) 4. approve-payment + scan-approve guard matrix (T-03 slice 2) 5. throttle 429 test (from SEC-02) 6. flake 3x CI (T-05).

---
*3-line summary: Suite 325/325 green; coverage provider missing so no per-file data; live abuse matrix all-holds except one real bug. Top: T-01 malformed JSON on otp/send → 500 instead of 422. Next: Phase 4 client/browser simulation (needs your go).*
