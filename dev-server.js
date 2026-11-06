// Servidor local para testes: node dev-server.js  (usa banco em memória/arquivo se não houver Upstash)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
process.env.LOCAL_DB_FILE ||= '.local-db.json';
const { default: handler } = await import('./api/index.js');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
http.createServer(async (req, res) => {
  if (req.url.startsWith('/api')) {
    let raw = ''; for await (const c of req) raw += c;
    req.body = raw ? JSON.parse(raw) : {};
    res.status = (s) => { res.statusCode = s; return res; };
    res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    return handler(req, res);
  }
  let f = path.join('public', decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith('/') || !path.extname(f)) f = path.join('public', 'index.html');
  fs.readFile(f, (e, d) => { if (e) { res.statusCode = 404; return res.end('404'); } res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream'); res.end(d); });
}).listen(process.env.PORT || 3000, () => console.log('http://localhost:' + (process.env.PORT || 3000)));
