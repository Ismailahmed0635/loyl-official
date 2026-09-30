const { execSync } = require('child_process');
try {
  const output = execSync('cd D:\\loyl.io\\frontend && npx tsc --noEmit', { encoding: 'utf8', timeout: 120000 });
  console.log(output);
} catch(e) {
  console.error(e.stdout || e.stderr || e.message);
}