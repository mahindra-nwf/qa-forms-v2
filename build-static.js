// Writes a read-only copy of the app to _site/ for GitHub Pages: the page plus every
// API answer saved as a plain .json file. Run: node build-static.js
const fs = require('fs');
const path = require('path');
const { ROOT, PRODUCTS, PLANT, LIBRARY, REGIONS, readJson, sheetFiles, sheetInfo, listProducts, plantFolder,
  listRegions, regionDetail, fillLog } = require('./server.js');

const OUT = path.join(ROOT, '_site');
fs.rmSync(OUT, { recursive: true, force: true });
const write = (rel, data) => {
  const f = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data));
};
const copySheets = (d, rel) => sheetFiles(d).forEach(f => write(path.join(rel, f), readJson(path.join(d, f))));

const products = listProducts();
write('api/products.json', products);
write('api/plant.json', plantFolder());
write('api/library.json', sheetFiles(LIBRARY).map(f => sheetInfo(LIBRARY, f)));
products.forEach(p => copySheets(path.join(PRODUCTS, p.brand, p.folder), path.join('api/products', p.brand, p.folder, 'sheets')));
copySheets(PLANT, 'api/plant/sheets');

// Regions: the list, each region, its line logs, and every product log filled in for that product.
const regions = listRegions();
write('api/regions.json', regions);
regions.forEach(r => {
  const d = regionDetail(r.id), base = path.join('api/regions', r.id), logDir = path.join(REGIONS, r.id, 'logs');
  write(base + '.json', d);
  d.logs.filter(l => l.scope === 'line').forEach(l => write(path.join(base, 'logs', l.file), readJson(path.join(logDir, l.file))));
  d.products.forEach(p => d.logs.filter(l => l.scope === 'product').forEach(l =>
    write(path.join(base, 'products', p.folder, 'logs', l.file), fillLog(readJson(path.join(logDir, l.file)), p, d))));
});

const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
if (!html.includes('const STATIC = false;')) throw new Error('index.html is missing the STATIC switch');
write('index.html', html.replace('const STATIC = false;', 'const STATIC = true;'));
write('.nojekyll', '');
console.log(`Static demo written to ${OUT}`);
