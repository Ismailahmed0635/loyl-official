# AGENTS.md

**read [CODIN.md](./CODIN.md) before any change to this repository.**

`CODIN.md` is the role and architecture brief for the coding agent working here
(Codin). It is the operating contract — not a summary of one.

The parts that most often get violated, restated so they cannot be missed:

1. **Two roots, one app.** UI + API routes live in `frontend/`; server-only logic,
   Zod schemas, and the Prisma schema live in `backend/`. Routes stay thin.
2. **Guard order is the contract.** `withAuth` 401 → `withMerchant` 409
   `SETUP_REQUIRED` / 403 `CUSTOMER_SESSION` → `withAdmin` 403 `NOT_ADMIN` /
   503 `ADMIN_NOT_CONFIGURED`. Always respond via `apiSuccess` / `apiError`.
3. **Error codes are stable.** SCREAMING_SNAKE. Never repurpose one; add a new one.
4. **Cross-tenant access returns 404**, never 403 — do not leak another merchant's data.
5. **Racing state transitions** use an atomic guarded `updateMany` inside `$transaction`.
6. **Tailwind only, mobile-first, Framer Motion recipes from `lib/motion/variants.ts`.**
   No new inline animations, no new dependencies without asking.
7. **Done means executed:** `npm run typecheck`, `npm test`, `npm run build`
   (with `next dev` stopped), and the relevant `scripts/*-smoke.mjs`.
8. **Keep the docs true in the same change** — `brain.md` (append-only changelog),
   `phases.md`, `ARCHITECTURE.md`.

See `CODIN.md` §7 for the full definition of done and §10 for the known gaps.
