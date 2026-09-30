// PoC for T-01: malformed JSON must be 422, never 500.
// Usage: node audit/pocs/t01-malformed-json.mjs [baseUrl]
// (dev server must be running; localhost/staging ONLY per RULE 4)
//
// Guard order (CODIN §3) runs BEFORE body parsing: routes behind withAuth
// answer 401 to a sessionless caller without ever touching the body — that
// 401 is correct, not a T-01 failure. Only public-parse routes can 500.
const base = process.argv[2] || 'http://localhost:3111';
if (!/localhost|127\.0\.0\.1|staging\./.test(base)) {
  console.error('REFUSING: target is not localhost/staging');
  process.exit(2);
}
// Public routes: parse runs pre-guard → malformed JSON must be 422.
const publicTargets = [
  '/api/auth/otp/send',
  '/api/auth/otp/verify',
  '/api/admin/login',
];
// Guarded routes, no session: guard fires first → 401 proves guard order.
const guardedTargets = [
  { path: '/api/customer/scan', method: 'POST' },
  { path: '/api/merchant/settings', method: 'PATCH' },
];
let fail = 0;
for (const t of publicTargets) {
  const r = await fetch(base + t, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'not-json{{{',
  });
  const ok = r.status === 422;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${t} => ${r.status} (want 422)`);
  if (!ok) fail++;
}
for (const t of guardedTargets) {
  const r = await fetch(base + t.path, {
    method: t.method,
    headers: { 'content-type': 'application/json' },
    body: 'not-json{{{',
  });
  const ok = r.status === 401;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${t.path} => ${r.status} (want 401 guard-first)`);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
