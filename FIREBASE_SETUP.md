# FIREBASE_SETUP.md — Firebase Email/Password Auth (the app's sign-in method)

Status: ✅ Code live — project `loyl-df23d` wired in `frontend/.env.local`.
Owner: you created the Firebase project; this doc records what goes where.

Merchants sign in with email + password (Firebase Web SDK). The client POSTs
the ID token to `POST /api/auth/session`; the server verifies it with the
Admin SDK and mints the `loyl_session` JWT keyed on the verified email.
Phone numbers are collected data only — there is no OTP step anywhere.

| Env state | Behaviour |
|---|---|
| `NEXT_PUBLIC_FIREBASE_*` **set** (client) | `/welcome` register/login via the Firebase Web SDK |
| `FIREBASE_PROJECT_ID` **set** (server) | `POST /api/auth/session` verifies ID tokens (public certs — no secret needed) and issues `loyl_session` |
| Full Admin creds **set** (server) | Same, plus Admin SDK has write credentials for future admin calls |

The session carries `userId` (merchant cuid after setup, `temp_…` before),
`email` (verified), `firebaseUid`, and `phoneNumber` (collected at
business-setup, `''` before). Guards resolve the merchant by `userId`;
`POST /api/auth/business-setup` looks the merchant up by verified email.

---

## 1. Create the project (Firebase Console)

1. Go to https://console.firebase.google.com → Add project (e.g. `loyl-app`).
2. **Authentication → Sign-in method → Email/Password → Enable.**
3. **Authentication → Settings → Authorized domains** → add `localhost` (no
   protocol/port) for local dev, plus your production domain later.
4. **Project Settings → General → Your apps → Web app** → copy
   the config values into `frontend/.env.local`:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY="AIza..."
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="loyl-app.firebaseapp.com"
NEXT_PUBLIC_FIREBASE_PROJECT_ID="loyl-app"
NEXT_PUBLIC_FIREBASE_APP_ID="1:123:web:abc..."
```

5. Restart `npm run dev` — `/welcome` now registers/logs in with email.

## 2. Server verification (Admin SDK)

Server verification needs **only** the project ID (ID-token checks use
Google's public certs):

```bash
FIREBASE_PROJECT_ID="loyl-app"
```

A real private key is optional — it upgrades the Admin app to full
credentials (`isFirebaseAdminWriteConfigured`), currently unused. A
placeholder/non-PEM value is treated as absent, never as credentials.

Without `FIREBASE_PROJECT_ID`, `POST /api/auth/session` answers
`503 FIREBASE_NOT_CONFIGURED`.

## 3. CLI (optional — project context only)

```bash
npx -y firebase-tools@latest login
npx -y firebase-tools@latest use loyl-app
```

Email/Password needs no per-provider CLI setup beyond step 1.

## 4. Verification checklist

- [ ] `/welcome` register (email + password + optional phone) → Firestore
  `users/{uid}` written → `POST /api/auth/session` 200 + `loyl_session` →
  `/business-setup` (new merchant) → `/dashboard` after setup
- [ ] `/welcome` login with the same email → `isExistingMerchant: true` →
  straight to `/dashboard`
- [ ] Wrong password → Firebase client error surfaced inline on `/welcome`
- [ ] `POST /api/auth/session` with a forged `idToken` → `401 INVALID_FIREBASE_TOKEN`
- [ ] `POST /api/auth/session` with `{}` → `422 VALIDATION_ERROR`
- [ ] `POST /api/auth/session` with no project env → `503 FIREBASE_NOT_CONFIGURED`
- [ ] Customer check-in (`POST /api/customer/session` name + phone) →
  200 + customer session, no code step

---

## Changelog

- 2026-09-28: Created for Firebase Phone Auth (transport #2).
- 2026-09-30: Added `firestore.rules` (least-privilege: own `users/{uid}` create/update only, whitelisted fields, deny-all default; deploy with `firebase deploy --only firestore:rules --project loyl-df23d`).
- 2026-09-30: Rewritten for Email/Password (the auth method). Phone OTP
  removed app-wide: `backend/cognito.ts`, `/api/auth/otp/*`, `(auth)/otp`,
  `lib/firebase/phone.ts` deleted; server verifies with project ID alone
  (private key optional); `Merchant.email` (+ `firebaseUid`) added.
