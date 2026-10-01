# ARCHITECTURE.md

## ARCHITECTURE — Plan how it works

### 1. System Architecture Overview
The platform follows a modern, serverless Client-Server architecture utilizing Next.js (App Router) to handle both the Frontend UI and Backend API logic within a single unified repository. 

### 2. High-Level Component Interaction
- **Frontend (Client):** Next.js React components styled with Tailwind CSS. Handles UI state, Firebase email/password sign-in, and browser-based GPS data collection.
- **Backend (API Layer):** Next.js API Routes run serverless functions on Vercel to process business logic, secure database connections, and handle image manipulation.
- **Identity & Access Management (IAM):** Firebase Email/Password handles merchant sign-in; the server verifies the ID token and issues the `loyl_session` JWT. Customer check-in collects name + phone (no verification step).
- **Data & Storage:** 
  - API Routes communicate with **Supabase (PostgreSQL)** for CRUD operations (via Prisma; local dev uses local PostgreSQL).
  - Uploads (payment screenshots, menu photos) go through **`backend/storage.ts`**: Supabase Storage in **private buckets** when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set (production), the local `storage/` directory otherwise (dev/test). Buckets are never public — objects are only read back through the guarded admin/merchant routes.
  - Media files (logos, generated posters) are sent to **Cloudinary** via REST APIs — *plan only; not wired up (see the doc-drift note below).*

### 3. Core Operational Workflows

#### 3.1 Merchant Onboarding & Manual Payment Flow
1. **Signup:** Merchant registers with email + password (Firebase, UI), the server mints `loyl_session` via `POST /api/auth/session`.
2. **Profile Creation:** Frontend sends profile data to `POST /api/merchant/register` -> Saved in Supabase (`merchants` table).
3. **Payment Submission:** Merchant submits bKash/Nagad TrxID via the dashboard.
4. **Database Update:** API logs the request in the `payment_requests` table with a `pending` status.
5. **Admin Approval:** Super Admin verifies the transaction in their personal MFS app and clicks "Approve" in the Admin Panel.
6. **Activation:** API updates merchant status to `active`, unlocking full dashboard access.

#### 3.2 Dynamic QR & Poster Automation Flow
1. **Offer Creation:** Merchant defines offer rules and selects a background poster.
2. **Trigger Automation:** Frontend calls `POST /api/offer/generate`.
3. **QR Generation:** Backend utilizes the `qrcode` library to generate a dynamic data buffer.
4. **Image Merging:** Backend uses the `sharp` library to overlay the QR buffer onto the chosen poster template.
5. **Storage Upload:** The finalized image is uploaded directly to Cloudinary.
6. **Finalize:** The generated Cloudinary URL is saved to the `offers` table in Supabase.

#### 3.3 Customer Scan & Stamp Flow
1. **Scan & Authenticate:** Customer scans the printed QR code and signs in with name + phone number (collected, no verification step).
2. **Location Verification:** Browser's `navigator.geolocation` fetches current coordinates and sends them alongside the scan request.
3. **Validation & Update:** `POST /api/customer/scan` checks cooldown rules, validates GPS proximity to the `branches` data, and increments the stamp count in the `customer_stamps` table.
4. **Reward Trigger:** If the target stamp count is reached, the backend sends a success flag, triggering the animated 2x2 reward pop-up on the frontend.
5. **Review & socials:** `/scan/[offerId]` renders the shared `ShopLinks` card under **every** offer type (stamp,
scratch, dice): a Google review button — driving the PRD 3.3 open-Maps → bonus-stamp claim on stamp offers, a plain
Maps link elsewhere — plus the merchant's Website/Facebook/Instagram links from Settings → Social Links, served by
the customer context GET (`websiteUrl`/`facebookUrl`/`instagramUrl`) and hidden when unset.

#### 3.4 Digital Menu Card Flow (Phase 12)
1. **Capture:** Merchant opens `/menu` and picks a photo (camera or gallery) — or taps the Branch Page camera icon (`app/(merchant)/branches/page.tsx`), which opens the file chooser directly in the click handler, uploads through `uploadMenuPhoto`, and routes to `/menu` with the thumbnail already in place (no `capture=1` hand-off: a programmatic `input.click()` outside the user gesture raises no chooser). `POST /api/merchant/menu/photo` validates mime + size, stores it merchant-only through `backend/storage.ts` (Supabase Storage `menu-photos` bucket in production, `storage/menu-photos` locally), and creates the unpublished `DigitalMenu` row on the first upload so the file has somewhere to live. The row's `slug` is derived from the business name and allocated by probing the unique column (`-1`, `-2`, … on collision).
2. **Read (optional):** `POST /api/merchant/menu/extract` sends the stored photo to Groq Vision (`meta-llama/llama-4-scout-17b-16e-instruct`, OpenAI `gpt-4o-mini` fallback, native `fetch`, no new dependency) and returns a **draft only — nothing is written**. No vision key ⇒ `503 VISION_NOT_CONFIGURED`, and the manual editor is a supported end state.
3. **Correct:** The merchant edits categories/items/prices in `MenuEditor` and picks `backgroundHex`. Text colour is derived from WCAG relative luminance (`frontend/lib/color.ts`, shared with the public page so the preview and the published result cannot disagree).
4. **Save / Publish:** `PUT /api/merchant/menu` runs a full replace inside a `$transaction`; `publish: true` stamps `publishedAt` on the first publish only. Validation is `saveMenuSchema` — `.strict()`, so an unknown field is a 422 rather than a silent drop.
5. **Serve:** `(public)/menu/[slug]` is a server component (`generateMetadata`, no client JS) behind `/menu` in `PUBLIC_PREFIXES`. `publishedAt == null` ⇒ 404. The background reaches the page as an inline `style` — an arbitrary per-merchant hex is the one value Tailwind cannot express as a class.
6. **Share:** Once live, `GET /api/merchant/menu` returns the absolute URL plus a `qrcode` PNG data URL; the merchant copies, downloads the PNG, or prints (browser Save-as-PDF) from the same card.

> #### 3.5 Dice Roll Offer Flow (third offer type)
  1. **Configure:** The merchant picks "Dice Roll Offer" in `OfferForm` and chooses 1–5 dice (chips, `diceCount`).
Validation is the discriminated `diceOfferSchema` — the wrong type's field is a 422 (`OFFER_TYPE_MISMATCH`),
and `offerType` is immutable after create (`OFFER_TYPE_IMMUTABLE`). Dice renders with its own indigo identity
(`#4F46E5` / indigo-50/600/700); amber stays reserved for offers/scratch (brain.md §4).
  2. **Publish:** `POST /api/offers` writes the offer; the QR poster points at `/scan/[offerId]`, whose DICE branch
renders `DiceOfferView` — a plate carrying the configured dice and one prominent "Roll the Dice" button (no card,
no scratch state; the context GET returns `diceCount` + `dice` instead).
  3. **Roll:** `POST /api/customer/dice` runs the scratch guard order — offer → type (409 `WRONG_OFFER_TYPE`) →
paused/ended (409) → GPS (422 `NEED_LOCATION` / 403 `LOCATION_OUT_OF_RANGE`) → **already rolled** → roll + persist.
Each face is 1–6; the **sum is the discount percent** (1 die = 1–6%, 5 dice = 5–30%).
  4. **One-time limit:** enforced by `DiceRollResult`'s `@@unique([offerId, customerPhone])` — the insert is the
authority, so a double submit, refresh, or rescan can never roll twice. A repeat returns 409 `ALREADY_ROLLED`
carrying the prior roll, and the context GET already reports it, so the customer sees their earned discount rather
than an error. The limit is per customer per offer, not global: another phone rolls normally.
  5. **Measure:** rolls count as analytics activity — `diceRolls` on `SeriesPoint`/`AnalyticsTotals`/`OfferPerformance`
is sourced from `DiceRollResult` and unioned with the other activity sources in `GET /api/merchant/analytics`;
the CSV export gains a `dice_rolls` column, and the offer table shows Rolled + Visitors for dice offers.
  6. **Flip:** each die is a six-plate CSS cube (literal Tailwind arbitrary classes so JIT scans them; opposite faces
sum to 7, pre-roll front shows "?"). The roll tumbles cube-over-cube every ~130ms (`diceTumble`, per-die speed/hop
offsets), and once the server answers the cubes spin **forward** onto the exact rolled face — `faceOrientation()` is
the inverse of each plate's drawn rotation and `landingRotation()` guarantees ≥1 extra full turn (never a rewind),
staggered ~60ms with the `diceLanding` bounce. A `landing` state gates the switch to the already-rolled branch so
the dice stay mounted until the spin-down finishes; the handover is seamless (same pose, same faces) and reduced
motion skips both windows.

#### 3.6 Launch Polish Layer (Phase 8)
1. **Metadata source of truth:** `frontend/lib/metadata.ts` holds the pure rules (`resolveAppUrl`, `pageMetadata`, `buildManifest`, `buildRobots`, `buildSitemapEntries`), unit-tested in `metadata.test.ts`. The routes `frontend/app/manifest.ts`, `frontend/app/robots.ts`, `frontend/app/sitemap.ts` and the `metadata`/`viewport` exports in `app/layout.tsx` are thin callers, so favicon, theme colour, canonical base and crawler policy cannot disagree between files.
2. **Origin & crawler policy:** `NEXT_PUBLIC_APP_URL` (localhost fallback) is the production origin for canonical/OG/sitemap URLs. The root layout marks the auth-gated app `noindex, nofollow`; published digital menus opt into indexing (`robots: 'index'` in their `generateMetadata`), and robots.txt answers `Disallow: /` + `Allow: /menu/` — published menus are the only crawlable surface on this origin. `/sitemap.xml` lists published menu slugs read from the DB at request time (`force-dynamic`); `/` is never advertised because it 307s to `/welcome`. The marketing landing is a separate deploy (repo-root `landing page/`), so it carries its own robots/sitemap on its own host.
3. **PWA stance (deliberate):** the manifest is **not installable** (`display: 'browser'`) — customers never install anything (§11 of CODIN.md) and the merchant surface is the native app. The manifest carries the favicon, `theme_color #0D472A` and identity only; icons are a single SVG pair (`icon.svg`, `icon-maskable.svg`) covering every slot.
4. **Failure & wait states:** `components/ui/ErrorState.tsx` is the shared crash card rendered by `error.tsx` in the merchant, customer, admin-panel and public groups (their layouts keep the nav shell around it); `app/global-error.tsx` shares nothing on purpose (own html/body) because the root layout itself may have failed. `components/ui/Skeleton.tsx` backs `loading.tsx` for the merchant, customer and admin-panel segments — Tailwind `animate-pulse`, no new dependency. **The public menu deliberately has no `loading.tsx`** (see §3.7).

#### 3.7 Client read path & route transitions (performance pass)
1. **Navigation is client-side.** `components/merchant/MerchantNav.tsx` renders the desktop nav, the mobile drawer
   and the logo as `next/link` (`prefetch={true}`). They were plain `<a href>`, so every click performed a full
   document reload — fresh HTML plus the entire dev bundle re-parsed per click, with the tab title flashing
   `Loading http://localhost:3000/…`. A click is now one RSC fetch against an already-hydrated tree.
2. **Reads go through a zero-dependency SWR cache.** `frontend/lib/api/cache.ts` exposes
   `useQuery(key, fetcher, { staleTime, refetchInterval, enabled })` on top of `useSyncExternalStore`, plus
   `prime` / `invalidate` / `clearCache` / `inspect`. Keys are the same strings the `lib/api/*.ts` wrappers already
   use (`dashboard`, `stats`, `branches`, `menu`, `offer:{id}`, …), so migrating a page is a one-line swap.
   Cached data paints on a return visit while it revalidates in the background — no React Query/SWR dependency.
3. **Invalidation is centralised at the mutation.** `lib/api/merchant.ts` calls `invalidateReads(...)` after a
   successful offer/branch/settings/scan-request/menu write, and `MenuEditor` primes `menu` after a save, so a read
   cannot go stale after a write without a full reload.
4. **Polling is scoped.** The `MerchantNav` pending badge polls `scan-requests?status=PENDING&pageSize=1` every 15s
   through `useQuery`; `/requests` polls only while its PENDING tab is active (8s). `getAuthMe` is deduped behind a
   single shared promise (15s TTL) so the nav, the badge and the page mount cannot triplicate it, and `logout()`
   clears the cache.
5. **Why the public menu has no `loading.tsx`.** A segment-level fallback streams the shell as soon as the page
   suspends on its one fast, indexed query, which commits HTTP **200** before `notFound()` runs — an unknown or
   unpublished menu would then answer 200 to crawlers, on the only surface `robots.txt` allows. Throwing from
   `generateMetadata` does not help (metadata flushes the shell too). Removing the boundary returns a real 404 and
   ships the fully server-rendered document in a single flush.

> **Doc drift — flag, partially fixed.** §2 and §3.2 above describe the original plan. Uploads are now handled by
> `backend/storage.ts` (Supabase Storage private buckets in production, local `storage/` in dev — verified by
> `scripts/storage-smoke.mjs`), so the Cloudinary path for payment screenshots and menu photos is superseded. Still
> outstanding: the `sharp` poster overlay (the QR page renders a `qrcode` data URL directly, no `sharp`), and Cloudinary
> for logos/posters. §3.3 describes the pre-Phase-9 instant
> stamp; scans now open a `ScanRequest` that a merchant app must approve before `lastScannedAt`
> — and therefore the 24h cooldown — starts. These are pre-existing mismatches outside the Phase
> 12 scope and should be rewritten together in one pass.