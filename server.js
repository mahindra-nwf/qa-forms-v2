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
const PORT = process.env.PORT || 8080;

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
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let s = ''; for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
}

// build-static.js reuses these to write the read-only GitHub Pages demo.
module.exports = { ROOT, PRODUCTS, PLANT, LIBRARY, readJson, sheetFiles, sheetInfo, listProducts, plantFolder };
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
    if (url.pathname === '/api/plant' && req.method === 'GET') return send(res, 200, plantFolder());
    if (parts[0] === 'api' && parts[1] === 'plant' && parts[2] === 'sheets') { plantFolder(); return sheetRoute(req, res, PLANT, parts[3]); }

    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(ROOT, 'public', 'index.html')));
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
}).listen(PORT, () => console.log(`QA app on http://localhost:${PORT}`));
