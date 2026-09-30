# DEBUG.md

## DEBUG — Fix the Root Cause

### 1. Systematic Debugging Workflow
When encountering bugs or errors during development or production, follow this structured troubleshooting checklist:
1. **Reproduce the Issue:** Document exact user steps, payload input, network environment, and browser/device type.
2. **Isolate the Layer:** Determine if the root cause lies in the Frontend UI state, Next.js Serverless API layer, AWS Cognito Auth, or Supabase Database.
3. **Analyze Logs:** Inspect Vercel serverless function logs, browser developer console errors, and database query logs.
4. **Apply Minimal Fix:** Address the underlying root cause rather than patching symptoms, and verify with automated or manual test cases.

---

### 2. Common Failure Modes & Fix Strategies

#### 2.1 AWS Cognito & WebOTP Authentication Failures
- **Symptom:** WebOTP fails to autofill the verification code on mobile devices.
- **Root Cause:** Missing `autocomplete="one-time-code"` attribute on input element, or SMS text format does not conform to WebOTP spec.
- **Fix:** Ensure the input field includes `autocomplete="one-time-code"` and the SMS format ends with `@your-domain.vercel.app #123456`.

#### 2.2 Image Processing (`sharp` + `qrcode`) Overhead / Crash
- **Symptom:** Poster generation fails or times out on Vercel (`504 Gateway Timeout`).
- **Root Cause:** Poster template image resolution is excessively large, exceeding serverless execution limits or memory quotas.
- **Fix:** Downscale uploaded poster images on the client side before submission, or process image overlays asynchronously using background workers.

#### 2.3 GPS Location Mismatch & Geofencing Errors
- **Symptom:** Customer is physically at the store, but branch auto-detection fails.
- **Root Cause:** Weak indoor GPS signals or precision variance in browser `navigator.geolocation`.
- **Fix:** Implement a fallback tolerance radius (e.g., 100 meters) and allow manual branch selection if GPS accuracy confidence score is low.

#### 2.4 Race Conditions in Stamp Increment
- **Symptom:** Customer scans once, but database logs duplicate stamp increments.
- **Root Cause:** Rapid duplicate HTTP POST requests sent before state update completes.
- **Fix:** Enforce database atomic increments via PostgreSQL RPC procedures and apply frontend submit button throttling/disabling.

---

### 3. Error Handling & Monitoring Setup
- **Server-Side API Errors:** Wrap all API route handlers in standard `try/catch` blocks returning structured JSON responses: `{ success: false, error: "ERROR_CODE", message: "User-friendly description" }`.
- **Client Boundary Catching:** Implement Next.js `error.tsx` boundary components to catch unhandled UI rendering exceptions gracefully.