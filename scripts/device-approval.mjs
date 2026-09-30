/**
 * Phase 9/10 device-approval helpers, shared by the smoke scripts.
 *
 * A customer scan never stamps: it opens a PENDING ScanRequest, and the stamp
 * only lands when the merchant approves it **from the app**. The app proves it
 * holds the Ed25519 private key by signing (CODIN.md §11):
 *
 *   loyl-device-v1\n{merchantId}\n{scanRequestId}\n{timestampMillis}
 *
 * and sending base64url({ version, deviceId, timestamp, signature }) in the
 * `x-loyl-device` header. The private key stays in this process, mirroring the
 * app's Keychain/Keystore copy — the server only ever stores the public half.
 *
 * The proof is bound to the request id, so it is useless for any other
 * check-in, and a plain merchant web session is rejected with 403
 * APP_APPROVAL_REQUIRED (asserted by the callers).
 *
 * Targets the same base URL the caller was started with:
 *   node scripts/phase3-smoke.mjs http://localhost:3111
 *
 * Usage:
 *   const device = await registerDevice({ cookie: m1, merchantId, deviceName });
 *   const approve = await approveCheckIn({ cookie: m1, ...device, requestId });
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:3111';

/** Minimal JSON call — same shape as the per-script `call()` helpers. */
async function call(path, { method = 'POST', body, cookie, headers: extra = {} } = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, json, setCookie, headers: res.headers };
}

/** Fresh Ed25519 keypair + the base64url proof envelope for `x-loyl-device`. */
export function makeDeviceSigner(merchantId) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }); // { kty, crv, x }
  return {
    publicKey: { kty: jwk.kty, crv: jwk.crv, x: jwk.x },
    proof(deviceId, targetId) {
      const timestamp = Date.now();
      const payload = `loyl-device-v1\n${merchantId}\n${targetId}\n${timestamp}`;
      const signature = cryptoSign(null, Buffer.from(payload, 'utf8'), privateKey).toString(
        'base64'
      );
      const envelope = JSON.stringify({ version: 1, deviceId, timestamp, signature });
      return Buffer.from(envelope, 'utf8').toString('base64url');
    },
  };
}

/**
 * Registers one app installation for a merchant. Returns the registration
 * response plus `signer` and `deviceId` — everything needed to approve.
 */
export async function registerDevice({ cookie, merchantId, deviceName }) {
  const signer = makeDeviceSigner(merchantId);
  const res = await call('/api/merchant/devices', {
    cookie,
    body: { deviceName, publicKey: signer.publicKey },
  });
  return { ...res, signer, deviceId: res.json?.data?.device?.id ?? null };
}

/** Approves a PENDING check-in with a device-bound proof. */
export async function approveCheckIn({ cookie, signer, deviceId, requestId }) {
  return call(`/api/merchant/scan-requests/${requestId}`, {
    cookie,
    headers: { 'x-loyl-device': signer.proof(deviceId, requestId) },
  });
}
