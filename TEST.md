# TEST.md

## TEST — Check If It Works

### 1. Authentication & Onboarding Testing
- **Merchant Email/Password:** Verify Firebase register/login mints `loyl_session` via `POST /api/auth/session` (new merchants land on `/business-setup`, existing on `/dashboard`); forged tokens 401, malformed bodies 422.
- **Customer Check-in Identity:** Verify `POST /api/customer/session` mints a named customer session from name + phone with no code step; missing/invalid fields 422.
- **Session Persistence:** Confirm `loyl_session` JWTs authorize API requests and persist sessions securely.

### 2. Manual Payment & Admin Approval Testing
- **TrxID Submission:** Ensure duplicate bKash/Nagad Transaction IDs (TrxID) are rejected at the API layer.
- **Access Control Lockdown:** Verify that merchants with `pending` or `expired` subscription statuses cannot access protected dashboard features.
- **Admin Approval Trigger:** Confirm that clicking "Approve" in the Super Admin Panel updates the merchant status to `active` and extends the expiration date by 30 days.

### 3. QR Code & Poster Automation Testing
- **Image Processing Pipeline:** Test `sharp` and `qrcode` image merging to verify the QR overlay aligns correctly on uploaded poster templates.
- **Cloudinary Upload:** Ensure processed poster images upload reliably to Cloudinary and return valid, accessible CDN URLs.
- **Dynamic QR Routing:** Test scanning the generated QR code to verify it redirects correctly to the merchant's target customer web app route (`/scan/[offerId]`).

### 4. Stamp Engine & Branch Detection Testing
- **GPS Proximity Check:** Test scanning from valid branch coordinates vs. spoofed/out-of-range coordinates to ensure location validation functions correctly.
- **Scan Cooldown Rules:** Verify that a customer cannot scan multiple times within the cooldown window (e.g., 24 hours per shop).
- **Stamp Counter & Animation:** Confirm that scanning increments the stamp count in `customer_stamps` and triggers the stamp fill animation.
- **Reward Trigger:** Test reaching the required stamp threshold to ensure the 2x2 celebration pop-up displays and generates a valid redemption button.

### 5. Polish & Launch Prep Testing (Phase 8)
- **Manifest & Icons:** Verify `/manifest.webmanifest` serves `display: 'browser'` (deliberately not installable), the Sovereign Green theme/background colours, and that `/icon.svg` + `/icon-maskable.svg` resolve. Confirm the favicon renders in a browser tab (no more favicon 404).
- **Crawler policy:** Verify `/robots.txt` blocks everything except `/menu/`, that a published menu appears in `/sitemap.xml` (unpublished/missing slugs 404), and that published menu pages carry `robots: index` while gated app pages carry `noindex, nofollow`.
- **Canonical / OG tags:** With `NEXT_PUBLIC_APP_URL` set, confirm canonical links, Open Graph tags and sitemap URLs all use the configured origin; unset, they fall back to localhost.
- **Error boundaries:** Force a render error on a merchant, customer, admin and public menu page — each shows the shared error card (Try again / Return home + Error ID) while the merchant/admin nav stays rendered; the app must never show Next's raw error screen.
- **Loading states:** Throttle the network on `/dashboard`, `/stamp-card`, `/admin`, and a public menu page — each shows its skeleton instead of a blank screen, with no layout jump on load.
- **Performance audit:** Lighthouse >90 on the public menu page and (logged-out) welcome page; run `npm run build` and confirm no bundle regressions.