# BUILD.md

## BUILD — Build One Feature at a Time

To ensure a smooth and bug-free implementation, the development process is divided into incremental phases. Each feature must be fully built and verified before moving to the next.

---

### Phase 1: Project Foundations & Infrastructure
1. **Repository & Framework Setup**
   - Initialize a Next.js (App Router) project with TypeScript, Tailwind CSS, and Shadcn UI.
   - Configure environment variables (`AWS_COGNITO_*`, `SUPABASE_*`, `CLOUDINARY_*`).
2. **Database & Auth Integration**
   - Connect Supabase client using serverless SDK.
   - Configure AWS Cognito SDK for user signup, OTP verification, and JWT token handling.

---

### Phase 2: Super Admin & Payment Engine
1. **Super Admin Dashboard Layout**
   - Build protected route `/admin` accessible only to super admin credentials.
   - Build payment verification table showing pending `bKash`/`Nagad` `payment_requests`.
2. **Manual Payment Approval Workflow**
   - Implement `POST /api/admin/approve-payment` endpoint.
   - Update `payment_requests` status to `approved` and set merchant `subscription_status` to `active` for 30 days upon approval.

---

### Phase 3: Merchant Onboarding & Dashboard
1. **Merchant Auth & Profile Setup**
   - Build merchant signup page `/auth/signup` utilizing AWS Cognito.
   - Create onboarding wizard to capture business name, category, phone number, and logo.
2. **Subscription Lock Interface**
   - Implement middleware/route protection: if `subscription_status` is `pending` or `expired`, lock the dashboard features and show the bKash/Nagad payment submission page.
3. **Dashboard Home UI**
   - Build live analytics cards: total scans today, new vs. returning customers, active offers count, and redeemed rewards count.

---

### Phase 4: Offer Generator & Dynamic QR Poster Automation
1. **Offer Creation Form**
   - Build offer modal: duration picker, required stamps selector, reward type input, and background poster upload.
2. **Image Processing Pipeline (`POST /api/offer/generate`)**
   - Generate dynamic QR code buffer containing customer routing URL using `qrcode`.
   - Merge QR buffer onto uploaded poster image using `sharp`.
   - Upload finalized ready-to-print poster to Cloudinary and save URL in `offers` table.

---

### Phase 5: Customer Web App Experience
1. **Customer Scanning & WebOTP Authentication**
   - Build customer web route `/scan/[offerId]` triggered by scanning poster QR.
   - Implement WebOTP API for frictionless mobile phone number collection and instant verification.
2. **Branch Detection & Stamp Logic (`POST /api/customer/scan`)**
   - Capture user browser GPS coordinates (`navigator.geolocation`).
   - Validate proximity to branch coordinates and enforce scan cooldown rules.
   - Increment stamp count in `customer_stamps` table.
3. **Animated UI & Reward Claim**
   - Build animated digital stamp card fill animation and scratch card UI.
   - Implement Google Maps "Rate Us" redirect with focus verification to award bonus stamps.
   - Trigger 2x2 animated celebration pop-up when required stamps are collected, displaying redemption button for cashier.