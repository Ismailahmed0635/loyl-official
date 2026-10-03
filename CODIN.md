# CODIN.md — Role & Architecture Instructions for Codin

> Operating brief for the **Codin** coding agent on the **Loyl** repository.
> Authored from the project's own sources of truth: `brain.md`, `ARCHITECTURE.md`,
> `TECH_STACK.md`, `phases.md`, and the code under `frontend/` + `backend/`.
> When this file disagrees with the code, the code wins — then fix this file.

---

## 1. Role

Codin is the implementation agent for Loyl, a mobile-first digital loyalty /
stamp-card platform for Bangladesh merchants.

Codin:

- Ships **one phase at a time**, end to end, and does not start the next phase
  until the current one is verified (see §7).
- Follows the existing patterns in the repo instead of inventing new ones.
  New abstractions need a reason; a second copy of an existing pattern rarely does.
- Treats the docs in `*.md` as living contract files and updates them in the same
  change that alters behavior (§9).
- Reports honestly: a change is "done" only when typecheck, tests, build, and the
  relevant smoke script have actually been run and passed. "Should work" is not done.
- Adds no dependency that is not already in `package.json` without asking first.

Codin does **not**:

- Introduce a parallel auth, validation, or data-access path.
- Rewrite working phases as a side quest.
- Commit secrets, real phone numbers, or live credentials.

---

## 2. Repository architecture

The repo is split into two roots (commit `2026-09-23`). There is **no separate
server process** — the Next.js app is both UI and API.

```
/                          repo root: package.json, vitest.config.ts, scripts/, *.md
frontend/                  the whole Next.js 14 App Router app (run as `next dev frontend`)
  app/
    (auth)/                welcome, business-setup, success
    (merchant)/            dashboard, offers, branches, analytics, customers, requests, settings, billing
    (customer)/            scan, stamp-card, reward, profile
    (admin)/admin/         login + (panel) dashboard, merchants, billing
    (public)/              landing, pricing, terms, privacy, 404
    api/                   REST route handlers — MUST stay inside the Next app (serverless)
  components/              ui/ auth/ merchant/ customer/ admin/ animations/
  lib/
    motion/variants.ts     ALL animation recipes
    api/                   client-side fetch wrappers (customer.ts, merchant.ts, admin.ts)
    utils/, constants.ts
  middleware.ts            server-side auth gate for pages (public allowlist + role redirects)
  tsconfig.json            `@/*` -> frontend/, `@/backend/*` -> ../backend/
  tailwind.config.ts       content uses `relative: true`
  postcss.config.js        absolute path to tailwind config (cwd is repo root)
  next.config.mjs          outputFileTracingRoot = repo root, so Vercel bundles backend/
  .env.local / .env.example   runtime env lives HERE (Next loads from its project dir)
backend/                   server-only logic, no Next constraint
  db.ts                    Prisma client singleton (`db`)
  auth.ts                  JWT session helpers (jose, `loyl_session` cookie)
  admin.ts                 admin password + session helpers
  firebase.ts              Firebase Admin ID-token verifier (email/password sign-in)
  scan.ts                  stamp card state, cooldown, scan requests, grantStamp
  scratch.ts               scratch draw engine + state
  geo.ts                   haversine + nearest-branch proximity
  analytics.ts             pure series / totals / CSV helpers
  activity.ts              best-effort ActivityEvent writer
  billing.ts               payment screenshots + subscription grants
  api/handler.ts           withAuth / withMerchant / withCustomer / withAdmin guards
  api/response.ts          apiSuccess / apiError envelope
  validation/              Zod schemas + colocated *.test.ts
  prisma/schema.prisma     data model
.env (repo root)           ONLY for the Prisma CLI, which ignores frontend/.env.local
scripts/                   phaseN-smoke.mjs end-to-end smoke runners
```

**Placement rules**

| Kind of code | Goes in |
| --- | --- |
| HTTP surface, page, component | `frontend/app`, `frontend/components` |
| Request/response shape, status codes | `frontend/app/api/**/route.ts` (thin) |
| Business rules, pure logic, algorithms | `backend/*.ts` — no `next/*` imports |
| Input validation | `backend/validation/schemas.ts` |
| DB access | via `db` from `backend/db.ts`; never construct a new PrismaClient |

Routes stay thin: parse → validate with a Zod schema → call a `backend/` function →
return through `apiSuccess` / `apiError`. Business logic in a route handler is a bug.

---

## 3. API conventions

**Envelope** (`backend/api/response.ts`) — always this shape, never ad-hoc JSON:

```ts
apiSuccess(data, status = 200)          // { success: true, data }
apiError(message, code, status, extra?) // { success: false, error: { code, message }, data? }
```

**Guards** (`backend/api/handler.ts`) — composition order is the contract:

- `withAuth` — no session → **401 `UNAUTHORIZED`**
- `withMerchant` — 401 → **409 `SETUP_REQUIRED`** (no profile yet) → **403 `CUSTOMER_SESSION`**
  (customer cookie on a merchant route) → 404 on cross-merchant resources →
  **403 `ACCOUNT_SUSPENDED`** for suspended merchants
- `withCustomer` — 401 → merchant session on a customer route → **403**
- `withAdmin` — 401 → **403 `NOT_ADMIN`** → **503 `ADMIN_NOT_CONFIGURED`**
  (unsetting `ADMIN_PASSWORD` revokes access deployment-wide, even for live tokens)

Error codes are **SCREAMING_SNAKE** and stable — the UI and smoke scripts match on
them. Reuse the existing set (`COOLDOWN`, `CARD_COMPLETE`, `WRONG_OFFER_TYPE`,
`OFFER_PAUSED`, `REWARD_NOT_READY`, `PAYMENT_NOT_PENDING`, `REQUEST_ALREADY_APPROVED`,
`OFFER_TYPE_IMMUTABLE`, `LOCATION_OUT_OF_RANGE`, `NEED_LOCATION`,
  `SUBSCRIPTION_EXPIRED`, `TIER_FEATURE_LOCKED`, …) before adding
a new one. Never change a code's meaning; add a new code instead.

**Auth**: sessions are a `jose` HS256 JWT in the `loyl_session` cookie. Session
`role` is server-enum-only — a client may never request a role (customer
session with a `role` field is **422**, schemas are `.strict()`).

---

## 4. Data & validation

- **Prisma** is the only data path. Schema lives at `backend/prisma/schema.prisma`;
  CLI commands must pass `--schema` (the `db:*` npm scripts do this).
- Schema changes require `npm run db:push` **and** `npm run db:generate`, and a
  changelog line in `brain.md`.
- **Zod** validates every request body and query string. Schemas live in
  `backend/validation/schemas.ts` with tests in `backend/validation/schemas.test.ts`.
  Strict shapes; reject unknown fields; prefer discriminant unions for type variants.
- Queries/pagination constraints go in the schema (e.g. `page`/`pageSize` coerced
  1–100, `q` length-capped), not in the handler.
- Enum values that model product policy must say so in a doc comment (the deliberate
  absence of `REJECTED` in `ScanRequestStatus` is the model example: a merchant may
  accept or hold, never deny).
- Derived/aggregate logic stays **pure** and unit-tested (see `backend/analytics.ts`,
  `backend/scan.ts`) so routes stay thin and tests need no DB.

---

## 5. Frontend rules (from `brain.md` §4–§5 — non-negotiable)

- Tailwind only. No CSS modules, no styled-components, no inline style objects for
  things Tailwind expresses.
- Mobile-first: base styles target 375px, then `sm/md/lg`.
- Every page container: `max-w-md mx-auto md:max-w-2xl lg:max-w-6xl`.
- Radius: **8px inputs (`rounded-input`), 16px cards (`rounded-card`), 24px panels
  (`rounded-panel`), 999px pills.** Soft layered shadows over hairline borders — use
  `shadow-ambient` / `shadow-hairline` / `shadow-inset-light`, never a hard drop shadow.
- Type + font: pair `font-<role>` with `text-<role>` (`font-headline-sm text-headline-sm`,
  `font-body-md text-body-md`, `font-metric-num text-metric-num tabular-nums`). Headlines are
  Plus Jakarta Sans, body/labels are Inter — both are linked in `app/layout.tsx`.
  Canvas/surface vocabulary is `bg-surface-container-lowest` / `bg-surface-container-low` /
  `text-on-surface` / `text-on-surface-variant` / `border-hairline`. `.tnum` and `.frost`
  live in `app/globals.css`.
- Tap targets ≥ 44px on mobile.
- Motion: **Framer Motion only**, via recipes in `lib/motion/variants.ts`
  (`fadeUp`, `slideUp`, `slideDown`, `slideFromLeft`, `scaleIn`, `popIn`,
  `staggerContainer`, `progressFill`). No new inline animation without approval.
- `'use client'` on any file using hooks or `motion`. Call `useReducedMotion` on
  every animated page and provide a non-animated fallback.
- Colors (Sovereign Green — see `brain.md` §3): Royal Green `#0D472A` = primary
  actions/positive; Wine `#721422` = urgent/expiring/destructive **and** redemption;
  amber `#F59E0B` = offers & scratch cards only. The legacy `brand.*` Tailwind keys are
  aliases onto these values — prefer the semantic tokens for new code.
- Components go under the role folder (`components/merchant|customer|admin|ui`);
  generic primitives go in `components/ui`.
- Page data fetching uses the `lib/api/*.ts` wrappers — do not hand-roll `fetch`
  in a component.

---

## 6. Security & correctness invariants

- Authorization is checked **server-side** in the route guard, and again in
  middleware for pages (`frontend/middleware.ts`; `/api` is excluded so APIs return
  JSON 401/403 rather than redirects).
- Cross-tenant access must 404, not 403 — do not leak existence of another
  merchant's records.
- Any state transition that can race (approve payment, approve scan request, redeem)
  uses an atomic guarded `updateMany({ where: { status: X } })` inside `$transaction`,
  and re-checks the affected count. Double-tap → 409, not a silent double-grant.
- Anti-abuse limits are deliberate product decisions: one stamp per customer per shop
  per 24h, cooldown starts at **approval** for merchant-approved stamps, GPS proximity
  is enforced server-side (never trust client coords alone).
- Media uploads are size-capped and stored outside the repo tree; delete file
  artifacts only after the DB transaction commits.

---

## 7. Definition of done

A change is complete only when all of the following have actually been executed:

| Step | Command |
| --- | --- |
| Types | `npm run typecheck` |
| Unit tests | `npm test` |
| Build | `npm run build` |
| Phase smoke | `node scripts/<relevant>-smoke.mjs` |

Rules:

1. **Never run `next build` while `next dev` is running** — concurrent writers corrupt
   `frontend/.next` (symptom: `Cannot find module './NNN.js'` 500s). Kill dev,
   `rm -rf frontend/.next`, rebuild, restart.
2. Add or extend a colocated `*.test.ts` for every new pure function or schema.
3. Extend the phase smoke script when you add an endpoint or change a flow; the
   scripts are the cross-phase regression net.
4. When a flow changes shape, update the smoke scripts that assume the old shape —
   a passing test that asserts removed behavior is worse than a failing one.
5. Report the verification results honestly, including anything left unverified and
   why. Do not mark a phase ✅ in `phases.md` while anything above is outstanding.

---

## 8. Commands

```bash
npm run dev          # next dev frontend   (http://localhost:3000)
npm run build        # next build frontend (dev must be stopped)
npm run lint         # next lint frontend
npm run typecheck    # tsc -p frontend/tsconfig.json
npm test             # vitest run
npm run db:push      # apply schema (uses backend/prisma/schema.prisma)
npm run db:generate  # regenerate Prisma client
npm run db:studio    # Prisma Studio
```

- Bash on Windows: use POSIX syntax (`rm -rf`, `/dev/null`), forward slashes.
- Local dev needs PostgreSQL (service `postgresql-x64-16`, db `loyl_db`) and the root
  `.env` `DATABASE_URL`; `frontend/.env.local` holds runtime env (`JWT_SECRET`,
  `ADMIN_PASSWORD`, `NEXT_PUBLIC_BKASH_NUMBER`, …).
- Merchant sign-in is Firebase Email/Password (`FIREBASE_SETUP.md`): the client
  signs in with the Web SDK and `POST /api/auth/session` mints `loyl_session`.
  Server verification needs only `FIREBASE_PROJECT_ID` (public certs).

---

## 9. Docs to keep in sync

Update these in the same change that makes them stale:

| File | Owns |
| --- | --- |
| `brain.md` | stack, design rules, folder structure, **append-only changelog** |
| `phases.md` | phase status, file lists, verification evidence |
| `ARCHITECTURE.md` | system shape and end-to-end flows |
| `TECH_STACK.md` | chosen technologies |
| `TEST.md` / `BUILD.md` | test matrix / incremental build order |
| `PRD.md` | product requirements |
| `CODIN.md` (this file) | agent role, layering, conventions |

New deps or phase completions get a `brain.md` changelog line. Phase docs are
append-only: never delete history, only add.

---

## 10. Known gaps (do not treat as done)

- `ARCHITECTURE.md` / `TECH_STACK.md` describe `sharp` poster compositing and
  Cloudinary uploads; neither is in `package.json` yet — QR generation currently
  uses the `qrcode` package only.
- Supabase is a documented production target; local dev runs local PostgreSQL.
  Merchant auth is Firebase Email/Password (project `loyl-df23d`).
- `BUILD.md`/`TEST.md` "lock dashboard features while subscription pending/expired"
  is **implemented** (Phase 15, 2026-10-03) — but deliberately *not* as a page lock:
  pages stay reachable, and what is gated is offer/menu creation plus the customer QR
  path (`backend/subscription.ts`; FREE = 3-day trial, scratch cards only). Extending
  it to `PENDING` is intentionally not done — approvals are manual, so a merchant
  waiting on the admin must not be locked out.
- Phase 9/10/11 were marked unverified (no shell when authored). They are now verified:
  `db:push` + `db:generate` applied, typecheck clean, 251/251 unit tests, `next build` OK, and
  all 8 smoke scripts pass **503/503** assertions against `next dev frontend -p 3111`. The
  stale expectations that hid this (customer sign-in without `name`, instant-stamp scans) were
  fixed in `scripts/phase3|phase4|phase5|phase7|offer-type-smoke.mjs`; the Ed25519 approval
  logic is shared in `scripts/device-approval.mjs`. **Never run `next build` while a dev server
  is up** — a leftover dev on :3111 corrupted `frontend/.next` mid-run and every route 500'd
  until it was killed and rebuilt (§7.1, now observed, not just theorised).
- Phase 12 (digital menu) has no per-route rate limit on
  `POST /api/merchant/menu/extract` — an edge/platform limit, not a route-local one;
  inventing a second mechanism would be a new pattern. `OPENAI_API_KEY` is unset in every
  environment, so extraction currently answers `503 VISION_NOT_CONFIGURED` and the manual
  editor is the supported end state.
- The two defects found while verifying Phase 12 are **fixed** by the Sovereign Green
  redesign (both re-measured in Playwright at 768/900/1024/1100/1280/1440/1600):
  (1) `MerchantNav`'s desktop top-nav no longer overflows — the business name moved to a
  `hidden xl:flex` chip and the desktop links are **label-only** (icons dropped: with them
  the 7 links need ~741px against ~623px of available header, so `Settings` still painted
  over "New Offer"; labels need ~587px). Measured `nav.scrollWidth - clientWidth = 0` at
  every width, 22–164px of clearance before the actions block, and `document.scrollWidth`
  ≤ viewport at 768/900 too (the old sideways scroll is gone).
  (2) `app/(auth)/otp/page.tsx` "Back to Phone Number" now calls `router.push('/welcome')`
  instead of `router.back()`, so a deep link or refresh no longer loses the phone number.
  The favicon 404 is **fixed**: `frontend/app/favicon.ico` now exists (Next serves it at
  `/favicon.ico`; verified 200 `image/x-icon` on a production build). It is generated, not
  hand-maintained — `node scripts/favicon-gen.mjs` rasterises `frontend/public/icon.svg`
  (the single icon source of truth) through headless Chrome at 16/32/48/64/256px and packs
  the PNGs into a multi-resolution ICO. Regenerate it whenever `icon.svg` changes; the
  SVG-linked `<link rel="icon">` stays the primary icon for modern browsers.
  Left open on purpose: there is still no support/contact route — `app/not-found.tsx`
  therefore links only to routes that exist.

---

## 11. Device-bound approval contract (Phase 10)

**The platform rule: only the merchant's mobile app may approve a customer
check-in.** Customers stay on the web and never install anything. A merchant web
session can review and hold check-ins but can never give a stamp.

The app is built against this contract (`backend/devices.ts` is the reference
implementation; Node's own `crypto` is the only dependency).

### Keypair

- Generate an **Ed25519** keypair on first run; keep the private key in platform
  secure storage (Keychain / Keystore). It never leaves the device.
- Register the **public** key once: `POST /api/merchant/devices`
  `{ deviceName, installId?, publicKey: { kty: "OKP", crv: "Ed25519", x: <base64url> } }`
- The body is `.strict()`: sending private material (`d`) or an unknown field is a
  **422 `INVALID_DEVICE_KEY`**. The server stores public keys only, so a database
  leak cannot forge an approval.
- Reinstalling with the same `installId` **rotates** the stored key and clears any
  revocation, rather than creating a second device.

### Signing an approval

The canonical payload is exactly this string (UTF-8, `\n` separated):

```
loyl-device-v1
{merchantId}
{scanRequestId}
{timestampMillis}
```

Send the proof in the **`x-loyl-device`** header, base64url of:

```json
{ "version": 1, "deviceId": "...", "timestamp": 1730000000000, "signature": "<base64 Ed25519>" }
```

Then `POST /api/merchant/scan-requests/[id]` — the same merchant session cookie
plus that header. Success returns the updated card and records
`approvedByDeviceId` on the request.

### Rules the app must respect

- **Bind the request id.** The signature covers the specific ScanRequest id, so a
  proof harvested for one check-in is useless for another. This is the entire
  replay defence — do not sign a payload with an empty target id for approvals.
- **Timestamp is millis, and the clock matters.** The server accepts ±2 minutes
  (`DEVICE_PROOF_MAX_SKEW_MS`). A skewed device clock yields
  `403 DEVICE_PROOF_STALE`; sync the device clock before prompting the merchant.
- **`version` must be sent.** A mismatch is `426 DEVICE_PROOF_UNSUPPORTED` — treat
  it as "update the app", not as a retryable error.
- **A rejected approval is not a retry loop.** `APP_APPROVAL_REQUIRED`,
  `DEVICE_PROOF_INVALID`, `DEVICE_REVOKED` and `DEVICE_PROOF_STALE` mean the
  request is not going to succeed as-is; send the merchant to re-register or
  re-sync instead of hammering the endpoint.
- **Revoked means revoked.** `DELETE /api/merchant/devices/[id]` sets REVOKED and
  the device can no longer sign. The row is kept so past approvals stay
  attributable.

### Customer side (web) — no install, collected identity

Customers never install anything, and the QR flow collects name + phone
(collected data, no verification step) before a check-in exists:

1. Scan the poster → `/scan/[offerId]`.
2. Enter **Full Name** and **Phone Number** → `POST /api/customer/session`
   mints the session carrying `role: 'customer'` **and** the `name`.
3. `POST /api/customer/scan` → opens a PENDING check-in carrying the name, GPS
   snapshot and branch. No stamp yet.
4. The merchant approves **from the app** (§ above) → the stamp lands and the name
   is written onto the card.

Error codes the customer flow can return:

- `422` from `POST /api/customer/session` when `name`/`phoneNumber` are
  missing or malformed (schemas are `.strict()` — a `role` field is rejected),
  and from `POST /api/customer/scan` when the session has no name.
- The pre-existing scan guards (`NEED_LOCATION`, `LOCATION_OUT_OF_RANGE`,
  `COOLDOWN`, `CARD_COMPLETE`, `OFFER_PAUSED`, `OFFER_ENDED`, `WRONG_OFFER_TYPE`)
  still apply, in that order after the name guard.

When adding anything to the customer scan flow, keep the name guard **first**: a
check-in must never be created, and a stamp must never be granted, for a customer
with no name on the session.

### Web dashboard behaviour (already implemented)

The dashboard has no device key, so it is rejected by design. `/requests`
acknowledges the rejection once it sees `APP_APPROVAL_REQUIRED` or `DEVICE_REVOKED`,
shows an "Approve stamps in the Loyl merchant app" notice, and disables the action —
it must never present a button whose only outcome is a 403.
