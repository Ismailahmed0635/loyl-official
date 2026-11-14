import { Redis } from '@upstash/redis';

/**
 * backend/redis.ts — shared Upstash Redis client (REST, Vercel-safe).
 *
 * Why REST: serverless functions have no long-lived TCP connection, so a
 * classic `redis` TCP client is wrong here. Upstash REST works per-request.
 *
 * Contract:
 * - `isRedisConfigured()` — true only when both REST env vars are set.
 * - `getRedis()` — singleton, null when unconfigured (callers fall back to
 *   the in-memory implementations, so local dev works with no Redis).
 * - Helpers below are best-effort: any Redis error resolves to a safe
 *   fallback value, never throws into the request path.
 */

let client: Redis | null | undefined;

export function isRedisConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  if (!isRedisConfigured()) {
    client = null;
    return client;
  }
  client = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  return client;
}

/** Test hook: drop the singleton so env changes take effect. */
export function resetRedisClient(): void {
  client = undefined;
}

export interface GateResult {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Atomic fixed-window gate: INCR the key, set expiry on first hit, deny
 * past max. Returns retryAfterMs from TTL when denied. Falls back to null
 * when Redis is unavailable so callers can use the in-memory path.
 */
export async function redisRateGate(
  key: string,
  max: number,
  windowMs: number
): Promise<GateResult | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const namespaced = `loyl:rl:${key}`;
    const count = await redis.incr(namespaced);
    if (count === 1) {
      await redis.pexpire(namespaced, windowMs);
      return { allowed: true, retryAfterMs: 0 };
    }
    if (count > max) {
      const ttl = await redis.pttl(namespaced);
      return { allowed: false, retryAfterMs: Math.max(0, ttl < 0 ? windowMs : ttl) };
    }
    return { allowed: true, retryAfterMs: 0 };
  } catch {
    return null;
  }
}

/** Record a session revocation that outlives any single instance. */
export async function redisRevokeJti(jti: string, ttlMs: number): Promise<void> {
  const redis = getRedis();
  if (!redis || !jti) return;
  try {
    await redis.set(`loyl:revoked:${jti}`, '1', { px: Math.max(1, Math.floor(ttlMs)) });
  } catch {
    // Best-effort: the in-memory set is the fallback.
  }
}

/** True when the jti was revoked via any instance. False on any failure. */
export async function redisIsJtiRevoked(jti: string | undefined): Promise<boolean> {
  const redis = getRedis();
  if (!redis || !jti) return false;
  try {
    const v = await redis.get(`loyl:revoked:${jti}`);
    return v !== null && v !== undefined;
  } catch {
    return false;
  }
}

/** Tiny JSON cache helper for hot reads (dashboard/menu). Null on miss/error. */
export async function redisCacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const v = await redis.get<T>(`loyl:cache:${key}`);
    return (v ?? null) as T | null;
  } catch {
    return null;
  }
}

/** Best-effort cache write with TTL. Never throws. */
export async function redisCacheSet(key: string, value: unknown, ttlMs: number): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(`loyl:cache:${key}`, value as string, {
      px: Math.max(1, Math.floor(ttlMs)),
    });
  } catch {
    // Cache writes must never break the request.
  }
}
