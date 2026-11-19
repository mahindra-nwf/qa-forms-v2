// Local QA app: serves public/ and reads product folders from products/<Brand>/<Product>/.
// Each product folder has a product.json and the log sheets (form .json files) that belong to it.
// plant/ holds the plant-wide log sheets (SSOP, receiving, shipping) that aren't tied to one product.
// No dependencies: run with `node server.js` and open http://localhost:8080
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PRODUCTS = path.join(ROOT, 'products');
const PLANT = path.join(ROOT, 'plant');
const LIBRARY = path.join(ROOT, 'forms', 'samples');
const PORT = process.env.PORT || process.argv[2] || 8080; // e.g. node server.js 8081

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const dirs = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort() : [];
const sheetFiles = d => fs.readdirSync(d).filter(f => f.endsWith('.json') && f !== 'product.json' && f !== 'folder.json').sort();
const sheetInfo = (d, file) => { const j = readJson(path.join(d, file)); return { file, name: j.name, code: j.code || '' }; };

// Folder names come from the URL, so refuse anything that could step outside products/ or forms/samples/.
const safe = s => s && !/[\\/]|^\.\.?$/.test(s);

function listProducts() {
  return dirs(PRODUCTS).flatMap(brand => dirs(path.join(PRODUCTS, brand)).map(folder => {
    const d = path.join(PRODUCTS, brand, folder), meta = path.join(d, 'product.json');
    return { brand, folder, ...(fs.existsSync(meta) ? readJson(meta) : { name: folder }), sheets: sheetFiles(d).map(f => sheetInfo(d, f)) };
  }).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name)));
}

function plantFolder() {
  if (!fs.existsSync(PLANT)) fs.mkdirSync(PLANT);
  const meta = path.join(PLANT, 'folder.json');
  return { name: 'Plant-wide', ...(fs.existsSync(meta) ? readJson(meta) : {}), sheets: sheetFiles(PLANT).map(f => sheetInfo(PLANT, f)) };
}

// Regions: regions/<Region>/region.json, logs/ (each log defined once, scope "line" or "product")
// and products/<Product>/product.json. A product's log sheets are the region's "product" logs,
// filled in with that product's details.
const REGIONS = path.join(ROOT, 'regions');
const byOrder = (a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name);
const jsonIn = d => fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.json')).sort() : [];

function regionLogs(r) {
  const d = path.join(REGIONS, r, 'logs');
  return jsonIn(d).map(file => { const j = readJson(path.join(d, file)); return { file, name: j.name, code: j.code || '', scope: j.scope || 'line', ...(j.placeholder ? { placeholder: true } : {}), ...(j.nameIf ? { nameIf: j.nameIf } : {}) }; });
}

function regionProducts(r) {
  const d = path.join(REGIONS, r, 'products');
  return dirs(d).map(folder => {
    const meta = path.join(d, folder, 'product.json');
    return { folder, ...(fs.existsSync(meta) ? readJson(meta) : { name: folder }) };
  }).sort(byOrder);
}

function regionInfo(r) {
  const meta = path.join(REGIONS, r, 'region.json');
  return { id: r, ...(fs.existsSync(meta) ? readJson(meta) : { name: r }) };
}

const listRegions = () => dirs(REGIONS).map(r => ({ ...regionInfo(r), products: regionProducts(r).length, logs: regionLogs(r) })).sort(byOrder);
const regionDetail = r => ({ ...regionInfo(r), logs: regionLogs(r), products: regionProducts(r) });

// Fill a product log with the product's details:
//   field.prefill: "item"      → default from product.item ("region" → the region name)
//   table.rowsFrom: "materials.packaging" → one fixed row per entry in that list; the row shows
//     its name/material (and spec underneath), and matching column ids are filled in
//   column.each: "components"  → repeat the column for each component ("{name}" in the label)
// Without the product details the template's own fixedRows/columns are used.
function fillLog(form, product, region) {
  const value = key => key === 'region' ? region.name : product[key];
  const comps = product.components?.length ? product.components : null;
  // nameIf: a different name for some products, e.g. "Walmart Packaging…" when the customer is Walmart
  if (form.nameIf && product[form.nameIf.field] === form.nameIf.value) form.name = form.nameIf.name;
  for (const sec of form.sections) for (const f of sec.fields) {
    if (f.prefill && value(f.prefill)) f.default = value(f.prefill);
    // info table rowsFor: keep only the reference rows whose first cell is this product's value (e.g. its roll type)
    if (f.rowsFor && product[f.rowsFor]) { const mine = f.body.filter(r => r[0] === product[f.rowsFor]); if (mine.length) f.body = mine;
      const keep = f.head.map((h, i) => f.body.some(r => r[i] && r[i] !== '—'));  // drop columns that are empty for this product
      f.head = f.head.filter((h, i) => keep[i]); f.body = f.body.map(r => r.filter((v, i) => keep[i])); }
    const rows = f.rowsFrom && f.rowsFrom.split('.').reduce((o, k) => o?.[k], product);
    if (rows?.length) f.fixedRows = rows.map(r => ({ label: r.name ?? r.material, sub: r.spec, values: r }));
    if (f.columns) f.columns = f.columns.flatMap(c => {
      if (!c.each) return [c];
      const names = (comps || [{ name: 'item 1' }, { name: 'item 2' }]).map(x => x.name);
      return names.map((n, i) => ({ ...c, each: undefined, id: c.id + (i + 1), label: c.label.replace('{name}', n) }));
    });
  }
  return form;
}

// Read one log sheet (GET .../<file>), add one from the library to folder d (POST { file }),
// or remove one (DELETE .../<file>).
async function sheetRoute(req, res, d, file) {
  if (req.method === 'GET' && sheetFiles(d).includes(file)) return send(res, 200, readJson(path.join(d, file)));
  if (req.method === 'POST') {
    const { file: pick } = await body(req);
    if (!safe(pick) || !fs.existsSync(path.join(LIBRARY, pick))) return send(res, 400, { error: 'No such log sheet' });
    fs.copyFileSync(path.join(LIBRARY, pick), path.join(d, pick));
    return send(res, 200, sheetInfo(d, pick));
  }
  if (req.method === 'DELETE' && sheetFiles(d).includes(file)) {
    fs.unlinkSync(path.join(d, file)); // removes this folder's copy; the library original stays
    return send(res, 200, { ok: true });
  }
  send(res, 404, { error: 'Not found' });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let s = ''; for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
}

// build-static.js reuses these to write the read-only GitHub Pages demo.
module.exports = { ROOT, PRODUCTS, PLANT, LIBRARY, REGIONS, readJson, sheetFiles, sheetInfo, listProducts, plantFolder,
  listRegions, regionDetail, regionInfo, regionProducts, fillLog };
if (require.main !== module) return;

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  try {
    if (url.pathname === '/api/products' && req.method === 'GET') return send(res, 200, listProducts());
    if (url.pathname === '/api/library' && req.method === 'GET') return send(res, 200, sheetFiles(LIBRARY).map(f => sheetInfo(LIBRARY, f)));

    // /api/products/<brand>/<folder>/sheets[/<file>]
    if (parts[0] === 'api' && parts[1] === 'products' && parts[4] === 'sheets') {
      const [, , brand, folder, , file] = parts;
      const d = path.join(PRODUCTS, brand, folder);
      if (![brand, folder].every(safe) || !fs.existsSync(d)) return send(res, 404, { error: 'No such product' });
      return sheetRoute(req, res, d, file);
    }
    // /api/regions, /api/regions/<r>, /api/regions/<r>/logs/<file>,
    // /api/regions/<r>/products/<folder>/logs/<file>
    if (parts[0] === 'api' && parts[1] === 'regions' && req.method === 'GET') {
      const [, , r, kind, a, b, c] = parts;
      if (!r) return send(res, 200, listRegions());
      if (![r, kind, a, b, c].every(x => x === undefined || safe(x)) || !fs.existsSync(path.join(REGIONS, r))) return send(res, 404, { error: 'No such region' });
      if (!kind) return send(res, 200, regionDetail(r));
      const logs = regionLogs(r);
      const logFile = path.join(REGIONS, r, 'logs', kind === 'logs' ? a : c || '');
      if (kind === 'logs' && logs.some(l => l.file === a && l.scope === 'line')) return send(res, 200, readJson(logFile));
      if (kind === 'products' && b === 'logs' && logs.some(l => l.file === c && l.scope === 'product')) {
        const p = regionProducts(r).find(p => p.folder === a);
        if (p) return send(res, 200, fillLog(readJson(logFile), p, regionInfo(r)));
      }
      return send(res, 404, { error: 'Not found' });
    }
    if (url.pathname === '/api/plant' && req.method === 'GET') return send(res, 200, plantFolder());
    if (parts[0] === 'api' && parts[1] === 'plant' && parts[2] === 'sheets') { plantFolder(); return sheetRoute(req, res, PLANT, parts[3]); }

    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      // /ipad: development preview of the app inside an iPad 9th gen frame (local only, not in the Pages demo)
      const page = url.pathname === '/ipad' ? 'ipad.html' : 'index.html';
      return res.end(fs.readFileSync(path.join(ROOT, 'public', page)));
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
}).listen(PORT, () => console.log(`QA app on http://localhost:${PORT}`));
