/** Make Tesseract worker, core WASM and English data same-origin.
 * No runtime OCR CDN downloads; generated public/ocr is not checked in.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
const nodeModules = resolve('node_modules');
const output = resolve('public/ocr');
const core = join(nodeModules, 'tesseract.js-core');
const worker = join(nodeModules, 'tesseract.js/dist/worker.min.js');
const lang = join(nodeModules, '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz');
if (![worker,core,lang].every(existsSync)) {
  throw new Error('Missing offline OCR dependency. Run npm install before preparing OCR assets.');
}
mkdirSync(join(output,'core'),{recursive:true});
mkdirSync(join(output,'lang'),{recursive:true});
copyFileSync(worker,join(output,'worker.min.js'));
const names = readdirSync(core).filter(name=>/^tesseract-core.*\.(?:js|wasm)$/.test(name));
for (const name of names) copyFileSync(join(core,name),join(output,'core',name));
if (!names.some(name=>name.endsWith('.wasm'))) throw new Error('Missing OCR WebAssembly runtime');
copyFileSync(lang,join(output,'lang','eng.traineddata.gz'));
process.stdout.write('Local OCR assets ready.\n');
