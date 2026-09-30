// scripts/migrate-drill.mjs — proves the checked-in baseline migration applies
// cleanly to an EMPTY database (the production path: `prisma migrate deploy`).
// Creates loyl_migrate_check, deploys, counts tables, drops it. Local dev
// (loyl_db, built by db:push) is untouched.
import { execFileSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

const BASE = 'postgresql://postgres:postgres@localhost:5432';
const CHECK = `${BASE}/loyl_migrate_check?schema=public`;

const admin = new PrismaClient({ datasources: { db: { url: `${BASE}/postgres?schema=public` } } });
try {
  await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS loyl_migrate_check');
  await admin.$executeRawUnsafe('CREATE DATABASE loyl_migrate_check');
} finally {
  await admin.$disconnect();
}

execFileSync(
  'node',
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'backend/prisma/schema.prisma'],
  { env: { ...process.env, DATABASE_URL: CHECK }, stdio: 'inherit' }
);

const check = new PrismaClient({ datasources: { db: { url: CHECK } } });
try {
  const tables = await check.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`
  );
  const applied = await check.$queryRawUnsafe(`SELECT migration_name FROM _prisma_migrations`);
  console.log(`DRILL OK: ${tables[0].n} tables, migrations applied: ${applied.map((r) => r.migration_name).join(',')}`);
} finally {
  await check.$disconnect();
}

const admin2 = new PrismaClient({ datasources: { db: { url: `${BASE}/postgres?schema=public` } } });
try {
  await admin2.$executeRawUnsafe('DROP DATABASE loyl_migrate_check');
} finally {
  await admin2.$disconnect();
}
console.log('DRILL CLEANUP OK');
