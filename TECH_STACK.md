# TECH STACK.md

## TECH STACK — Choose the technologies

### 1. Frontend & Core Framework
- **Framework:** Next.js (App Router) - Used for both frontend UI and backend serverless API routes. Ensures fast loading and SEO friendliness.
- **Styling:** Tailwind CSS - For rapid, utility-first UI styling.
- **UI Components:** Shadcn UI - For pre-built, clean, and customizable components (tables, dialogs, forms, buttons).
- **Animations:** Framer Motion / CSS Animations - For smooth digital stamp and scratch card interactions on the customer web app.

### 2. Backend & Logic Layer
- **Environment:** Next.js API Routes (Node.js runtime).
- **QR & Image Automation:** 
  - `qrcode` library for generating dynamic QR code data.
  - `sharp` library for server-side image processing (merging the generated QR code onto the merchant's uploaded poster template).

### 3. Database & File Storage
- **Database (BaaS):** Supabase (PostgreSQL) - Handles all relational data (merchants, branches, offers, customer stamps, and payment logs).
- **Image Storage:** Cloudinary - Used to store merchant logos, uploaded poster templates, and the final generated ready-to-print promotional images.

### 4. Authentication & Security
- **Auth Providers:** AWS Cognito (User Pools) and Firebase Phone Auth (transport #2 — see `FIREBASE_SETUP.md`).
- **Features:** Passwordless login via Phone Number (OTP) and Email.
- **Customer UX:** Autofill WebOTP API integration for instant, frictionless mobile sign-in.
- **Session Management:** Secure JWT (JSON Web Tokens) handled automatically by Cognito.

### 5. Hosting & Infrastructure
- **Deployment Platform:** Vercel.
- **Benefits:** Seamless deployment for Next.js, built-in serverless function support, and high performance for mobile users in Bangladesh.

### 6. Payment Processing (MVP)
- **Method:** Manual verification via local MFS (Mobile Financial Services).
- **Tools:** Personal bKash and Nagad accounts, coupled with a custom Admin Panel approval workflow to avoid third-party payment gateway fees during the initial launch.