import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign as cryptoSign } from 'crypto';
import {
  DEVICE_PROOF_MAX_SKEW_MS,
  DEVICE_PROOF_VERSION,
  appApprovalRequired,
  buildApprovalPayload,
  isTimestampFresh,
  isValidDevicePublicJwk,
  parseDeviceProofHeader,
  verifyDeviceSignature,
} from './devices';

/** A fresh Ed25519 device identity, exactly as the app would create it. */
function makeDevice() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as unknown as Record<string, unknown>;
  return {
    jwk,
    jwkJson: JSON.stringify(jwk),
    privateKey,
    sign: (payload: string) => cryptoSign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64'),
  };
}

function encodeHeader(proof: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(proof), 'utf8').toString('base64url');
}

describe('Device proof header (Phase 10)', () => {
  it('round-trips a well-formed proof', () => {
    const raw = encodeHeader({ version: 1, deviceId: 'dev_1', timestamp: 1700000000000, signature: 'abc' });
    expect(parseDeviceProofHeader(raw)).toEqual({
      version: 1,
      deviceId: 'dev_1',
      timestamp: 1700000000000,
      signature: 'abc',
    });
  });

  it('treats an absent version as the current version', () => {
    const raw = encodeHeader({ deviceId: 'dev_1', timestamp: 1, signature: 's' });
    expect(parseDeviceProofHeader(raw)?.version).toBe(DEVICE_PROOF_VERSION);
  });

  it('returns null for missing or malformed input rather than throwing', () => {
    expect(parseDeviceProofHeader(null)).toBeNull();
    expect(parseDeviceProofHeader(undefined)).toBeNull();
    expect(parseDeviceProofHeader('')).toBeNull();
    expect(parseDeviceProofHeader('not-base64url-json!!!')).toBeNull();
    expect(parseDeviceProofHeader(Buffer.from('{"deviceId":"a"}').toString('base64url'))).toBeNull();
    // signature missing
    expect(
      parseDeviceProofHeader(encodeHeader({ deviceId: 'a', timestamp: 1 }))
    ).toBeNull();
    // timestamp not a number
    expect(
      parseDeviceProofHeader(encodeHeader({ deviceId: 'a', timestamp: 'now', signature: 's' }))
    ).toBeNull();
    // wrong version type
    expect(
      parseDeviceProofHeader(encodeHeader({ version: '1', deviceId: 'a', timestamp: 1, signature: 's' }))
    ).toBeNull();
  });
});

describe('Proof freshness window', () => {
  const now = 1_700_000_000_000;

  it('accepts a timestamp inside the window (either direction)', () => {
    expect(isTimestampFresh(now, now)).toBe(true);
    expect(isTimestampFresh(now - DEVICE_PROOF_MAX_SKEW_MS, now)).toBe(true);
    expect(isTimestampFresh(now + DEVICE_PROOF_MAX_SKEW_MS, now)).toBe(true);
  });

  it('rejects a timestamp outside the window', () => {
    expect(isTimestampFresh(now - DEVICE_PROOF_MAX_SKEW_MS - 1, now)).toBe(false);
    expect(isTimestampFresh(now + DEVICE_PROOF_MAX_SKEW_MS + 1, now)).toBe(false);
  });

  it('rejects missing/absurd timestamps', () => {
    expect(isTimestampFresh(0, now)).toBe(false);
    expect(isTimestampFresh(-1, now)).toBe(false);
    expect(isTimestampFresh(NaN, now)).toBe(false);
    expect(isTimestampFresh(Infinity, now)).toBe(false);
  });
});

describe('Public key validation', () => {
  it('accepts an Ed25519 public JWK', () => {
    expect(isValidDevicePublicJwk(makeDevice().jwk)).toBe(true);
  });

  it('rejects a JWK carrying private material', () => {
    const { jwk } = makeDevice();
    expect(isValidDevicePublicJwk({ ...jwk, d: 'private-bits' })).toBe(false);
  });

  it('rejects wrong key types and junk', () => {
    expect(isValidDevicePublicJwk({ kty: 'RSA', crv: 'Ed25519', x: 'a' })).toBe(false);
    expect(isValidDevicePublicJwk({ kty: 'OKP', crv: 'X25519', x: 'a' })).toBe(false);
    expect(isValidDevicePublicJwk({ kty: 'OKP', crv: 'Ed25519' })).toBe(false);
    expect(isValidDevicePublicJwk(null)).toBe(false);
    expect(isValidDevicePublicJwk('nope')).toBe(false);
  });
});

describe('Signature verification', () => {
  const merchantId = 'm_1';
  const requestId = 'req_1';
  const ts = 1_700_000_000_000;

  it('verifies a genuine signature over the canonical payload', () => {
    const device = makeDevice();
    const payload = buildApprovalPayload(merchantId, requestId, ts);
    expect(verifyDeviceSignature(device.jwkJson, payload, device.sign(payload))).toBe(true);
  });

  it('rejects a signature over a different request id (no replay onto another check-in)', () => {
    const device = makeDevice();
    const elsewhere = buildApprovalPayload(merchantId, 'req_OTHER', ts);
    const signature = device.sign(elsewhere);
    const payload = buildApprovalPayload(merchantId, requestId, ts);
    expect(verifyDeviceSignature(device.jwkJson, payload, signature)).toBe(false);
  });

  it('rejects a signature from a different merchant', () => {
    const device = makeDevice();
    const payload = buildApprovalPayload(merchantId, requestId, ts);
    const forged = device.sign(buildApprovalPayload('m_OTHER', requestId, ts));
    expect(verifyDeviceSignature(device.jwkJson, payload, forged)).toBe(false);
  });

  it('rejects a signature from a different device key', () => {
    const payload = buildApprovalPayload(merchantId, requestId, ts);
    const attacker = makeDevice();
    expect(verifyDeviceSignature(makeDevice().jwkJson, payload, attacker.sign(payload))).toBe(false);
  });

  it('rejects garbage key material and signatures without throwing', () => {
    const payload = buildApprovalPayload(merchantId, requestId, ts);
    expect(verifyDeviceSignature('not json', payload, 'sig')).toBe(false);
    expect(verifyDeviceSignature(JSON.stringify({ kty: 'RSA' }), payload, 'sig')).toBe(false);
    expect(verifyDeviceSignature(makeDevice().jwkJson, payload, 'not-base64!!')).toBe(false);
  });

  it('rejects a public key that smuggles private material', () => {
    const device = makeDevice();
    const withPrivate = JSON.stringify({ ...device.jwk, d: 'x' });
    const payload = buildApprovalPayload(merchantId, requestId, ts);
    expect(verifyDeviceSignature(withPrivate, payload, device.sign(payload))).toBe(false);
  });
});

describe('Canonical payload', () => {
  it('is version-tagged and line-delimited', () => {
    expect(buildApprovalPayload('m', 'r', 5)).toBe(`loyl-device-v${DEVICE_PROOF_VERSION}\nm\nr\n5`);
  });

  it('substitutes a placeholder for an empty target', () => {
    expect(buildApprovalPayload('m', '', 5)).toContain('\n-\n');
  });

  it('binds the merchant, target and timestamp distinctly', () => {
    const base = buildApprovalPayload('m', 'r', 5);
    expect(base).not.toBe(buildApprovalPayload('m2', 'r', 5));
    expect(base).not.toBe(buildApprovalPayload('m', 'r2', 5));
    expect(base).not.toBe(buildApprovalPayload('m', 'r', 6));
  });

  it('uses fields the server generates, so the newline framing is unambiguous', () => {
    // merchantId and targetId are cuid()s and timestamp is an integer — none can
    // contain the '\n' delimiter. This is the assumption the format rests on.
    const payload = buildApprovalPayload('clx123', 'clr456', 1700000000000);
    expect(payload.split('\n')).toHaveLength(4);
  });
});

describe('Web dashboard cannot approve', () => {
  it('the "use the app" failure is a 403 APP_APPROVAL_REQUIRED', () => {
    const failure = appApprovalRequired();
    expect(failure.code).toBe('APP_APPROVAL_REQUIRED');
    expect(failure.status).toBe(403);
    expect(failure.message).toMatch(/merchant app/i);
  });
});
