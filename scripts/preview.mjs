import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const base = process.env.BASE_PATH || '/dear-wallet/';
if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) throw new Error('BASE_PATH must be / or /directory/ with a trailing slash.');
await readFile(path.join(root, 'index.html')); // Fail early if npm run build has not run.
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (base !== '/' && pathname === base.slice(0, -1)) { res.writeHead(308, { Location:base }); res.end(); return; }
    if (!pathname.startsWith(base)) throw new Error('Not found');
    const relative = pathname.slice(base.length) || 'index.html';
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || relative.split('/').some(part => part.startsWith('.'))) throw new Error('Not found');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type':types[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff', 'Cache-Control':'no-cache' }); res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(Number(process.env.PORT || 4173), '0.0.0.0', () => console.log(`Built-site preview ready: base ${base}, port ${process.env.PORT || 4173}`));
