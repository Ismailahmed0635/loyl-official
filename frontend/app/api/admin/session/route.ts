import { apiSuccess } from '@/backend/api/response';
import { withAdmin } from '@/backend/api/handler';

// GET /api/admin/session — admin layout gate.
// 200 → admin session valid; 401/403/503 → redirect to /admin/login.
export const GET = withAdmin(async () => apiSuccess({ role: 'admin' }));
