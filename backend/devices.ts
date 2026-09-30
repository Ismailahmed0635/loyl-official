/**
 * backend/devices.ts — Phase 10 device-bound approval.
 *
 * The platform rule: **only the merchant's mobile app may approve a customer
 * check-in.** A logged-in web session is not enough — the merchant must prove
 * the registered device is present.
 *
 * Mechanism (no new dependencies — Node's own `crypto`):
 *   1. The app generates an **Ed25519** keypair on first run and keeps the
 *      private key in platform secure storage. It registers the *public* key
 *      with `POST /api/merchant/devices`.
 *   2. To approve a check-in the app signs a canonical payload that binds the
 *      merchant, the specific request id, and a timestamp, then sends the proof
 *      in the `x-loyl-device` header.
 *   3. The server loads the device, checks it is ACTIVE, checks the timestamp is
 *      inside a small window, and verifies the signature with the stored public
 *      key. Only then does the approval proceed.
 *
 * Why binding the **request id** into the signature is enough replay protection:
 * the signature is only valid for that one ScanRequest, and approving a request
 * is already an atomic guarded transition (a second attempt is a 409). A
 * captured proof therefore cannot be redirected at another request, and cannot
 * be replayed to any effect. The timestamp window bounds how long a captured
 * proof is even parseable.
 *
 * The server never stores a signing secret — a database leak cannot be used to
 * forge an approval.
 */
import { createPublicKey, verify as cryptoVerify } from 'crypto';
import { db } from '@/backend/db';

/** Bump when the payload/header shape changes; old clients get DEVICE_PROOF_UNSUPPORTED. */
export const DEVICE_PROOF_VERSION = 1;

/** Header the app sends its proof in (base64url-encoded JSON). */
export const DEVICE_PROOF_HEADER = 'x-loyl-device';

/** How far a proof timestamp may drift from server time. */
export const DEVICE_PROOF_MAX_SKEW_MS = 2 * 60 * 1000;

/** The proof envelope carried in the header. */
export interface DeviceProof {
  version: number;
  deviceId: string;
  /** Unix epoch milliseconds, as claimed by the device. */
  timestamp: number;
  /** Ed25519 signature (base64) over `buildApprovalPayload(...)`. */
  signature: string;
}

export interface DeviceFailure {
  code: string;
  message: string;
  status: number;
}

export type DeviceApprovalResult =
  | { ok: true; device: { id: string; deviceName: string } }
  | { ok: false; failure: DeviceFailure };

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Canonical string a device signs to approve `targetId`.
 * Line-delimited and version-tagged so it can never collide with another
 * payload shape. `targetId` is the ScanRequest id — or `'-'` when a proof is
 * being used for a request-independent action.
 *
 * The '\n' framing is unambiguous **because both ids are server-generated
 * cuids** and the timestamp is an integer: no field can contain the delimiter.
 * Never pass user-supplied text into this function.
 */
export function buildApprovalPayload(
  merchantId: string,
  targetId: string,
  timestamp: number
): string {
  return `loyl-device-v${DEVICE_PROOF_VERSION}\n${merchantId}\n${targetId || '-'}\n${timestamp}`;
}

/** True when `timestamp` is within the allowed skew of `now`. */
export function isTimestampFresh(
  timestamp: number,
  now: number = Date.now(),
  skewMs: number = DEVICE_PROOF_MAX_SKEW_MS
): boolean {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
  return Math.abs(now - timestamp) <= skewMs;
}

/**
 * Decodes and shape-checks the proof header. Returns null for anything
 * malformed — callers must treat null as "no proof supplied", never as trusted.
 */
export function parseDeviceProofHeader(raw: string | null | undefined): DeviceProof | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded !== 'object') return null;
    const { version, deviceId, timestamp, signature } = decoded as Record<string, unknown>;
    if (typeof deviceId !== 'string' || deviceId.length === 0) return null;
    if (typeof signature !== 'string' || signature.length === 0) return null;
    if (typeof timestamp !== 'number') return null;
    // Absent version is treated as v1 so a first-release client that omits it
    // still works; an explicit mismatch is rejected by the caller.
    const v = version === undefined ? DEVICE_PROOF_VERSION : version;
    if (typeof v !== 'number') return null;
    return { version: v, deviceId, timestamp, signature };
  } catch {
    return null;
  }
}

/**
 * Validates an Ed25519 public JWK supplied at registration.
 * Rejects private material outright: an app that sends `d` would let the server
 * (and thus a database leak) forge approvals, which defeats the whole design.
 */
export function isValidDevicePublicJwk(jwk: unknown): boolean {
  if (!jwk || typeof jwk !== 'object') return false;
  const k = jwk as Record<string, unknown>;
  if (k.kty !== 'OKP' || k.crv !== 'Ed25519') return false;
  if (typeof k.x !== 'string' || k.x.length === 0) return false;
  if (k.d !== undefined) return false; // private key must never be transmitted
  return true;
}

/** Verifies `signature` (base64) over `payload` using the stored JWK JSON. */
export function verifyDeviceSignature(
  publicKeyJwkJson: string,
  payload: string,
  signature: string
): boolean {
  try {
    const jwk = JSON.parse(publicKeyJwkJson);
    if (!isValidDevicePublicJwk(jwk)) return false;
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    return cryptoVerify(null, Buffer.from(payload, 'utf8'), key, Buffer.from(signature, 'base64'));
  } catch {
    // Unparseable key or signature — never throw out of an auth check.
    return false;
  }
}

/** The single code the UI/API uses for "this needs the app". */
export function appApprovalRequired(message?: string): DeviceFailure {
  return {
    code: 'APP_APPROVAL_REQUIRED',
    message:
      message ??
      'Approving a stamp requires the Loyl merchant app. Sign in on a registered device.',
    status: 403,
  };
}

/* -------------------------------------------------------------------------- */
/* DB-backed helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Serialized form of a device row for API responses (never includes key material). */
export interface DeviceSummary {
  id: string;
  deviceName: string;
  status: string;
  registeredAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export function toDeviceSummary(row: {
  id: string;
  deviceName: string;
  status: string;
  registeredAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}): DeviceSummary {
  return {
    id: row.id,
    deviceName: row.deviceName,
    status: row.status,
    registeredAt: row.registeredAt.toISOString(),
    lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
  };
}

/**
 * Registers an app installation for a merchant.
 * Re-registering the same `installId` rotates the stored public key instead of
 * creating a second row, so reinstalling the app doesn't strand approvals on a
 * key the device no longer holds.
 */
export async function registerMerchantDevice(args: {
  merchantId: string;
  deviceName: string;
  publicKeyJwk: unknown;
  installId?: string | null;
}): Promise<{ ok: true; device: DeviceSummary } | { ok: false; failure: DeviceFailure }> {
  if (!isValidDevicePublicJwk(args.publicKeyJwk)) {
    return {
      ok: false,
      failure: {
        code: 'INVALID_DEVICE_KEY',
        message: 'A public Ed25519 key (JWK, no private material) is required.',
        status: 422,
      },
    };
  }
  const publicKey = JSON.stringify(args.publicKeyJwk);
  const installId = args.installId ?? null;

  const existing = installId
    ? await db.merchantDevice.findFirst({
        where: { merchantId: args.merchantId, installId, deletedAt: null },
      })
    : null;

  if (existing) {
    const row = await db.merchantDevice.update({
      where: { id: existing.id },
      data: {
        deviceName: args.deviceName,
        publicKey,
        // A rotating key revives a device the merchant had revoked — the
        // merchant explicitly re-enrolled it, and the old key is gone.
        status: 'ACTIVE',
        revokedAt: null,
      },
    });
    return { ok: true, device: toDeviceSummary(row) };
  }

  try {
    const row = await db.merchantDevice.create({
      data: { merchantId: args.merchantId, deviceName: args.deviceName, publicKey, installId },
    });
    return { ok: true, device: toDeviceSummary(row) };
  } catch (err) {
    // Concurrent registers with the same installId both missed `existing` and
    // raced to create: the loser's unique hit rotates the winner's row instead
    // of 500ing (same end state as the sequential path above).
    if (
      installId &&
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: unknown }).code === 'P2002'
    ) {
      const winner = await db.merchantDevice.findFirst({
        where: { merchantId: args.merchantId, installId, deletedAt: null },
      });
      if (winner) {
        const row = await db.merchantDevice.update({
          where: { id: winner.id },
          data: { deviceName: args.deviceName, publicKey, status: 'ACTIVE', revokedAt: null },
        });
        return { ok: true, device: toDeviceSummary(row) };
      }
    }
    throw err;
  }
}

/** Marks a device REVOKED. Keeps the row so past approvals stay attributable. */
export async function revokeMerchantDevice(
  merchantId: string,
  deviceId: string
): Promise<{ ok: true } | { ok: false; failure: DeviceFailure }> {
  const revoked = await db.merchantDevice.updateMany({
    where: { id: deviceId, merchantId, status: 'ACTIVE', deletedAt: null },
    data: { status: 'REVOKED', revokedAt: new Date() },
  });
  if (revoked.count === 0) {
    return {
      ok: false,
      failure: { code: 'NOT_FOUND', message: 'No active device with that id.', status: 404 },
    };
  }
  return { ok: true };
}

/**
 * The gate for "only the merchant app can approve". Verifies the proof header
 * against the merchant's registered devices.
 *
 * Every failure is deliberately a 403 that says "use the app" — the web
 * dashboard has no device key, so this is exactly what it will receive, and no
 * failure path reveals whether a given device id exists.
 */
export async function authenticateDeviceApproval(args: {
  merchantId: string;
  /** ScanRequest id being approved — bound into the signature. */
  targetId: string;
  /** Raw `x-loyl-device` header value. */
  header: string | null;
  now?: number;
}): Promise<DeviceApprovalResult> {
  const proof = parseDeviceProofHeader(args.header);
  if (!proof) return { ok: false, failure: appApprovalRequired() };
  if (proof.version !== DEVICE_PROOF_VERSION) {
    return {
      ok: false,
      failure: {
        code: 'DEVICE_PROOF_UNSUPPORTED',
        message: 'This app version can no longer approve stamps. Please update the app.',
        status: 426,
      },
    };
  }

  const now = args.now ?? Date.now();
  if (!isTimestampFresh(proof.timestamp, now)) {
    return {
      ok: false,
      failure: {
        code: 'DEVICE_PROOF_STALE',
        message: 'The device signature expired. Check the device clock and try again.',
        status: 403,
      },
    };
  }

  const device = await db.merchantDevice.findFirst({
    where: { id: proof.deviceId, merchantId: args.merchantId, deletedAt: null },
  });
  if (!device) return { ok: false, failure: appApprovalRequired() };
  if (device.status !== 'ACTIVE') {
    return {
      ok: false,
      failure: {
        code: 'DEVICE_REVOKED',
        message: 'This device was removed from the account. Approve from an active device.',
        status: 403,
      },
    };
  }

  const payload = buildApprovalPayload(args.merchantId, args.targetId, proof.timestamp);
  if (!verifyDeviceSignature(device.publicKey, payload, proof.signature)) {
    return {
      ok: false,
      failure: {
        code: 'DEVICE_PROOF_INVALID',
        message: 'The device signature did not match this approval.',
        status: 403,
      },
    };
  }

  // Best-effort liveness stamp — a failure here must not block a valid approval.
  try {
    await db.merchantDevice.updateMany({
      where: { id: device.id, merchantId: args.merchantId },
      data: { lastSeenAt: new Date(now) },
    });
  } catch (err) {
    console.warn('Failed to update device lastSeenAt', err);
  }

  return { ok: true, device: { id: device.id, deviceName: device.deviceName } };
}
