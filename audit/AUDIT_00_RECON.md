# AUDIT_00_RECON.md — Phase 0: Reconnaissance

**Project:** Loyl (`loyl.io`) — mobile-first digital loyalty / stamp-card platform for Bangladesh
**Repo root:** `D:/loyl.io`
**Audit run:** 2026-09-29
**Auditor:** Audit Master (read-only recon — **no source file was modified**)
**Scope of this phase:** map everything. No findings severity, no fixes. Observations that
feed Phases 1–7 are collected in §12 with `R-xx` ids; they are **not yet verified findings**.

> **Rule compliance:** Audit only. Nothing under `frontend/`, `backend/`, `scripts/` was
> edited. The only file created in this phase is this report.

---

## 0.1 Tooling actually available in this environment (honest)

`rg`, `fd`, `tree`, `semgrep`, `gitleaks`, `trivy`, `nuclei`, `lighthouse`, `knip`, `madge`,
`eslint`, `biome` are **not installed** (no `rg`/`fd`/`tree` on PATH — verified by empty output
+ `command -v` misses). Global installs were **not** attempted: that is a machine-wide side
effect outside the project directory, and the prompt's own rule #4 says don't guess — so this
phase ran on the equivalents bash/git-bash ships with.

| Intent | Tool asked for | Tool actually used | Status |
| --- | --- | --- | --- |
| File search | `fd`, `tree` | `find`, `ls`, `glob` | substituted |
| Text search | `rg` | `grep -r`, `code_search` | substituted |
| Deps audit | `npm audit`, `osv-scanner` | not run (Phase 2) | deferred |
| SAST/secrets | `semgrep`, `gitleaks`, `trufflehog` | not run (Phase 2) | deferred |
| Coverage | vitest `--coverage` | not run (Phase 3) | deferred |
| Perf | `lighthouse`, `unlighthouse` | not run (Phase 5) | deferred |

**Decision requested before Phase 2:** installing `semgrep`, `gitleaks`, `trivy`, `nuclei`,
`lighthouse` requires network + machine-level installs (and Docker for several). Confirm which
you want installed locally vs. skipped and replaced by an equivalent (e.g. `npm audit` +
`gitleaks` binary only). Until then Phase 2 will run what exists.

---

## 0.2 Folder tree

Two roots, one app (per `CODIN.md` §2). There is **no separate server process** — the Next.js
app *is* the API.

```
/                              repo root: package.json, vitest.config.ts, scripts/, *.md, .env
├── frontend/                  the entire Next.js 14 App Router app (`next dev frontend`)
│   ├── app/
│   │   ├── (auth)/            welcome · otp · business-setup
│   │   ├── (merchant)/        dashboard · offers · branches · customers · requests ·
│   │   │                      analytics · settings · billing · menu
│   │   ├── (customer)/        scan · scan/[offerId] · stamp-card · reward · profile
│   │   ├── (admin)/admin/     login · (panel)/ dashboard · merchants · billing
│   │   ├── (public)/menu/[slug]   ← the ONLY crawlable page
│   │   ├── api/               39 route.ts files, 49 exported handlers
│   │   ├── test-auth/         dev-only Firebase email/password harness (public!)
│   │   ├── layout.tsx · global-error.tsx · not-found.tsx · manifest.ts · robots.ts · sitemap.ts
│   │   └── globals.css · page.tsx (redirects → /welcome)
│   ├── components/            admin · animations · auth · billing · customer · merchant · ui
│   │   └── ui/skiper-ui/skiper39.tsx   ← GSAP-based component (see R-06)
│   ├── lib/                   api/ (client fetch wrappers) · firebase/ · motion/variants.ts
│   │                          constants.ts · format.ts · metadata.ts · poster.ts · scratch.ts ...
│   ├── middleware.ts          edge auth gate for PAGES (API excluded on purpose)
│   ├── next.config.mjs        outputFileTracingRoot=repo root; remotePatterns: res.cloudinary.com
│   ├── tailwind.config.ts · postcss.config.js · tsconfig.json (`@/*`→frontend, `@/backend/*`→../backend)
│   ├── .env.local             runtime env (gitignored)
│   └── .env.example           committed template
├── backend/                   server-only, no `next/*` page concerns
│   ├── db.ts                  PrismaClient singleton
│   ├── auth.ts                jose HS256 JWT ↔ `loyl_session` cookie; session TTL 30d
│   ├── admin.ts               ADMIN_PASSWORD, timing-safe compare, 5/60s throttle, 12h TTL
│   ├── cognito.ts             SigV4 Cognito client + dev-mock OTP transport
│   ├── firebase.ts            Firebase Admin ID-token verifier (transport #2)
│   ├── devices.ts             Ed25519 device proof (approval contract)
│   ├── scan.ts · scratch.ts · dice.ts · geo.ts · analytics.ts · activity.ts · billing.ts · menu.ts
│   ├── api/handler.ts         withAuth / withMerchant / withMerchantApp / withCustomer / withAdmin
│   ├── api/response.ts        apiSuccess / apiError envelope
│   ├── validation/schemas.ts  all Zod schemas (1 000+ lines) + schemas.test.ts
│   └── prisma/schema.prisma   16 models / 11 enums
├── scripts/                   11 phaseN-smoke.mjs end-to-end runners (the cross-phase net)
├── storage/                   local file storage — NOT served by the app
│   ├── menu-photos/           19 PNGs retained
│   └── payment-screenshots/
├── landing page/              standalone static HTML/CSS/JS marketing site + serve.js
├── screenshots/               desktop/ + mobile/ + pw-*.png manual captures
├── qa/                        2 pngs
├── .agents/ + .claude/        vendored skill packs (firebase-*, xcode-project-setup)
└── docs: AGENTS.md · CODIN.md · CODIN_SPEC.md · ARCHITECTURE.md · brain.md (61 KB) ·
        phases.md (43 KB) · TECH_STACK.md · DATABASE.md · BUILD.md · TEST.md · DEBUG.md ·
        REVIEW.md · PRD.md · IDEA.md · LOYLS_APP_REQUIREMENTS.md · COGNITO_SETUP.md ·
        FIREBASE_SETUP.md · AUDIT_SUMMARY.md · supabase-schema.sql · firebase.json ·
        server.log (430 KB, committed) · flow.pdf · restore.bat · check_tsc.js · tsc_result.txt ...
```

Notable at tree level:

- `server.log` (430 KB) and `tsc_result.txt` / `typecheck_out.txt` are committed artifacts.
- `AUDIT_SUMMARY.md` at root is a **previous** auto-generated status file (claims 312/312 tests
  in 17 files) — it is not this audit.
- No `audit/` directory existed before this phase; it was created now.
- No `Dockerfile`, no CI config (`.github/`), no IaC anywhere → Phase 6 will have nothing to scan.

---

## 0.3 Tech stack + versions (installed, read from `node_modules`)

| Layer | Package | `package.json` range | Installed |
| --- | --- | --- | --- |
| Runtime | Node | — (no `.nvmrc`, no `engines`) | **v24.21.0** |
| Package manager | npm | — | 11.19.0 |
| Framework | next | `14.2.10` (pinned) | 14.2.10 |
| UI | react / react-dom | `^18.3.1` | 18.3.1 |
| Language | typescript | `^5.6.2` | 5.9.3 |
| Data | @prisma/client / prisma | `^5.19.0` | 5.22.0 |
| Validation | zod | `^3.23.8` | 3.25.76 |
| Auth/session | jose | `^5.8.0` | 5.10.0 |
| Auth | firebase | `^12.19.0` | 12.19.0 |
| Auth | firebase-admin | `^14.5.0` | 14.5.0 |
| Animation | framer-motion | `^11.5.4` | 11.18.2 |
| Animation | gsap | `^3.15.0` | 3.15.0 |
| QoL | clsx / tailwind-merge | `^2.1.1` / `^2.5.2` | 2.1.1 / 2.6.1 |
| QR | qrcode | `^1.5.4` | 1.5.4 |
| Icons | lucide-react | `^0.439.0` | 0.439.0 |
| FX | canvas-confetti | `^1.9.4` | 1.9.4 |
| Hashing | bcryptjs | `^2.4.3` | 2.4.3 |
| CSS | tailwindcss / postcss / autoprefixer | 3.4.10 / 8.4.45 / 10.6.1 | 3.4.19 / 8.5.28 / 10.6.1 |
| Test | vitest | `^2.0.5` | 2.1.9 |

Database: **PostgreSQL 16.15** locally (`postgresql-x64-16`, db `loyl_db`); production target is
Supabase-hosted Postgres (`DATABASE.md`). Prisma provider `postgresql`.

`package.json` `allowScripts` pins `@prisma/client@5.22.0`, `@prisma/engines@5.22.0`,
`prisma@5.22.0`, `esbuild@0.21.5`.

Documented-but-absent stack items (documented gap in `CODIN.md` §10, re-confirmed here):
**`sharp` and `cloudinary` are not dependencies**; `TECH_STACK.md` still claims Cloudinary image
storage and server-side poster compositing. Actual image handling is local disk (`storage/`).

---

## 0.4 Every entry point

### 0.4.1 Page routes (27 `page.tsx` + 2 error files)

| URL | File | Gate (server `middleware.ts` + layout) |
| --- | --- | --- |
| `/` | `app/page.tsx` | public → `redirect('/welcome')` |
| `/welcome` | `(auth)/welcome/page.tsx` | **public** |
| `/otp` | `(auth)/otp/page.tsx` | **public** |
| `/business-setup` | `(auth)/business-setup/page.tsx` | **public** |
| `/admin/login` | `(admin)/admin/login/page.tsx` | **public** |
| `/test-auth` | `test-auth/page.tsx` | **public** (`PUBLIC_PATHS`) — dev harness, see R-04 |
| `/scan` | `(customer)/scan/page.tsx` | **public** (`/scan` prefix) |
| `/scan/[offerId]` | `(customer)/scan/[offerId]/page.tsx` | **public** |
| `/menu/[slug]` | `(public)/menu/[slug]/page.tsx` | **public** — the only crawlable page |
| `/dashboard` | `(merchant)/dashboard/page.tsx` | middleware: any valid session → layout re-checks role |
| `/offers`, `/offers/new`, `/offers/[id]`, `/offers/[id]/qr` | `(merchant)/offers/**` | merchant session |
| `/branches` | `(merchant)/branches/page.tsx` | merchant session |
| `/customers` | `(merchant)/customers/page.tsx` | merchant session |
| `/requests` | `(merchant)/requests/page.tsx` | merchant session (approval disabled — app-only) |
| `/analytics` | `(merchant)/analytics/page.tsx` | merchant session |
| `/settings` | `(merchant)/settings/page.tsx` | merchant session |
| `/billing`, `/billing/checkout` | `(merchant)/billing/**` | merchant session |
| `/menu` | `(merchant)/menu/page.tsx` | merchant session |
| `/stamp-card`, `/reward`, `/profile` | `(customer)/**` | session + `CUSTOMER_PREFIXES` re-entry via `/scan?next=` |
| `/admin`, `/admin/merchants`, `/admin/billing` | `(admin)/admin/(panel)/**` | `withAdmin`-equivalent layout gate → else `/admin/login` |
| `/404` (any unknown) | `app/not-found.tsx` | public |
| global crash | `app/global-error.tsx` | public |

### 0.4.2 API routes — 39 files, 49 handlers

Guard legend: `PUB` = no guard, `AUTH` = `withAuth`, `MER` = `withMerchant`,
`MERAPP` = `withMerchantApp` (Ed25519 device proof required), `CUST` = `withCustomer`,
`ADM` = `withAdmin`.

| Method + path | Guard | File |
| --- | --- | --- |
| POST `/api/auth/otp/send` | **PUB** | `auth/otp/send/route.ts` |
| POST `/api/auth/otp/verify` (legacy + Firebase) | **PUB** | `auth/otp/verify/route.ts` |
| POST `/api/auth/logout` | **PUB** | `auth/logout/route.ts` |
| POST `/api/admin/login` | **PUB** | `admin/login/route.ts` |
| GET `/api/customer/offers/[offerId]` | **PUB (session-optional)** | `customer/offers/[offerId]/route.ts` |
| POST `/api/auth/business-setup` | AUTH | `auth/business-setup/route.ts` |
| GET `/api/auth/me` | AUTH | `auth/me/route.ts` |
| GET `/api/admin/session` | ADM | `admin/session/route.ts` |
| GET `/api/admin/stats` | ADM | `admin/stats/route.ts` |
| GET `/api/admin/merchants` | ADM | `admin/merchants/route.ts` |
| PATCH `/api/admin/merchants/[id]` | ADM | `admin/merchants/[id]/route.ts` |
| GET `/api/admin/payments` | ADM | `admin/payments/route.ts` |
| GET `/api/admin/payments/[id]/screenshot` | ADM | `admin/payments/[id]/screenshot/route.ts` |
| POST `/api/admin/approve-payment` | ADM | `admin/approve-payment/route.ts` |
| POST `/api/admin/reject-payment` | ADM | `admin/reject-payment/route.ts` |
| GET `/api/billing` | MER | `billing/route.ts` |
| POST `/api/billing/checkout` | MER | `billing/checkout/route.ts` (multipart screenshot) |
| GET, POST `/api/branches` | MER | `branches/route.ts` |
| PATCH, DELETE `/api/branches/[id]` | MER | `branches/[id]/route.ts` |
| GET, POST `/api/offers` | MER | `offers/route.ts` |
| GET, PATCH, DELETE `/api/offers/[id]` | MER | `offers/[id]/route.ts` |
| GET `/api/offers/[id]/qr` | MER | `offers/[id]/qr/route.ts` |
| GET `/api/merchant/stats` | MER | `merchant/stats/route.ts` |
| GET `/api/merchant/analytics` | MER | `merchant/analytics/route.ts` |
| GET `/api/merchant/customers` | MER | `merchant/customers/route.ts` |
| GET `/api/merchant/settings`, PATCH same | MER | `merchant/settings/route.ts` |
| GET `/api/merchant/scan-requests` | MER | `merchant/scan-requests/route.ts` |
| POST `/api/merchant/scan-requests/[id]` | **MERAPP** | `merchant/scan-requests/[id]/route.ts` |
| GET, POST `/api/merchant/devices` | MER | `merchant/devices/route.ts` |
| DELETE `/api/merchant/devices/[id]` | MER | `merchant/devices/[id]/route.ts` |
| GET, PUT `/api/merchant/menu` | MER | `merchant/menu/route.ts` |
| GET, POST, DELETE `/api/merchant/menu/photo` | MER | `merchant/menu/photo/route.ts` |
| POST `/api/merchant/menu/extract` | MER | `merchant/menu/extract/route.ts` (OpenAI Vision) |
| GET `/api/customer/cards` | CUST | `customer/cards/route.ts` |
| POST `/api/customer/scan` | CUST | `customer/scan/route.ts` |
| POST `/api/customer/scratch` | CUST | `customer/scratch/route.ts` |
| POST `/api/customer/dice` | CUST | `customer/dice/route.ts` |
| POST `/api/customer/redeem` | CUST | `customer/redeem/route.ts` |
| POST `/api/customer/review` | CUST | `customer/review/route.ts` |

### 0.4.3 Non-HTTP entry points

| Kind | Present? | Evidence |
| --- | --- | --- |
| Background jobs / cron / queue | **none** | `grep -niE "webhook|cron|queue|worker|job"` → only `setInterval` client pollers and the word "queue" in UI prose |
| Webhooks (inbound) | **none** | no route named webhook; no signature verification code |
| Webhooks (outbound) | none | — |
| CLI entry points | `scripts/*.mjs` (11), `npm run db:*` (Prisma CLI), `landing page/serve.js`, `check_tsc.js` | — |
| Next-generated | `manifest.ts`, `robots.ts`, `sitemap.ts` (dynamic, DB-backed) | — |
| Mobile app | **not in this repo** — Phase 10 contract documented in `CODIN.md` §11 for an app that isn't here | — |

Client-side polling loops (no server job, but they are load sources):
`(merchant)/requests/page.tsx` every 8 s, `MerchantNav.tsx` badge every 15 s,
`(customer)/scan/[offerId]/page.tsx` silent refresh every 5 s.

---

## 0.5 Every DB model + relationship (Prisma)

16 models, 11 enums, provider `postgresql`. All ids are `cuid()` strings.
Soft deletes: `Merchant.deletedAt`, `Branch.deletedAt`, `Offer.deletedAt`,
`CustomerStamp.deletedAt`, `PaymentRequest.deletedAt`, `MerchantDevice.deletedAt`,
`ScanRequest.deletedAt`, `DigitalMenu.deletedAt`.

```
Merchant 1─* Branch
Merchant 1─* Offer 1─* ScratchItem
Merchant 1─* ScratchResult       *─1 Offer
Merchant 1─* DiceRollResult      *─1 Offer
Merchant 1─* CustomerStamp       (unique [merchantId, customerPhone])
Merchant 1─* PaymentRequest      (trxId unique)
Merchant 1─* ActivityEvent       (offerId is a PLAIN string, no FK — survives offer deletion)
Merchant 1─* MerchantDevice      (unique [merchantId, installId])
Merchant 1─* ScanRequest  *─1 Offer
                          *─0..1 MerchantDevice  (approvedByDeviceId, onDelete: SetNull)
Merchant 1─0..1 DigitalMenu      (merchantId unique; slug unique)
DigitalMenu 1─* MenuCategory 1─* MenuItem 1─* MenuModifierGroup 1─* MenuModifierOption
```

| Model | Key columns / constraints | Purpose |
| --- | --- | --- |
| `Merchant` | `cognitoSub? @unique`, `phoneNumber @unique`, `subscriptionStatus`, `subscriptionTier`, `subscriptionExpiresAt`, `deletedAt` | tenant root |
| `Branch` | `latitude Decimal(10,8)`, `longitude Decimal(11,8)`, cascade from Merchant | GPS fence source |
| `Offer` | `offerType` STAMP/SCRATCH/DICE, `requiredStamps?`, `scratchMode?`, `scratchCursor`, `scratchOrder String[]`, `scratchCooldownHours` (default 24), `diceCount?` (1..5), `durationDays`, `isActive` | campaign |
| `ScratchItem` | `offerId`, `label`, `sortOrder` | reward pool rows |
| `ScratchResult` | `offerId`, `merchantId`, `customerPhone`, `rewardLabel`, `mode`, `scratchedAt` | one reveal |
| `DiceRollResult` | **`@@unique([offerId, customerPhone])`** — the anti-re-roll enforcement, `diceValues Int[]`, `total`, `discountPercent` | one roll, forever |
| `CustomerStamp` | **`@@unique([merchantId, customerPhone])`**, `stampsCollected`, `totalRedeemed`, `lastScannedAt`, `lastReviewAt`, `customerName?` | the stamp card |
| `PaymentRequest` | `paymentMethod BKASH/NAGAD`, `trxId @unique`, `amount Decimal(10,2)`, `requestedTier`, `screenshotPath`, `status` | manual MFS checkout |
| `ActivityEvent` | `type` SCAN/REVIEW_BONUS/REDEEM, `offerId?` (no FK), index `[merchantId, createdAt]` | analytics series (scratch results are unioned in instead) |
| `MerchantDevice` | `publicKey` (JWK JSON), `installId?`, `status` ACTIVE/REVOKED, `@@unique([merchantId, installId])` | app approval key |
| `ScanRequest` | `status` PENDING/APPROVED (**no REJECTED by design**), `customerName?`, `distanceMeters?`, `branchName?`, `decidedAt?`, `approvedByDeviceId?` | check-in awaiting app approval |
| `DigitalMenu` | `merchantId @unique`, `slug @unique`, `backgroundHex`, `photoPath?`, `publishedAt?` | public menu (404 until published) |
| `MenuCategory` / `MenuItem` | `MenuItem.price` is **free text** (OCR-friendly), `isAvailable` | menu body |
| `MenuModifierGroup` / `MenuModifierOption` | `selectionType` SINGLE/MULTI, `isRequired`, option `price` free text, `isDefault` | Phase 12.5 variants/add-ons |

Enums: `SubscriptionStatus`, `RewardType`, `OfferType`, `ScratchMode`, `PaymentStatus`,
`ScanRequestStatus`, `PaymentMethod`, `SubscriptionTier`, `ActivityType`, `DeviceStatus`,
`MenuModifierSelection`.

Migrations: **there is no `prisma/migrations/` directory** — the flow is `db push`
(`npm run db:push`), i.e. no versioned/reversible migration history (Phase 6 input, R-07).
`supabase-schema.sql` at root is a hand-written SQL file that is **not** the Prisma schema.

---

## 0.6 Every external service

| Service | Role | Configured how | Live in this env? |
| --- | --- | --- | --- |
| **PostgreSQL 16.15** | single data store (all 16 models) | `DATABASE_URL` (`.env` for Prisma CLI + `frontend/.env.local` for the app — two copies, must stay in sync) | local service `postgresql-x64-16`, db `loyl_db` |
| **Supabase** | documented prod Postgres host | `DATABASE_URL` in Vercel | not provisioned (no Supabase client/SDK in deps — plain Postgres connection) |
| **AWS Cognito** | OTP transport #1 | `AWS_COGNITO_REGION`, `AWS_COGNITO_USER_POOL_ID`, `AWS_COGNITO_CLIENT_ID`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (hand-rolled SigV4 in `backend/cognito.ts`) | **dev-mock** unless all five set |
| **Firebase Phone Auth** | OTP transport #2 | `NEXT_PUBLIC_FIREBASE_*` (client) + `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` (Admin SDK) | env-gated; `firebase.json` is a project-context stub only |
| **Firebase Firestore** | written by `components/auth/EmailAuthForm.tsx` (`users/{uid}`) on the `/test-auth` harness | client SDK | see R-04 |
| **OpenAI Vision** | read a photographed menu into draft items | `OPENAI_API_KEY`, `OPENAI_VISION_MODEL` (default `gpt-4o-mini`) | **unset** → `503 VISION_NOT_CONFIGURED`; manual editor is the supported path |
| **Cloudinary** | documented image host | `CLOUDINARY_*` in `.env.example` | **not a dependency, not referenced in code** — dead config |
| **bKash / Nagad** | manual MFS payments, no API | `NEXT_PUBLIC_BKASH_NUMBER`, `NEXT_PUBLIC_NAGAD_NUMBER` + admin approval | manual only |
| **Vercel** | documented deploy target | none in repo | no `vercel.json` |
| **Google Fonts** | Plus Jakarta Sans + Inter | linked in `app/layout.tsx` | remote at runtime |

**Local file storage** (not a third party, but a service dependency): `storage/menu-photos`
and `storage/payment-screenshots` on the server filesystem, resolved via
`path.join(process.cwd(), 'storage', ...)`. This is **ephemeral on Vercel** (Phase 6 input, R-08).

---

## 0.7 Every environment variable

**Values were deliberately NOT read.** `.env` and `frontend/.env.local` are gitignored secret
files; this audit prints names only. Whether a given var is *set* in your environments is
therefore **UNKNOWN** from this phase — Phase 6 verifies startup fail-fast behaviour instead.

Names below are the union of `frontend/.env.example` (committed template) and every
`process.env.X` actually referenced by project code (grep over `backend/`, `frontend/` minus
`.next`, `scripts/`).

| Var | Read by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `prisma/schema.prisma` (CLI), Prisma at runtime | exists in **two** files (root `.env` + `frontend/.env.local`) |
| `JWT_SECRET` | `backend/auth.ts`, `frontend/middleware.ts` (mirrored on the edge) | **has a hardcoded fallback in both places**: `loyl_default_secure_secret_key_2026_bd_market` |
| `ADMIN_PASSWORD` | `backend/admin.ts` | unset ⇒ admin disabled (503 by design) |
| `AWS_COGNITO_REGION`, `AWS_COGNITO_USER_POOL_ID`, `AWS_COGNITO_CLIENT_ID` | `backend/cognito.ts` | all three required to leave dev-mock |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (+ `AWS_REGION`, `AWS_SESSION_TOKEN`) | `backend/cognito.ts` SigV4 | credentials in env, not IAM role |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | `backend/firebase.ts` | server-only; `\n` unescaping handled |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` | `frontend/lib/firebase/*` | public by design |
| `OPENAI_API_KEY`, `OPENAI_VISION_MODEL` | `backend/menu.ts` | unset ⇒ 503 |
| `NEXT_PUBLIC_BKASH_NUMBER`, `NEXT_PUBLIC_NAGAD_NUMBER` | checkout modal | public (they are the merchant's receive numbers) |
| `NEXT_PUBLIC_APP_URL` | `frontend/lib/metadata.ts` | canonical/OG/robots/sitemap origin; localhost fallback |
| `NODE_ENV` | `backend/db.ts` (query logging), `backend/auth.ts` (Secure cookie), OTP `testCode` leak guard | framework-managed |
| `__NEXT_BUILD_ID`, `__FIREBASE_DEFAULTS__`, `GRPC_*`, `NEXT_OTEL_*`, `NEXT_PRIVATE_TEST_PROXY` | **library internals**, not project vars | noise from grep; listed here only to be explicit that they are not ours |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | **nothing** | present in `.env.example`, referenced by zero code |
| `USE_MOCK_PERSISTENCE` | **nothing in project source** | grep hit came from a build artifact, not our code |

---

## 0.8 ASCII data-flow diagram

```
 ┌────────────────────────── CLIENTS (no mobile app in this repo) ──────────────────────────┐
 │  Customer web   (no install; camera QR)              Merchant web (dashboard)             │
 │  /scan/[offerId] → OTP → /stamp-card /reward         /dashboard /offers /requests ...     │
 │                                                       Merchant NATIVE APP (Phase 10)      │
 │  Admin web  /admin  (password only)                   holds Ed25519 private key           │
 └───┬──────────────────────────┬───────────────────────────────────┬───────────────────────┘
     │ HTTPS                    │ HTTPS                             │ HTTPS + x-loyl-device sig
     ▼                          ▼                                   ▼
 ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 │  EDGE (Vercel)                                                                           │
 │   middleware.ts : PAGES ONLY  (matcher excludes /api, /_next, *.*)                        │
 │     public allowlist: / /welcome /otp /business-setup /admin/login /test-auth            │
 │                       prefixes /scan /menu                                                │
 │     else: no valid loyl_session JWT → /welcome | /admin/login | /scan?next=…               │
 └───┬──────────────────────────────────────────────────────────────────────────────────────┘
     ▼
 ┌───────────────────────────────────────────────────── Next.js 14 (App Router) ────────────┐
 │  frontend/app/api/**/route.ts  (49 handlers — thin: parse → Zod → backend fn → envelope)  │
 │    guard chain: withAuth(401) → withMerchant(409 SETUP_REQUIRED | 403 CUSTOMER_SESSION |  │
 │                  403 ACCOUNT_SUSPENDED | 404 cross-tenant) → withMerchantApp(Ed25519)     │
 │                  withCustomer(role/phone) → withAdmin(403 NOT_ADMIN | 503)                │
 │  server components: (public)/menu/[slug] reads DB directly + sitemap.ts                    │
 └───┬──────────────────────────────────────────────────────────────────────────────────────┘
     ▼
 ┌──────────────────────── backend/*.ts — server-only, no next/* imports ───────────────────┐
 │ auth.ts(jose HS256)  admin.ts(timing-safe pw, 5/60s throttle)  devices.ts(Ed25519 verify) │
 │ scan.ts/stamp  scratch.ts  dice.ts  geo.ts(haversine + fence)  analytics.ts  activity.ts  │
 │ billing.ts  menu.ts(slugify, hex contrast, vision)   validation/schemas.ts (Zod)           │
 └───┬───────────────────────────────────────┬───────────────────────┬─────────────────────┘
     ▼                                       ▼                       ▼
 ┌──────────────────────┐   ┌──────────────────────────────┐  ┌────────────────────────────┐
 │ Prisma → PostgreSQL  │   │ local filesystem             │  │ outbound HTTP              │
 │ 16 models / 11 enums │   │ storage/menu-photos          │  │ AWS Cognito (SigV4)        │
 │ single tenant filter │   │ storage/payment-screenshots  │  │ Firebase Admin (verify ID) │
 │ on merchantId        │   │ (ephemeral on serverless)    │  │ OpenAI Vision (menu OCR)   │
 └──────────────────────┘   └──────────────────────────────┘  └────────────────────────────┘
```

Trust boundaries: (1) browser → edge; (2) edge → route handler; (3) handler → backend logic;
(4) backend → Postgres; (5) backend → filesystem; (6) backend → third-party APIs.
GPS coordinates and all identity/role claims cross boundary (1) as attacker-controlled input.

---

## 0.9 INPUT surface (every place user data enters)

| # | Entry | Field(s) | Validated by |
| --- | --- | --- | --- |
| I-01 | POST `/api/auth/otp/send` | `phoneNumber` | `sendOtpSchema` |
| I-02 | POST `/api/auth/otp/verify` legacy | `phoneNumber`, `code`, `role`, `name` | `verifyOtpSchema` |
| I-03 | POST `/api/auth/otp/verify` Firebase | `idToken`, `role`, `name` | `firebaseVerifySchema` + Admin SDK |
| I-04 | POST `/api/admin/login` | `password` | `adminLoginSchema` |
| I-05 | POST `/api/auth/business-setup` | business profile fields | `businessSetupSchema` |
| I-06 | POST/PATCH `/api/offers`, `/api/offers/[id]` | stamp/scratch/dice variants | `createOfferSchema` / `updateOfferSchema` / `scratchOfferSchema` / `diceOfferSchema` |
| I-07 | GET `/api/offers` query | status/pagination | (query schema) |
| I-08 | GET `/api/merchant/analytics` query | range | `analyticsQuerySchema` |
| I-09 | GET `/api/merchant/customers` query | `q`, `page`, `pageSize` | `customerListQuerySchema` |
| I-10 | GET `/api/merchant/scan-requests` query | `status` (PENDING/APPROVED/ALL) | `scanRequestListQuerySchema` |
| I-11 | PATCH `/api/merchant/settings` | social links etc. | `updateSettingsSchema` |
| I-12 | branch create/update | name, address, **lat/lng** | `branchSchema` / `updateBranchSchema` |
| I-13 | **POST `/api/customer/scan`** | `offerId`, **`latitude`, `longitude`** | `scanSchema` (`coordinateShape`) |
| I-14 | POST `/api/customer/scratch` | same shape | `scratchSchema` |
| I-15 | POST `/api/customer/dice` | same shape | `diceRollSchema` |
| I-16 | POST `/api/customer/redeem` | `offerId` | `redeemSchema` |
| I-17 | POST `/api/customer/review` | `offerId` | `reviewBonusSchema` |
| I-18 | GET `/api/customer/offers/[offerId]` | **path segment (public)** | checked in-handler (`findFirst`) |
| I-19 | POST `/api/merchant/scan-requests/[id]` | path segment + **`x-loyl-device` header** (base64url JSON: version/deviceId/timestamp/signature) | `authenticateDeviceApproval` |
| I-20 | POST `/api/merchant/devices` | `deviceName`, `installId`, `publicKey` JWK | `deviceRegisterSchema` (`.strict()`) |
| I-21 | POST `/api/merchant/menu/photo` | **multipart image** (png/jpeg/webp/heic/heif, ≤5 MB) | `saveMenuPhoto` — MIME string only |
| I-22 | POST `/api/billing/checkout` | **multipart screenshot** + method/sender/trxId/amount/tier | `checkoutSchema` + billing upload helper |
| I-23 | PUT `/api/merchant/menu` | whole menu tree (categories/items/modifiers) | `saveMenuSchema` |
| I-24 | POST `/api/merchant/menu/extract` | body referencing an uploaded photo | `visionDraftSchema` (upstream, outbound to OpenAI) |
| I-25 | Admin actions | approve/reject payment, merchant action enum | `paymentActionSchema`, `adminMerchantActionSchema` |
| I-26 | GET `/menu/[slug]` | path segment | `menuSlugSchema` |
| I-27 | GET `/api/admin/payments/[id]/screenshot`, `/api/merchant/menu/photo` | path/query filename | `path.basename` guard in `readMenuPhoto`; billing equivalent |
| I-28 | Cookie `loyl_session` | JWT (HS256) — **client-held, therefore attacker-controllable** | `jose.jwtVerify` |
| I-29 | Header `x-forwarded-for` (via `req.ip`/header) | admin login throttle key | `backend/admin.ts` key derivation |
| I-30 | QR code payload → `/scan/[offerId]` URL | offer id from a printed poster | same as I-18 |

---

## 0.10 OUTPUT surface (every place data leaves)

| # | Exit | What leaves | Guard |
| --- | --- | --- | --- |
| O-01 | `POST /api/auth/otp/verify` → `Set-Cookie: loyl_session` | JWT with `userId`, `phoneNumber`, `role`, `name`, `cognitoSub`/`firebaseUid` | HttpOnly, SameSite=Lax, `Secure` only when `NODE_ENV=production`, Max-Age 30d |
| O-02 | `POST /api/auth/otp/send` response | `testCode` **when `NODE_ENV !== 'production'`** | dev-mock only — R-01 |
| O-03 | `POST /api/auth/otp/verify` response | `merchant` object (full Prisma `Merchant` row incl. `cognitoSub`, `subscriptionTier`) to the just-verified phone | returns the caller's own row |
| O-04 | `/api/auth/me` | session + merchant/customer summary | AUTH |
| O-05 | `/api/customer/offers/[offerId]` | **public pre-auth:** business name, category, `logoUrl`, website/facebook/instagram URLs, offer title/type; card/scratch/dice state only when a session exists | public by design |
| O-06 | `/api/customer/cards`, `scan`, `scratch`, `dice`, `redeem`, `review` | the customer's own card/reveal/roll, reward labels | CUST (identity = session phone) |
| O-07 | `/api/merchant/*` reads | merchant's own offers/branches/customers (with `customerPhone`, `customerName`)/analytics/stats | MER |
| O-08 | `POST /api/merchant/scan-requests/[id]` | updated card + `approvedByDeviceId` attribution | MERAPP |
| O-09 | `/api/offers/[id]/qr` | generated QR PNG/SVG (`qrcode` pkg) pointing at the public scan URL | MER |
| O-10 | `/api/merchant/menu/photo` GET | stored photo bytes with content-type | MER — note the **public** `/menu/[slug]` page renders a photo without a session (see R-05) |
| O-11 | `/api/admin/payments/[id]/screenshot` | payment proof images | ADM |
| O-12 | `/menu/[slug]` (server-rendered) | title, background colour, categories/items/prices, merchant name+category | **public** |
| O-13 | `/sitemap.xml`, `/robots.txt`, per-page `Metadata`/OG (`lib/metadata.ts`) | published menu slugs to the world | public |
| O-14 | Error envelope `apiError` | `error.code` + human message; generic `'Internal Server Error'` on throw | stack traces are `console.error`-only, not returned |
| O-15 | Server logs (`console.warn/error`) → Vercel logs | DB errors, "Merchant lookup failed …", Firebase/GCP warnings | see Phase 2 logging review |
| O-16 | Outbound third-party payloads | phone + code (Cognito), ID token (Firebase verify), menu photo base64 (OpenAI) | server-side only |

---

## 0.11 Attack surface

| Class | Surface |
| --- | --- |
| **Fully public (no session)** | 5 pages (`/`, `/welcome`, `/otp`, `/business-setup`, `/admin/login`, `/test-auth`=6), 3 unlimited-ish public APIs (`otp/send`, `otp/verify`, `admin/login`), `logout`, `GET /api/customer/offers/[offerId]`, `/scan` + `/scan/[offerId]` pages, `/menu/[slug]` page, `/sitemap.xml`, `/robots.txt`, all static assets, `/.next/*` (prod build output) |
| **Authenticated (any valid JWT, any role)** | `/api/auth/me`, `/api/auth/business-setup`, and — because `middleware.ts` does **not** run for `/api` — every `/api/merchant/*`, `/api/offers/*`, `/api/billing*`, `/api/customer/*`, `/api/admin/*` route that relies **solely** on its own guard. Role separation is enforced per-handler (`withMerchant` rejects admin/customer sessions; `withCustomer` rejects admin; `withAdmin` requires `role==='admin'`). |
| **Merchant tenant scope** | 20 merchant endpoints + 6 offer endpoints + 2 billing + 6 customer endpoints. Cross-tenant expectation: **404, never 403** |
| **Device-bound (highest assurance)** | exactly one route: `POST /api/merchant/scan-requests/[id]` via `withMerchantApp` |
| **Admin** | 8 endpoints, password-only auth, no MFA, module-level in-memory throttle |
| **Internal / never exposed** | `backend/**` (no route mounts it directly), `storage/**` (filesystem only), root `.env` / `frontend/.env.local`, Prisma CLI, `scripts/*.mjs` |
| **Public but should not be** | `/test-auth` (`PUBLIC_PATHS`), and the Firebase/Firestore write path it exercises — R-04 |
| **Absent controls observed at recon level** | no `/health` `/ready` `/live` route; no security headers configured (no `headers()` in `next.config.mjs`, no `vercel.json`); no CORS config anywhere (browser same-origin only); no CSP; no rate limiting on `otp/send` / `otp/verify` / `business-setup` / `menu/extract`; no WAF/IaC/Docker; no `.github/` CI |

---

## 0.12 Observations to carry into later phases (`R-xx`)

These are **recon observations, not verified findings** — each is assigned an owner phase and
must be proven (with `file:line` + PoC) before it becomes a finding.

| ID | Observation | Evidence (recon) | Owner phase | Why it matters |
| --- | --- | --- | --- | --- |
| R-01 | `testCode` is returned in the OTP-send response whenever `NODE_ENV !== 'production'` | `auth/otp/send/route.ts` returns `...(result.testCode && process.env.NODE_ENV !== 'production' ? { testCode } : {})` | 2 | OTP bypass if a deployment is ever run with `NODE_ENV` unset/`development` (self-hosted, `next start` misconfig, a preview env) |
| R-02 | `JWT_SECRET` has an identical hardcoded fallback in two places | `backend/auth.ts` and `frontend/middleware.ts` both `process.env.JWT_SECRET \|\| 'loyl_default_secure_secret_key_2026_bd_market'` | 2 | Session forgery for any deployment where the var is missing; also a secret living in the repo |
| R-03 | `role` is taken from the **request body** on OTP verify and drives session authority | `verifyOtpSchema.role` ∈ {merchant, customer}; `createSessionToken({ … role: 'customer' … })` | 2 | Verify the enum really excludes `admin`, and that `role: 'customer'` + any phone cannot inherit a merchant's `userId` (`cust_${phone}` fallback) |
| R-04 | `/test-auth` is publicly routable, and its form writes to Firestore `users/{uid}` | `middleware.ts` `PUBLIC_PATHS` includes `/test-auth`; `app/test-auth/page.tsx` comment says "Delete before launch"; `components/auth/EmailAuthForm.tsx` uses the Firebase client SDK | 2 + 6 | Public write path to a Firebase project; also `firebase` client dep + Firestore rules are outside this repo's auditable scope |
| R-05 | Menu photo is served to logged-out customers but the reading route is merchant-only | `GET /api/merchant/menu/photo` is `withMerchant`; the public `/menu/[slug]` server component renders `photoPath` (its query selects `title/backgroundHex/publishedAt/merchant/categories` and **not** `photoPath` — the render path must be confirmed) | 1 + 4 | Either the public page shows no photo (functional gap) or a second, ungated read path exists — **UNKNOWN, verify in Phase 1** |
| R-06 | `gsap` is used by exactly one component; `CODIN.md` §5 mandates Framer Motion recipes only | `components/ui/skiper-ui/skiper39.tsx` imports `gsap` and runs a `gsap.ticker` + timeline + `Math.random()` | 1 + 5 | Convention violation; a second animation engine ships in the client bundle; `ticker.add` cleanup is a leak candidate |
| R-07 | No `prisma/migrations/` — schema is applied with `db push` | directory absent; `package.json` has `db:push`, no `migrate`/`deploy` | 6 | No reversible/zero-downtime migration story, no prod drift detection |
| R-08 | Uploads are written to the local filesystem under `process.cwd()` | `MENU_PHOTO_DIR = path.join(process.cwd(), 'storage', 'menu-photos')`, `SCREENSHOT_DIR = … 'storage','payment-screenshots'` | 6 | Serverless/read-only or multi-instance hosting loses or fails uploads; also unbounded local growth (19 menu photos already committed) |
| R-09 | Upload validation checks the client-declared MIME **string** only | `saveMenuPhoto`: `MENU_PHOTO_MIME_EXT[file.type]` — no magic-byte sniffing | 2 | Stored "image" may be arbitrary content; served back with an attacker-chosen content-type |
| R-10 | `bcryptjs` is a production dependency with zero imports | `grep -rn bcryptjs backend frontend scripts` → no matches | 1 | Dead dep (knip candidate); passwords/OTPs are not hashed with it anywhere — the hashing story is Cognito/Firebase-managed |
| R-11 | Routes are untested at unit level; coverage lives in smoke scripts | 20 `*.test.ts` files, **all** under `backend/**` or `frontend/lib/**`; zero under `frontend/app` | 3 | The 49 handlers' validation/guard order has no unit coverage; the 11 `scripts/*-smoke.mjs` are the only HTTP regression net |
| R-12 | Stated test totals disagree with the repo | `AUDIT_SUMMARY.md` claims 312 tests / 17 files; `find` shows 20 `*.test.ts` files | 3 | Re-measure in Phase 3 (`vitest run --coverage`) before trusting any number |
| R-13 | Two files mirror the session cookie + secret (edge cannot import `next/headers`) | `middleware.ts` comments this explicitly | 2 | Any future change to cookie name/TTL/alg must be made twice or auth silently diverges |
| R-14 | Admin throttle state is per-instance and in-memory | `backend/admin.ts` `const attempts = new Map(...)` with the caveat documented in the file | 2 + 6 | Effective limit is `5 × instanceCount` per 60 s; no durable lockout on a multi-instance deploy |
| R-15 | No security headers, no CSP, no `headers()` block, no `/health` endpoint, no CI | `next.config.mjs` has only tracing root + remotePatterns; `firebase.json` is a stub; no `.github/` | 6 | Baseline prod-readiness gaps (Phase 6 checklist) |
| R-16 | Public business profile exposes outbound links publicly | `customer/offers/[offerId]` returns `websiteUrl`/`facebookUrl`/`instagramUrl` with no session | 2 | Low; linking-off-site from a QR deep link is a phishing vector worth a line in the report |
| R-17 | `Decimal` lat/lng are compared through `geo.ts` haversine; the client also sends its own coords | `scanSchema` = `coordinateShape` (lat/lng from the client), fence enforced server-side per `CODIN.md` §6 | 2 + 7 | Confirm the fence cannot be satisfied by spoofed coordinates when a merchant has no branch coordinates (`isGeoRequired`) |
| R-18 | `landing page/` is a second, non-Next marketing site with its own `serve.js` | `landing page/index.html`, `serve.js`, `styles.css` | 4 + 6 | Not part of the deployed app; risks being an untracked public surface if ever served |

---

## 0.13 Explicit UNKNOWNs (rule #4 — never guess)

1. Whether `JWT_SECRET`, `ADMIN_PASSWORD`, `DATABASE_URL`, or any `AWS_*`/`FIREBASE_*`/
   `OPENAI_*` var is actually set in local, preview, and production — **values were not read**
   (secrets) and no deployment access exists. Phase 6 must verify fail-fast behaviour instead.
2. Whether the production deploy is Vercel (docs say so; no `vercel.json`, no CI). Filesystem
   persistence (`storage/`) behaviour on the real host is therefore unknown.
3. Whether AWS Cognito real resources or Firebase Phone Auth are live in any environment
   (both are documented as env-gated and currently mocked/absent).
4. Whether a Prisma migration baseline exists outside the repo (e.g. hand-applied
   `supabase-schema.sql`) — the file exists at root but its relationship to `schema.prisma`
   is undocumented.
5. Whether the public `/menu/[slug]` page renders the uploaded photo and via which route
   (R-05) — requires reading the rest of that page in Phase 1.
6. Whether any Firestore security rules exist for the `/test-auth` write path (rules live in the
   Firebase console, outside this repo).
7. Which of the CI/scanning tools from the audit prompt can be installed in this environment —
   awaiting your decision (§0.1).

---

## 0.14 Raw evidence / reproduction

```bash
# tree (depth 3, excluding generated/ignored trees)
find . -maxdepth 3 -not -path './node_modules*' -not -path './.git/*' \
  -not -path './frontend/.next*' -not -path './.playwright-mcp*' -not -path './storage/*' | sort

# entry points
glob 'frontend/app/**/route.ts'   # 39 files
glob 'frontend/app/**/page.tsx'   # 27 files
grep -rhoE "export (const|async function) (GET|POST|PATCH|PUT|DELETE)" \
  $(find frontend/app/api -name route.ts) | wc -l          # 49 handlers

# guards per route (the table in §0.4.2 was generated by this)
for f in $(find frontend/app/api -name route.ts | sort); do
  echo "### $f"
  grep -nE "export (async function|const) (GET|POST|PUT|PATCH|DELETE)|with(Auth|Merchant|Customer|Admin)\(" "$f"
done

# data model
grep -cE '^model ' backend/prisma/schema.prisma   # 16
grep -cE '^enum '  backend/prisma/schema.prisma   # 11

# env var names (values never printed)
grep -rhoE 'process\.env\.[A-Z0-9_]+' --include='*.ts' --include='*.tsx' \
  --include='*.mjs' --include='*.js' backend frontend scripts | sort -u

# tests
find . -name '*.test.ts' -not -path './node_modules/*'   # 20 files, none under frontend/app

# jobs / webhooks / cron: NONE
grep -rniE "webhook|cron|queue|worker|job" --include='*.ts' --include='*.tsx' \
  --include='*.mjs' backend frontend scripts
```

Installed versions were read with
`node -e "console.log(require('./node_modules/<pkg>/package.json').version)"`
(no network, no installs).

---

## Phase 0 verdict

**Recon complete. The map is drawn; no code was touched.**

The most load-bearing things a later phase must attack first, in the order I would exploit them:
the two-place `JWT_SECRET` fallback (R-02), the dev-only `testCode` leak (R-01), the body-supplied
`role` (R-03), the public `/test-auth` + Firestore write path (R-04), the absence of any rate
limit on OTP send/verify (R-11/§0.11), and the local-filesystem upload model on a serverless host
(R-08).

**Awaiting your instruction to start Phase 1 (static audit).** Per the prompt, no fix will be
applied before each one is approved.
