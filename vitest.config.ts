import { defineConfig } from 'vitest/config';
import path from 'path';
import { z } from 'zod';

const root = __dirname;

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    env: {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/loyl_db?schema=public',
      JWT_SECRET: 'loyl_super_secret_jwt_key_2026_bd_market',
    },
    // Validate env vars at test startup - fail fast if missing/invalid
    envValidation: true,
  },
  resolve: {
    // Order matters: `@/backend/*` must match before the generic `@/*`.
    alias: [
      { find: '@/backend', replacement: path.resolve(root, 'backend') },
      { find: '@', replacement: path.resolve(root, 'frontend') },
    ],
  },
});
