// Lighthouse JSON comparison/report helper (node qa/lh-report.mjs <file> [...])
import { readFileSync } from 'node:fs';

for (const f of process.argv.slice(2)) {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  const cats = Object.values(j.categories)
    .map((c) => `${c.title}=${Math.round(c.score * 100)}`)
    .join('  ');
  console.log(`\n== ${f} (LH ${j.lighthouseVersion})  ${cats}`);
  const perf = j.categories.performance.auditRefs.filter((r) => r.weight > 0);
  for (const r of perf) {
    const a = j.audits[r.id];
    console.log(`  w=${r.weight} score=${a.score} ${r.id} => ${a.displayValue ?? ''}`);
  }
  const dump = (id, fmt) => {
    const items = j.audits[id]?.details?.items ?? [];
    console.log(`  ${id}: ${items.length} items`);
    for (const it of items.slice(0, 10)) console.log('    ' + fmt(it));
  };
  dump('bootup-time', (it) => `${Math.round(it.total)}ms (${Math.round(it.scripting)} script) ${it.url ?? it.entity ?? ''}`);
  dump('long-tasks', (it) => `${it.duration}ms @ ${Math.round(it.startTime)} ${it.url ?? ''}`);
  dump('network-requests', (it) => `${Math.round(it.networkEndTime)}ms ${String(it.transferSize).padStart(7)}B ${(it.url || '').replace('http://localhost:3000', '')}`);
}
