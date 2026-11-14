# Env Setup Reference — Loyl

## Firebase Project
- Project ID: `loyl-df23d`
- Client email: `firebase-adminsdk-fbsvc@loyl-df23d.iam.gserviceaccount.com`
- Private key: from downloaded service account JSON (full `-----BEGIN PRIVATE KEY-----...-----END PRIVATE KEY-----` block)

## Web App Config (Firebase Console → Project settings → Your apps → Web)
- API Key: `AIzaSyC8h8S43UCJoZJWahgKt5DveajFLYgspQo`
- Auth Domain: `loyl-df23d.firebaseapp.com`
- Project ID: `loyl-df23d`

## Environment Variables

### `frontend/.env.local` (local)
```
FIREBASE_PROJECT_ID=loyl-df23d
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@loyl-df23d.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
JWT_SECRET=<run: openssl rand -base64 32>

NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyC8h8S43UCJoZJWahgKt5DveajFLYgspQo
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=loyl-df23d.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=loyl-df23d
```

### Vercel Dashboard → Project → Settings → Environment Variables (production)
Same 7 vars as above. Select Production, then redeploy.

## Files Created
- `frontend/.env.local`
- `frontend/lib/firebase.ts` (Google sign-in helper)

## Backend Route
`POST /api/auth/session` — already handles Google ID tokens. No code change needed.
