import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isRedisConfigured,
  getRedis,
  resetRedisClient,
  redisRateGate,
  redisRevokeJti,
  redisIsJtiRevoked,
  redisCacheGet,
  redisCacheSet,
} from './redis';
import { rateLimitGate } from './rateLimit';

const URL_KEY = 'UPSTASH_REDIS_REST_URL';
const TOKEN_KEY = 'UPSTASH_REDIS_REST_TOKEN';

describe('redis shared layer', () => {
  let savedUrl: string | undefined;
  let savedToken: string | undefined;

  beforeEach(() => {
    savedUrl = process.env[URL_KEY];
    savedToken = process.env[TOKEN_KEY];
    delete process.env[URL_KEY];
    delete process.env[TOKEN_KEY];
    resetRedisClient();
  });

  afterEach(() => {
    if (savedUrl !== undefined) process.env[URL_KEY] = savedUrl;
    else delete process.env[URL_KEY];
    if (savedToken !== undefined) process.env[TOKEN_KEY] = savedToken;
    else delete process.env[TOKEN_KEY];
    resetRedisClient();
  });

  it('reports unconfigured and returns null client without env', () => {
    expect(isRedisConfigured()).toBe(false);
    expect(getRedis()).toBeNull();
  });

  it('helpers fail soft without Redis (never throw)', async () => {
    await expect(redisRateGate('k', 1, 1000)).resolves.toBeNull();
    await expect(redisRevokeJti('jti-x', 1000)).resolves.toBeUndefined();
    await expect(redisIsJtiRevoked('jti-x')).resolves.toBe(false);
    await expect(redisCacheGet('k')).resolves.toBeNull();
    await expect(redisCacheSet('k', { a: 1 }, 1000)).resolves.toBeUndefined();
  });

  it('rateLimitGate falls back to memory without Redis', async () => {
    const rule = { max: 1, windowMs: 60_000 };
    const first = await rateLimitGate('redis-fallback-a', rule);
    expect(first.allowed).toBe(true);
    const second = await rateLimitGate('redis-fallback-a', rule);
    expect(second.allowed).toBe(false);
    expect(second.retryAfterMs).toBeGreaterThan(0);
  });

  it('half-configured (url only) still falls back safely', () => {
    process.env[URL_KEY] = 'https://example.upstash.io';
    resetRedisClient();
    expect(isRedisConfigured()).toBe(false);
    expect(getRedis()).toBeNull();
  });
});
