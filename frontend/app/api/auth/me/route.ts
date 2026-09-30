import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/backend/api/response';
import { withAuth } from '@/backend/api/handler';
import { db } from '@/backend/db';

// GET /api/auth/me — Retrieves current authenticated merchant profile & session
export const GET = withAuth(async (req: NextRequest, session) => {
  try {
    let merchant = null;
    if (session.userId && !session.userId.startsWith('temp_')) {
      try {
        merchant = await db.merchant.findUnique({
          where: { id: session.userId },
        });
      } catch (dbErr) {
        console.warn('DB lookup error in /api/auth/me', dbErr);
      }
    }

    return apiSuccess({
      authenticated: true,
      session,
      merchant,
    });
  } catch (error) {
    console.error('Error in /api/auth/me', error);
    return apiError('Failed to load session', 'INTERNAL_ERROR', 500);
  }
});
