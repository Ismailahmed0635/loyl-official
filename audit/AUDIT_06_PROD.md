# AUDIT_06_PROD.md — Phase 6: Production Readiness

**Date:** 2026-09-29 · **Auditor:** Audit Master · **Mode:** read-only (no source edited)
**Method:** every claim below is a grep/read result (0-hit = absent). No deploys touched.

## Go / No-Go table

| # | Item | Verdict | Proof |
|---|---|---|---|
| P-01 | Env validated at startup, fail-fast | ❌ NO-GO | 0 hits for envalid/Zod-env/assertEnv across `backend/ + frontend/lib`; `JWT_SECRET` falls back silently (SEC-01), Firebase key cast (ST-04) |
| P-02 | Secrets in vault + rotation runbook | ❌ NO-GO | `.gitignore` covers `.env` (good) but no vault, no rotation doc; `ADMIN_PASSWORD` rotation = manual env edit + redeploy (undocumented) |
| P-03 | Structured logging, request ID, PII redaction | ❌ NO-GO | 8 bare `console.*` in backend, no request/correlation IDs (test-file hits only = false positives); dev OTP log prints phone+code (acceptable in dev, must never reach prod transports) |
| P-04 | Monitoring / errors / uptime / alerts | ❌ NO-GO | 0 vendor SDKs (Sentry/OTel/etc.), no uptime check in repo |
| P-05 | Health endpoints | ❌ NO-GO | no `/health`, `/ready`, `/live` route (grep hits were "already" prose); load-balancer/uptime probes have nothing to hit |
| P-06 | Graceful shutdown | ⚠️ PARTIAL | Next.js drains by default; no custom handlers needed — but untested here; add to launch drill |
| P-07 | DB migrations reversible/zero-downtime | ❌ NO-GO | no `prisma/migrations/` — `db push` only (R-07 confirmed: `backend/prisma/` holds just `schema.prisma`); no drift detection, no prod-size test evidence |
| P-08 | Backups + restore tested, RPO/RTO | ❌ NO-GO | nothing in repo; depends on Supabase PITR (not provisioned per recon) — UNKNOWN until prod DB exists |
| P-09 | Rate limiting / quotas | ❌ NO-GO | only admin-login throttle (in-memory, ST-02); OTP + extract + all reads unlimited (SEC-02) |
| P-10 | Feature flags / kill switches | ❌ NO-GO | none; risky surfaces (Vision extract, dice, test-auth) have no runtime toggle |
| P-11 | Rollback < 5 min | ⚠️ PARTIAL | Vercel instant-rollback IF deployed there (no `vercel.json`, no CI — unverified); DB has no down-migrations so schema rollback is manual |
| P-12 | CI/CD gated, branch protection, signed commits | ❌ NO-GO | no `.github/`, no Dockerfile/`.dockerignore`, no IaC; repo isn't even git (`git check-ignore` → "not a git repository") — shipping from a non-git tree |
| P-13 | Legal: privacy/ToS/GDPR export+delete | ❌ NO-GO | no terms/privacy/pricing routes (Phase 6 scope, still pending); no data-export/delete endpoint |
| P-14 | Upload persistence | ❌ NO-GO | local `storage/` FS (SEC-09/R-08) — lost on serverless redeploy |

## What's actually prod-OK

- `next build` exit 0, 58 routes; prod Lighthouse 0.97 desktop (Phase 5).
- `.env` files gitignored; error envelope never leaks stacks (`INTERNAL_ERROR` generic + `console.error` server-side only).
- Auth cookie flags correct (Phase 4); atomic guarded transitions on money/stamp races (CODIN §6).

## Fix list (each → FIX_PLAN with hours)

1. P-01 env schema + fail-fast (2h) — also closes SEC-01/ST-04 structurally
2. P-05 `/api/health` (deep: SELECT 1) + `/api/ready` (5h incl. smoke + uptime wiring) — 0.5h
3. P-09 throttles (with SEC-02, 3h)
4. P-07 first real migration baseline (`prisma migrate dev` + deploy drill) (4h)
5. P-12 init git + CI per RULE 6 + branch protection (3h)
6. P-04 Sentry + uptime monitor (3h)
7. P-03 request-ID + PII scrub (2h)
8. P-13 legal pages + export/delete (8h, needs owner copy)
9. P-08 backup/restore drill once prod DB exists (2h)
10. P-10 flags for extract/dice/test-auth (2h)
11. P-14 object storage (8h, with SEC-07/09)

**Launch posture: DO-NOT-SHIP as-is** (details → EXECUTIVE_SUMMARY). Single biggest unblockers: env fail-fast, health endpoint, OTP throttling, migration story, git+CI.

---
*3-line summary: 14-item checklist probed, 11 NO-GO — all deploy-pipeline shaped, app code itself builds green. Top: no env validation, no health endpoint, no migrations, not even a git repo. Next: Phase 7 red team (needs your go).*
