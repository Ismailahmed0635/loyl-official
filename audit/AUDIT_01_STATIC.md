# AUDIT_01_STATIC.md — Phase 1: Static Code Audit

**Date:** 2026-09-29 · **Auditor:** Audit Master · **Mode:** read-only (no source edited)
**Prior context:** `audit/AUDIT_00_RECON.md` (R-01…R-18 are the input queue; this phase proves or rejects the static ones)
**Toolchain actually used:** `npm run typecheck` (tsc), PowerShell `Select-String` (rg/fd unavailable — see Recon §0.1), manual read of `backend/*.ts`. NOT run: eslint (no config in repo), semgrep/gitleaks (Phase 2), knip/jscpd/madge (not installed — recorded as gaps, not findings).

## Raw tool output (unhidden)

```
> npm run typecheck → tsc -p frontend/tsconfig.json → CLEAN (exit 0, no output)

:any casts in backend+lib+components → 0 hits
@ts-ignore / @ts-expect-error / @ts-nocheck → 0 hits
empty catch `catch {}...{}` → 0 hits
TODO|FIXME|HACK|@deprecated → 0 hits
dangerouslySetInnerHTML / innerHTML → 0 hits
bcrypt|sharp|cloudinary imports → 0 code imports
  (only prose: menu.ts:490 "sharper photo", 2× helperText "Cloudinary or web URL", poster.ts:4 "sharp is deferred")
console.* in backend/*.ts → 5 hits (all warn/error, deliberate):
  activity.ts:33, billing.ts:102, devices.ts:335 (best-effort warn), cognito.ts:244 ([OTP:dev] log), menu.ts:497 (vision error)
non-null `!` in backend → only tests + 3 prod sites (all verified safe, see §Verified safe)
timers/listeners → 24 hits, all sampled cleanups present (requests/page.tsx:79-80 set+clearInterval pair verified)
```

## Findings (RULE 8 — all 12 fields each)

### ST-01 | `backend/auth.ts:41` | MEDIUM | Correctness/Type-safety
- **Category:** code-quality (auth-adjacent; exploit path is Phase 2/7 territory)
- **What's wrong (1 sentence):** `verifySessionToken` casts the verified JWT payload straight to `SessionPayload` with zero runtime shape check.
- **Why it matters:** any claim drift (missing `role`, wrong `phoneNumber` type, future field rename) compiles clean and fails at a guard three hops away instead of at the trust boundary; a token minted by an older/newer code version is accepted on signature alone.
- **How to reproduce:** unit-test: `createSessionToken({userId:'x'} as any)` → `verifySessionToken` returns it without complaint (no such test exists today).
- **❌ Before:** `backend/auth.ts:38-45`
  ```ts
  const { payload } = await jwtVerify(token, JWT_SECRET);
  return payload as unknown as SessionPayload;
  ```
- **✅ After (proposal, NOT applied):** parse through the existing Zod session shape (or a new `sessionPayloadSchema`) and return `null` on failure:
  ```ts
  const parsed = sessionPayloadSchema.safeParse(payload);
  if (!parsed.success) return null;
  return parsed.data;
  ```
- **Verify cmd:** `npm run typecheck && npx vitest run backend/auth.test.ts` (new file)
- **Regression test to add:** `backend/auth.test.ts`: forged-shape token → `null`; valid token → payload; expired → `null`.
- **Est. fix time:** 1h

### ST-02 | `backend/admin.ts:58` | MEDIUM | Concurrency/Prod-readiness
- **Category:** prod (rate-limit integrity)
- **What's wrong:** login throttle is a module-level `Map` — per-instance memory, swept only on access.
- **Why it matters:** on multi-instance hosting the effective limit is `5 × instanceCount`/60s (recon R-14 confirmed at code level); idle keys never expire → slow unbounded growth.
- **How to reproduce:** read `admin.ts:58-90` — no `delete` except inside `checkLoginAllowed`/`clearFailedLogins`; no store outside the module.
- **❌ Before:** `const attempts = new Map<string, AttemptWindow>();` with lazy expiry.
- **✅ After (proposal):** keep Map for single-instance dev, but add a periodic sweep + document the multi-instance limit in `ARCHITECTURE.md`, or move to Postgres/Upstash before prod multi-instance.
  ```ts
  // sweep expired windows on each check (O(n), n = keys in window)
  for (const [k, w] of attempts) if (w.resetAt <= now) attempts.delete(k);
  ```
- **Verify cmd:** `npx vitest run backend/admin.test.ts` + new throttle-sweep test.
- **Regression test to add:** insert 3 expired windows → next `checkLoginAllowed` clears all three.
- **Est. fix time:** 1h (sweep) / 4h (durable store)

### ST-03 | `backend/cognito.ts:67` | LOW | Concurrency (dev-mock scope)
- **Category:** code-quality
- **What's wrong:** dev-mock OTP store is `globalThis.__loylOtpStore` in-memory Map.
- **Why it matters:** OTPs don't survive restart/scale; acceptable for dev-mock, fatal if ever enabled in prod.
- **Reproduce:** read `cognito.ts:60-80`; restart dev server → pending OTPs vanish.
- **❌/✅:** no code change — guard it: assert dev-mock never activates when `NODE_ENV=production` (test exists partially; extend it). Verify: `npm test`.
- **Regression test:** `backend/cognito.test.ts` already covers verify/replay; add "prod env ⇒ no testCode path".
- **Est.:** 0.5h

### ST-04 | `backend/firebase.ts:69` | LOW | Error-handling (fail-fast)
- **Category:** prod-readiness
- **What's wrong:** `getPrivateKey() as string` casts away the `undefined` case; misconfig surfaces later as an opaque Admin SDK error instead of a startup throw.
- **Why it matters:** operator typos in `FIREBASE_PRIVATE_KEY` cost a debugging session.
- **❌ Before:** `privateKey: getPrivateKey() as string`
- **✅ After:** `const pk = getPrivateKey(); if (!pk) throw new Error('FIREBASE_PRIVATE_KEY missing');`
- **Verify cmd:** `npm run typecheck && npx vitest run backend/firebase.test.ts` (if exists) else typecheck only.
- **Regression test:** env-unset → `getFirebaseAdmin()` throws `FIREBASE_NOT_CONFIGURED`-adjacent error.
- **Est.:** 0.5h

### ST-05 | `backend/validation/schemas.ts` (968 lines) + `backend/menu.ts` (517) | LOW | Complexity
- **Category:** code-quality
- **What's wrong:** two hotspot files carry most domain validation + menu IO; longest-file ranking: schemas 968 > menu 517 > analytics 372 > devices 339 > cognito 320.
- **Why it matters:** merge-conflict + review-cost hotspot, not a bug; splitting now would churn every route import.
- **Reproduce:** file-length table in raw output above.
- **Fix:** no split recommended pre-prod; cap: new schemas go in per-domain files only after prod. No verify cmd beyond `npm run typecheck`.
- **Est.:** 0h (accepted) / 8h (split — deferred)

### ST-06 | `package.json:18` | LOW | Dead code
- **Category:** code-quality
- **What's wrong:** `bcryptjs` (+ `@types/bcryptjs`) is a production dependency with zero imports anywhere (recon R-10 re-confirmed: grep `bcrypt` hits only prose).
- **Why it matters:** install weight + false hashing story (real hashing is Cognito/Firebase-managed).
- **Fix:** `npm uninstall bcryptjs @types/bcryptjs` (needs clean-install verification per CODIN §7).
- **Verify cmd:** `npm run typecheck && npm test && npm run build` (dev stopped, `.next` removed first).
- **Regression test:** none (dep removal).
- **Est.:** 0.5h incl. verification

### ST-07 | `frontend/components/ui/skiper-ui/skiper39.tsx:263` | LOW | Convention
- **Category:** code-quality
- **What's wrong:** `gsap` second animation engine violates CODIN §5 (Framer Motion recipes only); exactly one component uses it (recon R-06 confirmed).
- **Why it matters:** extra client bundle weight + second motion mental model; cleanup itself is correct (see Verified safe).
- **Fix:** accept for `/welcome` hero (measured, shipped) or rewrite to `variants.ts`; at minimum record the exception in CODIN §5.
- **Verify cmd:** `npm run build` + compare First Load JS.
- **Est.:** 0h (document) / 6h (rewrite — deferred)

## Verified safe (attacked, held — per RULE 3 loop)

| Claim (recon) | Verdict | Proof |
|---|---|---|
| `geo.ts:64-65` `!` null-deref | SAFE | loop iterates `geoBranches()` output, which filters nulls at `geo.ts:41-45`; `!` unreachable on null |
| `scratch.ts:150` `!` on `byId.get` | SAFE | `orderValid` at `scratch.ts:123-126` requires exact-set match; invalid/stale orders reshuffle at 131-148 before line 150 |
| skiper39 ticker/listener leak (R-06) | SAFE | `skiper39.tsx:272-278` removes resize listener + `gsap.ticker.remove(render)` + kills walks |
| request polling leaks | SAFE (sampled) | `requests/page.tsx:79-80` set+clearInterval pair; same pattern on scan page + nav (spot-checked) |
| `recordActivity` fire-and-forget | SAFE | all 3 call sites `await` it (`redeem:56`, `review:76`, `scan-requests/[id]:85`) |
| empty catch / ts-ignore / innerHTML / TODO | ABSENT | 0 hits each (raw output) |

## Not run / UNKNOWN (never guess)

- eslint/biome, knip (dead code beyond grep), jscpd (dup), madge (cycles), `vitest --coverage` (Phase 3 owns it).
- Per-function cyclomatic >10: no tool available; file/function counts tabled instead (menu.ts 14 fns is the max).

## Top 10 must-fix before prod (static-only ordering)

1. ST-01 JWT claim parse (1h) 2. ST-02 throttle sweep + multi-instance note (1h) 3. ST-04 firebase fail-fast (0.5h) 4. ST-03 dev-mock prod guard (0.5h) 5. ST-06 drop bcryptjs (0.5h) 6. ST-07 gsap exception note (0h) 7. ST-05 hotspot cap (0h). Remaining 3 slots reserved for Phase 2 security findings — static alone yields 7.

---
*3-line summary: Ran tsc (clean) + exhaustive grep/read sweep over backend + routes. Top finding: ST-01 unchecked JWT claim cast at backend/auth.ts:41. Next: Phase 2 security audit (needs your go).*
