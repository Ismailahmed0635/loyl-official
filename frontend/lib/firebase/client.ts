'use client';

/**
 * frontend/lib/firebase/client.ts — Firebase Web SDK singleton (client-only).
 *
 * Env-gated: when NEXT_PUBLIC_FIREBASE_API_KEY is unset the module answers
 * `isFirebaseClientConfigured() === false` and callers fall back to the
 * legacy server-OTP flow (`POST /api/auth/otp/send`). No Firebase network
 * traffic happens until configured, so local dev + smoke scripts are
 * unaffected.
 */

import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';

let appPromise: Promise<FirebaseApp> | null = null;

export function isFirebaseClientConfigured(): boolean {
  return !!(
    typeof process.env.NEXT_PUBLIC_FIREBASE_API_KEY === 'string' &&
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY.length > 0 &&
    typeof process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === 'string' &&
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID.length > 0
  );
}

function firebaseConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY as string,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID as string,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
}

async function getFirebaseApp(): Promise<FirebaseApp> {
  if (!appPromise) {
    appPromise = (async () => {
      const { initializeApp, getApps } = await import('firebase/app');
      const existing = getApps();
      if (existing.length > 0) return existing[0];
      return initializeApp(firebaseConfig());
    })();
  }
  return appPromise;
}

export async function getFirebaseAuth(): Promise<Auth> {
  const { getAuth } = await import('firebase/auth');
  return getAuth(await getFirebaseApp());
}
