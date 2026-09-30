# FIX_PLAN.md — prioritized, hours, owner, verify (RULE 7)

Sort: CRITICAL → HIGH → MEDIUM → LOW; quick wins first within severity.
Owners: BE = backend, FE = frontend, OPS = deploy/infra, DOC = docs/process.

| ID | Phase | Sev | Title | Hrs | Owner | Depends on | Verify cmd |
|---|---|---|---|---|---|---|---|
| SEC-01 | 2 | CRITICAL | JWT fail-fast + rotate leaked fallback | 1 | BE | — | `JWT_SECRET= npm run typecheck` fails; `npm test` passes set |
| SEC-02 | 2 | HIGH | OTP send/verify throttling (429+Retry-After) | 3 | BE | ST-02 pattern | `node scripts/phase1-smoke.mjs` + 6th-rapid-send → 429 |
| SEC-03 | 2 | HIGH | Patch Next.js 14.x, full CODIN §7 verify | 2 | OPS | — | `npm audit --audit-level=high` clean for next; build OK |
| SEC-04 | 2 | HIGH | testCode behind explicit flag, not NODE_ENV | 1 | BE | — | prod-env send → no `testCode` key |
| P-01 | 6 | HIGH | Env schema + fail-fast at boot | 2 | BE | SEC-01 | boot without var → throw naming the var |
| P-07 | 6 | HIGH | First migration baseline + deploy drill | 4 | OPS | — | `prisma migrate deploy` clean on staging clone |
| P-12 | 6 | HIGH | git init + CI + branch protection | 3 | OPS | — | push to branch → CI red/green correctly |
| T-01 | 3 | MEDIUM | Malformed JSON → 422 (all 39 routes) | 1 | BE | — | PoC `audit/pocs/t01-malformed-json.mjs` → 422 everywhere |
| RT-01 | 7 | MEDIUM | Session revocation (jti blocklist / short TTL) | 4 | BE | SEC-01 | logout → old token 401 |
| P-05 | 6 | MEDIUM | `/api/health` (+ready) + smoke assert | 0.5 | BE | — | `curl /api/health` 200 `{db:true}` |
| SEC-05 | 2 | MEDIUM | Security headers (CSP/HSTS/nosniff/…) | 2 | FE | — | `curl -sI /welcome` shows CSP; phase8 smoke assert |
| SEC-07 | 2 | MEDIUM | Magic-byte upload validation | 3 | BE | dep approval | polyglot upload → 422 |
| RT-02 | 7 | MEDIUM | Append-only admin action log | 6 | BE | P-07 (table) | approve → row in log; smoke asserts |
| SEC-08 | 2 | MEDIUM | Admin runbook (vault pw, rotation) | 1 | DOC | — | doc exists; login smoke green |
| ST-01 | 1 | MEDIUM | Parse JWT claims via schema, null on drift | 1 | BE | SEC-01 | new `backend/auth.test.ts` green |
| ST-02 | 1 | MEDIUM | Throttle sweep + multi-instance note | 1 | BE | SEC-02 | sweep test green |
| T-02 | 3 | MEDIUM | coverage provider + thresholds | 1 | OPS | dep approval | `vitest run --coverage` + report |
| T-03 | 3 | MEDIUM | Route-level unit-test net (start: 5 auth routes) | 8 | BE | — | `npm test` covers `app/api/**` |
| SEC-06 | 2 | MEDIUM | Delete `/test-auth` (or admin-gate) | 0.5 | FE | — | `GET /test-auth` → 404 |
| PERF-01 | 5 | MEDIUM | Non-blocking font load | 1 | FE | — | prod mobile LCP < 2500 |
| P-09 | 6 | MEDIUM | Quotas: checkout + extract | 2 | BE | SEC-02 | burst → 429 (part of SEC-02 test) |
| P-04 | 6 | MEDIUM | Sentry + uptime monitor | 3 | OPS | P-05 | error fires test alert |
| P-03 | 6 | MEDIUM | Request-ID + PII log scrub | 2 | BE | — | log line carries req id, no phone |
| RT-03 | 7 | LOW | Approval-velocity/device alerts | 3 | BE | — | simulated burst → alert |
| SEC-09 | 2 | LOW | Object storage for uploads | 8 | OPS | P-07 | redeploy keeps files; no `storage/` writes |
| P-13 | 6 | LOW | Legal pages + export/delete | 8 | FE+DOC | owner copy | routes live; export returns user data |
| P-08 | 6 | LOW | Backup/restore drill (once prod DB exists) | 2 | OPS | P-07 | restore to staging verified |
| P-10 | 6 | LOW | Flags: extract/dice/test-auth | 2 | BE | — | flag off → 503/404 |
| T-04 | 3 | LOW | Property/fuzz/race tests | 6 | BE | dep approval | `npm test` incl. fast-check |
| C-01 | 4 | LOW | Phone out of `?phone=` URL | 1.5 | FE | — | E2E: no digits in setup URL |
| PERF-02 | 5 | LOW | Dynamic-import welcome heavy chunks | 3 | FE | PERF-01 | build table: welcome first-load down; mTBT < 200 |
| PERF-03 | 5 | LOW | Commit budgets + CI assert | 1 | OPS | P-12 | CI red on heavy commit (RULE 10 proof) |
| UX-02 | 5 | LOW | Screen-reader pass OTP→reward | 2 | FE | — | checklist signed in PR |
| ST-06 | 1 | LOW | Uninstall bcryptjs | 0.5 | OPS | — | typecheck+test+build green |
| ST-03 | 1 | LOW | Dev-mock prod guard test | 0.5 | BE | — | prod-env test green |
| ST-04 | 1 | LOW | (covered by P-01) Firebase fail-fast | 0 | BE | P-01 | — |
| C-02 | 4 | LOW | Deprecated meta (with SEC-03 upgrade) | 0.5 | FE | SEC-03 | warning gone |
| C-03 | 4 | LOW | Set NEXT_PUBLIC_APP_URL prod | 0 | OPS | launch checklist | sitemap shows prod origin |
| C-04 | 4 | LOW | Verify guest interstitial shows no data on 3G | 0.5 | FE | — | throttled load asserts |
| T-05 | 3 | LOW | 3x runs in CI | 0 | OPS | P-12 | CI config |
| ST-07 | 1 | LOW | Record gsap exception in CODIN §5 | 0 | DOC | — | one-line doc |
| ST-05 | 1 | LOW | Hotspot cap (accepted, no split) | 0 | — | — | — |

**Total ≈ 100h** (blocker slice §2 of EXECUTIVE_SUMMARY ≈ 21h). P-02 rotation folded into SEC-01/SEC-08. P-06/P-11 need no code (drill + Vercel confirm at launch).
