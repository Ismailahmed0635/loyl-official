# AUDIT_CI.md — guardrails that make these bugs impossible (RULE 6 + RULE 10)

**Status:** written, NOT activated — activation needs `git init` (P-12) + owner approval. No repo files touched.

## Files created

| File | Purpose |
|---|---|
| `audit/.github/workflows/audit.yml` | Audit CI (lint → typecheck → coverage 80/70 → semgrep → gitleaks → npm audit → Playwright → axe → LHCI) |
| `audit/lighthouserc.json` | LHCI asserts: perf 0.9, a11y 0.95, bp 0.9, LCP 2500ms, CLS 0.1, TBT 200ms |
| `audit/PERF_BUDGET.json` | Resource budgets: script 200 kB, total 700 kB, FCP 1500ms, LCP 2500ms |
| `audit/.pre-commit-config.yaml` | gitleaks + eslint + typecheck on every commit |
| `audit/pocs/t01-malformed-json.mjs` | runnable PoC for T-01 (asserts 422 post-fix) |

## Deliberate deviation from the prompt template

- `lighthouserc.json` sets `categories:seo` minScore **0.5, not 0.9**: the app root is intentionally `noindex` (auth-gated; measured 0.63 in Phase 5). Enforcing 0.9 would fail CI by design. Public `/menu/[slug]` pages opt into indexing individually.

## RULE 10 proof (guardrail tested, not assumed)

- **Lighthouse config validated:** the same thresholds were run manually in Phase 5 (`audit/scans/lh-prod-*.json`) — desktop passes, mobile welcome fails perf (PERF-01). The gate therefore demonstrably discriminates.
- **Full CI red/green proof:** BLOCKED on git init — recorded as P-12 step 1. Procedure when activated: (1) temp branch, reintroduce `await req.json()` without catch on otp/send, (2) assert CI fails on the new T-01 regression test, (3) revert, (4) assert green. Do not mark RULE 10 complete until that run is logged here.

## Activation checklist (for the fixer)

1. `git init` + first commit (P-12).
2. Copy `audit/.github/workflows/audit.yml` → `.github/workflows/audit.yml`; `audit/lighthouserc.json` → root; `audit/PERF_BUDGET.json` → root (or wire into LHCI collect); `audit/.pre-commit-config.yaml` → root + `pre-commit install`.
3. `npm i -D @vitest/coverage-v8` (T-02) so the coverage gate can execute.
4. Run the RULE 10 proof above; paste results here.
