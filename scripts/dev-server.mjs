/**
 * Servidor local para testar antes de subir (imita o Vercel: arquivos estáticos + /api/*).
 * Uso: DATABASE_URL=... ADMIN_PASSWORD=... APP_SECRET=... npm run dev
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const port = Number(process.env.PORT) || 3000;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.ico': 'image/x-icon' };
const handlers = {};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    const m = url.pathname.match(/^\/api\/([a-z-]+)\/?$/);
    if (m) {
      const file = path.join(root, 'api', m[1] + '.js');
      if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
      handlers[m[1]] ||= (await import(pathToFileURL(file).href)).default;
      return await handlers[m[1]](req, res);
    }
    let p = path.join(pub, decodeURIComponent(url.pathname));
    if (!p.startsWith(pub)) { res.statusCode = 404; return res.end('not found'); }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { res.statusCode = 404; return res.end('not found'); }
    const stat = fs.statSync(p);
    const type = types[path.extname(p)] || 'application/octet-stream';
    const range = req.headers.range;
    if (range && type === 'video/mp4') {
      const [s, e] = range.replace('bytes=', '').split('-');
      const start = Number(s), end = e ? Number(e) : stat.size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      return fs.createReadStream(p, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size });
    fs.createReadStream(p).pipe(res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.statusCode = 500; res.end('erro'); }
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
