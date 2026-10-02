// Validates EPUB files with the official W3C EPUBCheck (needs Java).
// Usage: node scripts/epubcheck.mjs file1.epub [file2.epub ...]
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jar = join(dirname(require.resolve('epubcheck-static/package.json')), 'vendor', 'epubcheck.jar');
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('No EPUB files given');
  process.exit(1);
}
let failed = false;
for (const f of files) {
  const r = spawnSync('java', ['-jar', jar, f], { stdio: 'inherit' });
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
