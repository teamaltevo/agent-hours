import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';

// Development-only vendoring. Neither the CLI nor the Worker reads node_modules
// at report-generation time; the text import is bundled as an offline asset.
const root=resolve(import.meta.dir,'..');
const pkg=JSON.parse(await readFile(resolve(root,'node_modules/chart.js/package.json'),'utf8'));
const app=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
if(app.devDependencies['chart.js']!==pkg.version)throw new Error('Chart.js must match the exact pinned version');
const license=await readFile(resolve(root,'node_modules/chart.js/LICENSE.md'),'utf8');
const runtime=(await readFile(resolve(root,'node_modules/chart.js/dist/chart.umd.min.js'),'utf8')).replace(/\/\/# sourceMappingURL=[^\r\n]*/g,'');
if(/<\/script/i.test(runtime)||/\*\//.test(license))throw new Error('Unexpected inline-script delimiter in vendor asset');
const output=resolve(root,'src/vendor/chart-runtime.txt');await mkdir(dirname(output),{recursive:true});
await writeFile(output,'/* Chart.js '+pkg.version+' — bundled for offline reports.\n'+license+'\n*/\n'+runtime.trim()+'\n');
console.log('Vendored Chart.js '+pkg.version+' with its MIT license.');
