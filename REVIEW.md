# REVIEW.md

## REVIEW — Find the Problems[cite: 1]

### 1. Code Quality & Architectural Review
- **Type Safety & Contracts:** Ensure all database entities (`merchants`, `offers`, `branches`, `customer_stamps`, `payment_requests`) have strict TypeScript definitions matching the Supabase schema.
- **Next.js App Router Patterns:** Audit API routes under `/app/api/` to ensure proper HTTP status codes (200, 400, 401, 403, 500) and proper handling of asynchronous serverless functions.
- **Clean Architecture:** Verify that complex logic—such as image processing (`sharp` + `qrcode`) and Cognito JWT token verification—is abstracted into modular helper files (`/lib/poster.ts`, `/lib/auth.ts`).

### 2. Security & Vulnerability Review
- **API Endpoint Protection:** Ensure every merchant endpoint verifies the authenticated AWS Cognito JWT token before fetching or mutating data.
- **Stamp Abuse & Fraud Prevention:** Audit the scan endpoint (`/api/customer/scan`) to ensure 24-hour scan cooldown timers and GPS geofencing validations cannot be bypassed via direct payload manipulation.
- **Payment Verification Integrity:** Ensure duplicate bKash/Nagad Transaction IDs (`trx_id`) are blocked by unique database constraints and cannot be claimed by multiple merchants.

### 3. Performance & UX Review
- **Asset Optimization:** Check processed poster images uploaded to Cloudinary to ensure proper resolution compression for rapid loading on local Bangladeshi mobile networks.
- **Graceful Fallbacks:** Test customer web app behavior when WebOTP or `navigator.geolocation` permissions are denied by the browser, ensuring a seamless manual fallback.
- **Animation Performance:** Ensure animated stamp fills and reward pop-ups render smoothly on budget mobile hardware without UI lag.

### 4. Edge Cases & Business Logic Checks
- **Expired Subscriptions:** Confirm that scanning a QR code for a merchant whose subscription has expired gracefully blocks the scan and prompts the merchant to renew.
- **Concurrency & Race Conditions:** Test multiple rapid scans from the same user to verify atomic database operations prevent duplicate stamp increments.