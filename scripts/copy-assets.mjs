// Copies the OCR engine, language data and PDF helper files into public/vendor
// so the site serves them itself (works offline, no third-party CDN needed).
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));
const out = join(process.cwd(), 'public', 'vendor');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'tesseract', 'core'), { recursive: true });
mkdirSync(join(out, 'tesseract', 'lang'), { recursive: true });

const tess = pkgDir('tesseract.js');
cpSync(join(tess, 'dist', 'worker.min.js'), join(out, 'tesseract', 'worker.min.js'));

// LSTM-only cores: the app always uses the LSTM engine, so the larger legacy cores are skipped.
const core = pkgDir('tesseract.js-core');
for (const f of [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
]) {
  cpSync(join(core, f), join(out, 'tesseract', 'core', f));
}

const eng = pkgDir('@tesseract.js-data/eng');
cpSync(join(eng, '4.0.0_best_int', 'eng.traineddata.gz'), join(out, 'tesseract', 'lang', 'eng.traineddata.gz'));

const pdfjs = pkgDir('pdfjs-dist');
for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  if (existsSync(join(pdfjs, d))) cpSync(join(pdfjs, d), join(out, 'pdfjs', d), { recursive: true });
}

console.log('Copied OCR and PDF assets to public/vendor');
