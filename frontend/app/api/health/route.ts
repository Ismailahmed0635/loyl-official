import { NextResponse } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { db } from '@/backend/db';

/**
 * GET /api/health — liveness + DB reachability for uptime monitors and
 * load-balancer probes (P-05). Public by design: probes carry no session.
 * Shape: { success: true, data: { ok: true, db: true } } or 503 DB_UNHEALTHY.
 */
export async function GET(): Promise<NextResponse> {
  try {
    await db.$queryRaw`SELECT 1`;
    return apiSuccess({ ok: true, db: true });
  } catch (error) {
    console.error('Health check failed: database unreachable', error);
    return apiError('Database unreachable', 'DB_UNHEALTHY', 503);
  }
}
