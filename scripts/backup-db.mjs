// scripts/backup-db.mjs — local backup/restore drill (P-08).
// Usage:
//   node scripts/backup-db.mjs backup [outFile]   pg_dump -> backups/loyl-YYYYMMDD-HHmm.sql
//   node scripts/backup-db.mjs restore <file>     restore into loyl_restore_check, count tables, drop it
// Requires pg_dump/psql on PATH (PostgreSQL bin). Prod uses the platform's
// scheduled backups; this script proves a dump restores cleanly.
import { execFileSync } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';

const PG_BIN = 'C:\\Program Files\\PostgreSQL\\16\\bin';
const BASE_ENV = { ...process.env, PGPASSWORD: 'postgres' };
const mode = process.argv[2];

function pgDump(args, env = BASE_ENV) {
  execFileSync(path.join(PG_BIN, 'pg_dump.exe'), args, { env, stdio: 'inherit' });
}

if (mode === 'backup') {
  const out =
    process.argv[3] ||
    path.join('backups', `loyl-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.sql`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  pgDump(['-h', 'localhost', '-U', 'postgres', '-d', 'loyl_db', '-F', 'p', '-f', out]);
  console.log(`BACKUP OK: ${out} (${fs.statSync(out).size} bytes)`);
} else if (mode === 'restore') {
  const file = process.argv[3];
  if (!file || !fs.existsSync(file)) throw new Error('restore needs an existing dump file');
  const psql = path.join(PG_BIN, 'psql.exe');
  execFileSync(psql, ['-h', 'localhost', '-U', 'postgres', '-d', 'postgres', '-c', 'DROP DATABASE IF EXISTS loyl_restore_check'], { env: BASE_ENV, stdio: 'inherit' });
  execFileSync(psql, ['-h', 'localhost', '-U', 'postgres', '-d', 'postgres', '-c', 'CREATE DATABASE loyl_restore_check'], { env: BASE_ENV, stdio: 'inherit' });
  execFileSync(psql, ['-h', 'localhost', '-U', 'postgres', '-d', 'loyl_restore_check', '-f', file], { env: BASE_ENV, stdio: 'inherit' });
  const count = execFileSync(
    psql,
    ['-h', 'localhost', '-U', 'postgres', '-d', 'loyl_restore_check', '-tA', '-c',
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"],
    { env: BASE_ENV, encoding: 'utf8' }
  ).trim();
  console.log(`RESTORE OK: ${count} tables in loyl_restore_check`);
  execFileSync(psql, ['-h', 'localhost', '-U', 'postgres', '-d', 'postgres', '-c', 'DROP DATABASE loyl_restore_check'], { env: BASE_ENV, stdio: 'inherit' });
  console.log('RESTORE CLEANUP OK');
} else {
  throw new Error('usage: node scripts/backup-db.mjs [backup [outFile] | restore <file>]');
}
