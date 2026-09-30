# EXECUTIVE_SUMMARY.md — Loyl pre-production audit (final)

**Audit window:** 2026-09-29 · **Phases:** 0–7 complete · **Mode:** read-only (zero source files changed)
**Reports:** `AUDIT_00_RECON` → `AUDIT_07_REDTEAM` + `FIX_PLAN` + `AUDIT_CI` (all in `audit/`)

## 1. Risk score + verdict: 6.5/10 — DO-NOT-SHIP (yet) → SHIP-WITH-FIXES after the 10 blockers

App code is genuinely solid (clean typecheck, 325/325 tests, prod Lighthouse 0.97 desktop, IDOR/XSS/SSRF/payment all hold under attack). Everything red is **deployment-shaped**: secrets handling, throttling, migrations, CI, monitoring, legal. ~20 focused hours convert this to SHIP-WITH-FIXES; full hardening ≈ 75h.

## 2. Top 10 launch blockers

| # | ID | Severity | Title | Hours |
|---|---|---|---|---|
| 1 | SEC-01 | CRITICAL | Hardcoded JWT fallback (2 files) → forged sessions; rotate + fail-fast | 1 |
| 2 | SEC-02 | HIGH | No OTP throttling → SMS-budget burn + code brute force | 3 |
| 3 | SEC-03 | HIGH | Next.js 14.2.10 critical CVEs → patch within 14.x + full verify | 2 |
| 4 | SEC-04 | HIGH* | `testCode` on `NODE_ENV` (critical on misconfigured hosts) → explicit flag | 1 |
| 5 | P-01 | HIGH | No env validation/fail-fast at boot | 2 |
| 6 | P-07 | HIGH | No migrations story (`db push` only) → baseline + drill | 4 |
| 7 | P-12 | HIGH | Not a git repo, no CI → init + RULE 6 gates | 3 |
| 8 | RT-01 | MEDIUM | Sessions irrevocable (logout = cookie clear, JWT alive 30d) | 4 |
| 9 | T-01 | MEDIUM | Malformed JSON → 500 on otp/send (pattern fix ×39 routes) | 0.5+ |
| 10 | P-05 | MEDIUM | No `/api/health` for probes/monitors | 0.5 |

## 3. Category breakdown

- **Security (9):** 1 critical, 3 high, 4 medium, 1 low. AuthZ core holds; gaps are forgery-on-misconfig, throttling, headers, uploads, admin depth.
- **Tests (5):** suite green but coverageless, zero route unit tests, one live 500-bug (T-01).
- **Client (4):** clean console/storage/cookies; one PII-in-URL habit.
- **Perf/UX (5):** desktop elite; mobile welcome 0.75 (fonts → text LCP); budgets unenforced.
- **Prod (14 items):** 11 NO-GO, all pipeline.
- **Red team (3 new):** revocation, admin trail, device alerts. 5/8 goals blocked outright.

## 4. Quick wins (< 1h each)

T-01 malformed-JSON guard · SEC-06 delete `/test-auth` · P-05 health endpoint · ST-06 drop `bcryptjs` · C-03 set `NEXT_PUBLIC_APP_URL` · ST-04 Firebase fail-fast · PERF-03 write budgets · C-02 meta note.

## 5. Long-term (needs a sprint)

Route-level unit-test net (8h) · admin audit trail (6h) · session revocation (4h) · migrations baseline (4h) · legal pages + export/delete (8h) · object storage (8h) · property/fuzz tests (6h).

## 6. Estimated total: ~75h (blockers §2: ~21h)

## 7. Risk if shipped as-is

- **Money:** SMS/OpenAI spend DoS with no throttle or quota (most likely incident).
- **Users:** account takeover via OTP brute force on high-value merchant numbers; 30d irrevocable sessions after device loss.
- **Reputation:** forged-session breach IF any env ever ships without `JWT_SECRET`; data loss from local-FS uploads on redeploy; no backups proven.

## 8. Regression suite to add (bulleted, all specified in-phase)

- malformed-JSON → 422 on all 39 routes · auth guard-matrix unit tests · approve-payment + scan-approve matrix · throttle-429 tests · JWT-shape + forge-reject tests · throttle-sweep test · polyglot-upload 422s · Playwright no-`?phone=` + header assertions · 3x flake runs.

## 9. CI gates to add

lint · typecheck · `vitest --coverage` (80/70) · semgrep · gitleaks · `npm audit --high` · Playwright · axe · LHCI vs `lighthouserc.json` — all written in `AUDIT_CI.md` (+ workflow file), pending git init to activate.

## 10. Repeat-audit checklist

Re-run `npm audit` + Lighthouse prod after SEC-03/PERF-01; re-probe OTP throttles live; verify `testCode` absent under prod env; confirm migration #1 applies cleanly to a prod-sized snapshot; red-team G3/G8 replay post-fix.
