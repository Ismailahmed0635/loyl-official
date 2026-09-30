import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import { updateBranchSchema } from '@/backend/validation/schemas';
import { db } from '@/backend/db';
import type { Prisma } from '@prisma/client';

// PATCH /api/branches/[id] — Updates a branch
export const PATCH = withMerchant(async (req: NextRequest, session, merchant, { params }) => {
  try {
    const id = params?.id;
    if (!id) return apiError('Missing branch id', 'BAD_REQUEST', 400);

    // T-01: malformed JSON is a 422 (Zod rejects the null), never a 500.
    const body = await req.json().catch(() => null);
    const validation = updateBranchSchema.safeParse(body);
    if (!validation.success) {
      const issue = validation.error.issues[0]?.message || 'Invalid input';
      return apiError(issue, 'VALIDATION_ERROR', 422);
    }
    const b = validation.data;

    const existing = await db.branch.findFirst({
      where: { id, merchantId: merchant.id, deletedAt: null },
    });
    if (!existing) return apiError('Branch not found', 'NOT_FOUND', 404);

    const data: Prisma.BranchUpdateInput = {};
    if ('branchName' in b) data.branchName = b.branchName!;
    if ('address' in b) data.address = b.address || null;
    if ('latitude' in b) data.latitude = b.latitude ?? null;
    if ('longitude' in b) data.longitude = b.longitude ?? null;

    const branch = await db.branch.update({ where: { id: existing.id }, data });
    return apiSuccess({ branch });
  } catch (error) {
    console.error('Error updating branch:', error);
    return apiError('Failed to update branch', 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/branches/[id] — Soft-deletes a branch (deletedAt set)
export const DELETE = withMerchant(async (req: NextRequest, session, merchant, { params }) => {
  try {
    const id = params?.id;
    if (!id) return apiError('Missing branch id', 'BAD_REQUEST', 400);

    const existing = await db.branch.findFirst({
      where: { id, merchantId: merchant.id, deletedAt: null },
    });
    if (!existing) return apiError('Branch not found', 'NOT_FOUND', 404);

    await db.branch.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    return apiSuccess({ deleted: true, id: existing.id });
  } catch (error) {
    console.error('Error deleting branch:', error);
    return apiError('Failed to delete branch', 'INTERNAL_ERROR', 500);
  }
});
