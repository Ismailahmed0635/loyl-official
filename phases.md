# phases.md — Build Phases

## Status Key
✅ Done | 🟡 In Progress | 🔲 Pending | ⛔ Blocked

> **Path convention (since 2026-09-23 repo split):** file lists below use repo-root-relative paths as originally written. `app/…`, `components/…`, `lib/…` now live under **`frontend/`** (e.g. `app/(auth)/otp/page.tsx` → `frontend/app/(auth)/otp/page.tsx`). `backend/…` paths are unchanged (schema at `backend/prisma/schema.prisma`).

---

## Phase 1 — Auth Flow | ✅ Done
Files:
- app/(auth)/welcome/page.tsx
- app/(auth)/otp/page.tsx
- app/(auth)/business-setup/page.tsx

Deliverable: merchant can sign up, verify OTP, set up profile
Notes: Design done in Stitch. Code reviewed 2026-09-23: D1/D3/D4 fixed, Cognito transport added (dev-mock active, AWS pool pending — COGNITO_SETUP.md).

---

## Phase 2 — Merchant Core | ✅ Done
Files:
- app/(merchant)/dashboard/page.tsx
- app/(merchant)/offers/new/page.tsx        ← Offer Generator
- app/(merchant)/offers/[id]/page.tsx       ← Offer Edit
- app/(merchant)/offers/[id]/qr/page.tsx    ← QR Result
- app/(merchant)/branches/page.tsx

Deliverable: merchant can create offer, generate QR, manage branches
Notes: Movable menu button pattern. Mobile bottom-nav, desktop top-nav.
Completed 2026-09-23: supporting files — `app/(merchant)/layout.tsx` (auth gate) + `components/merchant/MerchantNav.tsx` (desktop top-nav, mobile bottom-nav with draggable quick-menu FAB) + `components/merchant/OfferForm.tsx` + `lib/api/merchant.ts` + `lib/poster.ts`; APIs `/api/offers` (CRUD), `/api/branches` (CRUD), `/api/merchant/stats`, `/api/offers/[id]/qr` with `withMerchant` guard (401 unauth → 409 SETUP_REQUIRED → 404 cross-merchant); Zod `offerSchema`/`branchSchema` in backend/validation. QR via `qrcode` pkg (PNG data URL, scan URL = `/scan/[offerId]`). Verified: tsc clean, vitest 29/29, `next build` OK, Playwright UI walkthrough, `scripts/phase2-smoke.mjs` 88/88.

---

## Phase 3 — Customer Experience | ✅ Done
Files:
- app/(customer)/scan/page.tsx              ← OTP entry
- app/(customer)/stamp-card/page.tsx
- app/(customer)/reward/page.tsx            ← Reward popup
- app/(customer)/profile/page.tsx

Deliverable: customer can scan QR, collect stamps, redeem reward
Notes: WebOTP API for phone auto-detect. Animated stamp fills. QR posters from Phase 2 encode `/scan/[offerId]` — build `app/(customer)/scan/[offerId]/page.tsx` (TEST.md §3) or redirect it to `scan/page.tsx`.
Completed 2026-09-23: supporting files — `app/(customer)/layout.tsx` (customer gate, skips `/scan*`), `components/customer/{CustomerNav,StampGrid,RewardModal,OtpEntry,Confetti}.tsx`, `hooks/useRewardClaim.ts`, `lib/api/customer.ts`, `backend/{scan,geo}.ts` (card state/cooldown engine + haversine/nearest-branch), `withCustomer` guard, customer role sessions (`role=customer`, merchant endpoints → 403 CUSTOMER_SESSION), `CustomerStamp.lastReviewAt` field (db:push applied). APIs: `GET /api/customer/offers/[offerId]`, `POST /api/customer/{scan,redeem,review}`, `GET /api/customer/cards` — GPS proximity, 24h scan cooldown, atomic stamp increment, review bonus (Google Maps return-focus, 24h window). Pages `/scan`, `/scan/[offerId]`, `/stamp-card`, `/reward`, `/profile`. Verified: tsc clean, vitest 50/50, `next build` OK, Playwright UI walkthrough (OTP → stamp → review bonus → reward modal → receipt), `scripts/phase3-smoke.mjs` 78/78.
Post-completion add (2026-09-23): scratch-to-reveal reward card — `frontend/lib/scratch.ts` (reveal math: `REVEAL_THRESHOLD` 0.6, `extractAlphas`/`revealedRatio`/`isRevealed`) + `frontend/components/customer/ScratchCard.tsx` (amber foil canvas, pointer/keyboard/Reveal-button fallbacks, reduced-motion instant reveal, `willReadFrequently`), wired into `RewardModal` 'ready' state (Claim gated until revealed). Verified: tsc clean, vitest 66/66 (`frontend/lib/scratch.test.ts` 16), `next build` OK (25 routes), Playwright walkthrough (scratch → reveal → claim → receipt), smokes 35/35 + 88/88 + 78/78.
Re-verified 2026-09-26 (Phases 9/10/11 landed since): customer sign-in now sends `name`
(422 `NAME_REQUIRED` without it) and every scan is asserted through the approval gate —
scan opens a PENDING check-in → web session 403 `APP_APPROVAL_REQUIRED` → Ed25519 proof
stamps the card, with the 24h cooldown measured from approval. Verified: tsc clean, vitest
251/251, `next build` OK, `scripts/phase3-smoke.mjs` **85/85**.

---

## Phase 3.5 — Separated Offer Types (Stamp vs Scratch Card) | ✅ Done — smoke 56/56
Files:
- backend/prisma/schema.prisma        ← OfferType/ScratchMode enums, Offer.offerType, ScratchItem, ScratchResult
- backend/scratch.ts                  ← pickReward rotation + buildScratchState cooldown
- backend/validation/schemas.ts       ← offerTypeSchema + scratchOfferSchema / updateScratchOfferSchema
- frontend/app/api/offers/route.ts, frontend/app/api/offers/[id]/route.ts  ← per-type create/update
- frontend/app/api/customer/scratch/route.ts  ← dedicated scratch endpoint (409 WRONG_OFFER_TYPE both directions vs /scan)
- frontend/app/api/customer/{scan,redeem,review}/route.ts  ← stamp-only guards; cards route = STAMP offers only
- frontend/components/merchant/OfferForm.tsx  ← type selector + dynamic stamp/scratch fields
- frontend/components/customer/ScratchOfferView.tsx  ← customer scratch-to-reveal flow
- scripts/offer-type-smoke.mjs       ← create/save/scan both types independently

Deliverable: merchant picks Stamp or Scratch Card up front; each type has its own schema, validation, endpoints, and customer UI
Notes: mark ✅ only after typecheck + vitest + all 4 smokes + Playwright walkthrough pass.
Re-verified 2026-09-26: `scripts/offer-type-smoke.mjs` **73/73** (up from 56/56) — the stamp
leg now covers Phase 9/10 (PENDING check-in → device-signed approval → stamp lands → cards
list pairs the card), and the customer sign-in sends `name` for Phase 11.

---

## Phase 3.6 — Dice Roll Offer (third offer type) | ✅ Done — offer-type smoke 107/107

Files:
- backend/prisma/schema.prisma        ← OfferType.DICE, Offer.diceCount Int?, DiceRollResult (@@unique([offerId, customerPhone]))
- frontend/lib/dice.ts                ← shared pure helpers: normalizeDiceCount (1–5), discountRange
- backend/dice.ts                     ← roll engine (rollDice, buildDiceState, findDiceRoll) + re-exports the pure helpers
- backend/validation/schemas.ts       ← diceOfferShape / diceOfferSchema / updateDiceOfferSchema / diceRollSchema; create union gains 'DICE'
- frontend/app/api/offers/route.ts, frontend/app/api/offers/[id]/route.ts  ← 3-branch create/update; cross-type diceCount → 422 OFFER_TYPE_MISMATCH, type change → 422 OFFER_TYPE_IMMUTABLE
- frontend/app/api/customer/dice/route.ts  ← one-time roll endpoint (guard order: offer → type → paused/ended → GPS → already-rolled → persist)
- frontend/app/api/customer/offers/[offerId]/route.ts  ← context exposes diceCount + dice roll state (UI renders without an error)
- frontend/components/merchant/OfferForm.tsx  ← "Dice Roll Offer" radio card, dice-count chips 1–5, indigo live preview
- frontend/components/customer/DiceOfferView.tsx  ← plate + configured dice + "Roll the Dice" (diceTumble/popIn, useReducedMotion, ALREADY_ROLLED handling)
- frontend/lib/motion/variants.ts     ← diceTumble recipe
- scripts/offer-type-smoke.mjs        ← H2–H6: create 422s, roll-once limit, cross-type guards, PATCH rules, analytics, GPS

Deliverable: a third offer type — merchant picks 1–5 dice, the customer rolls exactly once, and the sum of the faces is their discount percent (1 die = 1–6%, 5 dice = 5–30%).
Notes:
- The one-time limit is DB-enforced (`@@unique([offerId, customerPhone])` → P2002 caught as 409 `ALREADY_ROLLED` carrying the prior roll); a refresh/rescan re-reads the same outcome from the context, never a fresh roll.
- Dice has its own indigo identity (`#4F46E5`, indigo-50/600/700 pills/buttons/preview) so amber stays offers/scratch-only (brain.md §4); `Button` now merges `className` through `cn` so a flow's accent colour wins over its default variant.
- Rolls count as analytics activity: `diceRolls` on `SeriesPoint`/`AnalyticsTotals`/`OfferPerformance`, sourced from `DiceRollResult` and unioned with the other sources; CSV gains a `dice_rolls` column.
- Error codes reuse the stable set (WRONG_OFFER_TYPE / OFFER_PAUSED / OFFER_ENDED / NEED_LOCATION / LOCATION_OUT_OF_RANGE / OFFER_TYPE_IMMUTABLE / OFFER_TYPE_MISMATCH); `ALREADY_ROLLED` (409) is the only new code.
Verified 2026-09-26: `npm run typecheck` clean, `npm test` **277/277** (19 dice + 14 analytics tests), `npm run build` exit 0 with `/api/customer/dice` in the route table, all 8 smokes **535/535** (offer-type 105/105 with the new H2–H6 sections; phase4 CSV total row gained the `dice_rolls` cell), Playwright walkthrough (dice card in `/offers/new` → pre-roll plate → roll → same state after refresh, QR poster, dashboard `4 dice · 4–24% off`).
Follow-up 2026-09-26 (dice animation rewrite + review/social card): `DiceOfferView` rebuilt as a real 3D tumble-and-land — six-plate CSS cubes (`DIE_PLATES`, opposite faces sum to 7), per-die tumble steps every ~130ms (`diceTumble` + per-die offsets and an alternating hop), landing spins forward onto the exact rolled face via `faceOrientation`/`landingRotation` in `lib/dice.ts` (≥1 extra full turn, never a rewind; ~60ms stagger, `diceLanding` bounce); reduced motion lands instantly. A `landing` gate discovered during QA keeps the roll panel mounted until the spin-down finishes, so the switch to the already-rolled branch can no longer unmount the dice mid-flip (its `popIn` is skipped when `result` was set this session → seamless handover). New shared `frontend/components/customer/ShopLinks.tsx` renders under **all three** offer types on `/scan/[offerId]`: a Google review button (bonus-claim aware on stamp offers; a plain Maps link on scratch/dice) plus the merchant's Website/Facebook/Instagram links from Settings → Social Links (hidden when unset). Verified 2026-09-26: `npm run typecheck` clean, `npm test` **283/283** (6 new dice-helper tests), `npm run build` exit 0 (dev stopped), all 8 smokes **537/537** (offer-type **107/107** with the 2 new socials assertions), Playwright QA (frame-by-frame cube transforms at 54fps → 16–17 distinct poses per die landing on `rotateX(360)/rotateY(450|540)`, mid-flight screenshots, pip sum = displayed total, ShopLinks on stamp/scratch/dice incl. the stamp bonus variant after a device-approved scan).

---

## Phase 4 — Analytics & Settings | ✅ Done — smoke 53/53
Files:
- app/(merchant)/analytics/page.tsx
- app/(merchant)/settings/page.tsx
- app/(merchant)/customers/page.tsx
- backend/analytics.ts                  ← pure series/totals/offer/CSV helpers
- backend/activity.ts                   ← best-effort ActivityEvent writer
- backend/prisma/schema.prisma          ← ActivityEvent + ActivityType; Merchant social-link columns
- frontend/app/api/merchant/analytics/route.ts  ← GET JSON + ?format=csv
- frontend/app/api/merchant/customers/route.ts  ← GET search + pagination
- frontend/app/api/merchant/settings/route.ts   ← GET/PATCH
- frontend/components/merchant/AnalyticsChart.tsx  ← zero-dep SVG bar chart
- scripts/phase4-smoke.mjs

Deliverable: merchant can track performance and configure account
Notes: Charts, date range filter, CSV export.
Completed 2026-09-24: schema adds `ActivityEvent` (SCAN/REVIEW_BONUS/REDEEM recorded best-effort via `recordActivity` in scan/redeem/review routes — rejected scans/cooldowns record nothing; scratch activity still sourced from `ScratchResult`, analytics unions both) and `Merchant.websiteUrl/facebookUrl/instagramUrl` (LOYLS §6; db push applied, client regenerated). Analytics: UTC day bucketing, 7/30/90 presets + custom from/to (paired dates, ≤366 days → 422), KPI totals (scans, new vs returning customers, total redeemed, redemption rate, unique visitors), per-offer breakdown (sorted by activity), CSV export via same route `?format=csv` (Content-Disposition attachment, CRLF rows + total row). Customers: phone search + page/pageSize (coerced, 1–100), full phone shown to the owning merchant. Settings: PATCH ≥1 field (422 on empty body), http/https-only URLs (max 300), empty string clears column → null, phone never editable. Nav: 5 desktop top-nav items; mobile bottom-nav keeps 2 primary items around the FAB, Analytics/Customers/Settings live in the FAB quick menu. Verified: tsc clean, vitest 108/108 (new `backend/analytics.test.ts` + Phase 4 schema tests), `next build` OK, `scripts/phase4-smoke.mjs` 53/53 + regression smokes phase1 35/35 + phase2 88/88 + phase3 78/78 + offer-type 56/56, Playwright walkthrough (range presets, series switch, customers search/empty, settings save/invalid/clear, mobile FAB menu) — 0 console errors (duplicate chart gridline key warning fixed), screenshots `pw-phase4-analytics/customers/settings/mobile-menu.png`.
Re-verified 2026-09-26: `scripts/phase4-smoke.mjs` **57/57** (up from 53) — customer activity is
now counted at approval (the scan opens a PENDING check-in, and the app-signed approval writes
the SCAN event and creates the card, so `newCustomers`/`uniqueVisitors` follow the approval),
the blocked re-scan assertion names the real code (`409 CARD_COMPLETE`), and customer sign-in
sends `name` for Phase 11.

---

## Phase 5 — Admin Panel | ✅ Done
Files:
- frontend/app/(admin)/admin/login/page.tsx        ← password login (/admin/login)
- frontend/app/(admin)/admin/(panel)/layout.tsx    ← session gate + desktop-only shell
- frontend/app/(admin)/admin/(panel)/page.tsx      ← dashboard (KPIs + recents)
- frontend/app/(admin)/admin/(panel)/merchants/page.tsx  ← search/filter/actions
- frontend/app/(admin)/admin/(panel)/billing/page.tsx    ← payment verification
- frontend/app/api/admin/{login,session,stats,merchants,merchants/[id],payments,approve-payment,reject-payment}/route.ts
- backend/admin.ts (+ admin.test.ts)               ← password auth, throttle, subscription actions
- frontend/lib/api/admin.ts, frontend/components/admin/{AdminNav,StatusPill,ConfirmDialog,Pagination}.tsx

Deliverable: super admin can manage merchants and subscriptions
Notes: Desktop-only for now (mobile shows a notice card). Auth = ADMIN_PASSWORD env
(12h sessions, per-IP throttle). Smoke: scripts/phase5-smoke.mjs 63/63.
Note: phases.md originally listed app/(admin)/… paths, but app/(admin)/dashboard
would collide with the merchant /dashboard — real routes live under /admin.

---

## Phase 6 — Public Pages | 🔲 Pending
Files:
- app/(public)/page.tsx                     ← Landing
- app/(public)/pricing/page.tsx
- app/(public)/terms/page.tsx
- app/(public)/privacy/page.tsx
- app/not-found.tsx

Deliverable: marketing site + legal pages ready
Notes: SEO optimized. Desktop-primary.

Follow-up 2026-09-27 (landing connected, **separate deploy** — partial Phase 6):
the marketing landing is the repo-root `landing page/` static site
(`index.html` + `styles.css` + `script.js` + `serve.js`, `node serve.js` → :4321).
Its dead `#signin` / `#signup` / `#contact` anchors were rewired: all seven
Sign In / Get Started / Start Free Trial / Get Pro CTAs now point at
`${APP_ORIGIN}/welcome` (absolute — the landing and the app are different
hosts), and Contact Us is a `mailto:`. `/welcome` is the app's single
phone → OTP entry, so sign-in and first-time registration share one screen
(`#signin` and `#signup` therefore land on the same URL by design).

The app origin does **not** serve the landing: `frontend/public/` holds only
the PWA icons + peeps sprite, `next.config.mjs` has no rewrites, and `/` 307s
to `/welcome` (`frontend/app/page.tsx`). robots.txt stays `Disallow: /` +
`Allow: /menu/` and `/sitemap.xml` lists published menu slugs only — `/` is a
redirect here, and advertising a redirect target would split SEO credit away
from the separately deployed landing.

When the production domains are fixed, replace `http://localhost:3000` in
`landing page/index.html` (the only origin used there) and mirror it into
`NEXT_PUBLIC_APP_URL`.

Still pending here: /pricing, /terms, /privacy (an `app/(public)` route group
is optional — those pages may also ship as static files beside the landing).

---

## Phase 7 — Payments & Billing | ✅ Done
Files:
- backend/prisma/schema.prisma (PaymentRequest, SubscriptionTier enum, Merchant.subscriptionTier)
- backend/billing.ts (+ backend/billing.test.ts) — saveScreenshot/readScreenshot/deleteScreenshot, subscriptionGrant
- backend/validation/schemas.ts — checkoutSchema (FREE skips payment fields; paid requires method/number/trxId/amount)
- frontend/lib/api/payments.ts — tier plans, BKASH_NUMBER/NAGAD_NUMBER, submitCheckout, client screenshot rules
- frontend/components/billing/CheckoutModal.tsx — tier picker, personal bKash/Nagad numbers, method toggle, optional screenshot upload, success state
- frontend/app/(merchant)/billing/page.tsx — current plan card, 4 plan cards, request history table, pending-review banner
- frontend/app/(merchant)/billing/checkout/page.tsx — checkout route
- frontend/app/api/billing/route.ts — GET merchant billing state (401/403 CUSTOMER_SESSION/ADMIN_SESSION)
- frontend/app/api/billing/checkout/route.ts — POST multipart checkout (5MB cap, image types only)
- frontend/app/api/admin/payments/route.ts — pending/approved/rejected/all list + search
- frontend/app/api/admin/payments/[id]/screenshot/route.ts — admin-only screenshot stream (403 NOT_ADMIN)
- frontend/app/api/admin/approve-payment/route.ts — in-transaction status+tier+expiry update, then post-commit deleteScreenshot()
- frontend/app/api/admin/reject-payment/route.ts — reject without touching subscription
- frontend/app/(admin)/admin/(panel)/billing/page.tsx — table (merchant/tier/method/payment/amount/screenshot/status/actions), tabs, search, lightbox, Assign-tier confirm dialog
- frontend/middleware.ts — server-side auth gate (public allowlist + guest redirects; /api excluded so APIs keep JSON 401/403)
- scripts/phase7-smoke.mjs — API + middleware matrix (54 checks; rawMultipart() workaround for Node/undici >1MB FormData bug)

Deliverable: manual bKash/Nagad subscription payments with admin verification ✅
Notes: User redirected (2026-09-24): MVP uses manual bKash/Nagad verification with
optional screenshot upload (free-tier requests may submit with no screenshot/payment
details) + admin tier approval (FREE/MONTHLY/YEARLY/PREMIUM) with automatic screenshot
deletion on review; SSLCommerz deferred. Phase 6 (landing/SEO) explicitly deferred by user.
Main app is strictly auth-gated by frontend/middleware.ts (user chose middleware option;
phase1–5 smokes updated to pass session cookies). Verified: tsc clean, vitest 143/143,
next build OK, smokes phase1 35 + phase2 89 + phase3 78 + phase4 53 + offer-type 56 +
phase5 63 + phase7 54 = 428/428, Playwright walkthrough (billing → checkout with screenshot
→ admin lightbox → approve w/ tier dropdown → success notice + file deleted from storage)
with pw-phase7-* screenshots incl. mobile + guest-redirect. OPEN ITEM: BUILD.md/TEST.md
"lock dashboard features when subscription pending/expired" not implemented — not among the
user's 4 requirements, flagged for a later pass.

---

## Phase 9 — Merchant-Approved Stamps (ScanRequest) | ✅ Done — verified 2026-09-26
Files:
- backend/prisma/schema.prisma              ← ScanRequestStatus enum + ScanRequest model
- backend/scan.ts                           ← findPendingScanRequest + grantStamp
- backend/validation/schemas.ts             ← scanRequestListQuerySchema
- frontend/app/api/customer/scan/route.ts   ← opens a PENDING request instead of stamping
- frontend/app/api/customer/offers/[offerId]/route.ts  ← exposes pendingRequest
- frontend/app/api/merchant/scan-requests/route.ts       ← GET queue (pendingCount)
- frontend/app/api/merchant/scan-requests/[id]/route.ts  ← POST approve (no reject route)
- frontend/lib/api/{customer,merchant}.ts   ← types + listScanRequests/approveScanRequest
- frontend/app/(merchant)/requests/page.tsx ← merchant queue (Waiting/Approved tabs)
- frontend/components/merchant/MerchantNav.tsx  ← Requests item + pending badge (15s poll)
- frontend/app/(customer)/scan/[offerId]/page.tsx ← "waiting for shop" state + 5s poll

Deliverable: every stamp scan is confirmed by the merchant before the stamp lands
Notes: Customer scans → sees "Check-in sent — waiting for the shop to confirm" (no
stamp yet) → merchant is notified instantly on `/requests` → merchant accepts (stamp
applied + SCAN analytics event written) or holds. There is deliberately NO reject
path, so a merchant can never deny a customer a stamp. One open request per shop per
customer; a repeat scan while one is waiting just returns the same check-in as a
success (`alreadyPending: true`) — the customer is deliberately never blocked or
errored. The 24h cooldown now starts on approval, not on scan, and is what limits a
customer to one stamp per shop per day.
Verified 2026-09-26: `db:push` applied (`ScanRequest` + `ScanRequestStatus` present in the
local DB), `npm run typecheck` clean, `npm test` 251/251, `npm run build` OK, and the smokes
now assert the approval gate instead of the old instant-stamp flow — phase3 85/85, phase4
57/57, offer-type 73/73 (all three scan → PENDING → device-signed approval → stamp).

---

## Phase 10 — App-Only Stamp Approval (device-bound) | ✅ Done — verified 2026-09-26
Files:
- backend/prisma/schema.prisma                    ← MerchantDevice + DeviceStatus, ScanRequest.approvedByDeviceId (SetNull)
- backend/devices.ts                              ← canonical payload, proof parse, Ed25519 verify, skew window, register/revoke/authenticate
- backend/devices.test.ts
- backend/api/handler.ts                          ← withMerchantApp guard (403 APP_APPROVAL_REQUIRED)
- backend/validation/schemas.ts                   ← deviceRegisterSchema (strict — rejects private key material)
- frontend/app/api/merchant/devices/route.ts      ← GET list / POST register
- frontend/app/api/merchant/devices/[id]/route.ts ← DELETE revoke
- frontend/app/api/merchant/scan-requests/[id]/route.ts ← approval now requires a device proof
- frontend/app/(merchant)/requests/page.tsx       ← "Approve in the Loyl app" notice replaces a button that can never succeed

Deliverable: only the merchant's registered mobile app can approve a customer check-in.
The app generates an Ed25519 keypair, registers the public key once, and signs a payload
that binds merchant + ScanRequest id + timestamp; the server verifies it against an
ACTIVE device. The web dashboard holds no device key, so it receives 403
`APP_APPROVAL_REQUIRED` and can never approve — it may still review and hold.
Notes: no new dependencies (Node `crypto` only); the server stores public keys only, so a
database leak cannot forge approvals. New error codes: APP_APPROVAL_REQUIRED,
DEVICE_PROOF_INVALID, DEVICE_PROOF_STALE, DEVICE_PROOF_UNSUPPORTED (426), DEVICE_REVOKED,
INVALID_DEVICE_KEY. `db:push` is required (new table). See CODIN.md §11 for the contract
the app is built against.
Verified 2026-09-26: `db:push` applied (`MerchantDevice` table + `ScanRequest.approvedByDeviceId`
present), Prisma client regenerated, `npm run typecheck` clean, `npm test` 251/251 (incl.
`backend/devices.test.ts` 20/20), `npm run build` OK, and the smokes exercise the gate against
a dev server: web session → 403 `APP_APPROVAL_REQUIRED`, Ed25519 proof → 200 with
`approvedByDeviceId` recorded. Shared signer lives in `scripts/device-approval.mjs`
(used by phase3, phase4 and offer-type smokes).

---

## Phase 11 — Customer Name + Phone Verification | ✅ Done — verified 2026-09-26
Files:
- backend/prisma/schema.prisma          ← CustomerStamp.customerName, ScanRequest.customerName
- backend/validation/schemas.ts         ← customerNameSchema; `name` on verifyOtpSchema
- backend/auth.ts                       ← SessionPayload.name
- frontend/app/api/auth/otp/verify/route.ts ← 422 NAME_REQUIRED for customer sessions without a name
- frontend/components/customer/OtpEntry.tsx ← required "Full Name" field on the phone step
- frontend/app/api/customer/scan/route.ts  ← name guard, stored on the ScanRequest
- backend/scan.ts                       ← grantStamp writes customerName onto the card
- frontend/app/api/merchant/scan-requests/* ← customerName in list + approve responses
- frontend/app/(merchant)/requests/page.tsx ← shows the name, not just a phone number
- frontend/app/(customer)/scan/page.tsx     ← copy: "Add your name and verify your phone"

Deliverable: a customer on the web app verifies **both a name and a phone number** before any
check-in is created, so the merchant always sees who is asking for a stamp.
Notes: the merchant flow is deliberately untouched — `name` is optional on `verifyOtpSchema` and
the `role: 'customer'` requirement is enforced in the route (422 `NAME_REQUIRED`), because a
merchant has a business profile rather than a personal name. `grantStamp` takes the name as an
optional 4th argument and only writes it when non-empty, so cards created before this change keep
working. New guard: `POST /api/customer/scan` returns 422 `NAME_REQUIRED` for a customer session
with no verified name (pre-existing sessions must re-verify at `/scan`).
Verified 2026-09-26: `db:push` applied (`CustomerStamp.customerName` present), `npm run typecheck`
clean, `npm test` 251/251, `npm run build` OK, and every customer sign-in in the smokes now
sends `name` — a session without it never exists (422 `NAME_REQUIRED`), which is what was
causing the downstream 401s. Smoke results: phase3 85/85, phase4 57/57, phase5 63/63,
phase7 54/54, offer-type 73/73.

---

## Phase 12 — Digital Menu Card | ✅ Done - smoke 47/47
Files:
- backend/prisma/schema.prisma          ← DigitalMenu, MenuCategory, MenuItem + Merchant.digitalMenu
- backend/menu.ts                       ← photo IO, slug allocation, colour maths, OpenAI Vision extraction
- frontend/lib/color.ts                 ← shared WCAG colour maths (public page + editor preview)
- frontend/lib/constants.ts             ← MENU_* caps shared by schema and module (one source)
- backend/validation/schemas.ts         ← saveMenuSchema (.strict), menuSlugSchema, visionDraftSchema
- frontend/app/api/merchant/menu/route.ts           ← GET + PUT (draft save / publish)
- frontend/app/api/merchant/menu/photo/route.ts     ← GET/POST/DELETE (multipart, validated)
- frontend/app/api/merchant/menu/extract/route.ts   ← POST, returns a draft only
- frontend/app/(public)/menu/[slug]/page.tsx        ← public server component + generateMetadata
- frontend/app/(merchant)/menu/page.tsx             ← thin loader shell
- frontend/components/merchant/MenuEditor.tsx       ← upload → read → edit → colour → publish → QR
- frontend/app/(merchant)/dashboard/page.tsx        ← "Digital Menu" quick-action tile
- frontend/app/(merchant)/branches/page.tsx         ← LOYLS §5 camera icon → snap + upload → /menu
- frontend/components/merchant/MerchantNav.tsx      ← FAB quick-menu entry (mobile)
- frontend/middleware.ts               ← '/menu' added to PUBLIC_PREFIXES
- frontend/lib/api/merchant.ts         ← getDigitalMenu/saveDigitalMenu/upload/extract/remove
- frontend/.env.example                ← GROQ_API_KEY + GROQ_VISION_MODEL (preferred) + OPENAI_API_KEY + OPENAI_VISION_MODEL (fallback)
- backend/menu.test.ts                 ← 36 tests (slug, draft, upload validation, config gate)
- frontend/lib/color.test.ts           ← 13 tests (hex, luminance, contrast, surfaces)
- backend/validation/schemas.test.ts   ← +Digital Menu describe block
- scripts/menu-smoke.mjs               ← 47 assertions

Deliverable: a merchant photographs their printed menu, corrects what the model read, picks a
background colour, publishes, and gets a public URL plus a QR code a customer can scan with no
app and no session.

Notes: **OCR** is Groq Vision (`meta-llama/llama-4-scout-17b-16e-instruct`, OpenAI `gpt-4o-mini` fallback) over Node's native `fetch` — zero new npm
dependencies. Groq (`GROQ_API_KEY`) wins when both keys are set; when neither is set the API answers 503
`VISION_NOT_CONFIGURED` and the manual editor is a supported end state, not an error. Extraction
never writes to the database — it returns a draft that only lands on the public page when the
merchant saves, so a bad read is a correctable draft rather than a silently wrong menu.
**Slug** is derived from the business name (`/menu/caffe-corner`), allocated by probing the
unique column and walking `-1`, `-2`, … so two merchants with the same name never collide; the
merchant cuid is never exposed. `publishedAt == null` is what makes the public page 404.
**Colour**: the merchant may pick any hex (3- or 6-digit, normalised to `#RRGGBB` before it is
stored); text colour is chosen by WCAG relative luminance so both a pale yellow and a dark green
stay readable. Those maths live in `frontend/lib/color.ts` because the editor renders the same
pairing as a live preview — one implementation, two consumers. The hex reaches the page as an
inline `style`, the one thing Tailwind cannot express as a class. **Price** is free text
(`৳250`, `Market price`), so a no-price item just omits the column. The photo is a source, never
published: it is stored merchant-only through `backend/storage.ts` (Supabase Storage `menu-photos` bucket in
production, `storage/menu-photos` locally) and is not linked from the
public page. PDF download is `window.print()` (browser Save-as-PDF) — no new dependency.
`saveMenuSchema` is `.strict()` while `visionDraftSchema` strips unknown keys / uses `.catch()`:
upstream model output must never fail an extraction, but a client request must never smuggle an
extra field.

Verified: `npm run typecheck` clean, `npm test` 251/251 (57 of them new), `npm run build` OK
(dev stopped first; `/menu`, `/menu/[slug]` and the three API routes all registered),
`scripts/menu-smoke.mjs` 47/47. Two contract defects were found by the smoke and fixed on the
spot: the photo upload returned `url` top-level while GET/PUT return it on `menu` (now
consistently on `menu`), and the background assertion was racing a later save (now asserted
twice — once at publish, once after a subsequent save to prove live updates need no republish).
Re-verified 2026-09-25 (second pass, camera entry point): `npm run typecheck` clean, `npm test`
251/251, `npm run build` OK (dev stopped, `frontend/.next` cleaned first),
`scripts/menu-smoke.mjs` 47/47 + `scripts/phase2-smoke.mjs` 89/89 (branches page regression),
Playwright walkthrough signup → branches → camera → upload → `/menu`, 0 console errors. Note for
whoever runs the smokes: they must target a **dev** server (`next dev frontend -p 3111`) —
`next start` runs with `NODE_ENV=production`, where `/api/auth/otp/send` withholds `testCode` and
the `123456` master code is disabled, so every signup-based smoke fails its first assertion there.
Companion gotcha (hit 2026-09-26): **never start dev on top of a production `.next`.** The order
build → dev leaves the dev bundler reading a `webpack-runtime.js` whose lazy chunks it never
emitted, so routes begin 500ing with `Cannot find module './<id>.js'` (first `/api/auth/me`, then
everything). After any `next build`, `Remove-Item -Recurse -Force frontend\.next` before
`next dev`.
Open: no per-route rate limit on `POST extract` (an edge/platform limit, not a route-local one —
inventing a second mechanism would be a new pattern); OCR cost control should be revisited before
widespread rollout. No vision key is set in any environment yet.

Re-verified 2026-09-26 (third pass — desktop top-nav entry reverted): `npm run typecheck`
clean, `npm test` 251/251, `npm run build` OK (dev stopped, `frontend/.next` cleaned first),
`scripts/menu-smoke.mjs` 47/47 + `scripts/phase2-smoke.mjs` 89/89 (shared-nav regression).

Entry point (LOYLS §5, added 2026-09-25): the Branch Page header carries a **camera icon**
(`aria-label="Snap a photo of your printed menu"`) with a `capture="environment"` file input
beside it. The chooser is opened **from inside the icon's click handler**, the photo is uploaded
straight away through `uploadMenuPhoto`, and the merchant lands on `/menu` with the photo already
stored. That order is not a style choice: Chrome silently ignores a file chooser raised by a
programmatic click carrying no user gesture, so the first version — navigate to `/menu?capture=1`
and have `MenuEditor` click its own camera input on mount — was built, measured in Playwright
(2 clicks recorded on the input, **0** file choosers raised) and reverted; the `MenuEditor`
comment now records why. Verified end-to-end in Playwright: icon click → chooser opens → file
supplied → `POST /api/merchant/menu/photo 201` → `/menu` shows the thumbnail with
Replace/Read again/Remove, 0 console errors. Entry points as finally shipped: the FAB
quick-menu entry (mobile), the dashboard tile and the Branch Page camera icon. The
`MerchantNav` **desktop top-nav item was added and then removed again** — measurement
showed the header cannot hold it: the `lg:max-w-6xl` container leaves the 7 pre-existing
links needing 758px against a ~700px nav box, so an 8th item's links overflowed the
`min-w-0` nav and rendered *under* the "New Offer" button (Settings 46px covered with a
long shop name, 99px with the extra item). The spec's "no side-menu link" is read as
*minimum* access through the Branch Page, not as a ban on the nav; fitting a nav item
needs a product decision first — drop the business name from the header, or widen it past
the page's `max-w-6xl` alignment. Both, plus the pre-existing `md` overflow and the
`/otp` back-button, are written up in the Phase 12 correction in brain.md.

---

## Phase 8 — Polish & Launch Prep | 🟡 In Progress — build complete, verification outstanding
Files:
- frontend/public/icon.svg                     ← app icon — Sovereign Green stamp-card mark (favicon + manifest, single SVG for every slot)
- frontend/public/icon-maskable.svg            ← maskable variant (80% safe zone)
- frontend/app/favicon.ico                     ← multi-res ICO (16/32/48/64/256) generated from icon.svg — kills the /favicon.ico 404
- scripts/favicon-gen.mjs                      ← the generator (headless Chrome raster → ICO pack); rerun when icon.svg changes
- frontend/app/manifest.ts                     ← serves /manifest.webmanifest (delegates to lib/metadata.ts)
- frontend/lib/metadata.ts                     ← pure helpers: resolveAppUrl (NEXT_PUBLIC_APP_URL), pageMetadata, buildManifest, buildRobots, buildSitemapEntries
- frontend/lib/metadata.test.ts                ← 15 unit tests
- frontend/app/robots.ts                       ← serves /robots.txt — `Disallow: /` + `Allow: /menu/` (menus are the one crawlable surface)
- frontend/app/sitemap.ts                      ← serves /sitemap.xml, published menu slugs read at request time (force-dynamic)
- frontend/app/layout.tsx                      ← full SEO metadata (metadataBase, title template, OG/Twitter, icons, manifest, appleWebApp) + viewport themeColor #0D472A
- frontend/app/(public)/menu/[slug]/page.tsx   ← generateMetadata now built from pageMetadata with `robots: 'index'` (opts the public menu into crawling over the root noindex)
- frontend/components/ui/Skeleton.tsx          ← shared shimmer primitive (animate-pulse, server-safe)
- frontend/components/ui/ErrorState.tsx        ← shared crash card (digest + Try again / Return home)
- frontend/app/(merchant)/error.tsx            ← route-group boundary (nav shell kept)
- frontend/app/(customer)/error.tsx            ← route-group boundary
- frontend/app/(admin)/admin/(panel)/error.tsx ← admin panel boundary (login is outside the group)
- frontend/app/(public)/error.tsx              ← public group boundary (menu DB failures)
- frontend/app/global-error.tsx                ← last-resort boundary (own <html>/<body>, no shared deps by design)
- frontend/app/(merchant)/loading.tsx          ← KPI + list skeleton inside the merchant shell
- frontend/app/(customer)/loading.tsx          ← customer-card skeleton
- frontend/app/(admin)/admin/(panel)/loading.tsx ← admin KPI + table skeleton
- frontend/app/(public)/menu/[slug]/loading.tsx  ← REMOVED 2026-09-26: it streamed the shell before `notFound()`, so a missing menu answered 200 (ARCHITECTURE §3.7.5)
- frontend/.env.example                        ← NEXT_PUBLIC_APP_URL documented
- scripts/phase8-smoke.mjs                     ← manifest/icons/robots/sitemap/head + gate assertions

Deliverable: production-ready build
Notes:
- Product decisions (2026-09-26, user-confirmed): (1) the manifest is deliberately **not installable** — `display: 'browser'` — because customers never install anything (CODIN §11) and the merchant surface is the native app; the manifest exists for favicon/theme-colour/identity only. (2) The production origin is **env-driven** (`NEXT_PUBLIC_APP_URL`, localhost fallback) because the domain is fixed after publish.
- SEO stance: the root layout marks the app `noindex, nofollow` (it is auth-gated by middleware); public menu pages opt into indexing via `generateMetadata`, and robots.txt answers `Disallow: /` + `Allow: /menu/` — published menus are the one crawlable surface on the app origin. The sitemap lists DB-driven published menu slugs (refreshed at request time) and deliberately omits `/`, which only 307s to `/welcome`. The marketing landing is deployed separately (repo-root `landing page/`), so it owns the crawlable marketing surface and its own robots/sitemap.
- The metadata rules are pure and live in `frontend/lib/metadata.ts` so the manifest/robots/sitemap routes and `layout.tsx` cannot disagree; `sitemap.ts` is the only DB-touching file.
- Error boundaries render inside their group layouts (the merchant keeps their nav on a crash); `global-error.tsx` deliberately uses no shared component or Tailwind class because the root layout itself is what may have failed.
- Loading states are Tailwind `animate-pulse` skeletons (the same primitive as existing live dots) — no new dependency, no Framer Motion needed for a pre-hydration state.
- **VERIFIED 2026-09-27** (run by the redesign session at the CODIN §7 checkpoint): `npm run typecheck` clean, `npm test` 306/306 (17 files), `npm run build` exit 0 (58 static pages, First Load JS shared 87.1 kB, dev stopped and `frontend/.next` cleaned first), and `scripts/phase8-smoke.mjs` 31/31 against `next dev frontend -p 3111` (part of 568/568 across all 9 smokes). **Still outstanding:** the Lighthouse audit (>90 target) — run it, then move this to ✅. Known follow-ups for the audit pass: per-page titles on gated screens need server-layout wrappers (client layouts cannot export `metadata` — deferred: gated pages are noindex anyway); the `MerchantNav` overflow and `/otp` back-button defects from the Phase 12 write-up were **fixed** by the redesign phase below.

---

## Phase 13 — UI/UX Redesign (Sovereign Green) | ✅ Done — verified 2026-09-27

Implements the finished Stitch project **"Loyl App UI/UX Redesign"** (project `11313242325667721968`) on every route, page by page.

Files:
- frontend/tailwind.config.ts            ← Sovereign Green token layer — the source of truth for every restyle
- frontend/app/globals.css               ← porcelain canvas, font vars, `.tnum`, `.frost`
- frontend/app/layout.tsx                ← Plus Jakarta Sans + Inter via `<link>` (no build-time network)
- frontend/components/ui/Button.tsx      ← canonical variants: primary / secondary / accent / outline / ghost
- frontend/components/ui/Card.tsx, Input.tsx ← restyled to the same recipes
- frontend/components/merchant/MerchantNav.tsx ← rewritten frosted chrome + the nav-overflow fix
- frontend/app/not-found.tsx            ← new 404 page (design screen 07)
- frontend/app/(auth)/**                ← welcome, otp, business-setup (visual restyle)
- frontend/app/(merchant)/**            ← dashboard, offers new/[id]/qr, analytics, customers, branches, billing, checkout, settings, requests, menu + OfferForm/MenuEditor/CheckoutModal/AnalyticsChart
- frontend/app/(customer)/**, components/customer/**, app/(public)/menu/[slug] ← customer group
- frontend/app/(admin)/**, components/admin/** ← admin group

Notes:
- **Token strategy:** the legacy `brand.*` Tailwind keys were kept but **remapped** onto the Sovereign Green palette, so ~372 existing `brand-*` usages migrate for free; the Stitch export's class names (`surface-*`, `on-surface`, `primary-container`, `outline`, `wine`, `emerald`, `hairline`) were added as first-class tokens so the export maps 1:1 with no class-name rewrite sweep. Radii: `input` 8px, `card` 16px, new `panel` 24px, `lg` 1rem, `xl` 1.5rem.
- **CODIN §10 defect 1 (desktop nav overflow) fixed.** Measured with icons: the 7 desktop links needed ~741px against ~623px available, and `Settings` painted over "New Offer" (1062–1158 vs 1052–1192 at 1280). Fix: desktop links are **label-only (icons removed)** and the business name is an `hidden xl:flex` chip. After: `nav.scrollWidth - clientWidth = 0` at 1024/1280/1440/1600 with 22–164px clearance, and the whole-page sideways scroll at 768/900 is gone (`document.scrollWidth` ≤ viewport).
- **CODIN §10 defect 2 (`/otp` back button) fixed:** `router.push('/welcome')` instead of `router.back()`.
- **Rules held:** Tailwind only, mobile-first, Framer Motion recipes only from `lib/motion/variants.ts`, `'use client'` + `useReducedMotion`, no new dependencies, amber = offers/scratch only, wine = redemption/destructive, dice keeps indigo, tap targets ≥44px, no fake/placeholder UI, cross-tenant → 404.
- **Documented deviations:** no flag-prefix phone input (it would change the `01[3-9]` contract), no Stitch logo SVG (the download returned HTTP 400), no support/contact route (so the 404 page links only to real routes), no `favicon.ico` (Phase 8 ships `icon.svg`).
- **Cross-agent:** a second agent was concurrently doing Phase 8. It later deleted `(public)/menu/[slug]/loading.tsx`, which was the real cause of `notFound()` answering 200 with an infinite spinner (menu-smoke 45/47 → 47/47 once gone). The only edit on its side was the `phase8-smoke.mjs` robots regex (`noindex,\s*nofollow` — the served header was already correct). Remaining `loading.tsx` files (merchant/customer/admin-panel) sit on gated routes with no `notFound()`, so they are safe.
- **Follow-up 2026-10-02 — the "no `favicon.ico`" deviation above is closed.** `frontend/app/favicon.ico` ships now (16/32/48/64/256, 4 923 bytes, PNG-encoded entries) and `GET /favicon.ico` answers **200 `image/x-icon`** where it previously 404'd on every page. It is generated from `frontend/public/icon.svg` by the new `scripts/favicon-gen.mjs` (headless Chrome raster with `--default-background-color=00000000` to keep the rounded-corner alpha → ICO container that embeds the PNGs; no new dependency). The `<link rel="icon" href="/icon.svg">` from `layout.tsx` remains the primary icon; the `.ico` exists so direct probes (crawlers, tooling, the browser's implicit request) stop 404ing. Verified on a clean build (`frontend/.next` removed, dev/preview stopped first per §7.1): `npm run typecheck` clean, `npm test` **362/362** (23 files), `npm run build` exit 0, `/favicon.ico` 200 + `/welcome` 200 on `next start frontend`. The no-support-route deviation still stands.
- **Verified (CODIN §7):** `npm run typecheck` clean · `npm test` **306/306** (17 files) · `npm run build` exit 0 (`Generating static pages (58/58)`, First Load JS shared 87.1 kB) · all 9 smoke scripts against `next dev frontend -p 3111` = **568/568 assertions, 0 FAIL** (phase1 35, phase2 89, phase3 85, phase4 57, phase5 63, phase7 54, phase8 31, offer-type 107, menu 47) · dev stopped and `frontend/.next` cleaned. Console QA clean apart from the known favicon 404.
- Re-verify: `npm run typecheck && npm test`, `npm run build` (dev stopped, `frontend/.next` removed), then the 9 `scripts/*-smoke.mjs` against `next dev frontend -p 3111`.

## Phase 14 — Email/Password Auth, OTP Removed | ✅ Done — verified 2026-09-30

Files:
- backend/firebase.ts                       ← verify-only Admin init (project ID alone) + email claims
- backend/prisma/schema.prisma              ← Merchant.email + firebaseUid (@unique)
- backend/validation/schemas.ts             ← emailSessionSchema / customerSessionSchema (.strict); OTP schemas removed
- backend/auth.ts                            ← SessionPayload.email
- frontend/app/api/auth/session/route.ts     ← NEW: {idToken} → verified email → loyl_session
- frontend/app/api/customer/session/route.ts ← NEW: {name, phone} → customer session, no code
- frontend/app/api/auth/business-setup/route.ts ← email-keyed upsert; phone collected; EMAIL_REQUIRED / PHONE_TAKEN
- frontend/app/(auth)/welcome/page.tsx       ← mint session after Firebase auth, route by isExistingMerchant
- frontend/components/customer/CustomerSignIn.tsx ← NEW single-step form (replaces OtpEntry)
- frontend/lib/api/{client,customer}.ts      ← createEmailSession / createCustomerSession; OTP wrappers removed
- DELETED: app/api/auth/otp/*, app/(auth)/otp, backend/cognito.ts(+test), lib/firebase/phone.ts, COGNITO_SETUP.md
- scripts/test-session.mjs                   ← NEW shared dev-JWT minting (smokes can't mint Firebase tokens)
- scripts/phase1-smoke.mjs                   ← rewritten: new-auth contract (25 checks)

Deliverable: merchants sign in with email + password; phones are collected data, never verified
Notes: server ID-token verification needs only FIREBASE_PROJECT_ID (public certs); a placeholder
FIREBASE_PRIVATE_KEY is treated as absent. Smokes mint dev JWTs with the local JWT_SECRET and cover
every downstream contract; the Firebase signature check is unit-covered (422/503/401) + live-tested.
Verified 2026-09-30: `db:push` applied (`Merchant.email`, `firebaseUid`), client regenerated,
`npm run typecheck` clean, `npm test` 331/331 (21 files), `npm run build` exit 0 (61/61 pages,
`/api/auth/session` + `/api/customer/session` registered, OTP routes gone), all 9 smokes
**543/543** (phase1 25, phase2 83, phase3 77, phase4 57, phase5 63, phase7 53, phase8 32,
offer-type 107, menu 46) + headless Chromium UI flow **50/50** (mobile + desktop). First build
attempt after killing dev failed transiently (`PageNotFoundError: /_document` — file handles
still releasing 3s after taskkill); clean rerun exit 0. Remaining live check for the user:
register/log in with a real email on `/welcome` → dashboard.

---

## Rules for Every Phase
- Read brain.md before starting
- Do NOT skip phases
- Mark phase 🟡 In Progress when starting
- Mark phase ✅ Done ONLY after all files exist AND basic smoke test passes
- Add a one-line changelog entry to brain.md on completion
- If blocked, mark ⛔ and add a note explaining why
