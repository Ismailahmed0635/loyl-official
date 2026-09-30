import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import { branchSchema } from '@/backend/validation/schemas';
import { db } from '@/backend/db';

// GET /api/branches — Lists the merchant's branches (oldest first)
export const GET = withMerchant(async (req: NextRequest, session, merchant) => {
  try {
    const branches = await db.branch.findMany({
      where: { merchantId: merchant.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return apiSuccess({ branches });
  } catch (error) {
    console.error('Error listing branches:', error);
    return apiError('Failed to load branches', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/branches — Creates a branch (optional GPS coordinates)
export const POST = withMerchant(async (req: NextRequest, session, merchant) => {
  try {
    // T-01: malformed JSON is a 422 (Zod rejects the null), never a 500.
    const body = await req.json().catch(() => null);
    const validation = branchSchema.safeParse(body);

    if (!validation.success) {
      const issue = validation.error.issues[0]?.message || 'Invalid input';
      return apiError(issue, 'VALIDATION_ERROR', 422);
    }

    const { branchName, address, latitude, longitude } = validation.data;

    const branch = await db.branch.create({
      data: {
        merchantId: merchant.id,
        branchName,
        address: address || null,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
      },
    });

    return apiSuccess({ branch }, 201);
  } catch (error) {
    console.error('Error creating branch:', error);
    return apiError('Failed to create branch', 'INTERNAL_ERROR', 500);
  }
});
